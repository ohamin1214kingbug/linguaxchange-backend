// One-off: ask approved members to post a class before the campus push
// (posters, ESN, lecturers) sends students to an almost empty class list.
//
//   node scripts/announceTeach.js                  # dry run: count + full text, sends nothing
//   node scripts/announceTeach.js --test me@x.com  # one copy to that address only
//   node scripts/announceTeach.js --send           # everyone who has not had it yet
//
// Same runner and safety as announceApproved.js, with its own sent log
// (.announce-teach-sent.json, git-ignored).
//
// ponytail: the log is read once at start, so two runs at the same time
// mail the tail of the list twice (4 members on 2026-11-11). Run one at a
// time; add a lock file if this runner is reused again.

const path = require('path')
const { main } = require('./announceApproved')

function renderEmail(firstName) {
  const hi = firstName ? `Hi ${firstName},` : 'Hi,'
  const hola = firstName ? `Hola ${firstName}:` : 'Hola:'
  const text = `${hi}

GongbuLeng is about to be shared around campus, and right now the class list is almost empty. Could you post one class this week? Any topic works, and a simple conversation hour is enough.

Create it here: gongbuleng.com/classes/create

You earn 1 banana for every student who attends. If you invite a friend with the invite link on your dashboard, you both get a banana after their first class.

Thank you for being one of the first teachers. Questions? Write to gongbuleng.team@gmail.com

Hamin

---

${hola}

Vamos a empezar a dar a conocer GongbuLeng por el campus, y ahora mismo la lista de clases está casi vacía. ¿Podrías publicar una clase esta semana? Sirve cualquier tema: basta con una hora de conversación.

Créala aquí: gongbuleng.com/classes/create

Ganas 1 banana por cada estudiante que asista. Si invitas a alguien con el enlace de invitación de tu panel, los dos recibís una banana después de su primera clase.

Gracias por ser de los primeros profesores. ¿Dudas? Escríbenos a gongbuleng.team@gmail.com

Hamin
`
  return { subject: 'A small favour: post your first class', text }
}

if (require.main === module) {
  const sentLog = path.join(__dirname, '.announce-teach-sent.json')
  main(process.argv.slice(2), { render: renderEmail, sentLog }).catch(e => { console.error(e.message); process.exit(1) })
}

module.exports = { renderEmail }
