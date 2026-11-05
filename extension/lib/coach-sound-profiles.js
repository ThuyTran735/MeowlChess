// These are distinct banks of real, locally bundled cat recordings. Character
// comes from choosing a call, never pitch-shifting or synthesizing a cat sound.
const ids = numbers => Object.freeze(numbers.map(number => `meow-${String(number).padStart(2, '0')}`));
const profile = ({ description, banks, sounds }) => Object.freeze({
  description,
  banks: Object.freeze(Object.fromEntries(Object.entries(banks).map(([kind, numbers]) => [kind, ids(numbers)]))),
  sounds: Object.freeze(Object.fromEntries(Object.entries(sounds).map(([kind, values]) => [kind, Object.freeze(values)]))),
});

export const COACH_SOUND_PROFILES = Object.freeze({
  meowl: profile({
    description: 'Friendly meows and little greetings',
    banks: { voice:[1,3,4,7,8,9], hello:[1,2,3,6,7], inquiry:[3,4,6,24], comfort:[3,4,8,25], praise:[2,5,7,9,35], brilliant:[2,5,6,7,35] },
    sounds: { voice:['meow'], hello:['meow'], inquiry:['meow','chirp'], comfort:['purr','purr-chirp','chirp'], praise:['meow'], brilliant:['meow'] },
  }),
  owl: profile({
    description: 'Thoughtful chirps and measured meows',
    banks: { voice:[11,14,19,21,31], hello:[11,14,21,26], inquiry:[19,21,26,31], comfort:[19,21,25,31], praise:[11,14,21,31], brilliant:[11,14,26,31] },
    sounds: { voice:['chirp'], hello:['chirp','meow'], inquiry:['chirp'], comfort:['purr','purr-chirp','chirp'], praise:['chirp','meow'], brilliant:['meow','chirp'] },
  }),
  paws: profile({
    description: 'Bold calls and hearty celebration meows',
    banks: { voice:[12,13,16,17,34], hello:[12,16,17,18], inquiry:[12,13,22,27], comfort:[12,13,22,25], praise:[13,16,17,18,34], brilliant:[16,17,18,32,34] },
    sounds: { voice:['meow'], hello:['meow'], inquiry:['meow','chirp'], comfort:['purr-chirp','chirp'], praise:['meow'], brilliant:['meow'] },
  }),
  mellow: profile({
    description: 'Gentle purrs and soft little meows',
    banks: { voice:[4,8,10,20,25], hello:[8,10,20,25], inquiry:[20,24,25,30], comfort:[8,20,25,30], praise:[8,10,25,33], brilliant:[10,20,25,33] },
    sounds: { voice:['purr','purr-chirp'], hello:['purr','purr-chirp'], inquiry:['purr-chirp','chirp'], comfort:['purr','purr-chirp'], praise:['purr-chirp','meow'], brilliant:['purr-chirp','meow'] },
  }),
  scout: profile({
    description: 'Curious trills and bright discovery chirps',
    banks: { voice:[22,24,26,27,29,31], hello:[22,24,27,29], inquiry:[24,26,27,29,31], comfort:[22,24,25,31], praise:[6,22,26,29], brilliant:[6,24,26,29,31] },
    sounds: { voice:['chirp'], hello:['chirp'], inquiry:['chirp'], comfort:['purr-chirp','chirp'], praise:['chirp'], brilliant:['chirp','meow'] },
  }),
  evil: profile({
    description: 'Mischievous chirps and dramatic meows',
    banks: { voice:[13,23,27,34], hello:[13,23,27,32], inquiry:[19,22,27,29], comfort:[19,22,25,27], praise:[5,13,23,34], brilliant:[16,23,32,34] },
    sounds: { voice:['chirp'], hello:['chirp'], inquiry:['chirp'], comfort:['purr-chirp','chirp'], praise:['meow'], brilliant:['meow'] },
  }),
  baby: profile({
    description: 'Tiny kitten mews and soft chirps',
    banks: { voice:[19,20,21,28,30], hello:[19,20,28,30], inquiry:[20,21,28,30], comfort:[19,20,25,28], praise:[19,21,28,30], brilliant:[19,21,28,30,31] },
    sounds: { voice:['chirp','purr-chirp'], hello:['chirp','purr-chirp'], inquiry:['chirp','purr-chirp'], comfort:['purr','chirp','purr-chirp'], praise:['chirp','purr-chirp'], brilliant:['chirp','purr-chirp'] },
  }),
});

const ROLES = Object.freeze({ talk:'voice', greeting:'hello', curious:'inquiry', encourage:'comfort', approve:'praise', great:'praise', celebrate:'praise', brilliant:'brilliant' });
const FALLBACK_KINDS = Object.freeze({ talk:['talk'], greeting:['greeting','talk'], curious:['curious','talk'], encourage:['encourage','curious','talk'], approve:['approve','talk','greeting'], great:['great','celebrate','brilliant'], celebrate:['celebrate','brilliant'], brilliant:['brilliant','celebrate'] });

export function coachSoundKind(kind) {
  if (kind === 'idle') return 'idle';
  if (kind === 'think') return 'curious';
  if (kind === 'signature') return 'greeting';
  return Object.hasOwn(ROLES, kind) ? kind : 'talk';
}

export function getCoachSoundProfile(id) {
  return COACH_SOUND_PROFILES[Object.hasOwn(COACH_SOUND_PROFILES, id) ? id : 'meowl'];
}

/** Pick from a character's authored reaction bank before using generic types.
 * New recordings can name their coaches and reactions without changing this
 * selection code. Old untagged/custom clip banks retain the previous fallback.
 */
export function coachSoundBank(catalog, coach = 'meowl', kind = 'talk') {
  if (!Array.isArray(catalog)) return [];
  kind = coachSoundKind(kind);
  if (kind === 'idle') return [];
  coach = Object.hasOwn(COACH_SOUND_PROFILES, coach) ? coach : 'meowl';
  const selected = getCoachSoundProfile(coach), role = ROLES[kind];
  const supports = (clip, kinds) => Array.isArray(clip.kinds) && kinds.some(value => clip.kinds.includes(value));
  const belongs = clip => Array.isArray(clip.coaches) && clip.coaches.includes(coach);
  const candidates = catalog.filter(clip => clip && typeof clip.id === 'string');
  const tagged = candidates.filter(clip => belongs(clip) && supports(clip, [kind]));
  // A real kitten's voice is Baby's first choice, not an adult call sped up.
  // Mellow's calm turns favor actual purring once the bank has enough variety.
  const identity = coach === 'baby' ? tagged.filter(clip => clip.sound === 'kitten-meow')
    : coach === 'mellow' && ['voice','hello','comfort'].includes(role) ? tagged.filter(clip => clip.sound === 'purr') : [];
  if (identity.length >= (coach === 'baby' ? 3 : 2)) {
    // A soft purr-chirp rounds out Mellow's purr bank without borrowing the
    // other coaches' louder calls or repeating the same two clips forever.
    return coach === 'mellow' ? candidates.filter(clip => identity.includes(clip)
      || selected.banks[role].includes(clip.id) && clip.sound === 'purr-chirp') : identity;
  }
  const authored = candidates.filter(clip => selected.banks[role].includes(clip.id)
    || tagged.includes(clip));
  if (authored.length >= 2) return authored;
  // A reduced/older install should keep the character's voice where possible.
  const allIds = new Set(Object.values(selected.banks).flat());
  const character = candidates.filter(clip => allIds.has(clip.id) || belongs(clip));
  if (character.length >= 2) return character;
  const matching = candidates.filter(clip => supports(clip, FALLBACK_KINDS[kind]));
  const available = matching.length ? matching : candidates;
  const typed = available.filter(clip => selected.sounds[role].includes(clip.sound));
  return typed.length >= 2 ? typed : available;
}
