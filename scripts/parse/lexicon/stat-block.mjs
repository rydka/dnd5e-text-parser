/**
 * Lexicon of the header of a stat block (size line and stat lines): English and French, 2014 and 2024 layouts.
 * Every table maps a dnd5e 6 key to the printed words (case- and accent-insensitive). To add a label or fix a
 * translation, edit the lists only: the regular expressions are built from them.
 *
 * Ported from `compendium-json-importer` (`scripts/core/pdf/lexicon.mjs`); the PDF-only tables (sections, item
 * header aliases, item kinds) stayed there. French and 2024 labels: `reports/rules/pdf-import-lexicon.md`.
 * Pure: no Foundry global.
 */

const freeze = value => {
  if ( Array.isArray(value) ) value.forEach(freeze);
  else if ( value && typeof value === "object" ) Object.values(value).forEach(freeze);
  return Object.freeze(value);
};

export const STAT_LEXICON = freeze({
  /** Labels of the stat lines, by the key `parseStatLines` returns. Longer labels first where one contains another. */
  labels: {
    ac: ["Armor Class", "Classe d'armure", "Classe d’armure", "AC", "CA"],
    hp: ["Hit Points", "Points de vie", "HP", "PV"],
    speed: ["Speed", "Vitesse"],
    initiative: ["Initiative"],
    saves: ["Saving Throws", "Jets de sauvegarde", "Sauvegardes"],
    skills: ["Skills", "Compétences"],
    dv: ["Damage Vulnerabilities", "Vulnérabilités aux dégâts", "Vulnérabilité aux dégâts", "Vulnérabilités contre les dégâts",
      "Vulnérabilité contre les dégâts", "Vulnerabilities", "Vulnérabilités"],
    dr: ["Damage Resistances", "Résistances aux dégâts", "Résistance aux dégâts", "Résistances contre les dégâts",
      "Résistance contre les dégâts", "Resistances", "Résistances"],
    di: ["Damage Immunities", "Immunités aux dégâts", "Immunité aux dégâts", "Immunités contre les dégâts",
      "Immunité contre les dégâts", "Immunities", "Immunités"],
    ci: ["Condition Immunities", "Immunités contre les états", "Immunité contre les états", "Immunités aux états",
      "Immunité aux états", "Immunités aux conditions"],
    senses: ["Senses", "Sens"],
    languages: ["Languages", "Langues"],
    // "Puissance" (FR 2014 BBE) and "Dangerosité" (FR community): medium confidence, tolerated
    cr: ["Challenge Rating", "Challenge", "Facteur de puissance", "Dangerosité", "Puissance", "CR", "FP"],
    prof: ["Proficiency Bonus", "Bonus de maîtrise", "PB", "BM"],
    gear: ["Gear", "Équipement", "Equipement"],
    habitat: ["Habitat"],
    treasure: ["Treasure", "Trésor"]
  },
  /** Header words of the 2024 ability table ("MOD SAVE", "MOD JS", "MOD JdS"), skipped. */
  tableHeaders: ["MOD", "SAVE", "JS", "JdS", "SAUV"],
  sizes: {
    tiny: ["Tiny", "très petite", "TP"],
    sm: ["Small", "petite", "P"],
    med: ["Medium", "moyenne", "M"],
    lg: ["Large", "grande", "G"],
    huge: ["Huge", "très grande", "TG"],
    grg: ["Gargantuan", "gigantesque", "Gig"]
  },
  /** French "de taille M" after the creature type. */
  sizePrefixFr: ["de taille"],
  /** French swarm: "Nuée de taille M de bêtes de taille TP" (low confidence). */
  swarmFr: ["Nuée", "Nuee"],
  creatureTypes: {
    aberration: ["aberration", "aberrations"],
    beast: ["beast", "beasts", "bête", "bêtes"],
    celestial: ["celestial", "celestials", "céleste", "célestes"],
    construct: ["construct", "constructs", "créature artificielle", "créatures artificielles", "artificiel"],
    dragon: ["dragon", "dragons"],
    elemental: ["elemental", "elementals", "élémentaire", "élémentaires"],
    fey: ["fey", "fée", "fées"],
    fiend: ["fiend", "fiends", "fiélon", "fiélons"],
    giant: ["giant", "giants", "géant", "géants"],
    humanoid: ["humanoid", "humanoids", "humanoïde", "humanoïdes"],
    monstrosity: ["monstrosity", "monstrosities", "monstruosité", "monstruosités"],
    ooze: ["ooze", "oozes", "vase", "vases"],
    plant: ["plant", "plants", "plante", "plantes"],
    undead: ["undead", "mort-vivant", "morts-vivants", "mort vivant", "morts vivants"]
  },
  swarm: ["swarm of", "nuée de", "nuée d'", "nuée d’"],
  abilities: {
    str: ["STR", "FOR"],
    dex: ["DEX"],
    con: ["CON"],
    int: ["INT"],
    wis: ["WIS", "SAG"],
    cha: ["CHA"]
  },
  /** Full ability names, for saving throw lines written in full ("Strength +5", "Sagesse +3"). */
  abilityNames: {
    str: ["Strength", "Force"],
    dex: ["Dexterity", "Dextérité"],
    con: ["Constitution"],
    int: ["Intelligence"],
    wis: ["Wisdom", "Sagesse"],
    cha: ["Charisma", "Charisme"]
  },
  movement: {
    walk: ["walk", "marche"],
    fly: ["fly", "vol"],
    swim: ["swim", "nage"],
    climb: ["climb", "escalade"],
    burrow: ["burrow", "fouissement", "creusement", "fouille"]
  },
  hover: ["hover", "vol stationnaire", "stationnaire"],
  senses: {
    blindsight: ["blindsight", "vision aveugle"],
    darkvision: ["darkvision", "vision dans le noir"],
    tremorsense: ["tremorsense", "perception des vibrations"],
    truesight: ["truesight", "vision lucide", "vision véritable"]
  },
  passivePerception: ["passive Perception", "Perception passive"],
  skills: {
    acr: ["Acrobatics", "Acrobaties"],
    ani: ["Animal Handling", "Dressage"],
    arc: ["Arcana", "Arcanes"],
    ath: ["Athletics", "Athlétisme"],
    dec: ["Deception", "Supercherie", "Tromperie"],
    his: ["History", "Histoire"],
    ins: ["Insight", "Perspicacité", "Intuition"],
    itm: ["Intimidation"],
    inv: ["Investigation"],
    med: ["Medicine", "Médecine"],
    nat: ["Nature"],
    prc: ["Perception"],
    prf: ["Performance", "Représentation"],
    per: ["Persuasion"],
    rel: ["Religion"],
    slt: ["Sleight of Hand", "Escamotage"],
    ste: ["Stealth", "Discrétion", "Furtivité"],
    sur: ["Survival", "Survie"]
  },
  skillAbilities: {
    acr: "dex", ani: "wis", arc: "int", ath: "str", dec: "cha", his: "int", ins: "wis", itm: "cha", inv: "int",
    med: "wis", nat: "int", prc: "wis", prf: "cha", per: "cha", rel: "int", slt: "dex", ste: "dex", sur: "wis"
  },
  languages: {
    common: ["Common", "commun"],
    draconic: ["Draconic", "draconique"],
    dwarvish: ["Dwarvish", "nain"],
    elvish: ["Elvish", "elfique", "elfe"],
    giant: ["Giant", "géant"],
    gnomish: ["Gnomish", "gnome"],
    goblin: ["Goblin", "gobelin"],
    halfling: ["Halfling", "halfelin", "halfeline"],
    orc: ["Orc", "orque"],
    sign: ["Common Sign Language", "langue des signes commune", "langue des signes"],
    aarakocra: ["Aarakocra"],
    abyssal: ["Abyssal"],
    cant: ["Thieves' Cant", "Thieves’ Cant", "Thieves Cant", "argot des voleurs"],
    celestial: ["Celestial", "céleste"],
    deep: ["Deep Speech", "profond"],
    druidic: ["Druidic", "druidique"],
    gith: ["Gith"],
    gnoll: ["Gnoll"],
    infernal: ["Infernal"],
    aquan: ["Aquan", "aquatique"],
    auran: ["Auran", "aérien"],
    ignan: ["Ignan", "igné"],
    terran: ["Terran", "terreux"],
    primordial: ["Primordial", "primordial"],
    sylvan: ["Sylvan", "sylvestre", "sylvain"],
    undercommon: ["Undercommon", "commun des profondeurs", "sous-commun"]
  },
  telepathy: ["telepathy", "télépathie"],
  /** "Languages —", "Languages none" */
  noLanguage: ["none", "aucune", "aucun", "—", "-", "–"],
  anyLanguage: ["all", "any", "toutes", "n'importe laquelle"],
  units: { ft: ["ft", "ft.", "feet", "foot", "pieds", "pied", "pi", "pi."], m: ["m", "m.", "mètres", "mètre", "metres"] },
  xp: ["XP", "PX"],
  crFractions: { "1/8": 0.125, "1/4": 0.25, "1/2": 0.5, "⅛": 0.125, "¼": 0.25, "½": 0.5 },
  naturalArmor: ["natural armor", "natural armour", "armure naturelle"],
  /** Alignment words of the size line (the alignment is the rest of the line after the first comma). */
  anyAlignment: ["any alignment", "tout alignement", "unaligned", "non aligné", "non alignée", "sans alignement"]
});

const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Alternation of every word of a list (longest first, so "Bonus Actions" wins over "Actions"). */
export function alternation(words) {
  return [...words].sort((a, b) => b.length - a.length).map(escape).join("|");
}

/** Alternation of every word of every key of a table. */
export function tableAlternation(table) {
  return alternation(Object.values(table).flat());
}

let labelPatterns = null;

/** Key of `STAT_LEXICON.labels` whose label starts the line, else null. Longest label wins. */
export function labelOf(line) {
  const text = String(line ?? "");
  // One expression per label, compiled once (this runs on every line). A short label ("AC", "HP", "CR") must be
  // followed by a space and a value, not a letter.
  labelPatterns ??= Object.entries(STAT_LEXICON.labels).flatMap(([kind, words]) => words.map(word => ({
    kind, word, length: word.length, re: new RegExp(`^${escape(word)}(?![\\p{L}'’])`, "iu")
  }))).sort((a, b) => b.length - a.length);
  for ( const { kind, word, length, re } of labelPatterns ) {
    if ( re.test(text) ) return { kind, length, word };
  }
  return null;
}

/** Strip the diacritics and lowercase: lookups in the tables are accent-insensitive. */
export const foldWord = value => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Key of a table (`STAT_LEXICON.sizes`, `.creatureTypes`, `.skills`…) whose words include the text, else null.
 * @param {Record<string, string[]>} table
 * @param {string} text
 * @returns {string|null}
 */
export function statLookup(table, text) {
  const wanted = foldWord(text).replace(/[.:]$/, "");
  if ( !wanted ) return null;
  for ( const [key, words] of Object.entries(table) ) {
    if ( words.some(word => foldWord(word) === wanted) ) return key;
  }
  return null;
}

/** True when the text (trimmed, trailing period removed) is one of the words. */
export function isWord(words, text) {
  const wanted = foldWord(text).replace(/[.:]$/, "").trim();
  return words.some(word => foldWord(word) === wanted);
}

/** The six abilities, in the order of the stat block. */
export const ABILITY_ORDER = Object.freeze(["str", "dex", "con", "int", "wis", "cha"]);

/** Row of the six ability headers, in order ("STR DEX CON INT WIS CHA", "FOR DEX CON INT SAG CHA"). */
export const ABILITY_ROW_RE = new RegExp(
  ABILITY_ORDER.map(key => `\\b(?:${alternation(STAT_LEXICON.abilities[key])})\\b`).join(".*"), "iu");

/** One cell of the 2024 ability table: "Str 16 +3 +3" (score, modifier, save). */
export const ABILITY_CELL_RE = new RegExp(
  `\\b(${tableAlternation(STAT_LEXICON.abilities)})\\b\\s*(\\d{1,2})\\s+([+-]\\s?\\d+)\\s+([+-]\\s?\\d+)`, "giu");

/** Ability key of an abbreviation or a full name ("Str", "FOR", "Wisdom", "Sagesse"), else null. */
export function statAbilityKey(text) {
  return statLookup(STAT_LEXICON.abilities, text) ?? statLookup(STAT_LEXICON.abilityNames, text);
}
