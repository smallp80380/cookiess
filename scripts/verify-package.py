"""Verify the distributable, including content and manifest resource paths."""
import json
from pathlib import Path
from zipfile import ZipFile

root = Path("dist")
version = json.loads(Path("package.json").read_text())["version"]
with ZipFile(f"artifacts/cookiess-{version}.zip") as archive:
  names = set(archive.namelist())
  expected = {str(p.relative_to(root)).replace("\\", "/") for p in root.rglob("*") if p.is_file()}
  assert names == expected, "ZIP file set differs from dist"
  for name in names:
    assert archive.read(name) == (root / name).read_bytes(), f"Content differs: {name}"
  manifest = json.loads(archive.read("manifest.json"))
  assert manifest["manifest_version"] == 3
  assert manifest["version"] == version
  for resource in [manifest["action"]["default_popup"], *manifest["icons"].values(), *manifest["action"]["default_icon"].values()]:
    assert resource in names, f"Missing manifest resource: {resource}"
print("ZIP matches dist; MV3 manifest and referenced resources verified.")
