// L1/L4/L7 at unit level: translation of plans into dnd5e 6 sources (activities, effects, keys).
import { describe, expect, it } from "vitest";
import * as P from "../../scripts/index.mjs";

import { readFileSync } from "node:fs";

// Real dnd5e 6.0.6 keys: snapshot of CONFIG.DND5E taken in Foundry (tests/integration/extract-control.spec.mjs).
const CONFIG_DND5E = JSON.parse(readFileSync(new URL("../fixtures/dnd5e-keys.json", import.meta.url), "utf8"));
const keys = P.keysFromConfig(CONFIG_DND5E);
let n = 0;
const idGen = () => `id${++n}`.padEnd(16, "0");

const BITE = "<p><em>Melee Weapon Attack:</em> +5 to hit, reach 5 ft., one target. <em>Hit:</em> 7 (1d8 + 3) piercing damage.</p>";
const BREATH = "<p><strong>Fire Breath (Recharge 5-6).</strong> The dragon exhales fire in a 60-foot cone. Each creature in that area must make a DC 18 Dexterity saving throw, taking 56 (16d6) fire damage on a failed save, or half as much damage on a successful one.</p>";

describe("keys", () => {
  it("keysFromConfig accepts objects, Sets, Maps and arrays; a snapshot round-trips", () => {
    const k = P.keysFromConfig({ abilities: new Map([["str", 1]]), skills: ["ste"], damageTypes: new Set(["fire"]), currencies: { gp: 1 } });
    expect([...k.abilities]).toEqual(["str"]);
    expect([...k.skills]).toEqual(["ste"]);
    const snap = P.keysSnapshot(P.keysFromConfig(CONFIG_DND5E));
    expect(JSON.parse(JSON.stringify(snap)).damageTypes).toContain("fire");
    expect([...P.keysFromConfig(JSON.parse(JSON.stringify(snap))).abilities].sort()).toEqual([...keys.abilities].sort());
    expect(P.keysFromConfig(undefined).abilities.size).toBe(0);
  });
});

describe("toActivities: feature plans", () => {
  it("attack: flat bonus, written damage, includeBase false, reach on the activity", () => {
    const [a, ...rest] = P.toActivities(P.parseFeature("Bite", BITE, { keys }), { keys, idGen, item: { type: "feat" } });
    expect(rest).toHaveLength(0);
    expect(a.type).toBe("attack");
    expect(a.attack).toMatchObject({ flat: true, bonus: "5", type: { value: "melee", classification: "weapon" } });
    expect(a.damage.includeBase).toBe(false);
    expect(a.damage.parts[0]).toMatchObject({ number: 1, denomination: 8, bonus: "3", types: ["piercing"] });
    expect(a.range).toMatchObject({ value: "5", units: "ft" });
  });

  it("weapon items keep the reach on the item", () => {
    const [a] = P.toActivities(P.parseFeature("Bite", BITE, { keys }), { keys, idGen, item: { type: "weapon" } });
    expect(a.range).toBeUndefined();
  });

  it("save: fixed DC, area and recharge consumption", () => {
    const plan = P.parseFeature("Fire Breath (Recharge 5-6)", BREATH, { keys });
    const acts = P.toActivities(plan, { keys, idGen, item: { type: "feat" } });
    const save = acts.find(x => x.type === "save");
    expect(save.save).toEqual({ ability: ["dex"], dc: { calculation: "", formula: "18" } });
    expect(save.damage).toMatchObject({ onSave: "half" });
    expect(save.damage.parts[0]).toMatchObject({ number: 16, denomination: 6, types: ["fire"] });
    expect(save.target.template).toMatchObject({ type: "cone", size: "60", units: "ft" });
    expect(save.consumption.targets[0].type).toBe("itemUses");
    const patch = P.toItemPatch(plan, { keys, item: { type: "feat" } });
    expect(patch.uses.recovery[0]).toMatchObject({ period: "recharge", formula: "5" });
  });

  it("never emits a key absent from the valid sets", () => {
    const small = P.keysFromConfig({ damageTypes: { fire: {} }, abilities: { str: {} }, activityActivationTypes: { action: {} }, areaTargetTypes: {} });
    const plan = P.parseFeature("Fire Breath", BREATH, { keys });
    const save = P.toActivities(plan, { keys: small, idGen }).find(x => x.type === "save");
    expect(save).toBeUndefined();
    const attack = P.toActivities(P.parseFeature("Bite", BITE, { keys }), { keys: small, idGen })[0];
    expect(attack.damage.parts[0].types).toEqual([]);
  });

  it("damage alone gives a damage activity; multiattack gives nothing", () => {
    const dmg = P.toActivities(P.parseFeature("Fire Aura", "<p>Any creature that touches the aura takes 5 (1d10) fire damage.</p>", { keys }), { keys, idGen });
    expect(dmg.map(a => a.type)).toEqual(["damage"]);
    const multi = P.toActivities(P.parseFeature("Multiattack", "<p>The ogre makes two greatclub attacks.</p>", { keys }), { keys, idGen });
    expect(multi).toEqual([]);
    expect(P.toActivities(null, { keys, idGen })).toEqual([]);
  });

  it("legendary resistance: utility activity consuming resources.legres, condition in the requested language", () => {
    const plan = P.parseFeature("Legendary Resistance (3/Day)", "<p>If the dragon fails a saving throw, it can choose to succeed instead.</p>", { keys });
    expect(plan.legendaryResistance).toBe(3);
    const en = P.toActivities(plan, { keys, idGen, lang: "en" });
    const fr = P.toActivities(plan, { keys, idGen, lang: "fr" });
    const act = (list) => list.find(a => a.consumption?.targets?.[0]?.target === "resources.legres.value");
    expect(act(en).activation.condition).toMatch(/saving throw/);
    expect(act(fr).activation.condition).toMatch(/jet de sauvegarde/);
  });

  it("legendary activation carries its cost", () => {
    const plan = P.parseFeature("Wing Attack (Costs 2 Actions)", "<p>The dragon beats its wings. Each creature within 10 feet must succeed on a DC 15 Dexterity saving throw or take 10 (2d6 + 3) bludgeoning damage.</p>", { keys });
    const save = P.toActivities(plan, { keys, idGen }).find(a => a.type === "save");
    expect(save.activation).toMatchObject({ type: "legendary", value: 2 });
  });
});

describe("toActivities, toEffects, toItemPatch: item plans", () => {
  const WAND = "<p><em>Wand, rare (requires attunement by a spellcaster)</em></p><p>This wand has 7 charges. While holding it, you can use an action to expend 1 or more of its charges to cast magic missile. The wand regains 1d6 + 1 expended charges daily at dawn. If you expend the wand's last charge, roll a d20. On a 1, the wand crumbles into ashes and is destroyed.</p>";
  const RING = "<p><em>Ring, rare (requires attunement)</em></p><p>You gain a +1 bonus to AC. You also gain a +1 bonus to all saving throws. You have resistance to fire damage.</p>";
  const POTION = "<p><em>Potion, common</em></p><p>You regain 2d4 + 2 hit points when you drink this potion.</p>";

  it("cast activity needs resolveSpell; missing spell leaves a note, no activity", () => {
    const plan = P.parseItem("Wand of Magic Missiles", WAND, { keys, itemType: "consumable" });
    const notes = [];
    expect(P.toActivities(plan, { keys, idGen, item: { type: "consumable" }, notes }).filter(a => a.type === "cast")).toEqual([]);
    expect(notes.some(x => x.key === "dnd5e-text-parser.Note.SpellNotFound")).toBe(true);
    const acts = P.toActivities(plan, { keys, idGen, item: { type: "consumable" }, resolveSpell: () => "Compendium.dnd5e.spells.Item.abc" });
    const cast = acts.find(a => a.type === "cast");
    expect(cast.spell.uuid).toBe("Compendium.dnd5e.spells.Item.abc");
    expect(acts[0].consumption.targets[0].type).toBe("itemUses");
  });

  it("heal activity for a potion", () => {
    const plan = P.parseItem("Potion of Healing", POTION, { keys, itemType: "consumable" });
    const acts = P.toActivities(plan, { keys, idGen, item: { type: "consumable" } });
    const heal = acts.find(a => a.type === "heal");
    expect(heal.healing).toMatchObject({ number: 2, denomination: 4, bonus: "2" });
    expect(heal.healing.types).toEqual(["healing"]);
  });

  it("effects: v14 changes (type, no mode), transfer true for passive effects", () => {
    const plan = P.parseItem("Ring", RING, { keys, itemType: "equipment" });
    const effects = P.toEffects(plan, { keys, idGen, name: "Ring" });
    expect(effects.length).toBeGreaterThan(0);
    const changes = effects.flatMap(e => e.system.changes);
    expect(changes.length).toBeGreaterThanOrEqual(2);
    for ( const c of changes ) { expect(typeof c.type).toBe("string"); expect(c).not.toHaveProperty("mode"); }
    expect(effects.every(e => !("changes" in e))).toBe(true);
    expect(effects.some(e => e.transfer === true)).toBe(true);
  });

  it("toItemPatch: rarity, attunement, charges for a wand", () => {
    const plan = P.parseItem("Wand", WAND, { keys, itemType: "consumable" });
    const patch = P.toItemPatch(plan, { keys, item: { type: "consumable" } });
    expect(patch.rarities ?? patch.rarity).toBeTruthy();
    expect(patch.attunement).toBe("required");
    expect(patch.uses.max).toBe("7");
  });

  it("toItemPatch writes weight, price, armor and weapon details", () => {
    const armor = P.parseItem("Chain Shirt", "<p><em>Armor (medium), common</em></p><p>AC 13 + Dex modifier (max 2). Weight 20 lb. Price 50 gp.</p>", { keys, itemType: "equipment" });
    const patch = P.toItemPatch(armor, { keys, item: { type: "equipment" } });
    expect(patch.weight).toMatchObject({ value: 20, units: "lb" });
    expect(patch.price).toMatchObject({ value: 50, denomination: "gp" });
    expect(patch.armor).toMatchObject({ value: 13 });
    const weapon = P.parseItem("Longsword +1", "<p><em>Weapon (longsword), uncommon</em></p><p>You have a +1 bonus to attack and damage rolls made with this magic weapon.</p>", { keys, itemType: "weapon" });
    expect(P.toItemPatch(weapon, { keys, item: { type: "weapon" } }).magicalBonus).toBe("1");
  });
});

describe("toActorPatch, toSpellStubs, describe", () => {
  it("actor: legendary resources and traits", () => {
    const actor = {
      name: "Dragon", type: "npc",
      system: { details: { biography: { value: "<p><strong>Damage Resistances</strong> cold; fire</p><p><strong>Damage Immunities</strong> poison</p><p><strong>Condition Immunities</strong> charmed, frightened</p><p>The dragon can take 3 legendary actions, choosing from the options below.</p>" } }, resources: { legact: { max: 0 }, legres: { max: 0 } } },
      items: [{ _id: "x", name: "Legendary Resistance (3/Day)", type: "feat", system: { description: { value: "<p>If the dragon fails a saving throw, it can choose to succeed instead.</p>" } } }]
    };
    const plan = P.parseActor(actor, { keys });
    const { system } = P.toActorPatch(plan, { keys, actor });
    expect(system.resources?.legact?.max).toBe(3);
    expect(system.resources?.legres?.max).toBe(3);
    expect(JSON.stringify(system.traits)).toMatch(/cold/);
    expect(JSON.stringify(system.traits)).toMatch(/poison/);
  });

  it("spell stubs carry names only", () => {
    const sc = P.parseSpellcasting("<p>The mage is a 9th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 14, +6 to hit with spell attacks). The mage has the following wizard spells prepared:</p><p>Cantrips (at will): fire bolt, light</p><p>1st level (4 slots): magic missile, shield</p>");
    const stubs = P.toSpellStubs(sc);
    expect(stubs.map(s => s.name.toLowerCase())).toEqual(expect.arrayContaining(["fire bolt", "magic missile", "shield"]));
  });

  it("describe covers activities, effects and details of an item plan, with paths", () => {
    const plan = P.parseItem("Ring", "<p><em>Ring, rare (requires attunement)</em></p><p>You gain a +1 bonus to AC. Weight 1 lb. Price 500 gp.</p>", { keys, itemType: "equipment" });
    const list = P.describe(plan);
    const groups = new Set(list.map(d => d.group));
    expect(groups.has("details")).toBe(true);
    expect(groups.has("effects")).toBe(true);
    expect(list.filter(d => d.group === "effects").every(d => d.paths.some(p => /^effects\.\d+$/.test(p)))).toBe(true);
    const bite = P.describe(P.parseFeature("Bite", BITE, { keys }));
    expect(bite.some(d => d.group === "activities" && d.paths.includes("activities.0"))).toBe(true);
    expect(bite.every(d => d.origin === "rules")).toBe(true);
  });
});
