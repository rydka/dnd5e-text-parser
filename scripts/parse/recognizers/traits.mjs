import { fold, damageKey, conditionKey } from "./actor-words.mjs";

/** Order in which bypasses are listed. */
const BYPASS_ORDER = ["mgc", "ada", "sil"];

/** Line headers, matched on accent-folded text. Group 1 carries the kind word. */
const HEADERS = [
  { re: /^\W*condition\s+immunit(?:y|ies)\b/, kind: "ci" },
  { re: /^\W*immunites?\s+(?:contre\s+)?(?:les\s+)?etats?\b/, kind: "ci" },
  { re: /^\W*damage\s+(resistances?|immunit(?:y|ies)|vulnerabilit(?:y|ies))\b/, kind: null },
  { re: /^\W*(resistances?|immunites?|vulnerabilites?)\s+(?:aux?\s+)?degats?\b/, kind: null },
  { re: /^\W*(resistances|immunities|vulnerabilities)\b/, kind: null, bare: true },
  { re: /^\W*(resistances|immunites|vulnerabilites)\s*:/, kind: null, bare: true }
];

/** Where the next stat block entry starts, when the whole block is on one line. */
const NEXT_ENTRY_RE = /\b(?:condition immunities|immunites contre les etats|damage (?:resistances|immunities|vulnerabilities)|senses|languages|challenge|sens|langues|dangerosite)\b/;

/** Start of a qualifier on a group ("from nonmagical attacks", "d'attaques non magiques"…). */
const QUALIFIER_RE = new RegExp([
  String.raw`\b(?:(?:from|provenant|que|des?|d\x27)\s*)?(?:attacks?\s+|attaques?\s+|weapons?\s+|armes?\s+)?non[- ]?magi`,
  String.raw`\bthat (?:aren\x27t|are not|isn\x27t|is not)\b`,
  String.raw`\bwhich (?:aren\x27t|are not)\b`,
  String.raw`\bqui ne sont pas\b`,
  String.raw`\bnot made with\b`,
  String.raw`\bfrom (?:attacks|weapons|spells)\b`,
  String.raw`\bd\x27(?:attaques?|armes?|sorts?)\b`
].join("|"));

/**
 * Map a leading word to a trait kind.
 * @param {string} word  Folded word.
 * @returns {"dr"|"di"|"dv"}
 */
const kindOf = word => word.startsWith("resist") ? "dr" : word.startsWith("immun") ? "di" : "dv";

/**
 * Bypass keys named in a qualifier (folded text).
 * @param {string} folded
 * @returns {string[]}
 */
function bypassesIn(folded) {
  const found = new Set();
  if ( /non[- ]?magi/.test(folded) ) found.add("mgc");
  if ( /adamant/.test(folded) ) found.add("ada");
  if ( /silver|argent/.test(folded) ) found.add("sil");
  return BYPASS_ORDER.filter(key => found.has(key));
}

const emptyTrait = () => ({ values: [], bypasses: [], custom: [] });

/**
 * Parse the body of one trait line (the text after "Damage Resistances").
 * Groups are separated by `;`. dnd5e stores `bypasses` once per trait, so only the first group's bypass set is
 * mechanical: groups with another bypass set go to `custom`, with a note.
 * @param {string} body
 * @param {"dr"|"di"|"dv"|"ci"} kind
 * @param {{ bare?: boolean }} [options]  `bare`: 2024 header without "Damage"; conditions go to `ci`.
 * @returns {{ traits: Record<string, {values: string[], bypasses: string[], custom: string[]}>, ambiguous: object[] }}
 */
export function parseTraitBody(body, kind, options = {}) {
  const traits = { dr: emptyTrait(), di: emptyTrait(), dv: emptyTrait(), ci: emptyTrait() };
  const ambiguous = [];
  let mechanical = null;

  for ( const rawGroup of String(body ?? "").split(";") ) {
    const group = rawGroup.trim().replace(/\.$/, "");
    if ( !group ) continue;
    const folded = fold(group);
    const cut = folded.match(QUALIFIER_RE);
    const itemsText = cut ? group.slice(0, cut.index) : group;
    const bypasses = cut ? bypassesIn(folded.slice(cut.index)) : [];
    if ( cut && !bypasses.length ) {
      // Qualifier we cannot express as a bypass ("from spells"): keep the passage as text.
      traits[kind].custom.push(group);
      ambiguous.push({ key: "dnd5e-text-parser.Note.TraitQualifier", data: { kind, text: group } });
      continue;
    }

    const parts = itemsText.split(/\s*(?:,|\band\b|\bet\b|\bor\b|\bou\b)\s*/i).map(s => s.trim().replace(/\.$/, ""))
      .filter(Boolean);
    const entries = [];
    for ( const part of parts ) {
      const damage = kind === "ci" ? null : damageKey(part);
      const condition = (kind === "ci" || options.bare) && !damage ? conditionKey(part) : null;
      entries.push({ part, target: damage ? kind : condition ? "ci" : null, key: damage ?? condition });
    }

    const signature = bypasses.join(",");
    if ( mechanical === null && entries.some(e => e.target) ) mechanical = signature;
    const isMechanical = mechanical === signature;
    if ( !isMechanical && entries.some(e => e.target) ) {
      // A different bypass set than the first group: cannot share the trait's single `bypasses`.
      traits[kind].custom.push(group);
      ambiguous.push({ key: "dnd5e-text-parser.Note.TraitBypassMixed", data: { kind, text: group } });
      continue;
    }

    for ( const entry of entries ) {
      if ( !entry.target ) {
        traits[kind].custom.push(entry.part);
        ambiguous.push({ key: "dnd5e-text-parser.Note.TraitUnknown", data: { kind, text: entry.part } });
        continue;
      }
      const trait = traits[entry.target];
      if ( !trait.values.includes(entry.key) ) trait.values.push(entry.key);
      if ( entry.target === kind || kind === "ci" ) {
        for ( const bypass of bypasses ) if ( !trait.bypasses.includes(bypass) ) trait.bypasses.push(bypass);
      }
    }
  }
  return { traits, ambiguous };
}

/**
 * Damage resistances, immunities and vulnerabilities, and condition immunities (C13).
 * `fact` = `{ dr, di, dv, ci }`, each `{ values, bypasses, custom }`. Spans are `{ kind, start, end, text }`.
 * @param {string} text  Plain text, one stat block line per text line.
 * @returns {{ fact: Record<string, {values: string[], bypasses: string[], custom: string[]}>,
 *   spans: object[], ambiguous: object[] }}
 */
export function recognizeTraits(text) {
  const source = String(text ?? "");
  const fact = { dr: emptyTrait(), di: emptyTrait(), dv: emptyTrait(), ci: emptyTrait() };
  const spans = [];
  const ambiguous = [];

  const queue = [];
  let offset = 0;
  for ( const line of source.split("\n") ) {
    queue.push({ line, offset });
    offset += line.length + 1;
  }

  while ( queue.length ) {
    const { line, offset: base } = queue.shift();
    const folded = fold(line);
    let header = null;
    for ( const candidate of HEADERS ) {
      const match = folded.match(candidate.re);
      if ( match ) { header = { ...candidate, match }; break; }
    }
    if ( !header ) continue;

    const kind = header.kind ?? kindOf(header.match[1]);
    let start = header.match[0].length;
    const rest = folded.slice(start);
    const next = rest.search(NEXT_ENTRY_RE);
    let end = line.length;
    if ( next > 0 ) {
      end = start + next;
      queue.unshift({ line: line.slice(end), offset: base + end });
    }
    // Skip the separator between the header and its list.
    start += (line.slice(start, end).match(/^[\s:.\u2013\u2014-]*/)?.[0].length ?? 0);
    const body = line.slice(start, end);
    if ( !body.trim() ) continue;

    const result = parseTraitBody(body, kind, { bare: header.bare });
    for ( const key of Object.keys(fact) ) {
      const from = result.traits[key];
      for ( const value of from.values ) if ( !fact[key].values.includes(value) ) fact[key].values.push(value);
      for ( const bypass of from.bypasses ) if ( !fact[key].bypasses.includes(bypass) ) fact[key].bypasses.push(bypass);
      for ( const custom of from.custom ) if ( !fact[key].custom.includes(custom) ) fact[key].custom.push(custom);
    }
    ambiguous.push(...result.ambiguous);
    spans.push({ kind, start: base, end: base + end, text: line.slice(0, end).trim() });
  }
  return { fact, spans, ambiguous };
}
