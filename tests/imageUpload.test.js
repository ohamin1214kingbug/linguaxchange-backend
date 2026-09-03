const { decodeImage, MAX_IMAGE_BYTES } = require('../utils/imageUpload')

// Real magic bytes, padded to look like a file with content in it.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(64)])

const url = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`

describe('decodeImage', () => {
  test('accepts a real PNG', () => {
    const result = decodeImage(url('image/png', PNG))
    expect(result.ok).toBe(true)
    expect(result.ext).toBe('png')
  })

  test('accepts a real JPEG', () => {
    expect(decodeImage(url('image/jpeg', JPEG)).ext).toBe('jpg')
  })

  test('accepts a real WebP', () => {
    expect(decodeImage(url('image/webp', WEBP)).ext).toBe('webp')
  })

  // The declared MIME type is attacker-controlled: a base64 body can claim
  // to be anything. The bytes are what get stored, so the bytes are what
  // get checked.
  test('refuses a script wearing a png content type', () => {
    const notAnImage = Buffer.from('<?php system($_GET["c"]); ?>')
    expect(decodeImage(url('image/png', notAnImage)).ok).toBe(false)
  })

  test('refuses a JPEG declared as a PNG', () => {
    expect(decodeImage(url('image/png', JPEG)).ok).toBe(false)
  })

  test('refuses a content type that is not an image at all', () => {
    expect(decodeImage(url('application/pdf', PNG)).ok).toBe(false)
  })

  test('refuses something that is not a data URL', () => {
    expect(decodeImage('https://example.com/cat.png').ok).toBe(false)
  })

  test('refuses a file over the size limit', () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES + 1)])
    expect(decodeImage(url('image/png', huge)).ok).toBe(false)
  })

  test('honours a caller-supplied smaller limit', () => {
    expect(decodeImage(url('image/png', PNG), { maxBytes: 8 }).ok).toBe(false)
  })
})
