/**
 * Header of a stat block: the size line ("Medium undead, neutral evil") and the stat lines ("Armor Class 16",
 * "Speed 0 ft., fly 60 ft. (hover)", "Challenge 12 (8,400 XP)") to values. English and French, 2014 and 2024
 * layouts ("AC 17 Initiative +2 (12)", "Str 16 +3 +3", "CR 5 (XP 1,800; PB +3)").
 *
 * Ported from `compendium-json-importer` (`scripts/core/pdf/stat-lines.mjs`). Every field result keeps the passage
 * it was read from in `raw`; nothing is invented: a missing or unreadable line gives `null`. Distances are in feet
 * (1.5 m = 5 ft); `toNpcPatch` converts them to the world's unit. Pure: no Foundry global.
 */
import {
  ABILITY_CELL_RE, ABILITY_ORDER, STAT_LEXICON as LEXICON, alternation, foldWord, isAbilityRow, isWord, labelOf,
  statAbilityKey, statLookup as lookup, tableAlternation
} from "./lexicon/stat-block.mjs";
import { toFeet as defaultToFeet } from "./text.mjs";
import { parseTraitBody } from "./recognizers/traits.mjs";

const normalize = value => String(value ?? "").replace(/\s+/g, " ").trim();
/** Longest value a stat line can carry (a real one is under 300 characters); longer text is not read. */
const MAX_VALUE = 1000;
/** Words and signed numbers of a saves or skills line, in one linear pass ("Sleight of Hand +4, Str +11"). */
const TOKEN_RE = /[\p{L}][\p{L}'’-]*|[+-]\s*\d+|[,;]/gu;
const CR_VALUE = String.raw`(\d+\s*/\s*\d+|[⅛¼½]|\d+(?:[.,]\d+)?)`;
const UNIT_RE = `(${alternation([...LEXICON.units.ft, ...LEXICON.units.m])})`;
const TABLE_HEADER_RE = new RegExp(`^(?:\\s*(?:${alternation(LEXICON.tableHeaders)})\\.?)+\\s*$`, "iu");
const ABILITY_CELL = new RegExp(ABILITY_CELL_RE.source, "iu");
const TRAIT_KINDS = ["dr", "di", "dv", "ci"];

const unitOf = text => (LEXICON.units.m.some(u => foldWord(u) === foldWord(text)) ? "m" : "ft");
const feet = (value, unit, toFeet) => (toFeet ?? defaultToFeet)(value, unit);

/** "18", "1/2", "½", "0.25" -> number, null otherwise. */
export function parseCrValue(raw) {
  const s = normalize(raw).replace(/\s/g, "").replace(",", ".");
  if ( s in LEXICON.crFractions ) return LEXICON.crFractions[s];
  const fraction = s.match(/^(\d+)\/(\d+)$/);
  if ( fraction && Number(fraction[2]) ) return Number(fraction[1]) / Number(fraction[2]);
  const value = Number(s);
  return Number.isFinite(value) ? value : null;
}

/** Comma- or semicolon-separated parts. */
const splitList = value => normalize(value).split(/[,;]/).map(p => p.trim()).filter(Boolean);

/**
 * "Medium undead/fiend (wraith), neutral evil", "Medium Undead, Neutral Evil", "Mort-vivant (fantôme) de taille M,
 * tout alignement", "Medium swarm of Tiny beasts, unaligned" -> `{ size, type, types, subtype, swarm, alignment,
 * anyAlignment, raw }`, or null when the line is not a size line.
 * @param {string} text
 * @returns {object|null}
 */
export function parseSizeLine(text) {
  const line = normalize(text);
  if ( !line || line.length > 120 ) return null;
  const [head, ...rest] = line.split(",");
  const alignment = rest.join(",").trim();
  const sizeWords = tableAlternation(LEXICON.sizes);
  const swarmWords = alternation(LEXICON.swarm);
  const sizeFr = alternation(LEXICON.sizePrefixFr);
  let m = head.match(new RegExp(`^(${sizeWords})(?:\\s+(?:or|ou)\\s+(?:${sizeWords}))?\\s+(?:(${swarmWords})\\s+(${sizeWords})\\s+)?(.+)$`, "iu"));
  let size; let body; let swarm = "";
  if ( m ) {
    size = lookup(LEXICON.sizes, m[1]);
    body = m[4];
    if ( m[2] ) swarm = lookup(LEXICON.sizes, m[3]) ?? "";
  } else {
    // French swarm: "Nuée de taille M de bêtes de taille TP"
    const swarmFr = alternation(LEXICON.swarmFr);
    m = head.match(new RegExp(`^(?:${swarmFr})\\s+(?:${sizeFr})\\s+(${sizeWords})\\s+(?:de|d['’])\\s*(.+?)\\s+(?:${sizeFr})\\s+(${sizeWords})\\s*$`, "iu"));
    if ( m ) {
      size = lookup(LEXICON.sizes, m[1]);
      body = m[2];
      swarm = lookup(LEXICON.sizes, m[3]) ?? "";
    } else {
      // French: "Mort-vivant (fantôme) de taille M", "Humanoïde de taille M ou P", "Nuée de bêtes de taille TP"
      m = head.match(new RegExp(`^(.+?)\\s+(?:${sizeFr})\\s+(${sizeWords})(?:\\s+(?:or|ou)\\s+(?:${sizeWords}))?\\s*$`, "iu"));
      if ( !m ) return null;
      size = lookup(LEXICON.sizes, m[2]);
      body = m[1];
      const swarmMatch = body.match(new RegExp(`^(?:${swarmWords})\\s*(.+)$`, "iu"));
      if ( swarmMatch ) { body = swarmMatch[1]; swarm = size; }
    }
  }
  if ( !size ) return null;
  const paren = body.match(/\(([^)]*)\)/);
  const typeText = body.replace(/\([^)]*\)/g, " ").trim();
  const types = typeText.split(/\s*\/\s*|\s+(?:or|ou)\s+/i).map(t => lookup(LEXICON.creatureTypes, t)).filter(Boolean);
  if ( !types.length ) {
    // A word of the type at the start of the text ("undead (ghost)" reads as a type with a trailing word)
    const first = typeText.split(/\s+/).map(t => lookup(LEXICON.creatureTypes, t)).find(Boolean);
    if ( !first ) return null;
    types.push(first);
  }
  const subtypeParts = [...types.slice(1), paren?.[1]?.trim()].filter(Boolean);
  return {
    size, type: types[0], types, subtype: subtypeParts.join(", "), swarm, alignment,
    anyAlignment: isWord(LEXICON.anyAlignment, alignment), raw: line
  };
}

/**
 * Does `line` continue the value of `record` (a wrapped stat line of a two-column block)? Yes when the record ends
 * open (comma, semicolon, parenthesis, sign) or when the line starts like the middle of a value (lowercase letter,
 * digit, sign, parenthesis). A line that starts with a capital after a closed value is a line of its own: a name,
 * the size line or a sentence nobody asked for, which `parseStatLines` reports instead of gluing it to a value.
 */
const continues = (record, line) => /[,;(+-]$/.test(record.text) || /^[\p{Ll}\d+(-]/u.test(line);

/**
 * Group the stat lines into labelled records: a line that starts with a label opens a record, the next lines without
 * a label continue it when they look like a wrapped value (see `continues`). The ability header row and the 2024
 * ability cells are records of their own; any other line is a record of kind "unknown" (the size line, a name).
 * @param {string[]} lines
 * @returns {{kind: string, label: string, text: string}[]}
 */
export function groupRecords(lines) {
  const records = [];
  let current = null;
  for ( const raw of lines ) {
    const text = normalize(raw);
    if ( !text || TABLE_HEADER_RE.test(text) ) continue;
    const label = labelOf(text);
    if ( label ) {
      current = { kind: label.kind, label: label.word, text: text.slice(label.length).replace(/^[\s:]+/, "").trim() };
      records.push(current);
      continue;
    }
    if ( isAbilityRow(text) || ABILITY_CELL.test(text) ) {
      current = { kind: "abilities", label: "", text };
      records.push(current);
      continue;
    }
    if ( current && continues(current, text) ) current.text = normalize(`${current.text} ${text}`);
    else records.push(current = { kind: "unknown", label: "", text });
  }
  return records;
}

const firstOf = (records, kind) => records.find(r => r.kind === kind) ?? null;
const allOf = (records, kind) => records.filter(r => r.kind === kind);
const lineOf = record => (record ? normalize(`${record.label} ${record.text}`) : "");

/** "16 (natural armor)" -> { value, detail, natural, raw }. */
export function parseAc(text) {
  const line = normalize(text);
  const m = line.match(/^(\d+)(?:\s*\(([^)]*)\))?/);
  if ( !m ) return null;
  const detail = normalize(m[2] ?? "");
  return {
    value: Number(m[1]), detail, natural: LEXICON.naturalArmor.some(w => foldWord(detail).includes(foldWord(w))), raw: line
  };
}

/**
 * "136 (16d8 + 64)", "1,200 (96d20)", "1 200", "1.200" -> { value, formula, raw }. Thousands are grouped by a
 * comma, a space or a point; a number followed by a shorter group ("1,20") is ambiguous and gives null.
 */
export function parseHp(text) {
  const line = normalize(text);
  const m = line.match(/^(\d{1,3}(?:[ ,.]\d{3})+|\d+)/);
  if ( !m ) return null;
  const rest = line.slice(m[0].length);
  if ( /^[,.]\d/.test(rest) ) return null;
  const paren = rest.match(/^\s*\(([^)]+)\)/);
  return { value: Number(m[1].replace(/\D/g, "")), formula: normalize(paren?.[1] ?? ""), raw: line };
}

/** "+2 (12)" -> { bonus, score, raw } (2024 "Initiative" after the AC). */
export function parseInitiative(text) {
  const line = normalize(text);
  const m = line.match(/([+-]\s*\d+)(?:\s*\((\d+)\))?/);
  if ( !m ) return null;
  return { bonus: Number(m[1].replace(/\s/g, "")), score: m[2] ? Number(m[2]) : null, raw: line };
}

/**
 * "0 ft., fly 60 ft. (hover)", "9 m, vol 18 m (vol stationnaire)" -> { speeds: { walk, fly… } (feet), hover, raw }.
 * @param {string} text
 * @param {{toFeet?: Function}} [opts]  `toFeet(value, unit)` replaces the library's conversion.
 */
export function parseSpeed(text, { toFeet } = {}) {
  const line = normalize(text);
  if ( !line ) return null;
  const hover = LEXICON.hover.some(w => foldWord(line).includes(foldWord(w)));
  const modeWords = tableAlternation(LEXICON.movement);
  const re = new RegExp(`^(?:(${modeWords})\\s*:?\\s*)?(\\d+(?:[.,]\\d+)?)\\s*${UNIT_RE}?(?![\\p{L}\\d])`, "iu");
  const speeds = {};
  for ( const part of splitList(line.replace(/\([^)]*\)/g, " ")) ) {
    const m = part.match(re);
    if ( !m ) continue;
    const mode = m[1] ? lookup(LEXICON.movement, m[1]) : "walk";
    if ( !mode ) continue;
    speeds[mode] = feet(m[2].replace(",", "."), m[3] ? unitOf(m[3]) : "ft", toFeet);
  }
  if ( !Object.keys(speeds).length ) return null;
  return { speeds, hover, raw: line };
}

/**
 * Ability scores from the ability records: the 2024 cells ("Str 16 +3 +3": score, modifier, save; a save that
 * differs from the modifier is a proficient save) or the 2014 row of six scores under the header row.
 * @param {{text: string}[]} records  Records of kind "abilities" (or any `{ text }` list).
 * @returns {{scores: object, saves: object, raw: string}|null}  `scores` = { str: 12… }, `saves` = { dex: 10… }
 *   (2024 only).
 */
export function parseAbilities(records) {
  const scores = {};
  const saves = {};
  const list = Array.isArray(records) ? records : [];
  const raw = list.map(r => normalize(r?.text)).filter(Boolean).join("\n");
  const cells = list.flatMap(r => Array.from(String(r?.text ?? "").matchAll(new RegExp(ABILITY_CELL_RE.source, "giu"))));
  if ( cells.length >= 6 ) {
    for ( const [, name, score, mod, save] of cells ) {
      const key = statAbilityKey(name);
      if ( !key ) continue;
      scores[key] = Number(score);
      const modValue = Number(mod.replace(/\s/g, ""));
      const saveValue = Number(save.replace(/\s/g, ""));
      if ( saveValue !== modValue ) saves[key] = saveValue;
    }
    return Object.keys(scores).length === 6 ? { scores, saves, raw } : null;
  }
  const headerWords = new RegExp(`\\b(?:${tableAlternation(LEXICON.abilities)})\\b`, "giu");
  for ( const record of list ) {
    const cleaned = String(record?.text ?? "").replace(headerWords, " ").replace(/\([^)]*\)/g, " ");
    const numbers = Array.from(cleaned.matchAll(/(?<![\d+-])(\d{1,2})(?![\d])/g), m => Number(m[1]));
    if ( numbers.length >= 6 ) {
      ABILITY_ORDER.forEach((key, i) => { scores[key] = numbers[i]; });
      return { scores, saves, raw };
    }
  }
  return null;
}

/** "12 (8,400 XP) Proficiency Bonus +4", "5 (XP 1,800; PB +3)" -> { cr, xp, prof, raw }. */
export function parseChallenge(text) {
  const raw = normalize(text);
  let line = raw;
  if ( !line ) return null;
  const profWords = alternation(LEXICON.labels.prof);
  let prof = null;
  line = line.replace(new RegExp(`(?:${profWords})\\s*:?\\s*\\+?\\s*(\\d+)`, "iu"), (_, n) => { prof = Number(n); return " "; });
  const m = line.match(new RegExp(`${CR_VALUE}(?:\\s*\\(([^)]*)\\))?(?:\\s*\\+\\s*(\\d+))?`, "u"));
  if ( !m ) return null;
  const cr = parseCrValue(m[1]);
  if ( cr === null ) return null;
  let xp = null;
  const inside = m[2] ?? "";
  const xpWords = alternation(LEXICON.xp);
  const xpMatch = inside.match(new RegExp(`([\\d,.\\s]+?)\\s*(?:${xpWords})\\b`, "iu"))
    ?? inside.match(new RegExp(`(?:${xpWords})\\s*:?\\s*([\\d,.\\s]+)`, "iu"));
  if ( xpMatch ) {
    const digits = xpMatch[1].replace(/\D/g, "");
    if ( digits ) xp = Number(digits);
  }
  if ( prof === null && m[3] ) prof = Number(m[3]);
  return { cr, xp, prof, raw };
}

/** dnd5e: Proficiency.calculateMod(max(cr, 1)). */
export const proficiencyFromCr = cr => (cr === null || cr === undefined ? null : Math.floor((Math.max(Number(cr), 1) + 7) / 4));

/** A custom trait entry is short prose without numbers; interleaved lines of the other column are not. */
const isPlausibleCustom = part => /\p{L}/u.test(part) && !/[\d:.]/.test(part) && part.length <= 60;

/**
 * "darkvision 120 ft., passive Perception 13" -> { ranges: { darkvision: 120 }, units: "ft", special, raw }.
 * @param {string} text
 * @param {{toFeet?: Function}} [opts]
 */
export function parseSenses(text, { toFeet } = {}) {
  const line = normalize(text);
  if ( !line ) return null;
  const ranges = {};
  const special = [];
  const senseWords = tableAlternation(LEXICON.senses);
  const re = new RegExp(`^(${senseWords})\\s+(\\d+)\\s*${UNIT_RE}?\\s*(.*)$`, "iu");
  const passive = new RegExp(`^(?:${alternation(LEXICON.passivePerception)})\\b`, "iu");
  for ( const part of splitList(line) ) {
    const m = part.match(re);
    if ( m ) {
      const key = lookup(LEXICON.senses, m[1]);
      ranges[key] = feet(m[2], m[3] ? unitOf(m[3]) : "ft", toFeet);
      const rest = normalize(m[4]);
      if ( rest && isPlausibleCustom(rest) ) special.push(`${key} ${rest}`);
    } else if ( !passive.test(part) && isPlausibleCustom(part) ) special.push(part);
  }
  if ( !Object.keys(ranges).length && !special.length ) return null;
  return { ranges, units: "ft", special: special.join("; "), raw: line };
}

/**
 * "Common, Abyssal, telepathy 60 ft." -> { value: ["abyssal", "common"], custom: "", communication: { telepathy:
 * { value, units: "ft" } }, raw }.
 * @param {string} text
 * @param {{toFeet?: Function}} [opts]
 */
export function parseLanguages(text, { toFeet } = {}) {
  const line = normalize(text);
  if ( !line ) return null;
  const value = new Set();
  const custom = [];
  const communication = {};
  const telepathy = new RegExp(`^(?:${alternation(LEXICON.telepathy)})\\s+(\\d+)\\s*${UNIT_RE}?`, "iu");
  for ( let part of splitList(line) ) {
    const tele = part.match(telepathy);
    if ( tele ) {
      communication.telepathy = { value: feet(tele[1], tele[2] ? unitOf(tele[2]) : "ft", toFeet), units: "ft" };
      continue;
    }
    part = part.replace(/\s*\(.*$/, "").trim();
    const low = foldWord(part).replace(/[.\s]+$/, "");
    if ( !low || isWord(LEXICON.noLanguage, low) || !/\p{L}/u.test(low) ) continue;
    const key = lookup(LEXICON.languages, low);
    if ( key ) value.add(key);
    else custom.push(part.replace(/[.\s]+$/, ""));
  }
  if ( !value.size && !custom.length && !communication.telepathy ) return null;
  return { value: [...value].sort(), custom: custom.join("; "), communication, raw: line };
}

/**
 * Pairs "name, signed number" of a saves or skills line, in one linear pass over its tokens: the words since the
 * last separator or number form the name of the number that follows them ("Sleight of Hand +4, Str +11").
 * @param {string} line
 * @returns {{ name: string, value: number }[]}
 */
function namedBonuses(line) {
  const pairs = [];
  let words = [];
  for ( const [token] of line.matchAll(TOKEN_RE) ) {
    if ( token === "," || token === ";" ) words = [];
    else if ( /^[+-]/.test(token) ) {
      if ( words.length ) pairs.push({ name: words.join(" "), value: Number(token.replace(/\s/g, "")) });
      words = [];
    }
    else words.push(token);
  }
  return pairs;
}

/** "Str +11, Wis +9", "For +11, Sag +9", "Strength +5" -> { str: 11, wis: 9 } (plain map, no `raw`). */
export function parseSaves(text) {
  const line = normalize(text);
  if ( !line || line.length > MAX_VALUE ) return null;
  const out = {};
  for ( const { name, value } of namedBonuses(line) ) {
    // The last word names the ability ("Str", "Sagesse"); a stray word before it is ignored
    const key = statAbilityKey(name.split(" ").at(-1));
    if ( key ) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * "Athletics +11, Perception +4" -> { ath: 2, prc: 1 } (plain map, no `raw`): proficiency level (2 = expertise
 * when the bonus reaches the ability modifier plus twice the proficiency bonus).
 * @param {string} text
 * @param {{scores?: object, prof?: number|null, cr?: number|null}} [opts]
 */
export function parseSkills(text, { scores, prof, cr } = {}) {
  const line = normalize(text);
  if ( !line || line.length > MAX_VALUE ) return null;
  const bonus = prof ?? proficiencyFromCr(cr);
  const out = {};
  for ( const { name, value } of namedBonuses(line) ) {
    const key = lookup(LEXICON.skills, name);
    if ( !key ) continue;
    let level = 1;
    const score = scores?.[LEXICON.skillAbilities[key]];
    if ( bonus && (score !== undefined) && (value >= Math.floor((score - 10) / 2) + 2 * bonus) ) level = 2;
    out[key] = level;
  }
  return Object.keys(out).length ? out : null;
}

/** A 2024 "Immunities" line lists damage types and conditions together (label without "damage" / "condition"). */
const isBareLabel = label => /^immunit/iu.test(foldWord(label)) && !/(degats|damage|etat|condition)/iu.test(foldWord(label));

/**
 * dr/di/dv/ci of the trait lines, read by the traits recognizer (`parseTraitBody`).
 * @param {{kind: string, label: string, text: string}[]} traitLines
 * @returns {Record<string, {values: string[], bypasses: string[], custom: string[]}>|null}  Only the kinds with
 *   content, null when there is none.
 */
export function parseTraitLines(traitLines) {
  const out = {};
  for ( const { kind, label, text } of traitLines ?? [] ) {
    if ( !TRAIT_KINDS.includes(kind) || !normalize(text) ) continue;
    const { traits } = parseTraitBody(text, kind, { bare: kind === "di" && isBareLabel(label) });
    for ( const key of TRAIT_KINDS ) {
      const from = traits[key];
      if ( !from.values.length && !from.bypasses.length && !from.custom.length ) continue;
      out[key] ??= { values: [], bypasses: [], custom: [] };
      for ( const part of ["values", "bypasses", "custom"] ) {
        for ( const entry of from[part] ) if ( !out[key][part].includes(entry) ) out[key][part].push(entry);
      }
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Read the header of a stat block.
 * @param {string|string[]} input  Plain text (one stat line per text line) or the lines, in reading order: the size
 *   line (optional) and the stat lines, up to the first trait.
 * @param {{toFeet?: Function}} [opts]  `toFeet(value, unit)` replaces the library's metre to foot conversion.
 * @returns {object}  `{ size, ac, hp, initiative, speed, abilities, saves, skills, senses, languages, cr, xp, prof,
 *   traits, traitLines, gear, records, unrecognized }`; every field null when its line is absent or unreadable.
 *   `abilities` = `{ str: 18… }`, `saves` = `{ str: 7… }` (bonuses), `skills` = `{ ath: 1… }` (proficiency level).
 *   `traitLines` = `[{ kind, label, text }]` with the printed text of the dr/di/dv/ci lines and `traits` their
 *   reading; `records` keeps every grouped line (`{ kind, label, text }`); `unrecognized` = `[{ kind, text }]`:
 *   the lines without a known label (other than the size line) and the labelled values that could not be read.
 */
export function parseStatLines(input, { toFeet } = {}) {
  const lines = Array.isArray(input) ? input.map(line => String(line ?? "")) : String(input ?? "").split("\n");
  const records = groupRecords(lines);
  const unrecognized = [];
  const read = (kind, parse) => {
    const record = firstOf(records, kind);
    if ( !record ) return null;
    const result = parse(record.text);
    if ( result === null ) unrecognized.push({ kind, text: lineOf(record) });
    else if ( typeof result === "object" && ("raw" in result) ) result.raw = lineOf(record);
    return result;
  };

  let size = null;
  for ( const record of allOf(records, "unknown") ) {
    const parsed = size ? null : parseSizeLine(record.text);
    if ( parsed ) size = parsed;
    else unrecognized.push({ kind: "line", text: record.text });
  }

  const acRecord = firstOf(records, "ac");
  const acText = acRecord?.text ?? "";
  const initiativeWords = alternation(LEXICON.labels.initiative);
  // 2024: "AC 17 Initiative +2 (12)" on one line, or "Initiative +12 (22)" on its own line
  const inlineInitiative = acText.match(new RegExp(`(?:${initiativeWords})\\s*(.*)$`, "iu"));
  const ac = read("ac", parseAc);
  let initiative;
  if ( inlineInitiative ) {
    initiative = parseInitiative(inlineInitiative[1]);
    if ( initiative ) initiative.raw = lineOf(acRecord);
  } else initiative = read("initiative", parseInitiative);

  const abilityRecords = allOf(records, "abilities");
  const abilities = abilityRecords.length ? parseAbilities(abilityRecords) : null;
  if ( abilityRecords.length && !abilities ) {
    for ( const record of abilityRecords ) unrecognized.push({ kind: "abilities", text: record.text });
  }
  const challenge = read("cr", parseChallenge);
  const profRecord = firstOf(records, "prof");
  const profLine = profRecord?.text.match(/\+?\s*(\d+)/);
  const prof = profLine ? Number(profLine[1]) : challenge?.prof ?? null;
  if ( profRecord && !profLine ) unrecognized.push({ kind: "prof", text: lineOf(profRecord) });
  const cr = challenge?.cr ?? null;
  const saves = read("saves", parseSaves) ?? (abilities && Object.keys(abilities.saves).length ? abilities.saves : null);
  const traitLines = records.filter(r => TRAIT_KINDS.includes(r.kind)).map(r => ({ kind: r.kind, label: r.label, text: r.text }));
  return {
    size,
    ac,
    hp: read("hp", parseHp),
    initiative,
    speed: read("speed", text => parseSpeed(text, { toFeet })),
    abilities: abilities?.scores ?? null,
    saves,
    skills: read("skills", text => parseSkills(text, { scores: abilities?.scores, prof, cr })),
    senses: read("senses", text => parseSenses(text, { toFeet })),
    languages: read("languages", text => parseLanguages(text, { toFeet })),
    cr,
    xp: challenge?.xp ?? null,
    prof,
    traits: parseTraitLines(traitLines),
    traitLines,
    gear: firstOf(records, "gear")?.text || null,
    records,
    unrecognized
  };
}

/** The four values a creature needs: AC, hit points, speed and abilities. */
export function hasRequiredStats(stats) {
  return !!(stats?.ac && stats.hp && stats.speed && stats.abilities);
}
