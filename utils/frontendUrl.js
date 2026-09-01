// The public site, used to build every link this backend puts in an email.
//
// This lived as four separate copies of the same literal — in routes/auth.js,
// routes/university.js, utils/lowCreditNudge.js and utils/classReminder.js —
// all pointing at the raw Vercel deployment URL rather than the real domain.
// Nothing caught it because no email was ever delivered: the sending domain
// was unverified from the day the feature shipped until 2026-09-01.
//
// It matters most on the password-reset mail. A reset link arriving on a
// domain that is not the one the user signed up on is the exact shape of a
// phishing message, and that is the message people scrutinise hardest.
//
// One copy, so the next person changing it changes it everywhere.
// ponytail: hardcoded, move to an env var when a second environment needs
// its own value.
module.exports = { FRONTEND_URL: 'https://linguaxchange.com' }
