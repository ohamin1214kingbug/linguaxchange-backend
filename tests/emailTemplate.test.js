const { renderEmail } = require('../utils/emailTemplate')

test('text and html carry the same content', () => {
  const { text, html } = renderEmail({
    heading: 'Your class starts in 1 hour',
    paragraphs: ['Hi Ana,', '', 'It starts soon.'],
    box: [['Topic:', 'Ordering food']],
    button: { label: 'Join the class', url: 'https://gongbuleng.com/classroom/1' },
    footnote: 'Turn these emails off in Settings.',
  })
  expect(text).toBe('Hi Ana,\n\nIt starts soon.\n\nTopic: Ordering food\n\nJoin the class: https://gongbuleng.com/classroom/1\n\nTurn these emails off in Settings.')
  for (const part of ['Your class starts in 1 hour', 'It starts soon.', 'Ordering food', 'href="https://gongbuleng.com/classroom/1"', 'Turn these emails off', 'https://gongbuleng.com/email/header.png']) {
    expect(html).toContain(part)
  }
})

// Class titles, names and suspension reasons are typed by people.
test('member-typed text cannot inject markup', () => {
  const { html } = renderEmail({ heading: '<script>x</script>', paragraphs: ['a "b" <img src=x>'] })
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<img src=x>')
  expect(html).toContain('&lt;script&gt;')
})
