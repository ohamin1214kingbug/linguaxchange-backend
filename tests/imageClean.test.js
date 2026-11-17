const sharp = require('sharp')
const { cleanImage } = require('../utils/imageClean')

test('drops GPS and all other metadata, keeps the format, shrinks to 512px', async () => {
  // A 1200x800 JPEG carrying a GPS position and a camera model.
  const original = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#f4a623' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestPhone', Model: 'X1' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 25/1 0/1' } })
    .toBuffer()
  const before = await sharp(original).metadata()
  expect(before.exif).toBeDefined() // the fixture really has metadata

  const { buffer, mime, ext } = await cleanImage(original)
  const after = await sharp(buffer).metadata()
  expect(after.exif).toBeUndefined()
  expect(after.icc).toBeUndefined()
  expect(buffer.includes(Buffer.from('TestPhone'))).toBe(false)
  expect([mime, ext]).toEqual(['image/jpeg', 'jpg'])
  expect(Math.max(after.width, after.height)).toBe(512)
})

test('keeps PNG as PNG and never enlarges small images', async () => {
  const png = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
  const { buffer, mime } = await cleanImage(png)
  const after = await sharp(buffer).metadata()
  expect(mime).toBe('image/png')
  expect([after.width, after.height]).toEqual([100, 100])
})
