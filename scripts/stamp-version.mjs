// CI only: append the build number to the version (1.0.2 -> 1.0.2.57) in package.json and
// the manifest, so every build has a unique, increasing Chrome version and release tag.
// Never commit the result; the checked-in version stays the human-chosen base version.
import { readFileSync, writeFileSync } from 'node:fs';
const build = process.argv[2] ?? process.env.BUILD_NUMBER;
if (!/^\d+$/.test(build ?? '') || Number(build) > 65535)
  throw new Error('Usage: stamp-version.mjs <build number 0..65535>');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version))
  throw new Error(`Base version must be X.Y.Z, got ${pkg.version}`);
const version = `${pkg.version}.${build}`;
for (const file of ['package.json', 'public/manifest.json']) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.version = version;
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
console.log(version);
