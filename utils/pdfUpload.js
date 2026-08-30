const MAX_PDF_BYTES = 10 * 1024 * 1024

// Decodes a `data:application/pdf;base64,...` body into a Buffer, refusing
// anything that isn't really a PDF.
//
// Shared rather than copied: class materials and resource guides both accept
// an uploaded PDF as base64 in a JSON body, so the browser never needs the
// Supabase anon key and storage policies can stay shut. That means both are
// defending the same trust boundary, and a base64 payload can claim any MIME
// type it likes.
//
// The storage call stays in each route — only the decoding is shared, because
// only the decoding is the same.
function decodePdf(dataUrl) {
  const match = /^data:application\/pdf;base64,(.+)$/.exec(dataUrl || '')
  if (!match) return { ok: false, error: 'Expected a PDF file' }

  const buffer = Buffer.from(match[1], 'base64')
  if (buffer.length > MAX_PDF_BYTES) {
    return { ok: false, error: 'PDF must be under 10MB' }
  }
  // Check the actual bytes, not the declared type. Every real PDF starts
  // with %PDF-.
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return { ok: false, error: 'That file is not a valid PDF' }
  }
  return { ok: true, buffer }
}

module.exports = { decodePdf, MAX_PDF_BYTES }
