# Releasing the desktop app

Releases are built and published automatically by GitHub Actions
(`.github/workflows/release.yml`). Pushing a version tag produces a macOS DMG
and attaches it to a public GitHub Release that anyone can download from the
repo's **Releases** page.

## Cut a release (the easy way)

From a clean `main`, run one command:

```bash
pnpm release 0.3.0     # explicit version
pnpm release patch     # 0.1.2 -> 0.1.3
pnpm release minor     # 0.1.2 -> 0.2.0
pnpm release major     # 0.1.2 -> 1.0.0
pnpm release 0.3.0 --dry-run   # preview, change nothing
```

`scripts/release.sh` bumps the version in both `package.json` files, commits
`release: vX.Y.Z`, pushes `main`, then creates and pushes the tag (which
triggers the build). It refuses to run unless you're on `main`, the tree is
clean, you're in sync with `origin/main`, the new version is higher than the
current one, and the tag doesn't already exist — so it can't produce the
tag/version mismatch that failed earlier.

The manual steps below are equivalent, for reference / when you can't use the
script.

## Cut a release (manual)

Releases are cut from the **`main`** branch. The golden rule:

> **Bump the version FIRST, commit it, THEN tag.** The tag (`vX.Y.Z`) must equal
> the version in `apps/desktop/package.json` (`X.Y.Z`) or CI fails at the
> "Verify tag matches app version" step. Never reuse a version that already
> shipped.

Example — releasing **0.3.0** (substitute your version):

```bash
# 0. Be on main and up to date
git checkout main && git pull origin main

# 1. Bump the version in BOTH apps/desktop/package.json and the root package.json
#    (this one-liner does both; macOS sed shown)
sed -i '' 's/"version": "[^"]*"/"version": "0.3.0"/' apps/desktop/package.json package.json

# 2. Commit and push the bump
git commit -am "release: v0.3.0"
git push origin main

# 3. Tag and push the tag — THIS is what triggers the release build
git tag v0.3.0
git push origin v0.3.0
```

Then watch the **Actions** tab. On success a Release named `v0.3.0` appears with
`AI Reading Assistant-0.3.0-universal.dmg` attached (runs on Apple Silicon and
Intel), and users on older versions get the in-app update notification on their
next launch.

> The workflow file must exist in the tagged commit, so always push `main`
> before tagging.

### Fixing a tag/version mismatch

If you already pushed a tag that doesn't match the version (the build fails the
guard), bump the version on `main` to match, then move the tag:

```bash
# after committing the correct version bump on main:
git tag -d v0.3.0                       # delete local tag
git push origin :refs/tags/v0.3.0       # delete remote tag
git tag v0.3.0                          # recreate on the bumped commit
git push origin v0.3.0                  # re-trigger the build
```

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
