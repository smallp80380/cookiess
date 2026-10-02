import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve('dist');
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
for (const file of [manifest.action.default_popup, ...Object.values(manifest.icons)])
  readFileSync(path.join(root, file));
mkdirSync('artifacts', { recursive: true });
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (manifest.version !== version) throw new Error('Manifest/package versions differ');
const zip = path.resolve(`artifacts/cookiess-${version}.zip`);
const result = spawnSync(
  'python3',
  [
    '-c',
    `import os, zipfile
root=${JSON.stringify(root)}
with zipfile.ZipFile(${JSON.stringify(zip)}, 'w', zipfile.ZIP_DEFLATED) as out:
 for folder, _, files in os.walk(root):
  for file in sorted(files):
   full=os.path.join(folder,file)
   out.write(full,os.path.relpath(full,root))
`,
  ],
  { stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(zip, readdirSync(root));
