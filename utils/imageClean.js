// Re-saves a photo without its hidden data. Phone photos often carry the GPS
// position where they were taken, the date and the device, and profile
// photos are public: one stored photo had real coordinates (2026-11-17).
// sharp drops all metadata on output unless asked to keep it; rotate() first
// applies the orientation tag, so the photo stays the right way up once
// that tag is gone. Keeps the input format (PNG keeps transparency).
const sharp = require('sharp')

const MAX_SIDE = 512
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' }

async function cleanImage(buffer) {
  const { format } = await sharp(buffer).metadata()
  const out = MIME[format] ? format : 'jpeg'
  const image = sharp(buffer).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
  const cleaned = await image.toFormat(out, out === 'png' ? {} : { quality: 85 }).toBuffer()
  return { buffer: cleaned, mime: MIME[out], ext: EXT[out] }
}

module.exports = { cleanImage, MAX_SIDE }
