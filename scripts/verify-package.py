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
  # Every __MSG_key__ in the manifest must exist in every locale, and locales must agree.
  default = manifest.get("default_locale")
  locales = {n.split("/")[1] for n in names if n.startswith("_locales/") and n.endswith("/messages.json")}
  assert default in locales, f"default_locale {default} has no messages.json"
  catalogs = {loc: json.loads(archive.read(f"_locales/{loc}/messages.json")) for loc in locales}
  keys = set(catalogs[default])
  for loc, catalog in catalogs.items():
    assert set(catalog) == keys, f"Locale {loc} keys differ from {default}"
  used = set()
  def collect(value):
    if isinstance(value, str):
      used.update(m[6:-2] for m in __import__("re").findall(r"__MSG_\w+__", value))
    elif isinstance(value, dict):
      for v in value.values(): collect(v)
    elif isinstance(value, list):
      for v in value: collect(v)
  collect(manifest)
  assert used <= keys, f"Manifest uses missing messages: {used - keys}"
print("ZIP matches dist; MV3 manifest and referenced resources verified.")
