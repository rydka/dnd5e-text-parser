// Builds the control set of creature abilities from the raw dump of the dnd5e compendiums (see
// tests/integration/extract-control.spec.mjs). The truth is derived from the real activity data, and a fact is
// kept only when the displayed description also states it. Does not call the parser.
//   node tests/tools/build-control-features.mjs <raw.json> [out.json]
import fs from "node:fs";

const [rawFile, outFile = new URL("../fixtures/control/features-en.json", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(rawFile, "utf8"));

const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const squash = (s) => s.replace(/\s+/g, "").toLowerCase();
const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;
const num = (v) => Number(String(v).replace(/[−–\s]/g, (m) => (m === " " ? "" : "-")));
const mentions = (text, needle) => squash(text).includes(squash(needle));

function damageTokens(labels, text, prefix) {
  const t = [];
  for ( const d of labels ?? [] ) {
    if ( !d.formula || !d.damageType ) continue;
    const f = squash(d.formula).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if ( !new RegExp(`${f}\\)?${d.damageType}`).test(squash(text)) ) continue;
    t.push(`${prefix}=${d.formula.replace(/\s/g, "")} ${d.damageType}`);
  }
  return t;
}

function build(x) {
  const text = plain(x.html);
  const expected = {};
  const ignore = [];
  const add = (k, v) => { (expected[k] ??= []).push(v); };

  const attack = x.activities.find(a => a.type === "attack");
  const header = text.match(/\b(Melee|Ranged)(?: or (Melee|Ranged))?(?: (Weapon|Spell))? Attack(?: Roll)?\b/i);
  if ( attack && header ) {
    const both = !!header[2];
    const type = both ? null : header[1].toLowerCase();
    const cls = header[3]?.toLowerCase() ?? null;
    const toHit = attack.labels?.toHit ?? x.labels?.attacks?.[0]?.toHit;
    const bonus = toHit ? num(toHit) : NaN;
    if ( both ) ignore.push("attack", "range");
    else if ( Number.isFinite(bonus) && text.includes(signed(bonus)) ) add("attack", `${type}/${cls ?? "-"} ${signed(bonus)}`);
    else ignore.push("attack");
    // Range and reach, as stated next to the header.
    if ( !both ) {
      const parts = [];
      const reach = text.match(/reach (\d+) ?(?:ft|feet)/i);
      const range = text.match(/range (\d+)(?:\/(\d+))? ?(?:ft|feet)/i);
      if ( reach ) parts.push(`reach ${reach[1]}`);
      if ( range ) parts.push(`range ${range[1]}${range[2] ? `/${range[2]}` : ""}`);
      if ( parts.length ) add("range", parts.join(" "));
    } else ignore.push("range");
    const tgt = text.match(/\bone (target|creature)\b/i);
    if ( tgt ) add("target", `1 ${tgt[1].toLowerCase()}`);
  }
  if ( !attack ) ignore.push("range", "target");
  if ( attack && !header ) ignore.push("attack", "range", "target");

  // Damage of attack and damage activities.
  for ( const a of x.activities.filter(a => ["attack", "damage"].includes(a.type)) ) {
    damageTokens(a.labels?.damages, text, "damage").forEach(v => add("damage", v.slice(7)));
  }

  // Save activities: only the first mentioned save is expressible in a plan.
  const saves = x.activities.filter(a => a.type === "save" && a.saveDC != null && mentions(text, `DC ${a.saveDC}`));
  const distinctDC = new Set(saves.map(a => `${a.save.ability[0]}${a.saveDC}`));
  if ( distinctDC.size > 1 || x.activities.filter(a => a.type === "save").length > 1 ) ignore.push("save", "saveDamage", "template");
  else if ( saves.length ) {
    const a = saves[0];
    const ability = a.save.ability[0];
    const half = a.damage?.onSave === "half" && /half as much|half the damage|half damage/i.test(text);
    add("save", `${ability} ${a.saveDC} ${half ? "half" : "none"}`);
    damageTokens(a.labels?.damages, text, "saveDamage").forEach(v => add("saveDamage", v.slice(11)));
  } else if ( x.activities.some(a => a.type === "save") ) ignore.push("save", "saveDamage");

  // Template, read from the displayed text (the data is incomplete for several 2014 breath weapons).
  if ( !ignore.includes("template") ) {
    const found = [];
    for ( const m of text.matchAll(/(\d+)-foot(?:-radius)?[- ](Cone|Cube|Sphere|Cylinder)\b/gi) ) found.push(`${m[2].toLowerCase()} ${m[1]}`);
    for ( const m of text.matchAll(/(\d+)-foot-long, (\d+)-foot-wide Line/gi) ) found.push(`line ${m[1]}x${m[2]}`);
    const emanation = /Emanation|Emanating|wall/i.test(text);
    if ( found.length === 1 && !emanation ) add("template", found[0]);
    else if ( found.length > 1 || emanation ) ignore.push("template");
  }



  if ( /\b(strength|dexterity|constitution|intelligence|wisdom|charisma) or (strength|dexterity|constitution|intelligence|wisdom|charisma)\b/i.test(text) ) ignore.push("save", "saveDamage");
  if ( /\)\s+damage\b|\bextra \d+d\d+ damage|\d+d\d+ damage\b|Hit: \d+ damage/i.test(text) ) ignore.push("damage", "saveDamage");
  if ( !expected.template && /(Cone|Line|Cube|Sphere|Cylinder|radius)/.test(text) && !ignore.includes("template") ) ignore.push("template");

  // Facts the plan models but the data cannot back up from the displayed text.
  ignore.push("activation", "uses", "recharge", "legendaryResistance", "skip");
  return { text, expected, ignore: [...new Set(ignore)] };
}

const seen = new Set();
const cases = [];
let zero = 0;
for ( const x of raw ) {
  if ( !x.html || x.html.startsWith("ERR") ) continue;
  const key = plain(x.html);
  if ( seen.has(key) ) continue;
  seen.add(key);
  const { expected, ignore } = build(x);
  const n = Object.values(expected).reduce((s, v) => s + v.length, 0);
  if ( n === 0 && (zero++ % 2) ) continue;
  cases.push({
    id: `c-en-${cases.length + 1}`, lang: "en", source: `${x.pack}/${x.actor}/${x.name}`,
    name: x.name, html: x.html, activityTypes: x.activities.map(a => a.type), expected, ignore, facts: n
  });
}
fs.writeFileSync(outFile, JSON.stringify({ description: "Control set: real creature abilities of the dnd5e compendiums, displayed description as input, truth from the activity data restricted to what the text states.", cases }, null, 1));
const withFacts = cases.filter(c => c.facts > 0).length;
console.log(`cases=${cases.length} withFacts=${withFacts} facts=${cases.reduce((s, c) => s + c.facts, 0)}`);

// French translations written by hand from selected English cases; the truth is that of the English case.
const frSource = JSON.parse(fs.readFileSync(new URL("../fixtures/control/features-fr-source.json", import.meta.url), "utf8"));
const byId = new Map(cases.map(c => [c.id, c]));
const frCases = frSource.map((t, i) => {
  const en = byId.get(t.from);
  if ( !en ) throw new Error(`unknown case ${t.from}`);
  return { id: `c-fr-${i + 1}`, lang: "fr", source: `translation of ${en.source}`, name: t.name, html: t.html, expected: en.expected, ignore: en.ignore, facts: en.facts };
});
fs.writeFileSync(outFile.replace("features-en", "features-fr"), JSON.stringify({ description: "Control set: French translations of control abilities.", cases: frCases }, null, 1));
console.log(`fr cases=${frCases.length}`);
