#!/usr/bin/env bash
#
# Cut a new desktop release: bump the version, commit, tag, and push — which
# triggers .github/workflows/release.yml to build the universal macOS DMG and
# publish a GitHub Release.
#
# Usage:
#   ./scripts/release.sh 0.3.0      # explicit version
#   ./scripts/release.sh patch      # 0.1.2 -> 0.1.3
#   ./scripts/release.sh minor      # 0.1.2 -> 0.2.0
#   ./scripts/release.sh major      # 0.1.2 -> 1.0.0
#   ./scripts/release.sh 0.3.0 --dry-run   # show what would happen, change nothing
#
# Safety: must be on `main`, clean working tree, in sync with origin/main, and
# the target version must be higher than the current one with no existing tag.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

DESKTOP_PKG="apps/desktop/package.json"
ROOT_PKG="package.json"
RELEASE_BRANCH="main"

die() { echo "error: $*" >&2; exit 1; }

ARG="${1:-}"
DRY_RUN=0
[[ "${2:-}" == "--dry-run" || "${1:-}" == "--dry-run" ]] && DRY_RUN=1
[[ "$ARG" == "--dry-run" ]] && ARG=""

[[ -n "$ARG" ]] || die "usage: $0 <version|patch|minor|major> [--dry-run]"

CURRENT="$(node -p "require('./$DESKTOP_PKG').version")"

# Resolve the target version (explicit X.Y.Z, or a semver bump keyword).
case "$ARG" in
  major|minor|patch)
    NEW="$(node -e "const [a,b,c]=require('./$DESKTOP_PKG').version.split('.').map(Number);
      const k='$ARG';
      console.log(k==='major'?\`\${a+1}.0.0\`:k==='minor'?\`\${a}.\${b+1}.0\`:\`\${a}.\${b}.\${c+1}\`)")"
    ;;
  [0-9]*.[0-9]*.[0-9]*)
    NEW="$ARG"
    ;;
  *)
    die "version must be X.Y.Z or one of: patch|minor|major (got '$ARG')"
    ;;
esac

TAG="v$NEW"
echo "Current version: $CURRENT"
echo "New version:     $NEW  (tag $TAG)"
echo

# --- Preflight checks ------------------------------------------------------
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "$RELEASE_BRANCH" ]] || die "must be on '$RELEASE_BRANCH' (on '$BRANCH'). Run: git checkout $RELEASE_BRANCH"
[[ -z "$(git status --porcelain)" ]] || die "working tree not clean — commit or stash first"

# Higher than current?
node -e "const c='$CURRENT'.split('.').map(Number),n='$NEW'.split('.').map(Number);
  const gt=n[0]>c[0]||(n[0]==c[0]&&(n[1]>c[1]||(n[1]==c[1]&&n[2]>c[2])));
  process.exit(gt?0:1)" \
  || die "new version $NEW is not greater than current $CURRENT"

# Tag must not already exist (locally or remotely).
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "tag $TAG already exists locally"
if git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
  die "tag $TAG already exists on origin"
fi

# In sync with origin/main so the release builds what's published.
git fetch origin "$RELEASE_BRANCH" --quiet
LOCAL="$(git rev-parse @)"
REMOTE="$(git rev-parse "origin/$RELEASE_BRANCH")"
[[ "$LOCAL" == "$REMOTE" ]] || die "local $RELEASE_BRANCH differs from origin/$RELEASE_BRANCH — pull/push first"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] would bump $DESKTOP_PKG and $ROOT_PKG to $NEW, commit 'release: $TAG', push $RELEASE_BRANCH, then tag+push $TAG."
  exit 0
fi

# --- Do it -----------------------------------------------------------------
# Bump version in both package.json files (first "version" field only).
for f in "$DESKTOP_PKG" "$ROOT_PKG"; do
  node -e "const fs=require('fs');const p='$f';const j=fs.readFileSync(p,'utf8');
    fs.writeFileSync(p, j.replace(/\"version\": \"[^\"]*\"/, '\"version\": \"$NEW\"'));"
  echo "bumped $f -> $NEW"
done

git commit -aqm "release: $TAG"
git push origin "$RELEASE_BRANCH"

git tag -a "$TAG" -m "AI Reading Assistant $TAG (macOS universal)"
git push origin "$TAG"

echo
echo "✓ Pushed $TAG. CI is building the release now:"
echo "  https://github.com/tuanh2000/ai-reading-assistant/actions"
echo "  Release will appear at: https://github.com/tuanh2000/ai-reading-assistant/releases/tag/$TAG"
