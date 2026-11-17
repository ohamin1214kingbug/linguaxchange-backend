jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
const { buildDigest, digestEmail, madridHour } = require('../utils/adminDigest')

const now = new Date('2026-11-20T10:00:00Z')
const ago = h => new Date(now.getTime() - h * 3600e3).toISOString()

test('flags stale reports, repeat-reported members, sign-up spikes and teacher no-shows', () => {
  const d = buildDigest({
    now,
    reports: [
      { id: 8, report_type: 'user', reported_id: 103, status: 'pending', category: 'harassment', created_at: ago(72) },
      { id: 9, report_type: 'user', reported_id: 103, status: 'resolved', created_at: ago(200) },
      { id: 10, report_type: 'class', reported_id: 5, status: 'pending', created_at: ago(5) },
    ],
    signups: [...Array(6)].map(() => ({ created_at: ago(2), phone_verified: true })).concat([{ created_at: ago(100), phone_verified: false }]),
    noShows: [{ user_id: 7, role: 'teacher', created_at: ago(3), undone_at: null }, { user_id: 8, role: 'student', created_at: ago(3), undone_at: null }],
  })
  expect(d.alerts.map(a => a.kind).sort()).toEqual(['repeat_reports', 'signup_spike', 'stale_report', 'teacher_no_show'])
  expect(d.stats).toEqual({ newMembers: 6, newVerified: 6, noShows: 2, openReports: 2 })
})

test('a quiet day has no alerts, and small numbers are not a spike', () => {
  const d = buildDigest({ now, signups: [{ created_at: ago(1) }, { created_at: ago(2) }], reports: [{ id: 1, report_type: 'user', reported_id: 2, status: 'pending', created_at: ago(5) }] })
  expect(d.alerts).toEqual([])
})

test('the email lists each alert and links to the admin page', () => {
  const mail = digestEmail({ alerts: [{ level: 'red', title: 'Report waiting more than 48 hours', text: 'Report #8' }], stats: { newMembers: 1, newVerified: 1, noShows: 0, openReports: 1 } })
  expect(mail.subject).toBe('GongbuLeng: 1 thing needs a look today')
  expect(mail.text).toContain('Report #8')
  expect(mail.html).toContain('/admin')
})

test('Madrid hour accounts for the time zone', () => {
  expect(madridHour(new Date('2026-11-20T08:30:00Z'))).toBe(9) // CET = UTC+1 in November
})
