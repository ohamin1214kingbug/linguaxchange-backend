// The values a profile may hold, shared by the two routes that write them.
//
// Registration validated these and PATCH did not, so a level could be set
// correctly at signup and replaced with anything at all afterwards — which
// is how a translated label ended up stored as a level.
const LANGUAGES = ['KO', 'ES', 'DE', 'EN', 'PT', 'FR', 'IT']

// 'Native' is a value, not a label. Whatever the interface shows a Korean
// speaker, what gets stored is this string, or the comparison below fails
// and every reader has to guess.
const TEACH_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Native']

module.exports = { LANGUAGES, TEACH_LEVELS }
