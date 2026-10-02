#!/usr/bin/env bash
# Only called by the main-branch release job after all OS checks pass.
set -euo pipefail
: "${GH_TOKEN:?}" "${GH_REPO:?}" "${RELEASE_SHA:?}" "${RELEASE_RUN_ID:?}"
current_sha=$(gh api "repos/$GH_REPO/commits/main" --jq .sha)
if [[ "$current_sha" != "$RELEASE_SHA" ]]; then
  echo "A newer commit is on main; skip publishing this superseded build."
  exit 0
fi
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
  assert manifest["version"] == version
  assert manifest["manifest_version"] == 3
  assert archive.testzip() is None
  for resource in [manifest["action"]["default_popup"], *manifest["icons"].values()]:
    assert resource in archive.namelist()
zip_data = source.read_bytes()
checksum = hashlib.sha256(zip_data).hexdigest()
out = Path("release-output")
(out / "cookiess-latest.zip").write_bytes(zip_data)
(out / "SHA256SUMS.txt").write_text(f"{checksum}  cookiess-latest.zip\n")
metadata = {"version": version, "commit": os.environ["RELEASE_SHA"], "sha256": checksum,
            "ci": f"https://github.com/{os.environ['GH_REPO']}/actions/runs/{os.environ['RELEASE_RUN_ID']}"}
(out / "build-info.json").write_text(json.dumps(metadata, indent=2) + "\n")
(out / "notes.md").write_text(
  f"Автоматическая сборка main после успешного CI на Linux, Windows и macOS.\n\n"
  f"Версия: {version}\n\nКоммит: `{metadata['commit']}`\n\n"
  f"[Проверки CI]({metadata['ci']})\n\n"
  f"Скачайте cookiess-latest.zip, распакуйте в папку расширения и нажмите Обновить в chrome://extensions.\n\n"
  f"Этот релиз обновляется при следующей успешной сборке main. SHA256: `{checksum}`.\n")
PYTHON
# The moving tag is reserved for this rolling prerelease, never for versioned releases.
git tag --force latest-build "$RELEASE_SHA"
git push origin refs/tags/latest-build --force
if gh release view latest-build --repo "$GH_REPO" >/dev/null 2>&1; then
  gh release upload latest-build release-output/cookiess-latest.zip release-output/SHA256SUMS.txt release-output/build-info.json --clobber --repo "$GH_REPO"
  gh release edit latest-build --title "Cookiess — свежая сборка main" --notes-file release-output/notes.md --prerelease --latest=false --repo "$GH_REPO"
else
  gh release create latest-build release-output/cookiess-latest.zip release-output/SHA256SUMS.txt release-output/build-info.json --verify-tag --title "Cookiess — свежая сборка main" --notes-file release-output/notes.md --prerelease --latest=false --repo "$GH_REPO"
fi
