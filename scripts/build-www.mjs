// Copies the static web app into www/ (the folder Capacitor bundles into the iOS app).
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'vendor']) {
  cpSync(join(root, f), join(out, f), { recursive: true });
}
console.log('Built www/');
