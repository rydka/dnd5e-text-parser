// Measures M2 (recall), M3 (precision, with critical errors) per language and M5 (time of a full stat block).
// Never fails: prints the values and writes JSON. Usage:
//   node tests/metrics/measure.mjs [--out=<file.json>]
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import * as P from "../../scripts/index.mjs";
import { loadActors, loadFeatures, loadObjects, loadSpellcasting, loadRealItems, realAvailable } from "../support/load.mjs";
import {
  actorTokens, compare, expectedActorTokens, expectedFeatureTokens, expectedItemTokens, expectedSpellTokens,
  isCritical, producedFeatureTokens, producedItemTokens, spellTokens
} from "../support/canon.mjs";

const out = process.argv.find(a => a.startsWith("--out="))?.slice(6);

const safe = (fn) => { try { return { value: fn() }; } catch (error) { return { error: String(error?.message ?? error) }; } };

function newBucket() {
  return { cases: 0, expected: 0, produced: 0, correct: 0, critical: 0, errors: 0, failedCases: [], missing: [], wrong: [] };
}

function add(bucket, id, result, crash) {
  bucket.cases++;
  bucket.expected += result.expected;
  bucket.produced += result.produced;
  bucket.correct += result.correct;
  bucket.errors += result.wrong.length;
  bucket.critical += result.wrong.filter(isCritical).length;
  if ( crash || result.missing.length || result.wrong.length ) {
    bucket.failedCases.push(id + (crash ? ` (crash: ${crash})` : ""));
    result.missing.forEach(m => bucket.missing.push(`${id}: ${m}`));
    result.wrong.forEach(w => bucket.wrong.push(`${id}: ${w}`));
  }
}

const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : null);

function summarize(bucket) {
  return {
    cases: bucket.cases,
    expectedFacts: bucket.expected,
    producedFacts: bucket.produced,
    recallPct: pct(bucket.correct, bucket.expected),
    precisionPct: pct(bucket.correct, bucket.produced),
    criticalErrors: bucket.critical,
    failedCases: bucket.failedCases,
    missing: bucket.missing,
    wrong: bucket.wrong
  };
}

function run(label, cases, expectedFn, producedFn) {
  const perLang = { en: newBucket(), fr: newBucket(), all: newBucket() };
  for ( const c of cases ) {
    const r = safe(() => producedFn(c));
    const expected = expectedFn(c);
    const result = compare(expected, r.error ? [] : r.value);
    for ( const key of [c.lang, "all"] ) add(perLang[key], c.id, result, r.error);
  }
  return { label, ...Object.fromEntries(Object.entries(perLang).map(([k, b]) => [k, summarize(b)])) };
}

const sections = [];

sections.push(run("features", loadFeatures(), expectedFeatureTokens,
  (c) => producedFeatureTokens(P.parseFeature(c.name, c.html), c)));

sections.push(run("spellcasting", loadSpellcasting(), expectedSpellTokens,
  (c) => spellTokens(P.parseSpellcasting(c.html), c)));

sections.push(run("actors", loadActors(), expectedActorTokens, (c) => actorTokens(P.parseActor(c.actor))));

if ( typeof P.parseItem === "function" ) {
  sections.push(run("objects", loadObjects(), expectedItemTokens,
    (c) => producedItemTokens(P.parseItem(c.name, c.html, { itemType: c.itemType }), c)));
} else {
  sections.push({ label: "objects", notMeasured: "parseItem is not exported yet" });
}

// Global figures (all categories pooled), per language.
const pooled = {};
for ( const lang of ["en", "fr", "all"] ) {
  const b = newBucket();
  for ( const s of sections ) {
    if ( !s[lang] ) continue;
    b.expected += s[lang].expectedFacts;
    b.produced += s[lang].producedFacts;
    b.correct += Math.round(s[lang].recallPct == null ? 0 : (s[lang].recallPct / 100) * s[lang].expectedFacts);
    b.critical += s[lang].criticalErrors;
  }
  pooled[lang] = {
    expectedFacts: b.expected, producedFacts: b.produced,
    recallPct: pct(b.correct, b.expected),
    precisionPct: pct(sections.reduce((n, s) => n + (s[lang] ? Math.round((s[lang].precisionPct ?? 0) / 100 * s[lang].producedFacts) : 0), 0), b.produced),
    criticalErrors: b.critical
  };
}

// M5: full stat block (parse + translate), no fallback. Median of 25 runs.
function statBlockRuns() {
  const features = loadFeatures().filter(c => c.lang === "en" && !c.ref);
  const realItems = loadRealItems();
  const actors = [];
  if ( realAvailable() ) {
    const file = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "../../../compendium-json-importer/tools/out/actors.json");
    try { actors.push(...JSON.parse(fs.readFileSync(file, "utf8")).filter(a => ["Lich", "Death Knight"].includes(a.name))); } catch { /* optional */ }
  }
  actors.push({
    name: "Synthetic worst case", type: "npc",
    system: { details: { biography: { value: "<p><strong>Damage Resistances</strong> cold; bludgeoning, piercing, and slashing from nonmagical attacks</p><p><strong>Condition Immunities</strong> charmed, frightened</p><p>The creature can take 3 legendary actions.</p>" } } },
    items: features.map((c, i) => ({ _id: `f${i}`, name: c.name, type: "feat", system: { description: { value: c.html } } }))
  });
  void realItems;
  const keys = P.keysFromConfig ? safe(() => P.keysFromConfig(minimalConfig())).value : undefined;
  return actors.map(actor => ({
    name: actor.name, items: actor.items.length,
    run: () => {
      const plan = P.parseActor(actor, { keys });
      P.toActorPatch(plan, { keys, actor });
      let n = 0;
      for ( const item of actor.items ) {
        const f = P.parseFeature(item.name, item.system?.description?.value ?? "", { keys });
        P.toActivities(f, { keys, idGen: () => `a${++n}`, item });
        P.toItemPatch(f, { keys, item });
      }
    }
  }));
}

function minimalConfig() {
  const o = (...k) => Object.fromEntries(k.map(x => [x, { label: x }]));
  return {
    damageTypes: o("acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"),
    conditionTypes: o("blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"),
    abilities: o("str", "dex", "con", "int", "wis", "cha"),
    areaTargetTypes: o("cone", "cube", "cylinder", "line", "radius", "sphere"),
    activityActivationTypes: o("action", "bonus", "reaction", "legendary", "special"),
    limitedUsePeriods: o("sr", "lr", "day", "dawn", "dusk")
  };
}

const timing = [];
for ( const block of statBlockRuns() ) {
  const samples = [];
  block.run();
  for ( let i = 0; i < 25; i++ ) {
    const t0 = performance.now();
    const r = safe(block.run);
    samples.push({ ms: performance.now() - t0, error: r.error });
  }
  const ms = samples.map(s => s.ms).sort((a, b) => a - b);
  timing.push({
    statBlock: block.name, items: block.items,
    medianMs: Math.round(ms[Math.floor(ms.length / 2)] * 100) / 100,
    maxMs: Math.round(ms[ms.length - 1] * 100) / 100,
    error: samples.find(s => s.error)?.error ?? null
  });
}

const report = {
  date: new Date().toISOString(),
  realItemsAvailable: realAvailable(),
  targets: { M2: ">= 90 % per language", M3: ">= 98 %, 0 critical error", M5: "<= 50 ms" },
  sections, pooled, M5: timing
};

if ( out ) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
}

for ( const s of sections ) {
  if ( s.notMeasured ) { console.log(`${s.label}: not measured (${s.notMeasured})`); continue; }
  for ( const lang of ["en", "fr"] ) {
    const r = s[lang];
    console.log(`${s.label.padEnd(13)} ${lang}  cases=${String(r.cases).padStart(3)}  recall=${r.recallPct}%  precision=${r.precisionPct}%  critical=${r.criticalErrors}  failed=${r.failedCases.length}`);
  }
}
for ( const lang of ["en", "fr"] ) {
  console.log(`POOLED ${lang}  recall=${pooled[lang].recallPct}%  precision=${pooled[lang].precisionPct}%  critical=${pooled[lang].criticalErrors}`);
}
for ( const t of timing ) console.log(`M5 ${t.statBlock} (${t.items} items): median ${t.medianMs} ms, max ${t.maxMs} ms${t.error ? `, error: ${t.error}` : ""}`);
