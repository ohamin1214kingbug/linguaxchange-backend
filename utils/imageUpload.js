const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_EVIDENCE = 3

// Decodes a `data:image/...;base64,...` body into a Buffer, refusing
// anything whose bytes disagree with its declared type.
//
// Shared for the same reason utils/pdfUpload.js is: avatars and report
// evidence both take a base64 image in a JSON body so the browser never
// holds a Supabase key, which means both defend the same trust boundary —
// and a base64 payload can claim any MIME type it likes.
//
// The storage call stays at each call site. Only the decoding is the same.

const SIGNATURES = {
  'image/png': {
    ext: 'png',
    matches: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  },
  'image/jpeg': {
    ext: 'jpg',
    matches: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  },
  'image/webp': {
    ext: 'webp',
    matches: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
  }
}

function decodeImage(dataUrl, { maxBytes = MAX_IMAGE_BYTES } = {}) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl || '')
  if (!match) return { ok: false, error: 'Expected a jpeg, png, or webp image' }

  const [, mime, base64] = match
  const buffer = Buffer.from(base64, 'base64')

  if (buffer.length > maxBytes) {
    return { ok: false, error: `Each image must be under ${Math.floor(maxBytes / 1024 / 1024)}MB` }
  }

  if (!SIGNATURES[mime].matches(buffer)) {
    return { ok: false, error: 'That file is not a valid image' }
  }

  return { ok: true, buffer, mime, ext: SIGNATURES[mime].ext }
}

module.exports = { decodeImage, MAX_IMAGE_BYTES, MAX_EVIDENCE }
