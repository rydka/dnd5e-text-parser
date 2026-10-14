import { htmlToText } from "./text.mjs";
import { fold, abilityKey, ABILITY_RE } from "./lexicon/index.mjs";

/** Trait names that introduce a spell list (EN/FR). */
const NAME_RE = /^(?:innate\s+)?spellcasting\b|^incantation\b/;

const ABILITY_RES = [
  new RegExp(String.raw`spellcasting ability (?:is|:)\s*(${ABILITY_RE})`),
  // "using Charisma as its spellcasting ability" (MM 2014), "uses Charisma as its spellcasting ability" (MM 2024)
  new RegExp(String.raw`us(?:ing|es|e) (${ABILITY_RE}) as (?:its|the|their|his|her)? ?spellcasting ability`),
  new RegExp(String.raw`caracteristique d'incantation(?:\s+innee)?(?:\s+(?:du|de la|de l'|des|d')\s*[^.:()]{1,40}?)?\s*(?:est|:)\s*(?:l[ae]\s+|l')?(${ABILITY_RE})`),
  // "en utilisant le Charisme comme caractéristique d'incantation", "utilise le Charisme comme caractéristique d'incantation"
  new RegExp(String.raw`(?:utilisant|utilise|avec)\s+(?:l[ae]\s+|l')?(${ABILITY_RE}) comme caracteristique d'incantation`)
];
const DC_RES = [/spell save dc\s*(\d+)/, /\bdd(?:\s+de\s+sauvegarde)?(?:\s+des\s+sorts?)?\s*(\d+)/, /\bdd\s+de\s+sort\s*(\d+)/];
const ATTACK_RES = [
  /([+-]\s?\d+)\s+to hit with spell attacks/,
  /([+-]\s?\d+)\s+au toucher\s+(?:avec|pour)\s+les\s+attaques\s+de\s+sorts?/
];
const LEVEL_RES = [
  /(\d+)(?:st|nd|rd|th)[- ]level spellcaster/,
  /lanc(?:eur|euse)s?\s+de\s+sorts?\s+de\s+niveau\s+(\d+)/,
  /(\d+)(?:er|e|eme)?[- ]niveau\s+(?:lanceur|lanceuse)/
];

const AT_WILL = "at[ -]will|a volonte";
const LIST_LABELS = [
  { mode: "cantrip", re: new RegExp(String.raw`^(?:cantrips?|sorts? mineurs?|tours? de magie)\s*(?:\((?:${AT_WILL})\))?\s*:`) },
  { mode: "atwill", re: new RegExp(String.raw`^(?:${AT_WILL})\s*:`) },
  { mode: "innate", re: /^(\d+)\s*\/\s*(?:day|jour)(?:\s+(?:each|chacun[es]?))?\s*:/ },
  { mode: "slots", re: /^(?:(\d+)(?:st|nd|rd|th)\s+level|level\s+(\d+)|niveau\s+(\d+)|(\d+)(?:er|e|eme)\s+niveau)\s*\(\s*(\d+)\s*(?:slots?|emplacements?)\s*\)\s*:/ }
];
const LABEL_ANYWHERE = new RegExp(
  String.raw`(?<=\S)[ \t]+(?=(?:` + LIST_LABELS.map(l => l.re.source.slice(1)).join("|") + "))", "g"
);

/**
 * Put every list label on its own line (stat blocks are sometimes flattened to one line).
 * @param {string} text
 * @returns {string}
 */
function breakBeforeLabels(text) {
  let out = "";
  let last = 0;
  for ( const match of fold(text).matchAll(LABEL_ANYWHERE) ) {
    out += text.slice(last, match.index) + "\n";
    last = match.index + match[0].length;
  }
  return out + text.slice(last);
}

/**
 * Is this feature name the heading of a spellcasting trait?
 * @param {string} name
 * @returns {boolean}
 */
export function isSpellcastingName(name) {
  return NAME_RE.test(fold(name).trim());
}

/**
 * Plain spell names from a list body: split on commas outside parentheses, remove parentheses, `*` marks and
 * `[[/item …]]{label}` / `@UUID[…]{label}` enrichers (the label is kept).
 * @param {string} body
 * @returns {string[]}
 */
export function splitSpellNames(body) {
  const cleaned = String(body ?? "")
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/\[\[\/item\s+([^\]]*?)\]\]\{([^}]*)\}/g, "$2")
    .replace(/\[\[\/item\s+([^\]]*?)\]\]/g, "$1")
    .replace(/@\w+\[[^\]]*\]/g, "");
  const names = [];
  let depth = 0;
  let current = "";
  for ( const char of cleaned ) {
    if ( char === "(" ) depth++;
    else if ( char === ")" ) depth = Math.max(0, depth - 1);
    if ( char === "," && depth === 0 ) { names.push(current); current = ""; }
    else current += char;
  }
  names.push(current);
  return names
    .map(n => n.replace(/\([^)]*\)/g, "").replace(/[*\u2020]/g, "").replace(/\s+/g, " ").trim().replace(/[.;]$/, "").trim())
    .filter(Boolean);
}

const firstMatch = (patterns, folded) => {
  for ( const re of patterns ) {
    const match = folded.match(re);
    if ( match ) return match;
  }
  return null;
};

/**
 * Parse a spellcasting trait (C22): header facts and spell lists.
 * Returns `null` when nothing of a spellcasting trait is found, unless `opts.name` is a spellcasting heading
 * (then an empty plan is returned so the caller can report the missing list).
 * @param {string} html
 * @param {{ name?: string }} [opts]
 * @returns {object|null} SpellcastingPlan
 */
export function parseSpellcasting(html, opts = {}) {
  const text = htmlToText(html ?? "");
  const named = opts.name ? isSpellcastingName(opts.name) : false;

  const lists = [];
  const lines = breakBeforeLabels(text).split("\n");
  let headerEnd = lines.length;
  lines.forEach((rawLine, index) => {
    const line = rawLine.replace(/^[\s\u2022*\-\u2013]+/, "");
    const lineFolded = fold(line);
    for ( const { mode, re } of LIST_LABELS ) {
      const match = lineFolded.match(re);
      if ( !match ) continue;
      headerEnd = Math.min(headerEnd, index);
      const spells = splitSpellNames(line.slice(match[0].length));
      const entry = { mode, uses: null, level: null, slots: null, spells };
      if ( mode === "cantrip" ) entry.level = 0;
      if ( mode === "innate" ) entry.uses = Number(match[1]);
      if ( mode === "slots" ) {
        entry.level = Number(match[1] ?? match[2] ?? match[3] ?? match[4]);
        entry.slots = Number(match[5]);
      }
      lists.push(entry);
      return;
    }
  });

  const headerFolded = fold(lines.slice(0, headerEnd).join("\n"));
  const ability = firstMatch(ABILITY_RES, headerFolded);
  const dc = firstMatch(DC_RES, headerFolded);
  const attack = firstMatch(ATTACK_RES, headerFolded);
  const level = firstMatch(LEVEL_RES, headerFolded);
  const innate = /\binnate\b|\binnee?s?\b/.test(fold(`${opts.name ?? ""}\n${lines.slice(0, headerEnd).join("\n")}`));

  if ( !ability && !dc && !attack && !level && !lists.length && !named ) return null;
  return {
    ability: ability ? abilityKey(ability[1]) : null,
    dc: dc ? Number(dc[1]) : null,
    attack: attack ? Number(attack[1].replace(/\s/g, "")) : null,
    casterLevel: level ? Number(level[1]) : null,
    innate,
    lists
  };
}
