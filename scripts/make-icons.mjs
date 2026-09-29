// Renders the Bliscord icon from SVG into every format the app and installer need.
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

// Speech bubble with a tail at the lower left, and a B drawn inside it (1024 space).
const BUBBLE = 'M332 214h360c95 0 150 55 150 150v250c0 95-55 150-150 150H420l-128 104c-22 18-46 6-42-22l14-86c-72-12-114-64-114-146V364c0-95 55-150 150-150z';
const B_MARK = 'M414 330v318M414 330h118a76 76 0 0 1 0 152H414M414 482h132a83 83 0 0 1 0 166H414';

function iconSvg(size = 1024) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1f3fd6"/>
      <stop offset="0.5" stop-color="#4f7cff"/>
      <stop offset="1" stop-color="#7fc0ff"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.3" cy="0.15" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.38"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="0.4" stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.15"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#0a1a66" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect x="40" y="40" width="944" height="944" rx="236" fill="url(#bg)"/>
  <rect x="40" y="40" width="944" height="944" rx="236" fill="url(#glow)"/>
  <rect x="44" y="44" width="936" height="936" rx="232" fill="none" stroke="url(#rim)" stroke-width="8"/>
  <g filter="url(#shadow)">
    <path d="${BUBBLE}" fill="#ffffff"/>
  </g>
  <path d="${B_MARK}" fill="none" stroke="url(#bg)" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function sidebarSvg() {
  const s = 0.14;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#1f3fd6"/>
      <stop offset="0.6" stop-color="#4f7cff"/>
      <stop offset="1" stop-color="#7fc0ff"/>
    </linearGradient>
  </defs>
  <rect width="164" height="314" fill="url(#bg)"/>
  <circle cx="82" cy="140" r="70" fill="none" stroke="#fff" stroke-opacity="0.18" stroke-width="1.5" stroke-dasharray="4 6"/>
  <circle cx="82" cy="140" r="108" fill="none" stroke="#fff" stroke-opacity="0.1" stroke-width="1.5"/>
  <mask id="cut"><rect width="1024" height="1024" fill="#fff"/><path d="${B_MARK}" fill="none" stroke="#000" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/></mask>
  <path transform="translate(82 140) scale(${s}) translate(-496 -541)" d="${BUBBLE}" fill="#fff" mask="url(#cut)"/>
</svg>`;
}

/** Minimal 24-bit BMP encoder (NSIS installer images must be BMP). */
function toBmp({ data, info }) {
  const { width, height, channels } = info;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const buf = Buffer.alloc(size);
  buf.write('BM', 0);
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      buf[row + x * 3] = data[i + 2];
      buf[row + x * 3 + 1] = data[i + 1];
      buf[row + x * 3 + 2] = data[i];
    }
  }
  return buf;
}

async function main() {
  const svg = Buffer.from(iconSvg());
  await fs.mkdir(path.join(root, 'build'), { recursive: true });
  await fs.mkdir(path.join(root, 'public'), { recursive: true });

  const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

  await fs.writeFile(path.join(root, 'build', 'icon.png'), await png(1024));
  await fs.writeFile(path.join(root, 'build', 'icon.svg'), svg);
  await fs.writeFile(path.join(root, 'electron', 'icon.png'), await png(256));
  await fs.writeFile(path.join(root, 'public', 'icon.png'), await png(256));

  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const ico = await pngToIco(await Promise.all(icoSizes.map(png)));
  await fs.writeFile(path.join(root, 'build', 'icon.ico'), ico);

  const sidebar = await sharp(Buffer.from(sidebarSvg())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  await fs.writeFile(path.join(root, 'build', 'installerSidebar.bmp'), toBmp(sidebar));

  console.log('Icons written to build/, electron/ and public/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
