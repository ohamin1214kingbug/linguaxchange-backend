// One look for every email the site sends: the header picture, a heading,
// the text, an optional details box and button, and a footer.
//
// renderEmail returns both versions from the same fields, so the plain-text
// copy (what a mail app shows when it blocks HTML) can never say something
// different from the designed one. Pure: no env, no imports beyond the URL.
//
// Email HTML is its own dialect: tables and inline styles, because Gmail and
// Outlook drop <style> blocks, flexbox and most modern CSS.
const { FRONTEND_URL } = require('./frontendUrl')

// Served by the frontend from public/email/header.png. An absolute URL on
// our own domain: mail apps cannot load relative paths.
const HEADER_URL = `${FRONTEND_URL}/email/header.png`
const CONTACT = 'gongbuleng.team@gmail.com'
const NAVY = '#1a1a2e', RED = '#da1f33', CREAM = '#fdf3e7'
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

// Everything interpolated below is escaped: names, class titles and
// suspension reasons are typed by members and admins.
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// box: [[label, value], ...]   button: { label, url }
function renderEmail({ heading, paragraphs = [], box, button, footnote }) {
  const lines = paragraphs.filter(Boolean)
  const text = [
    ...lines,
    box && box.map(([k, v]) => `${k} ${v}`).join('\n'),
    button && `${button.label}: ${button.url}`,
    footnote,
  ].filter(Boolean).join('\n\n')

  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}; font-family:${FONT};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%; max-width:600px; background:#ffffff; border:2px solid ${NAVY}; border-radius:16px; overflow:hidden;">
    <tr><td><img src="${HEADER_URL}" width="600" alt="GongbuLeng" style="display:block; width:100%; height:auto; border:0;"></td></tr>
    <tr><td style="padding:32px 32px 8px;">
      <h1 style="margin:0 0 16px; font-size:26px; line-height:1.25; font-weight:800; color:${NAVY};">${esc(heading)}</h1>
      ${lines.map(t => `<p style="margin:0 0 16px; font-size:16px; line-height:1.6; color:${NAVY};">${esc(t)}</p>`).join('\n      ')}
      ${box ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px; background:${CREAM}; border:2px solid ${NAVY}; border-radius:12px;"><tr><td style="padding:14px 18px; font-size:15px; line-height:1.6; color:${NAVY};">${box.map(([k, v]) => `<strong>${esc(k)}</strong> ${esc(v)}`).join('<br>')}</td></tr></table>` : ''}
      ${button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="background:${RED}; border:2px solid ${NAVY}; border-radius:999px;"><a href="${esc(button.url)}" style="display:inline-block; padding:13px 28px; font-size:16px; font-weight:700; color:#ffffff; text-decoration:none;">${esc(button.label)}</a></td></tr></table>` : ''}
    </td></tr>
    <tr><td style="padding:16px 32px 24px; border-top:2px solid ${CREAM}; font-size:13px; line-height:1.6; color:#5a5a6e;">
      ${footnote ? `${esc(footnote)}<br>` : ''}GongbuLeng · <a href="${FRONTEND_URL}" style="color:#5a5a6e;">gongbuleng.com</a> · Questions? ${CONTACT}
    </td></tr>
  </table>
</td></tr></table>`

  return { text, html }
}

module.exports = { renderEmail, CONTACT }
