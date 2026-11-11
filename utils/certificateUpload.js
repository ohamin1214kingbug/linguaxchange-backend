const { decodeImage } = require('./imageUpload')
const { decodePdf } = require('./pdfUpload')

const MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024
const CERTIFICATE_BUCKET = 'certificates'
// Every extension a certificate can be stored under, so replacing a PDF with
// a JPG (or deleting the account) removes whichever one is there.
const CERTIFICATE_EXTS = ['pdf', 'png', 'jpg', 'webp']

// A certificate arrives as a PDF or an image, base64 in a JSON body like
// every other upload here. The existing decoders check the real bytes, not
// the type the browser claims; this only adds the size cap they don't share
// (PDFs elsewhere may be 10MB) and one shape for the result.
function decodeCertificate(dataUrl) {
  if (/^data:application\/pdf;/.test(dataUrl || '')) {
    const pdf = decodePdf(dataUrl)
    if (!pdf.ok) return pdf
    if (pdf.buffer.length > MAX_CERTIFICATE_BYTES) return { ok: false, error: 'The file must be under 5MB' }
    return { ok: true, buffer: pdf.buffer, mime: 'application/pdf', ext: 'pdf' }
  }
  const image = decodeImage(dataUrl, { maxBytes: MAX_CERTIFICATE_BYTES })
  if (!image.ok) return { ok: false, error: image.error.replace('Expected a jpeg, png, or webp image', 'Upload a PDF, JPG, PNG or WEBP file') }
  return image
}

// The name the member's file had, for showing back to them and to admins.
// Never used as a storage path.
function cleanFileName(name) {
  const cleaned = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 100)
  return cleaned || 'certificate'
}

const certificatePaths = userId => CERTIFICATE_EXTS.map(ext => `${userId}.${ext}`)

module.exports = { decodeCertificate, cleanFileName, certificatePaths, CERTIFICATE_BUCKET, MAX_CERTIFICATE_BYTES }
