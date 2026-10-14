// Extraction of the control set from the dnd5e compendiums (run only with CONTROL_EXTRACT=1, FOUNDRY_TEST_INSTANCE=2).
// Output: the raw dump named by OUT. Not part of the regular suite.
import fs from "node:fs";
import { test } from "../../../../test-env/fixtures.mjs";

test.skip(!process.env.CONTROL_EXTRACT, "extraction only");
test.setTimeout(600_000);

test("extract creature abilities from dnd5e.monsters and dnd5e.actors24", async ({ foundry }) => {
  const out = await foundry(async () => {
    const hash = (s) => { let h = 2166136261; for ( const c of s ) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
    const simplify = (html) => {
      const div = document.createElement("div");
      div.innerHTML = html;
      div.querySelectorAll("i.fa-solid, i.fa-regular, i[class*='fa-']").forEach(n => n.remove());
      div.querySelectorAll("*").forEach(n => { for ( const a of [...n.attributes] ) n.removeAttribute(a.name); });
      return div.innerHTML.replace(/\s+/g, " ").trim();
    };
    const clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o.toObject?.() ?? o)));
    const result = [];
    const skipNames = /^(multiattack|spellcasting|innate spellcasting|actions|reactions|legendary actions|bonus actions)$/i;
    for ( const packName of ["dnd5e.monsters", "dnd5e.actors24"] ) {
      const pack = game.packs.get(packName);
      const index = await pack.getIndex();
      // Deterministic pseudo-random order of actors; take abilities until the quota is reached.
      const actors = [...index].sort((a, b) => hash(a._id + "ctl") - hash(b._id + "ctl"));
      let count = 0;
      for ( const entry of actors ) {
        if ( count >= 130 ) break;
        const actor = await pack.getDocument(entry._id);
        const items = [...actor.items].filter(i => ["feat", "weapon"].includes(i.type) && !skipNames.test(i.name));
        for ( const item of items ) {
          const acts = Array.from(item.system.activities ?? []);
          if ( !acts.length || !acts.some(a => ["attack", "save", "damage", "heal", "utility"].includes(a.type)) ) continue;
          if ( hash(item.id + actor.id + "pick") % 3 !== 0 ) continue;
          if ( count >= 130 ) break;
          let enriched = "";
          try {
            enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.description.value, { relativeTo: item, rollData: item.getRollData() });
          } catch ( e ) { enriched = `ERR ${e.message}`; }
          count++;
          result.push({
            pack: packName, actor: actor.name, actorId: actor.id, itemId: item.id, name: item.name, type: item.type,
            stored: item.system.description.value,
            html: simplify(enriched),
            labels: JSON.parse(JSON.stringify(item.labels ?? {})),
            itemUses: clone(item.system.uses),
            itemRange: clone(item.system.range),
            itemDamage: item.type === "weapon" ? clone(item.system.damage) : null,
            activities: acts.map(a => ({ ...a.toObject(), saveDC: a.save?.dc?.value ?? null, labels: clone(a.labels ?? {}) }))
          });
        }
      }
    }
    return result;
  });
  fs.writeFileSync(process.env.OUT, JSON.stringify(out));
  console.log("extracted", out.length);
});

test("extract objects from dnd5e.items and dnd5e.equipment24", async ({ foundry }) => {
  const exclude = JSON.parse(fs.readFileSync(process.env.EXCLUDE, "utf8"));
  const out = await foundry(async (exclude) => {
    const hash = (s) => { let h = 2166136261; for ( const c of s ) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
    const result = [];
    for ( const packName of ["dnd5e.items", "dnd5e.equipment24"] ) {
      const pack = game.packs.get(packName);
      const index = [...(await pack.getIndex({ fields: ["system.rarity", "system.type.value"] }))];
      const pool = index.filter(i => !exclude.uuids.includes(`Compendium.${packName}.Item.${i._id}`) && !exclude.names.includes(i.name.toLowerCase()))
        .sort((a, b) => hash(a._id + "obj") - hash(b._id + "obj")).slice(0, 110);
      for ( const entry of pool ) {
        const doc = await pack.getDocument(entry._id);
        const s = doc.system;
        result.push({
          pack: packName, id: doc.id, name: doc.name, type: doc.type, html: s.description.value,
          rarity: [...(s.rarity ? [s.rarity] : []), ...(s.rarities ?? [])].join(","), attunement: s.attunement ?? "", magicalBonus: s.magicalBonus ?? s.armor?.magicalBonus ?? null,
          weight: s.weight?.value ?? null, price: s.price?.value ?? null, denom: s.price?.denomination ?? null,
          subtype: s.type?.value ?? null, baseItem: s.type?.baseItem ?? null, properties: s.properties ? [...s.properties] : [],
          armorValue: s.armor?.value ?? null
        });
      }
    }
    return result;
  }, exclude);
  fs.writeFileSync(process.env.OUT_ITEMS, JSON.stringify(out));
  console.log("items", out.length);
});
