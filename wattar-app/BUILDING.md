# Building the Android test APK in GitHub Actions

The `Build Android APK` workflow builds an installable test APK in GitHub's cloud runners. It does not use EAS or require Android Studio on your computer.

## One-time setup

1. Keep this folder inside the Wattar repository as `wattar-app`. Keep the repository private unless you intentionally want the source code to be public.
2. In the repository, open **Settings → Secrets and variables → Actions** and add these repository secrets:
   - `GOOGLE_SERVICES_JSON`: the complete contents of the Firebase `google-services.json` file for Android package `app.wattar.mobile`. The file itself is ignored by Git and must not be committed.
   - `EXPO_PUBLIC_SUPABASE_URL`: the project's Supabase URL.
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`: the project's Supabase anon/publishable key. Do not use a service-role key.
3. Push to `master` to start the build automatically, or open **Actions → Build Android APK → Run workflow** to start it manually.
4. When the run succeeds, open it and download `wattar-android-apk-<run number>` from **Artifacts**. The download is a ZIP containing the APK and is retained for seven days.

The workflow validates the Firebase package ID and required Supabase values, runs TypeScript validation, generates Android native files from Expo config, builds a release-variant APK, and uploads it as an artifact.

This is a test build signed with the Android debug key, not a Play Store release. If an APK signed with a different key is already installed, Android may require uninstalling it before installing this test APK. Uninstalling can remove local app data.

GitHub Actions has usage limits. Public repositories generally get free standard hosted runners; private repositories use the included monthly minutes for the account's plan. Check GitHub's current Actions usage before running repeated builds.

The GitHub workflow builds the app but does not configure the service credentials used to deliver FCM push notifications; push delivery must be configured separately.
