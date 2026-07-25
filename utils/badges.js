const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Each badge is a small, independent isEarned(stats) check, so adding a new
// badge never touches the others. `stats` = { taughtCount, attendedCount,
// languageCount } — taughtCount/attendedCount are role-scoped completed-class
// counts, languageCount is the union of distinct languages across both roles
// (badges themselves are not role-scoped: a user can hold both).
const BADGE_DEFINITIONS = [
  {
    id: 'first_class',
    icon: '⭐',
    label: 'First Class',
    criteria: 'Taught or attended your first class',
    isEarned: (stats) => stats.taughtCount + stats.attendedCount >= 1
  },
  {
    id: 'five_taught',
    icon: '🎓',
    label: '5 Taught',
    criteria: 'Taught 5 or more classes',
    isEarned: (stats) => stats.taughtCount >= 5
  },
  {
    id: 'polyglot',
    icon: '🌍',
    label: 'Polyglot',
    criteria: 'Taught or attended classes in 3+ languages',
    isEarned: (stats) => stats.languageCount >= 3
  }
]

// Pure — no DB access, so unit-testable in isolation.
function computeEarnedBadges(stats) {
  return BADGE_DEFINITIONS
    .filter(badge => badge.isEarned(stats))
    .map(({ id, icon, label, criteria }) => ({ id, icon, label, criteria }))
}

// Badges are never persisted — recomputed from existing rows on every call.
// "Taught" is proxied by classes.status === 'completed' (the schema has no
// per-session completion flag; a recurring class counts as one completion
// regardless of how many sessions it had). "Attended" is class_enrollments
// with attended = true, which is genuinely per-session. Never throws: a
// badge computation failing shouldn't break the profile page that called it.
async function getEarnedBadges(userId) {
  try {
    const { data: taughtClasses } = await supabase
      .from('classes')
      .select('language_code')
      .eq('teacher_id', userId)
      .eq('status', 'completed')

    const { data: attendedEnrollments } = await supabase
      .from('class_enrollments')
      .select('class_sessions(classes(language_code))')
      .eq('user_id', userId)
      .eq('attended', true)

    const taughtCount = taughtClasses?.length || 0
    const attendedCount = attendedEnrollments?.length || 0

    const languages = new Set()
    for (const cls of taughtClasses || []) {
      if (cls.language_code) languages.add(cls.language_code)
    }
    for (const enrollment of attendedEnrollments || []) {
      const lang = enrollment.class_sessions?.classes?.language_code
      if (lang) languages.add(lang)
    }

    return computeEarnedBadges({ taughtCount, attendedCount, languageCount: languages.size })
  } catch (e) {
    console.error('[BADGES] Could not compute badges for user', userId, e.message)
    return []
  }
}

module.exports = { BADGE_DEFINITIONS, computeEarnedBadges, getEarnedBadges }
