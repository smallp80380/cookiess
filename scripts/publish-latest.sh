#!/usr/bin/env bash
# Only called by the main-branch release job after all OS checks pass.
# Every successful main commit gets its own release v<X.Y.Z.build>, marked Latest.
set -euo pipefail
: "${GH_TOKEN:?}" "${GH_REPO:?}" "${RELEASE_SHA:?}" "${RELEASE_RUN_ID:?}"
current_sha=$(gh api "repos/$GH_REPO/commits/main" --jq .sha)
if [[ "$current_sha" != "$RELEASE_SHA" ]]; then
  echo "A newer commit is on main; skip publishing this superseded build."
  exit 0
fi
version=$(node -p "require('./package.json').version")
tag="v$version"
if gh release view "$tag" --repo "$GH_REPO" >/dev/null 2>&1; then
  echo "Release $tag already exists (re-run); nothing to do."
  exit 0
fi
# Changes since the previous Latest release, for the notes.
previous=$(gh release view --repo "$GH_REPO" --json tagName --jq .tagName 2>/dev/null || true)
if [[ -n "$previous" ]] && git rev-parse -q --verify "refs/tags/$previous" >/dev/null; then
  changes=$(git log --no-merges --format='- %s (%h)' "$previous..$RELEASE_SHA")
else
  changes=$(git log --no-merges --format='- %s (%h)' -1 "$RELEASE_SHA")
fi
export CHANGES="${changes:-- без изменений кода}" PREVIOUS="$previous"
mkdir -p release-output
python3 - <<'PYTHON'
import hashlib
import json
import os
from pathlib import Path
from zipfile import ZipFile

version = json.loads(Path("package.json").read_text())["version"]
source = Path("artifacts") / f"cookiess-{version}.zip"
with ZipFile(source) as archive:
  manifest = json.loads(archive.read("manifest.json"))
  assert manifest["version"] == version, (manifest["version"], version)
  assert manifest["manifest_version"] == 3
  assert archive.testzip() is None
  for resource in [manifest["action"]["default_popup"], *manifest["icons"].values()]:
    assert resource in archive.namelist()
zip_data = source.read_bytes()
checksum = hashlib.sha256(zip_data).hexdigest()
out = Path("release-output")
(out / f"cookiess-{version}.zip").write_bytes(zip_data)
# Stable name: releases/latest/download/cookiess-latest.zip always points at the newest build.
(out / "cookiess-latest.zip").write_bytes(zip_data)
(out / "SHA256SUMS.txt").write_text(
  f"{checksum}  cookiess-{version}.zip\n{checksum}  cookiess-latest.zip\n")
ci = f"https://github.com/{os.environ['GH_REPO']}/actions/runs/{os.environ['RELEASE_RUN_ID']}"
metadata = {"version": version, "commit": os.environ["RELEASE_SHA"], "sha256": checksum, "ci": ci}
(out / "build-info.json").write_text(json.dumps(metadata, indent=2) + "\n")
since = f" с {os.environ['PREVIOUS']}" if os.environ.get("PREVIOUS") else ""
(out / "notes.md").write_text(
  f"Автоматическая сборка `main` после успешного CI на Linux, Windows и macOS.\n\n"
  f"## Изменения{since}\n\n{os.environ['CHANGES']}\n\n"
  f"## Установка\n\nСкачайте `cookiess-{version}.zip`, распакуйте в папку расширения и нажмите "
  f"«Обновить» в `chrome://extensions`.\n\n"
  f"Версия: {version} · коммит `{metadata['commit']}` · [проверки CI]({ci})\n\n"
  f"SHA256: `{checksum}`\n")
PYTHON
gh release create "$tag" \
  "release-output/cookiess-$version.zip" release-output/cookiess-latest.zip \
  release-output/SHA256SUMS.txt release-output/build-info.json \
  --target "$RELEASE_SHA" --title "Cookiess $version" \
  --notes-file release-output/notes.md --latest --repo "$GH_REPO"
echo "Published $tag"
