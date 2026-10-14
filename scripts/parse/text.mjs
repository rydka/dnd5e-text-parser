/**
 * Text helpers: HTML to plain text, sentences, lines, numbers and unit conversions.
 * Pure: no Foundry global.
 */

const ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", rsquo: "'", lsquo: "'", sbquo: "'",
  ldquo: "\"", rdquo: "\"", laquo: "\"", raquo: "\"", ndash: "-", mdash: "-", minus: "-", hellip: "...",
  times: "x", shy: "", ensp: " ", emsp: " ", thinsp: " "
};

const ABILITY_NAMES = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"
};

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if ( body[0] === "#" ) {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return match; }
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Replace Foundry / dnd5e enrichers with their readable text. */
function stripEnrichers(text) {
  return text
    .replace(/@Embed\[[^\]]*\](?:\{[^}]*\})?/g, "")
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@\w+\[([^\]/]*)\]/g, "$1")
    .replace(/&Reference\[([^\]=]*?)(?:\s+[a-z]+=[^\]]*)?\](?:\{([^}]*)\})?/g, (m, a, b) => b ?? a)
    .replace(/\[\[\/save\s+(?:ability=)?(\w+)\s+dc=(\d+)[^\]]*\]\](?:\{([^}]*)\})?/gi,
      (m, ab, dc, label) => label ?? `DC ${dc} ${ABILITY_NAMES[ab.toLowerCase().slice(0, 3)] ?? ab} saving throw`)
    .replace(/\[\[\/damage\s+([^\]]*?)\]\](?:\{([^}]*)\})?/gi, (m, body, label) => {
      if ( label ) return label;
      const formula = body.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)/)?.[1] ?? body;
      const type = body.match(/type=([a-z,|]+)/i)?.[1] ?? body.replace(/(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)/, "").trim();
      return `${formula}${type ? ` ${type.split(/[,|]/)[0]}` : ""} damage`;
    })
    .replace(/\[\[\/(?:r|roll|item|check|skill|tool|heal|healing)\s*([^\]]*?)\]\](?:\{([^}]*)\})?/gi,
      (m, body, label) => label ?? body.replace(/^(?:\w+=\S+\s*)+/, "").trim())
    .replace(/\[\[([^\]]*)\]\](?:\{([^}]*)\})?/g, (m, body, label) => label ?? body);
}

/**
 * HTML (or already plain text) to plain text. Lines are separated by "\n"; blank lines are removed.
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  let text = String(html ?? "");
  text = text.replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(?:p|div|li|tr|h[1-6]|ul|ol|table|section|blockquote)\s*>/gi, "\n")
    .replace(/<\/\s*(?:td|th)\s*>/gi, " ")
    .replace(/<\s*(?:p|div|li|tr|h[1-6])(?:\s[^>]*)?>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  text = decodeEntities(text);
  text = stripEnrichers(text);
  text = text
    .replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
    .replace(/[\u201c\u201d\u00ab\u00bb]/g, "\"")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u00a0\u2007\u2009\u200a\u202f\u2002\u2003]/g, " ")
    .replace(/[\u00ad\u200b-\u200d\ufeff]/g, "")
    .replace(/\r/g, "");
  return text.split("\n").map(line => line.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
}

/**
 * Non-empty lines with their offset in `text`.
 * @param {string} text  Plain text.
 * @returns {{ text: string, index: number }[]}
 */
export function splitLines(text) {
  const source = String(text ?? "");
  const lines = [];
  let index = 0;
  for ( const line of source.split("\n") ) {
    const trimmed = line.trim();
    if ( trimmed ) lines.push({ text: trimmed, index: index + line.indexOf(trimmed) });
    index += line.length + 1;
  }
  return lines;
}

/**
 * Sentences with their offset in `text`. A sentence ends at a line break or at ". ", "! ", "? "
 * followed by a capital letter, a digit, an opening parenthesis or a quote.
 * @param {string} text  Plain text.
 * @returns {{ text: string, index: number }[]}
 */
export function splitSentences(text) {
  const sentences = [];
  for ( const line of splitLines(text) ) {
    let start = 0;
    const re = /[.!?]+["')\]]*(?=\s+[\p{Lu}\d("'])/gu;
    let match;
    const push = (from, to) => {
      const slice = line.text.slice(from, to);
      const trimmed = slice.trim();
      if ( trimmed ) sentences.push({ text: trimmed, index: line.index + from + slice.indexOf(trimmed) });
    };
    while ( (match = re.exec(line.text)) ) {
      const end = match.index + match[0].length;
      // "5 ft. Hit:" etc. are real boundaries; abbreviations such as "e.g." or "No." are not
      const before = line.text.slice(0, match.index);
      if ( /(?:\be\.g|\bi\.e|\bno|\bnº|\bn°|\bvs|\bsp)$/i.test(before) ) continue;
      push(start, end);
      start = end;
    }
    push(start, line.text.length);
  }
  return sentences;
}

/**
 * Parse a number written with a decimal comma or point ("1,5", "2.5", "12").
 * @param {string|number} value
 * @returns {number|null}
 */
export function parseNumber(value) {
  if ( typeof value === "number" ) return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) && String(value).trim() !== "" ? parsed : null;
}

/**
 * Distance to feet. Meters use the dnd5e conversion (1.5 m = 5 ft): `Math.round(v * 10 / 3)`.
 * @param {number|string} value
 * @param {"ft"|"m"} [unit="ft"]
 * @returns {number|null}
 */
export function toFeet(value, unit = "ft") {
  const number = parseNumber(value);
  if ( number === null ) return null;
  return unit === "m" ? Math.round(number * 10 / 3) : Math.round(number);
}

/**
 * Weight to pounds. Kilograms are doubled and rounded to the nearest pound.
 * @param {number|string} value
 * @param {"lb"|"kg"} [unit="lb"]
 * @returns {number|null}
 */
export function toPounds(value, unit = "lb") {
  const number = parseNumber(value);
  if ( number === null ) return null;
  return unit === "kg" ? Math.round(number * 2) : number;
}

/**
 * Key used to match a feature name: accents removed, lowercase, and the mentions
 * "(Recharge 5-6)", "(3/Day)", "(Costs 2 Actions)" removed.
 * @param {string} name
 * @returns {string}
 */
export function nameKey(name) {
  return String(name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
    .replace(/\(+\s*(?:recharge|recharges)\b[^)]*\)+/g, " ")
    .replace(/\(+\s*\d+\s*\/\s*(?:day|jour|short rest|long rest|repos court|repos long)[^)]*\)+/g, " ")
    .replace(/\(+\s*(?:costs?|coute)\s*\d+\s*actions?\s*\)+/g, " ")
    .replace(/\s+/g, " ").trim();
}
