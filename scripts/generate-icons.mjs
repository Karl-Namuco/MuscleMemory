import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
const icon = await readFile(new URL('../public/icons/icon.svg', import.meta.url))
for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180], ['icon-maskable', 512]]) {
  await sharp(icon).resize(size, size).png().toFile(new URL(`../public/icons/${name}.png`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
}
console.log('Application icons generated.')
