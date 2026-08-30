#!/bin/bash
# One command for a complete, distributable release.
#
# This exists because the release procedure had a step that the build does NOT
# perform and that reports success either way: Tauri notarizes and staples the
# .app, wraps it in a DMG, signs the DMG, and stops. The disk image ships
# WITHOUT a notarization ticket unless it is submitted and stapled separately.
# That was written up as a manual "step 3b" in README.md, which is exactly the
# shape of instruction that gets skipped once. It is step 4 below and it is no
# longer possible to forget it.
#
# It also runs the gate against a CLEAN INSTALL. Every gate on record read
# "tsc silent" while main itself could not typecheck anywhere but one laptop,
# because @types/node existed only as a stray in that machine's node_modules.
# A suite is green against whatever node_modules happens to contain; `npm ci`
# is what makes it a statement about the repository.
#
# Usage:  npm run release
# Safe to re-run: a DMG that already carries a ticket is not resubmitted.

set -uo pipefail

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die()  { printf '\n\033[31mFAILED: %s\033[0m\n' "$1" >&2; exit 1; }

cd "$(dirname "$0")/.." || die "cannot find the project root"

# --- Preflight ---------------------------------------------------------------
# Fail before a 20-minute build rather than after it.

step "Preflight"

missing=()
for var in APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  [ -n "${!var:-}" ] || missing+=("$var")
done
if [ ${#missing[@]} -gt 0 ]; then
  printf '  These are not set: %s\n' "${missing[*]}" >&2
  printf '  They are read from the shell, never written to disk. See README.md,\n' >&2
  printf '  "Build a signed, notarized release". Credentials live outside the repo.\n' >&2
  die "missing signing environment"
fi

command -v cargo >/dev/null || die "cargo is not on PATH — see README.md prerequisites"
command -v xcrun >/dev/null || die "xcrun not found — Xcode command line tools are required"

security find-identity -v -p codesigning 2>/dev/null | grep -qF "$APPLE_SIGNING_IDENTITY" \
  || die "signing identity not in the keychain: $APPLE_SIGNING_IDENTITY"

# An artifact must trace to a commit. A release built from a dirty tree cannot.
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  die "working tree is dirty — commit or stash first, so the artifact traces to a commit"
fi

echo "  identity, toolchain and clean tree all confirmed"

# --- The gate, against a clean install ---------------------------------------

step "Clean install (npm ci)"
npm ci || die "npm ci failed — the repo cannot install from its own lockfile"

step "Gate: typecheck and bundle"
npm run build || die "tsc / vite build failed"

step "Gate: tests"
npm test || die "test suite failed"

step "Gate: lint"
npm run lint || die "lint failed"

step "Gate: cargo check (release profile)"
cargo check --release --manifest-path src-tauri/Cargo.toml || die "cargo check failed"

# --- Build -------------------------------------------------------------------

step "Build, sign, notarize, staple the app"
echo "  Notarization takes anywhere from two minutes to about an hour."
echo "  A long wait is a busy queue, not a fault."
npm run build:release || die "release build failed"

# --- Staple the DMG (the step the build does not do) -------------------------

BUNDLE=src-tauri/target/universal-apple-darwin/release/bundle
DMG=$(ls "$BUNDLE"/dmg/*.dmg 2>/dev/null | head -1)
[ -n "$DMG" ] || die "no DMG under $BUNDLE/dmg"

step "Staple the disk image"
echo "  $DMG"

if xcrun stapler validate "$DMG" >/dev/null 2>&1; then
  echo "  already carries a ticket — not resubmitting"
else
  echo "  submitting to Apple (this waits for the result)"
  xcrun notarytool submit "$DMG" \
    --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" \
    --wait || die "DMG notarization failed"
  xcrun stapler staple "$DMG" || die "stapling the DMG failed"
  echo "  stapled"
fi

# --- Verify the artifact, not the config -------------------------------------

step "Verify the built artifact"
bash scripts/verify-release.sh || die "verification failed — do NOT distribute this build"

step "Done"
echo "  $DMG"
shasum -a 256 "$DMG" | sed 's/^/  /'
echo
echo "  Every check passed. This build is safe to distribute."
