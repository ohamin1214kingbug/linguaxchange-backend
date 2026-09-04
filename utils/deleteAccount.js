const { cancelTeacherClasses } = require('./classCancellation')
const { sendEmail } = require('./mailer')
const { anonymizedFields, OWN_DATA_DELETIONS } = require('./accountDeletion')

// Separate from accountDeletion.js on purpose. That module is pure — a field
// map and a table list, no imports — which is what lets its tests assert
// against the real schema with no environment at all. Those tests are the
// guard that catches a migration adding a personal column nobody scrubs, and
// pulling a Supabase client in beside them stops the suite from even loading.
//
// So: accountDeletion.js says WHAT gets scrubbed, this says HOW it happens.

// The whole deletion, in the order it has to happen.
//
// Lifted out of routes/account.js so that an admin deleting someone runs
// exactly the steps a member deleting themselves runs. The ordering is not
// arbitrary, and copying it by hand is how a step gets dropped:
//
// 1. Cancel classes FIRST, while the account still looks normal —
//    cancelClass refunds every enrolled student and notifies them. After
//    anonymizing, those notifications would read "your class with Deleted
//    User was cancelled", and the refunds would run against a half-scrubbed
//    account.
// 2. Clear their own rows, zero the spendable balance (the ledger stays as
//    the financial record), remove the avatar — it is public and keyed by
//    user id, so nulling photo_url alone leaves it fetchable forever.
// 3. Anonymize last, then use the real address one final time.
async function deleteAccount(supabase, user, { notify = true } = {}) {
  // No cutoff: this teacher is not coming back, so everything upcoming goes.
  await cancelTeacherClasses(supabase, user.id)

  for (const { table, column } of OWN_DATA_DELETIONS) {
    const { error } = await supabase.from(table).delete().eq(column, user.id)
    if (error) console.error('[ACCOUNT_DELETE] Could not clear', table, error.message)
  }

  await supabase.from('credits').update({ balance: 0 }).eq('user_id', user.id)

  await supabase.storage.from('avatars')
    .remove(['jpg', 'png', 'webp'].map(ext => `avatars/${user.id}.${ext}`))

  const { error: anonError } = await supabase
    .from('users')
    .update(anonymizedFields(user.id))
    .eq('id', user.id)

  if (anonError) return { ok: false, error: anonError }

  if (notify) {
    await sendEmail({
      to: user.email,
      subject: 'Your LinguaXchange account has been deleted',
      text: `Hi ${user.first_name},\n\nYour LinguaXchange account has been deleted and your personal details have been removed.\n\nClasses you had scheduled were cancelled and the students enrolled in them were refunded. Records of past classes and credit transactions are kept without your name attached, because other members' history and our financial records depend on them.\n\nIf you didn't request this, reply to this email immediately.`
    }).catch(e => console.error('[ACCOUNT_DELETE] Confirmation email failed', e.message))
  }

  return { ok: true }
}

module.exports = { deleteAccount }
