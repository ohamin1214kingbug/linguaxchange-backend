const { cleanLearnDetails, LEARN_LEVELS } = require('../utils/profileFields')
const { decodeCertificate, cleanFileName, certificatePaths } = require('../utils/certificateUpload')

describe('cleanLearnDetails', () => {
  test('keeps level and note for listed languages, trimmed', () => {
    const r = cleanLearnDetails({ ES: { level: 'B1', note: '  I freeze when I speak ' } }, ['ES'])
    expect(r).toEqual({ ok: true, value: { ES: { level: 'B1', note: 'I freeze when I speak' } } })
  })

  // Un-ticking a language must not leave its level behind.
  test('drops detail for a language no longer listed, and empty entries', () => {
    const r = cleanLearnDetails({ ES: { level: 'B1', note: '' }, DE: { level: null, note: ' ' } }, ['DE'])
    expect(r).toEqual({ ok: true, value: {} })
  })

  test('refuses an unknown language, a bad level, Native, or a long note', () => {
    expect(cleanLearnDetails({ XX: { level: 'A1' } }, ['XX']).ok).toBe(false)
    expect(cleanLearnDetails({ ES: { level: 'B3' } }, ['ES']).ok).toBe(false)
    expect(cleanLearnDetails({ ES: { level: 'Native' } }, ['ES']).ok).toBe(false)
    expect(cleanLearnDetails({ ES: { note: 'x'.repeat(201) } }, ['ES']).ok).toBe(false)
    expect(cleanLearnDetails([], ['ES']).ok).toBe(false)
    expect(LEARN_LEVELS).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
  })
})

describe('decodeCertificate', () => {
  const dataUrl = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(10)])
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(10)])

  test('accepts a real PDF or image', () => {
    expect(decodeCertificate(dataUrl('application/pdf', pdf))).toMatchObject({ ok: true, ext: 'pdf', mime: 'application/pdf' })
    expect(decodeCertificate(dataUrl('image/png', png))).toMatchObject({ ok: true, ext: 'png' })
  })

  // The declared type is the browser's claim; the bytes decide.
  test('refuses a file whose bytes do not match its type, other types, and big files', () => {
    expect(decodeCertificate(dataUrl('application/pdf', png)).ok).toBe(false)
    expect(decodeCertificate(dataUrl('text/html', Buffer.from('<script>'))).error).toBe('Upload a PDF, JPG, PNG or WEBP file')
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024)])
    expect(decodeCertificate(dataUrl('application/pdf', big)).error).toBe('The file must be under 5MB')
  })
})

test('file names are shown, never used as paths, so they are only tidied', () => {
  expect(cleanFileName('TOPIK 6.pdf')).toBe('TOPIK 6.pdf')
  expect(cleanFileName('<b>x</b>\u0007.pdf')).toBe('bx/b.pdf')
  expect(cleanFileName('')).toBe('certificate')
  expect(cleanFileName('a'.repeat(300))).toHaveLength(100)
  expect(certificatePaths(7)).toEqual(['7.pdf', '7.png', '7.jpg', '7.webp'])
})
