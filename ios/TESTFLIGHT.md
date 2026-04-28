# Shipping the iOS app to TestFlight via Xcode Cloud

If you fork Loom and want to distribute the iOS app to TestFlight, this is
the path of least resistance. No local archive step needed once Xcode Cloud
is wired up — every push to a tracked branch produces a build automatically.

## What's already in the repo

- `project.yml` — XcodeGen config; bundle id and team id live here.
- `ExportOptions.plist` — set to App Store Connect upload.
- `ci_scripts/ci_post_clone.sh` — runs `xcodegen generate` so Xcode Cloud
  has a project to build before its compile step.

You will need to change two values in `project.yml` to match your own
Apple Developer account:

- `options.bundleIdPrefix` — your reverse-DNS prefix (e.g. `com.example`)
- `settings.base.DEVELOPMENT_TEAM` — your 10-character Apple team ID
  (find it at <https://developer.apple.com/account> → Membership)

`ExportOptions.plist` and the `PRODUCT_BUNDLE_IDENTIFIER` references in
`Loom.xcodeproj/project.pbxproj` should be updated to match.

## One-time setup in App Store Connect (~5 min)

1. **Register the App** — <https://appstoreconnect.apple.com/apps> → **+** → New App
   - Platform: iOS
   - Name: whatever you like
   - Bundle ID: must match `PRODUCT_BUNDLE_IDENTIFIER` in `project.yml`.
     (Register the identifier first at
     <https://developer.apple.com/account/resources/identifiers/list> if it
     doesn't appear in the dropdown.)

2. **Create an Xcode Cloud workflow** — In App Store Connect → your app →
   **Xcode Cloud** → Get Started
   - Connect your GitHub fork.
   - **Source branch**: `main` (or any branch you want to track).
   - **Start condition**: on push, on a schedule, or manual — your call.
   - **Action**: Archive → Internal Distribution: TestFlight.
   - **Environment**: Xcode 16, macOS 14+.
   - Save & run.

3. **Add testers** — App Store Connect → your app → TestFlight
   - **Internal testers** (Apple IDs in your team) get builds immediately.
   - **External testers** require ~24h Beta App Review for the first build
     in a major version; subsequent builds skip review.

## Versioning

`MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` live in `project.yml`.
Bump `CURRENT_PROJECT_VERSION` on each release — Xcode Cloud requires
monotonically increasing build numbers.

You can also auto-increment via env vars in a custom build script if you
prefer not to bump manually.
