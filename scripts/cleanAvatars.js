// One-off (2026-11-17): re-save every stored profile photo without hidden
// data, the same way new uploads are now saved (utils/imageClean.js). One
// public photo carried real GPS coordinates.
//
//   node scripts/cleanAvatars.js          # dry run: how many photos, nothing changed
//   node scripts/cleanAvatars.js --apply  # re-save them and point photo_url at the clean copy
//
// Only photos in our own avatars bucket; never prints locations or names.
require('dotenv').config({ quiet: true })
const { createClient } = require('@supabase/supabase-js')
const { cleanImage } = require('../utils/imageClean')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
const MARK = '/storage/v1/object/public/avatars/'

async function run(apply) {
  const { data: users, error } = await supabase.from('users').select('id, photo_url')
    .not('photo_url', 'is', null).neq('photo_url', '').is('deleted_at', null)
  if (error) throw error
  const ours = users.filter(u => u.photo_url.includes(MARK))
  console.log(`${ours.length} stored photo(s)${apply ? '' : ' (dry run: nothing changed)'}`)
  if (!apply) return
  for (const u of ours) {
    const path = decodeURIComponent(u.photo_url.split(MARK)[1].split('?')[0])
    const { data: blob, error: dlError } = await supabase.storage.from('avatars').download(path)
    if (dlError) { console.log(`  #${u.id}: could not download (${dlError.message})`); continue }
    const before = Buffer.from(await blob.arrayBuffer())
    const clean = await cleanImage(before)
    const to = `avatars/${u.id}.${clean.ext}`
    const { error: upError } = await supabase.storage.from('avatars').upload(to, clean.buffer, { contentType: clean.mime, upsert: true })
    if (upError) { console.log(`  #${u.id}: could not upload (${upError.message})`); continue }
    if (to !== path) await supabase.storage.from('avatars').remove([path])
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(to)
    await supabase.from('users').update({ photo_url: `${publicUrl}?v=${Date.now()}` }).eq('id', u.id)
    console.log(`  #${u.id}: cleaned (${Math.round(before.length / 1024)} KB -> ${Math.round(clean.buffer.length / 1024)} KB)`)
  }
}

run(process.argv.includes('--apply')).catch(e => { console.error(e.message); process.exit(1) })
