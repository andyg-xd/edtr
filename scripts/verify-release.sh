#!/bin/bash
# Verify that a built release is actually signed, notarized and stapled.
#
# The tests in src-tauri/src/distribution.rs guard the CONFIG. They cannot see
# the artifact, so none of them would notice a toolchain upgrade that quietly
# stopped signing — the failure this project already shipped once, as an ad-hoc
# "linker-signed" bundle that went unnoticed for a month.
#
# The app is checked INSIDE THE MOUNTED DMG, because that is the copy a
# recipient actually receives. Verifying only the build directory would miss
# anything the DMG packaging step changed.
#
# Usage:  npm run verify:release
# Exits non-zero if any check fails.

set -uo pipefail

BUNDLE="${1:-src-tauri/target/universal-apple-darwin/release/bundle}"
DMG=$(ls "$BUNDLE"/dmg/*.dmg 2>/dev/null | head -1)

fail=0
mountpoint=""

cleanup() {
  if [ -n "$mountpoint" ] && [ -d "$mountpoint" ]; then
    hdiutil detach "$mountpoint" -quiet 2>/dev/null || true
  fi
}
trap cleanup EXIT

check() {
  local label="$1"; shift
  if "$@" >/tmp/verify-release.out 2>&1; then
    echo "  PASS  $label"
  else
    echo "  FAIL  $label"
    sed 's/^/        /' /tmp/verify-release.out
    fail=1
  fi
}

if [ -z "$DMG" ]; then
  echo "  FAIL  no DMG under $BUNDLE/dmg — build it first with npm run build:release"
  exit 1
fi

echo "Verifying $DMG"

mountpoint=$(mktemp -d /tmp/edtr-verify.XXXXXX)
if ! hdiutil attach "$DMG" -mountpoint "$mountpoint" -nobrowse -quiet; then
  echo "  FAIL  could not mount $DMG"
  exit 1
fi

APP=$(ls -d "$mountpoint"/*.app 2>/dev/null | head -1)
if [ -z "$APP" ]; then
  echo "  FAIL  no .app inside the mounted DMG"
  exit 1
fi

echo "  app:  $APP"
echo

check "codesign --verify --deep --strict (inside the DMG)" \
  codesign --verify --deep --strict --verbose=2 "$APP"

check "spctl accepts the app — proves notarization took" \
  spctl -a -t exec -vv "$APP"

check "stapler validate on the app" xcrun stapler validate "$APP"
check "stapler validate on the DMG"  xcrun stapler validate "$DMG"

# The hardened runtime is only APPLIED when signing with a real identity, so
# this flag is the proof that a Developer ID signature was used, not an ad-hoc
# one. hardenedRuntime:true in tauri.conf.json is a declaration; this is effect.
# NOTE: capture first, then match. Piping codesign into `grep -q` under
# `set -o pipefail` is a race: grep exits on the first match, codesign takes
# SIGPIPE on its remaining output, and pipefail reports the pipeline as failed
# even though the pattern WAS found. It bites only when the output is long
# enough to still be writing, which made it look intermittent.
sig=$(codesign -dvvv "$APP" 2>&1)

if grep -q "flags=.*runtime" <<<"$sig"; then
  echo "  PASS  hardened runtime flag present"
else
  echo "  FAIL  hardened runtime flag absent — not signed with a real identity"
  grep -E "^(Signature|CodeDirectory|TeamIdentifier)" <<<"$sig" | sed 's/^/        /'
  fail=1
fi

if grep -q "TeamIdentifier=not set" <<<"$sig"; then
  echo "  FAIL  TeamIdentifier not set — this is an unsigned or ad-hoc build"
  fail=1
else
  team=$(grep "^TeamIdentifier=" <<<"$sig" | cut -d= -f2)
  echo "  PASS  TeamIdentifier is set ($team)"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "All checks passed. This build is safe to distribute."
else
  echo "FAILED. Do not distribute this build."
fi
exit "$fail"
