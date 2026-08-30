const { decodePdf, MAX_PDF_BYTES } = require('../utils/pdfUpload')

const asDataUrl = buf => `data:application/pdf;base64,${buf.toString('base64')}`
const realPdf = () => Buffer.from('%PDF-1.4\nfake body\n%%EOF', 'latin1')

describe('decodePdf', () => {
  test('accepts a real PDF payload', () => {
    const r = decodePdf(asDataUrl(realPdf()))
    expect(r.ok).toBe(true)
    expect(r.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  test('rejects anything that is not a PDF data URL', () => {
    expect(decodePdf('data:image/png;base64,iVBORw0KGgo=').ok).toBe(false)
    expect(decodePdf('').ok).toBe(false)
    expect(decodePdf(null).ok).toBe(false)
    expect(decodePdf(undefined).ok).toBe(false)
  })

  test('rejects bytes that are not a PDF even when the MIME type claims otherwise', () => {
    const notPdf = Buffer.from('GIF89a and then some padding', 'latin1')
    const r = decodePdf(asDataUrl(notPdf))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not a valid PDF/)
  })

  test('rejects a payload over the 10MB ceiling', () => {
    const big = Buffer.concat([Buffer.from('%PDF-', 'latin1'), Buffer.alloc(MAX_PDF_BYTES)])
    const r = decodePdf(asDataUrl(big))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/under 10MB/)
  })

  test('the ceiling is 10MB', () => {
    expect(MAX_PDF_BYTES).toBe(10 * 1024 * 1024)
  })
})
