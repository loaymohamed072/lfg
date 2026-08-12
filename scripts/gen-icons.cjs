// Regenerate all favicons + PWA/app icons from the solid-black LFG badge JPG.
// Solid background (no transparency) so iOS/Android stop showing the grey checkerboard.
// Keeps the existing filenames so the manifest + <head> links don't change.
const sharp = require('sharp');
const fs = require('fs');

const SRC = '464612580_435100992572893_7201260244501341517_n.jpg';
const BLACK = { r: 0, g: 0, b: 0, alpha: 1 };

async function fullBleed(size, out) {
  await sharp(SRC).resize(size, size, { fit: 'cover' }).png().toFile(out);
  console.log('  ' + out + ' (' + size + ', full)');
}

// Maskable-safe: shrink the badge a touch and pad with black so OS masks never clip the text.
async function padded(size, out, scale) {
  const inner = Math.round(size * scale);
  const logo = await sharp(SRC).resize(inner, inner, { fit: 'cover' }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BLACK } })
    .composite([{ input: logo, gravity: 'center' }])
    .png().toFile(out);
  console.log('  ' + out + ' (' + size + ', padded ' + scale + ')');
}

(async () => {
  console.log('favicons:');
  await fullBleed(16, 'favicon-16x16.png');
  await fullBleed(32, 'favicon-32x32.png');
  await fullBleed(48, 'favicon-48x48.png');
  await fullBleed(96, 'favicon-96x96.png');

  console.log('apple touch (iOS home screen):');
  await fullBleed(180, 'apple-touch-icon.png');

  console.log('PWA maskable icons:');
  await padded(192, 'icon-192.png', 0.9);
  await padded(512, 'icon-512.png', 0.9);

  // favicon.ico containing the 32x32 PNG (ICO can embed PNG data).
  const png32 = await sharp(SRC).resize(32, 32, { fit: 'cover' }).png().toBuffer();
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0); entry.writeUInt8(32, 1); entry.writeUInt8(0, 2); entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png32.length, 8); entry.writeUInt32LE(22, 12);
  fs.writeFileSync('favicon.ico', Buffer.concat([header, entry, png32]));
  console.log('  favicon.ico');

  console.log('done.');
})().catch(e => { console.error(e); process.exit(1); });
