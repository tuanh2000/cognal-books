# Releasing the desktop app

Releases are built and published automatically by GitHub Actions
(`.github/workflows/release.yml`). Pushing a version tag produces a macOS DMG
and attaches it to a public GitHub Release that anyone can download from the
repo's **Releases** page.

## Cut a release

1. **Bump the version** in `apps/desktop/package.json` (and ideally the root
   `package.json`) — e.g. `0.1.0` → `0.2.0`. The CI guard fails the build if the
   tag and `apps/desktop/package.json` version don't match.
2. **Commit** the version bump.
3. **Tag and push:**
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. Watch the **Actions** tab. On success a Release named `v0.2.0` appears with
   `AI Reading Assistant-0.2.0-universal.dmg` attached (runs on Apple Silicon
   and Intel).

> The workflow file must exist in the tagged commit, so always push your branch
> (including any workflow changes) before tagging.

## Manual / test build

Trigger **Actions → Release (macOS) → Run workflow** to build the DMG without
publishing a release. The DMG is uploaded as a downloadable workflow artifact.

## What users see on first launch

The build is **not code-signed or notarized** (no Apple Developer cert), so
macOS Gatekeeper blocks it the first time. Users must either:

- Right-click the app → **Open** → **Open**, or
- Run `xattr -dr com.apple.quarantine "/Applications/AI Reading Assistant.app"`.

These instructions are included automatically in every release's notes.

## Update notifications (zero-cost)

Installed apps check for updates themselves — no server required. A few seconds
after launch the Electron main process queries the public GitHub API
(`/repos/tuanh2000/ai-reading-assistant/releases/latest`). If the latest
release tag is newer than the running version, it shows a desktop notification;
clicking it opens that release's download page. The check is best-effort and
silent on failure (offline, rate-limited, or no releases yet).

So the flow for shipping an update is just: **cut a new release (above)** →
everyone on an older version gets notified on their next launch.

This is _notify-and-download_, not silent auto-install. Full background
auto-update (electron-updater / Squirrel.Mac) would require **code-signing**
the app (paid Apple Developer account) plus a `zip` mac target; see below.

## Known limitations / follow-ups

- **Unsigned.** Proper signing + notarization removes the Gatekeeper warning but
  requires a paid Apple Developer account and CI secrets (`CSC_LINK`,
  `CSC_KEY_PASSWORD`, notarization credentials).
- **No auto-update yet.** electron-builder already emits `latest-mac.yml`; adding
  `electron-updater` would let installed apps update themselves from Releases.
