// Measures M2 (recall) and M3 (precision, critical errors) per language and per category, on the reference set
// ("adjustment") or the control set ("generalization"). Never fails: prints and writes JSON.
//   node tests/metrics/measure-sets.mjs --set=reference|control [--out=<file.json>]
import fs from "node:fs";
import path from "node:path";
import * as P from "../../scripts/index.mjs";
import { loadFeatures, loadObjects, FIXTURES } from "../support/load.mjs";
import { compare, expectedFeatureTokens, expectedItemTokens, isCritical, producedFeatureTokens, producedItemTokens } from "../support/canon.mjs";

const arg = (n) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const set = arg("set") ?? "reference";
const out = arg("out");
const control = path.resolve(FIXTURES, "../control");
const readControl = (f) => JSON.parse(fs.readFileSync(path.join(control, f), "utf8")).cases;

let features, objects;
if ( set === "control" ) {
  features = [...readControl("features-en.json"), ...readControl("features-fr.json")];
  objects = readControl("objects.json");
} else {
  features = loadFeatures();
  objects = loadObjects();
}

const category = (token) => token.split("=")[0].replace(/^(weapon|armor|consumable)\..*/, "$1").replace(/^(rarity|attunement|attunementCondition|weight|price)$/, "details");

function newAcc() { return { cases: 0, expected: 0, produced: 0, correct: 0, critical: 0, crashes: [], missing: [], wrong: [], cat: {} }; }
function bump(acc, id, result, crash) {
  acc.cases++; acc.expected += result.expected; acc.produced += result.produced; acc.correct += result.correct;
  acc.critical += result.wrong.filter(isCritical).length;
  if ( crash ) acc.crashes.push(`${id}: ${crash}`);
  result.missing.forEach(m => acc.missing.push(`${id}: ${m}`));
  result.wrong.forEach(w => acc.wrong.push(`${id}: ${w}`));
}
function bumpCat(acc, expected, produced) {
  const pool = new Map();
  for ( const x of expected ) pool.set(x, (pool.get(x) ?? 0) + 1);
  const cat = (k) => (acc.cat[k] ??= { expected: 0, produced: 0, correct: 0 });
  for ( const x of expected ) cat(category(x)).expected++;
  for ( const x of produced ) {
    const c = cat(category(x)); c.produced++;
    const n = pool.get(x) ?? 0;
    if ( n > 0 ) { pool.set(x, n - 1); c.correct++; }
  }
}
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
function fin(acc) {
  return {
    cases: acc.cases, expectedFacts: acc.expected, producedFacts: acc.produced,
    recallPct: pct(acc.correct, acc.expected), precisionPct: pct(acc.correct, acc.produced), criticalErrors: acc.critical,
    byCategory: Object.fromEntries(Object.entries(acc.cat).map(([k, v]) => [k, { ...v, recallPct: pct(v.correct, v.expected), precisionPct: pct(v.correct, v.produced) }])),
    crashes: acc.crashes, missing: acc.missing, wrong: acc.wrong
  };
}

function runSet(cases, expectedFn, producedFn) {
  const acc = { en: newAcc(), fr: newAcc(), all: newAcc() };
  for ( const c of cases ) {
    let produced = [], crash = null;
    try { produced = producedFn(c); } catch ( e ) { crash = String(e.message ?? e); }
    const expected = expectedFn(c);
    const result = compare(expected, produced);
    for ( const k of [c.lang, "all"] ) { bump(acc[k], c.id, result, crash); bumpCat(acc[k], expected, produced); }
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, fin(v)]));
}

const report = {
  set, date: new Date().toISOString(),
  features: runSet(features, expectedFeatureTokens, (c) => producedFeatureTokens(P.parseFeature(c.name, c.html), c)),
  objects: runSet(objects, expectedItemTokens, (c) => producedItemTokens(P.parseItem(c.name, c.html, { itemType: c.itemType }), c))
};
// Pooled (features + objects).
report.pooled = {};
for ( const lang of ["en", "fr", "all"] ) {
  const parts = [report.features[lang], report.objects[lang]];
  const exp = parts.reduce((s, p) => s + p.expectedFacts, 0), prod = parts.reduce((s, p) => s + p.producedFacts, 0);
  const cor = parts.reduce((s, p) => s + Math.round(p.recallPct / 100 * p.expectedFacts), 0);
  report.pooled[lang] = { expectedFacts: exp, producedFacts: prod, recallPct: pct(cor, exp), precisionPct: pct(cor, prod), criticalErrors: parts.reduce((s, p) => s + p.criticalErrors, 0) };
}
if ( out ) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 1)); }
for ( const sec of ["features", "objects"] ) for ( const lang of ["en", "fr"] ) {
  const r = report[sec][lang];
  if ( !r.cases ) continue;
  console.log(`${set} ${sec.padEnd(8)} ${lang} cases=${r.cases} facts=${r.expectedFacts} recall=${r.recallPct}% precision=${r.precisionPct}% critical=${r.criticalErrors} crashes=${r.crashes.length}`);
}
for ( const lang of ["en", "fr"] ) { const r = report.pooled[lang]; if ( r.expectedFacts ) console.log(`${set} POOLED ${lang} recall=${r.recallPct}% precision=${r.precisionPct}% critical=${r.criticalErrors}`); }
