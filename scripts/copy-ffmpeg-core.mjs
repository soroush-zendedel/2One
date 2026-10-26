import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const destination = path.join(root, 'public', 'ffmpeg');
await mkdir(destination, { recursive: true });
for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  await copyFile(path.join(source, file), path.join(destination, file));
}
console.log('Copied the single-thread FFmpeg WebAssembly core into public/ffmpeg.');
