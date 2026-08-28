# Edtr

A lean macOS editor for Markdown and HTML files. Edit the source directly in Code view, or edit
the rendered document in Live view with a formatting ribbon, and switch between the two at any
time.

Edtr rewrites only the bytes you actually changed. It never reflows, re-indents, re-wraps or
tidies anything you did not touch, and that guarantee is enforced by tests rather than left to
good intentions.

## Requirements

- macOS 13 (Ventura) or later
- Node.js 18+
- Rust (stable) with `~/.cargo/bin` on your `PATH`

For a universal build that runs on both Apple Silicon and Intel, add the Intel target once:

```sh
rustup target add x86_64-apple-darwin
```

## Develop

```sh
npm install
npm run tauri dev
```

## Test

```sh
npm test        # frontend
npm run lint    # frontend lint
cd src-tauri && cargo test
```

## Build

An unsigned build, for local use only:

```sh
npm run tauri build
```

## Build a signed, notarized release

This produces the file other people install. It signs the app with a Developer ID certificate,
sends it to Apple for notarization, and staples the result so it opens without warnings even on
a machine that is offline.

You need a paid Apple Developer account, and the Developer ID Application certificate must be
in the keychain of the machine you build on.

**1. Find your signing identity.**

```sh
security find-identity -v -p codesigning
```

Copy the full name in quotes, which looks like
`Developer ID Application: Your Name (ABCDE12345)`.

**2. Create an app-specific password.** Sign in at
[appleid.apple.com](https://appleid.apple.com) and go to Sign-In and Security, then
App-Specific Passwords. This is not your Apple ID password. Your team identifier is the ten
character code shown on the Membership page of your developer account, and it is the same code
that appears in the identity above.

**3. Set the environment, then build.**

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (ABCDE12345)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCDE12345"

npm run build:release
```

Nothing here is written to disk or committed. Set the variables in the shell you build from.

That command signs the app, sends it to Apple, and staples the result to the app. Notarization
takes anywhere from two minutes to about an hour, depending on how busy Apple's queue is. A long
wait is not a sign of failure. To check on it from another shell:

```sh
xcrun notarytool history --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
```

**3b. Staple the disk image. This step is required and the build does not do it.**

The build staples the app but not the DMG that carries it, so the disk image is left without a
ticket. The app inside still works, but someone who mounts the image while offline can be told
it cannot be verified. Submit the image on its own and staple it:

```sh
DMG=src-tauri/target/universal-apple-darwin/release/bundle/dmg/Edtr_1.0.0_universal.dmg

xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
xcrun stapler staple "$DMG"
```

Do not skip this because the build reported success. It reports success either way. Step 4
fails if you forget.

**4. Check the result.**

```sh
npm run verify:release
```

This mounts the DMG and checks the app inside it, which is the copy a recipient actually
receives rather than the one left in the build directory. It verifies the signature, confirms
Apple's notarization was applied, confirms the notarization ticket is stapled to both the app
and the DMG, and confirms the hardened runtime and team identifier are really present rather
than merely configured. It exits non-zero if any of that is untrue.

The check that matters most is `spctl`, which must report **accepted**. Anything else means
notarization did not take, and the people you send the file to will be told the app cannot be
opened.

This script exists because the Rust tests in `src-tauri/src/distribution.rs` can only check the
configuration. They cannot see the built artifact, so none of them would catch a toolchain
upgrade that quietly stopped signing. That has happened here before: an ad-hoc signature shipped
unnoticed for a month.

To run the same checks by hand:

```sh
hdiutil attach src-tauri/target/universal-apple-darwin/release/bundle/dmg/Edtr_1.0.0_universal.dmg
codesign --verify --deep --strict --verbose=2 /Volumes/Edtr/Edtr.app
spctl -a -t exec -vv /Volumes/Edtr/Edtr.app
xcrun stapler validate /Volumes/Edtr/Edtr.app
xcrun stapler validate src-tauri/target/universal-apple-darwin/release/bundle/dmg/Edtr_1.0.0_universal.dmg
hdiutil detach /Volumes/Edtr
```

The finished artifacts are:

```
src-tauri/target/universal-apple-darwin/release/bundle/macos/Edtr.app
src-tauri/target/universal-apple-darwin/release/bundle/dmg/Edtr_1.0.0_universal.dmg
```

### If notarization is rejected

The rejection log names exactly what is wrong. Read it before changing anything:

```sh
xcrun notarytool log <submission-id> --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
```

Edtr ships with no entitlements file, because it does its file work in Rust and is not
sandboxed. If the log asks for an entitlement, add it then, and write down why.
