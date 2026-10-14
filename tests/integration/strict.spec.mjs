// L4 (strict dnd5e construction of the produced data) and L7 (v14 active effect format), in a real Foundry.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "../../../../test-env/fixtures.mjs";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const ref = (f) => JSON.parse(fs.readFileSync(path.join(here, "../fixtures/reference", f), "utf8"));
const ctl = (f) => JSON.parse(fs.readFileSync(path.join(here, "../fixtures/control", f), "utf8")).cases;

function featureCases() {
  const synthetic = ref("features-synthetic.json").cases;
  const out = [...synthetic.map(c => ({ id: c.id, name: c.name, html: c.html, kind: "feature" }))];
  for ( const f of ["features-en.json", "features-fr.json"] ) out.push(...ctl(f).map(c => ({ id: c.id, name: c.name, html: c.html, kind: "feature" })));
  return out.filter(c => c.html);
}
function objectCases() {
  return [...ref("objects.json").cases.filter(c => c.html), ...ctl("objects.json")]
    .map(c => ({ id: c.id, name: c.name, html: c.html, itemType: c.itemType, kind: "object" }));
}

test.setTimeout(300_000);

test("L4/L7: every produced item is accepted by the strict dnd5e construction, effects use the v14 format", async ({ foundry }, testInfo) => {
  const cases = [...featureCases(), ...objectCases()];
  const result = await foundry(async ({ cases, moduleId }) => {
    const P = await import(`/modules/${moduleId}/scripts/index.mjs`);
    const keys = P.keysFromConfig(CONFIG.DND5E);
    const idGen = () => foundry.utils.randomID();
    const report = { total: 0, strictOk: 0, errors: [], activities: 0, effects: 0, effectsLegacy: [], itemsWithActivities: 0 };
    const objectStrict = (data) => { const doc = new CONFIG.Item.documentClass(data, { strict: true }); return doc; };
    for ( const c of cases ) {
      report.total++;
      try {
        let data;
        if ( c.kind === "feature" ) {
          const plan = P.parseFeature(c.name, c.html, { keys });
          const acts = P.toActivities(plan, { keys, idGen, item: { type: "feat" } });
          data = { name: c.name || "x", type: "feat", system: { ...P.toItemPatch(plan, { keys, item: { type: "feat" } }), activities: Object.fromEntries(acts.map(a => [a._id, a])) } };
          report.activities += acts.length;
        } else {
          const plan = P.parseItem(c.name, c.html, { keys, itemType: c.itemType });
          const effects = P.toEffects(plan, { keys, idGen, name: c.name });
          const acts = P.toActivities(plan, { keys, idGen, item: { type: c.itemType }, effects, resolveSpell: () => null });
          data = { name: c.name || "x", type: c.itemType, effects, system: { ...P.toItemPatch(plan, { keys, item: { type: c.itemType } }), activities: Object.fromEntries(acts.map(a => [a._id, a])) } };
          report.activities += acts.length;
          if ( acts.length ) report.itemsWithActivities++;
          report.effects += effects.length;
          for ( const e of effects ) for ( const ch of e.system?.changes ?? [] ) {
            if ( typeof ch.type !== "string" || "mode" in ch ) report.effectsLegacy.push(`${c.id}: ${JSON.stringify(ch)}`);
          }
          if ( effects.some(e => "changes" in e) ) report.effectsLegacy.push(`${c.id}: legacy top-level changes`);
        }
        const doc = objectStrict(data);
        // Embedded effects must also build in strict mode.
        for ( const e of data.effects ?? [] ) new CONFIG.ActiveEffect.documentClass(e, { strict: true, parent: doc });
        report.strictOk++;
      } catch ( e ) {
        report.errors.push(`${c.id}: ${String(e.message).slice(0, 300)}`);
      }
    }
    return report;
  }, { cases, moduleId: "dnd5e-text-parser" });
  fs.writeFileSync(testInfo.outputPath("L4-L7-strict-construction.json"), JSON.stringify(result, null, 1));
  expect(result.errors).toEqual([]);
  expect(result.effectsLegacy).toEqual([]);
  expect(result.strictOk).toBe(result.total);
  expect(result.total).toBeGreaterThan(300);
  expect(result.effects).toBeGreaterThan(0);
});

test("L7: the effects of an object are v14 effects (change.type, no mode), transfer flag set", async ({ foundry }, testInfo) => {
  const out = await foundry(async (moduleId) => {
    const P = await import(`/modules/${moduleId}/scripts/index.mjs`);
    const keys = P.keysFromConfig(CONFIG.DND5E);
    const plan = P.parseItem("Ring of Protection", "<p><em>Ring, rare (requires attunement)</em></p><p>You gain a +1 bonus to AC. You also gain a +1 bonus to all saving throws.</p>", { keys, itemType: "equipment" });
    const effects = P.toEffects(plan, { keys, idGen: () => foundry.utils.randomID(), name: "Ring of Protection" });
    // eslint-disable-next-line no-undef
    const item = await Item.implementation.create({ name: "L7 ring", type: "equipment", effects }, { strict: true });
    const created = item.effects.contents.map(e => ({ transfer: e.transfer, changes: e.system.changes.map(c => ({ key: c.key, type: c.type, value: c.value })) }));
    await item.delete();
    return { effects, created };
  }, "dnd5e-text-parser");
  fs.writeFileSync(testInfo.outputPath("L7-effects.json"), JSON.stringify(out, null, 1));
  expect(out.created.length).toBeGreaterThan(0);
  const changes = out.created.flatMap(e => e.changes);
  expect(changes.length).toBeGreaterThan(1);
  for ( const c of changes ) expect(typeof c.type).toBe("string");
  expect(JSON.stringify(out.effects)).not.toMatch(/"mode"\s*:/);
});

test("L4 control: the strict construction does reject invalid activity data (the check is not vacuous)", async ({ foundry }) => {
  const rejected = await foundry(() => {
    try {
      new CONFIG.Item.documentClass({ name: "bad", type: "feat", system: { activities: { aaaaaaaaaaaaaaaa: { _id: "aaaaaaaaaaaaaaaa", type: "attack", damage: { parts: [{ number: "not a number", types: "fire" }] } } } } }, { strict: true });
      return false;
    } catch { return true; }
  });
  expect(rejected).toBe(true);
});

test("L4: a recharge ends up in uses.recovery and the item is accepted by the strict construction", async ({ foundry }, testInfo) => {
  const out = await foundry(async (moduleId) => {
    const P = await import(`/modules/${moduleId}/scripts/index.mjs`);
    const keys = P.keysFromConfig(CONFIG.DND5E);
    const html = "<p>The dragon exhales fire in a 60-foot cone. Each creature in that area must make a DC 18 Dexterity saving throw, taking 56 (16d6) fire damage on a failed save, or half as much damage on a successful one.</p>";
    const plan = P.parseFeature("Fire Breath (Recharge 5-6)", html, { keys });
    const patch = P.toItemPatch(plan, { keys, item: { type: "feat" } });
    const doc = new CONFIG.Item.documentClass({ name: "recharge", type: "feat", system: patch }, { strict: true });
    return { recovery: doc.toObject().system.uses.recovery, periods: [...keys.limitedUsePeriods] };
  }, "dnd5e-text-parser");
  fs.writeFileSync(testInfo.outputPath("L4-recharge.json"), JSON.stringify(out, null, 1));
  expect(out.recovery.some(r => r.period === "recharge" && r.formula === "5")).toBe(true);
});
