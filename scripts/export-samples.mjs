import { mkdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';

// SVG -> high-resolution raster original -> reduced public preview.
// Authoring masters and original files stay outside the public assets directory.
const sourceDirectory = new URL('../artwork-source/samples/', import.meta.url);
const originalDirectory = new URL('../sample-artworks/originals/', import.meta.url);
const previewDirectory = new URL('../public/samples/', import.meta.url);
const samples = ['quiet-geometry', 'long-way-home', 'almost-a-garden'];
const previewsOnly = process.argv.includes('--previews-only');
const previewWatermarkLines = ['Purchase Display License', 'on Tezos'];
// Apply the mark to the reduced public preview only, after reading the original.
const watermark = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1360">
  <g transform="translate(0 85) rotate(-15 900 1020)">
  <text text-anchor="middle" font-family="Arial, sans-serif" font-size="46"
    font-weight="600" fill="#2f5790" fill-opacity=".9"
    stroke="#faf7ef" stroke-opacity=".6" stroke-width="2" paint-order="stroke fill">
    <tspan x="900" y="1005">${previewWatermarkLines[0]}</tspan>
    <tspan x="900" y="1070">${previewWatermarkLines[1]}</tspan>
  </text>
  </g>
</svg>`);
await mkdir(originalDirectory, { recursive: true });
await mkdir(previewDirectory, { recursive: true });
for (const name of samples) {
  const original = new URL(`${name}.jpg`, originalDirectory);
  if (!previewsOnly) {
    const svg = await readFile(new URL(`${name}.svg`, sourceDirectory));
    await sharp(svg, { density: 288 })
      .resize(2400, 2720, { fit: 'fill' })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .withIccProfile('srgb')
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4', progressive: false })
      .toFile(original.pathname);
  }
  const metadata = await sharp(original.pathname).metadata();
  if (
    metadata.format !== 'jpeg' ||
    metadata.width !== 2400 ||
    metadata.height !== 2720 ||
    metadata.hasAlpha ||
    metadata.isProgressive
  ) {
    throw new Error(`Unexpected original format: ${name}`);
  }
  const preview = new URL(`${name}.webp`, previewDirectory);
  const result = await sharp(original.pathname)
    .resize({ width: 1200, withoutEnlargement: true })
    .toColourspace('srgb')
    .composite([{ input: watermark }])
    .webp({ quality: 82, effort: 6 })
    .toFile(preview.pathname);
  const { size } = await import('node:fs/promises').then((fs) => fs.stat(original));
  console.log(
    `${name}: original 2400 × 2720 JPEG (${Math.round(size / 1024)} KB); preview ${result.width} × ${result.height} WebP (${Math.round(result.size / 1024)} KB)`,
  );
}
