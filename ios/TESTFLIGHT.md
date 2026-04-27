# Shipping Loom to TestFlight via Xcode Cloud

Same pattern as Weave and Zeno. Once configured, every push to a tracked branch produces a TestFlight build automatically — no local archive step needed.

## What's already wired up

- `project.yml` uses team `F5YPB69R7A` and bundle id `com.jaydermody.loom`.
- `ExportOptions.plist` set to App Store Connect upload.
- `ci_scripts/ci_post_clone.sh` runs `xcodegen generate` so Xcode Cloud has a project to build.

## One-time setup in App Store Connect (~5 min)

1. **Register the App** — https://appstoreconnect.apple.com/apps → **+** → New App
   - Platform: iOS
   - Name: Loom
   - Bundle ID: `com.jaydermody.loom` (it'll show in the dropdown after the first xcodegen registers it; if not, register at https://developer.apple.com/account/resources/identifiers/list first)
   - SKU: `loom-ios`

2. **Create an Xcode Cloud workflow** — In App Store Connect → Loom → **Xcode Cloud** → Get Started
   - Connect the GitHub repo `alpharigel/loom`.
   - **Source branch**: pick `main` (or `ios-app` for a pre-merge preview).
   - **Start condition**: "On every push" or "On a schedule" — your pick.
   - **Action**: Archive → Internal Distribution: TestFlight.
   - **Environment**: Xcode 16, macOS 14+.
   - Save & run.

3. **Add testers** — App Store Connect → Loom → TestFlight
   - **Internal**: add yourself by Apple ID. Build is available immediately after Xcode Cloud finishes.
   - **External (Lauren)**: New Group → add Lauren's Apple ID email. First external build needs ~24h Beta App Review; subsequent builds in the same major version skip review.

## Versioning

`MARKETING_VERSION` (0.1.0) and `CURRENT_PROJECT_VERSION` (1) are in `project.yml`. Bump the latter on each release — Xcode Cloud requires monotonically increasing build numbers.

You can also let Xcode Cloud auto-increment via env vars in a custom build script, but for now manual bump matches Weave/Zeno.

## What I need from you

Just confirm:
1. Xcode Cloud workflow created in App Store Connect, pointing at this repo + branch.
2. Lauren's Apple ID email (for the external tester invite — has to be done in the App Store Connect UI; the API doesn't expose tester management).
