/**
 * Small EN/FR word helpers shared by the actor-level recognizers (legendary, traits, spellcasting).
 * Pure: no Foundry globals.
 */

/**
 * Lowercase, strip accents and normalize apostrophes. Length-preserving for precomposed characters,
 * so match indexes on the folded text are valid on the original text.
 * @param {string} text
 * @returns {string}
 */
export function fold(text) {
  return Array.from(String(text ?? ""), char => char.normalize("NFD")[0])
    .join("").toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'");
}

/**
 * Fold a word or phrase and drop one trailing plural / feminine ending, so "Charmed", "charmée" and
 * "charmés" share a stem.
 * @param {string} word
 * @returns {string}
 */
export function stem(word) {
  const folded = fold(word).trim().replace(/\s+/g, " ");
  return folded.length > 3 ? folded.replace(/(es|s|e)$/, "") : folded;
}

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10
};

/**
 * Read a digit string or a number word (EN/FR, one to ten).
 * @param {string} word
 * @returns {number|null}
 */
export function toNumber(word) {
  const w = fold(word ?? "").trim();
  if ( /^\d+$/.test(w) ) return Number(w);
  return NUMBER_WORDS[w] ?? null;
}

/** Number alternation for regex sources. */
export const NUMBER_RE = String.raw`\d+|one|two|three|four|five|six|seven|eight|nine|ten|une?|deux|trois|quatre|cinq|sept|huit|neuf|dix`;

const build = entries => {
  const map = new Map();
  for ( const [key, names] of Object.entries(entries) ) for ( const name of names ) map.set(stem(name), key);
  return map;
};

const DAMAGE = build({
  acid: ["acid", "acide"], bludgeoning: ["bludgeoning", "contondant"], cold: ["cold", "froid"],
  fire: ["fire", "feu"], force: ["force"], lightning: ["lightning", "foudre"],
  necrotic: ["necrotic", "nécrotique"], piercing: ["piercing", "perforant"], poison: ["poison"],
  psychic: ["psychic", "psychique"], radiant: ["radiant"], slashing: ["slashing", "tranchant"],
  thunder: ["thunder", "tonnerre"]
});

const CONDITION = build({
  blinded: ["blinded", "aveuglé"], charmed: ["charmed", "charmé"], deafened: ["deafened", "assourdi"],
  exhaustion: ["exhaustion", "épuisement"], frightened: ["frightened", "effrayé"],
  grappled: ["grappled", "agrippé"], incapacitated: ["incapacitated", "neutralisé"],
  invisible: ["invisible"], paralyzed: ["paralyzed", "paralysé"], petrified: ["petrified", "pétrifié"],
  poisoned: ["poisoned", "empoisonné"], prone: ["prone", "à terre"], restrained: ["restrained", "entravé"],
  stunned: ["stunned", "étourdi"], unconscious: ["unconscious", "inconscient"]
});

const ABILITY = build({
  str: ["strength", "force"], dex: ["dexterity", "dextérité"], con: ["constitution"],
  int: ["intelligence"], wis: ["wisdom", "sagesse"], cha: ["charisma", "charisme"]
});

/**
 * Damage type key for a word such as "fire", "fire damage" or "dégâts de feu".
 * @param {string} word
 * @returns {string|null}
 */
export function damageKey(word) {
  const cleaned = fold(word).trim().replace(/\s+damage$/, "").replace(/^degats\s+(?:de\s+|d')?/, "");
  return DAMAGE.get(stem(cleaned)) ?? null;
}

/**
 * Condition key for a word such as "charmed" or "à terre".
 * @param {string} word
 * @returns {string|null}
 */
export function conditionKey(word) {
  return CONDITION.get(stem(word)) ?? null;
}

/**
 * Ability key for a word such as "Wisdom" or "Sagesse".
 * @param {string} word
 * @returns {string|null}
 */
export function abilityKey(word) {
  return ABILITY.get(stem(word)) ?? null;
}

/** Ability names alternation for regex sources (for accent-folded text). */
export const ABILITY_RE = "strength|dexterity|constitution|intelligence|wisdom|charisma|force|dexterite|sagesse|charisme";
