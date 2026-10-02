"""Extract the verified install artifact for real extension browser checks."""
import json
import shutil
from pathlib import Path
from zipfile import ZipFile

version = json.loads(Path('package.json').read_text())['version']
root = Path('test-output/unpacked')
shutil.rmtree(root, ignore_errors=True)
root.mkdir(parents=True)
with ZipFile(f'artifacts/cookiess-{version}.zip') as archive:
  for name in archive.namelist():
    target = (root / name).resolve()
    assert target.is_relative_to(root.resolve()), 'Archive path escapes test directory'
  archive.extractall(root)
print(f'Extracted install ZIP for browser checks: {root.resolve()}')
