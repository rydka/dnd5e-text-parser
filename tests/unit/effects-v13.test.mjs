// Port to Foundry v13 / dnd5e 5.3.3: one block per gap of the design (P1 to P9), named by gap.
// Data format: reference/dnd5e/5.3.3 (creature.mjs, common.mjs, movement-field.mjs, physical-item.mjs, attributes.mjs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as P from "../../scripts/index.mjs";
import * as E from "../../scripts/dnd5e/effects.mjs";

const keys = P.keysFromConfig(JSON.parse(readFileSync(new URL("../fixtures/dnd5e-keys.json", import.meta.url), "utf8")));
let n = 0;
const idGen = () => `v${++n}`.padEnd(16, "0");
const plan = (...effects) => ({ name: "Thing", effects });
const write = (effects, opts = {}) => P.toEffects(plan(...effects), { idGen, keys, ...opts });
const changesOf = (effects, opts) => write(effects, opts).flatMap(e => e.changes);
const keysOf = (effects, opts) => changesOf(effects, opts).map(c => c.key);
const MODES = { custom: 0, multiply: 1, add: 2, downgrade: 3, upgrade: 4, override: 5 };

describe("P1: changes at the top level, numeric mode, string value", () => {
  it("CHANGE_MODES is the v13 table, exported by the module entry and by effects.mjs", () => {
    expect(E.CHANGE_MODES).toEqual(MODES);
    expect(P.CHANGE_MODES).toEqual(MODES);
  });

  it("every effect written has changes at the top level and no system, type or phase", () => {
    const effects = write([
      { kind: "ac", value: "+1" }, { kind: "save", value: "+1" }, { kind: "attack", scope: "spell", value: "+2" },
      { kind: "resistance", scope: "cold" }, { kind: "sense", scope: "darkvision", value: 60 },
      { kind: "speed", scope: "fly", value: 60 }, { kind: "advantage", on: "save", scope: "wis" }
    ]);
    expect(effects.length).toBeGreaterThan(0);
    for ( const e of effects ) {
      expect(e).not.toHaveProperty("system");
      expect(Array.isArray(e.changes)).toBe(true);
      expect(e.changes.length).toBeGreaterThan(0);
      for ( const c of e.changes ) {
        expect(Object.values(P.CHANGE_MODES)).toContain(c.mode);
        expect(typeof c.value).toBe("string");
        expect(typeof c.key).toBe("string");
        expect(c).not.toHaveProperty("type");
        expect(c).not.toHaveProperty("phase");
        expect(c.priority ?? null).toBeNull();
      }
    }
  });

  it("the passive example of the design: +1 AC and +1 to all saving throws", () => {
    const [effect] = write([{ kind: "ac", value: "+1" }, { kind: "save", value: "+1" }], { name: "Cloak of Protection" });
    expect(effect).toMatchObject({ name: "Cloak of Protection", transfer: true, disabled: false });
    expect(effect.changes).toEqual([
      { key: "system.attributes.ac.bonus", mode: 2, value: "+1", priority: null },
      { key: "system.bonuses.abilities.save", mode: 2, value: "+1", priority: null }
    ]);
  });
});

describe("P2: bonuses go to system.bonuses.*, never to system.rolls.*", () => {
  it("an attack bonus without scope writes the four attack roll types", () => {
    expect(keysOf([{ kind: "attack", value: "+1" }]).sort()).toEqual(
      ["mwak", "rwak", "msak", "rsak"].map(t => `system.bonuses.${t}.attack`).sort());
  });
  it("scope weapon: mwak and rwak; scope spell: msak and rsak; a roll type stands for itself", () => {
    expect(keysOf([{ kind: "attack", scope: "weapon", value: "+1" }]).sort()).toEqual(["system.bonuses.mwak.attack", "system.bonuses.rwak.attack"]);
    expect(keysOf([{ kind: "attack", scope: "spell", value: "+1" }]).sort()).toEqual(["system.bonuses.msak.attack", "system.bonuses.rsak.attack"]);
    expect(keysOf([{ kind: "attack", scope: "rwak", value: "+1" }])).toEqual(["system.bonuses.rwak.attack"]);
  });
  it("damage: scope spell -> msak and rsak; without scope -> the four roll types", () => {
    expect(keysOf([{ kind: "damage", scope: "spell", value: "+1" }]).sort()).toEqual(["system.bonuses.msak.damage", "system.bonuses.rsak.damage"]);
    expect(keysOf([{ kind: "damage", value: "+1" }]).sort()).toEqual(
      ["mwak", "rwak", "msak", "rsak"].map(t => `system.bonuses.${t}.damage`).sort());
  });
  it("saves and checks: per ability, per skill, or for all abilities", () => {
    expect(keysOf([{ kind: "save", scope: "wis", value: "+1" }])).toEqual(["system.abilities.wis.bonuses.save"]);
    expect(keysOf([{ kind: "check", scope: "dex", value: "+2" }])).toEqual(["system.abilities.dex.bonuses.check"]);
    expect(keysOf([{ kind: "save", value: "+1" }])).toEqual(["system.bonuses.abilities.save"]);
    expect(keysOf([{ kind: "check", value: "+1" }])).toEqual(["system.bonuses.abilities.check"]);
    expect(keysOf([{ kind: "check", on: "skill", scope: "sur", value: "+5" }])).toEqual(["system.skills.sur.bonuses.check"]);
  });
  it("the values are added (mode 2) and kept as the text gives them", () => {
    for ( const c of changesOf([{ kind: "attack", scope: "weapon", value: "+1" }, { kind: "save", scope: "wis", value: "+3" }]) ) expect(c.mode).toBe(2);
    expect(changesOf([{ kind: "save", scope: "wis", value: "+3" }])[0].value).toBe("+3");
  });
  it("no key written by any bonus kind starts with system.rolls.", () => {
    const all = keysOf([
      { kind: "attack", value: "+1" }, { kind: "damage", value: "+1" }, { kind: "save", value: "+1" }, { kind: "check", value: "+1" },
      { kind: "save", scope: "str", value: "+1" }, { kind: "check", on: "skill", scope: "ath", value: "+1" },
      { kind: "advantage", on: "save" }, { kind: "disadvantage", on: "check", scope: "dex" }
    ]);
    expect(all.length).toBeGreaterThan(10);
    expect(all.filter(k => k.startsWith("system.rolls."))).toEqual([]);
  });
});

describe("P3: general advantage is written per ability", () => {
  const ABILITIES = ["cha", "con", "dex", "int", "str", "wis"];
  it("advantage on saving throws without scope: six system.abilities.<a>.save.roll.mode changes, mode 2, value '1'", () => {
    const changes = changesOf([{ kind: "advantage", on: "save" }]);
    expect(changes.map(c => c.key).sort()).toEqual(ABILITIES.map(a => `system.abilities.${a}.save.roll.mode`));
    for ( const c of changes ) expect(c).toMatchObject({ mode: 2, value: "1" });
  });
  it("disadvantage on checks without scope: value '-1' on .check.roll.mode", () => {
    const changes = changesOf([{ kind: "disadvantage", on: "check" }]);
    expect(changes.map(c => c.key).sort()).toEqual(ABILITIES.map(a => `system.abilities.${a}.check.roll.mode`));
    for ( const c of changes ) expect(c).toMatchObject({ mode: 2, value: "-1" });
  });
  it("the abilities come from keys.abilities when given", () => {
    const narrow = { ...keys, abilities: new Set(["str", "dex"]) };
    expect(keysOf([{ kind: "advantage", on: "save" }], { keys: narrow }).sort()).toEqual(
      ["system.abilities.dex.save.roll.mode", "system.abilities.str.save.roll.mode"]);
  });
  it("without keys at all: the six default abilities", () => {
    const [effect] = P.toEffects(plan({ kind: "advantage", on: "check" }), { idGen });
    expect(effect.changes).toHaveLength(6);
  });
  it("per ability and per skill: the v14 path is unchanged, mode 2", () => {
    expect(changesOf([{ kind: "advantage", on: "save", scope: "wis" }])).toEqual(
      [{ key: "system.abilities.wis.save.roll.mode", mode: 2, value: "1", priority: null }]);
    expect(changesOf([{ kind: "disadvantage", on: "skill", scope: "ste" }])).toEqual(
      [{ key: "system.skills.ste.roll.mode", mode: 2, value: "-1", priority: null }]);
  });
});

describe("P4: speeds go to movement.<type>", () => {
  it("a flying speed: movement.fly, upgrade (mode 4), value '60'", () => {
    expect(changesOf([{ kind: "speed", scope: "fly", value: 60 }])).toEqual(
      [{ key: "system.attributes.movement.fly", mode: 4, value: "60", priority: null }]);
  });
  it.each(["walk", "burrow", "climb", "fly", "swim"])("%s is a movement field", (type) => {
    expect(keysOf([{ kind: "speed", scope: type, value: 30 }])).toEqual([`system.attributes.movement.${type}`]);
  });
  it("jump is no field of dnd5e 5.3.3: nothing written, Note.EffectSkipped", () => {
    const effects = write([{ kind: "speed", scope: "jump", value: 30 }]);
    expect(effects).toEqual([]);
    expect(effects.notes.map(x => x.key)).toContain("dnd5e-text-parser.Note.EffectSkipped");
  });
  it("without a type: movement.bonus, add, '+10'", () => {
    expect(changesOf([{ kind: "speed", value: 10 }])).toEqual(
      [{ key: "system.attributes.movement.bonus", mode: 2, value: "+10", priority: null }]);
  });
  it("no key contains movement.speeds", () => {
    expect(keysOf([{ kind: "speed", scope: "fly", value: 60 }, { kind: "speed", value: 10 }, { kind: "speedMultiplier", value: 0.5 }])
      .filter(k => k.includes("movement.speeds"))).toEqual([]);
  });
});

describe("P5: 'speed halved' multiplies each speed", () => {
  it("five changes, multiply (mode 1), '0.5', on walk burrow climb fly swim", () => {
    const changes = changesOf([{ kind: "speedMultiplier", value: 0.5 }]);
    expect(changes.map(c => c.key).sort()).toEqual(["burrow", "climb", "fly", "swim", "walk"].map(t => `system.attributes.movement.${t}`));
    for ( const c of changes ) expect(c).toMatchObject({ mode: 1, value: "0.5" });
  });
  it("only the speed fields present in keys.movementTypes (jump never)", () => {
    const narrow = { ...keys, movementTypes: new Set(["walk", "fly", "jump"]) };
    expect(keysOf([{ kind: "speedMultiplier", value: 0.5 }], { keys: narrow }).sort()).toEqual(
      ["system.attributes.movement.fly", "system.attributes.movement.walk"]);
  });
  it("no movement.multiplier key", () => {
    expect(keysOf([{ kind: "speedMultiplier", value: 0.5 }]).some(k => k.endsWith("multiplier"))).toBe(false);
  });
  it("a zero factor is skipped", () => {
    expect(write([{ kind: "speedMultiplier", value: 0 }])).toEqual([]);
  });
});

describe("P6: effect duration in the v13 format", () => {
  const dur = P.toEffectDuration;
  it.each([
    [{ value: 1, units: "hours" }, { seconds: 3600 }],
    [{ value: 1, units: "hour" }, { seconds: 3600 }],
    [{ value: 10, units: "minutes" }, { seconds: 600 }],
    [{ value: 1, units: "minute" }, { seconds: 60 }],
    [{ value: 30, units: "seconds" }, { seconds: 30 }],
    [{ value: 1, units: "days" }, { seconds: 86400 }],
    [{ value: 3, units: "rounds" }, { rounds: 3 }],
    [{ value: 1, units: "round" }, { rounds: 1 }],
    [{ value: 1, units: "turns" }, { turns: 1 }],
    [{ value: 2, units: "turn" }, { turns: 2 }],
    [{ until: "sourceEnd" }, { turns: 1 }],
    [{ until: "sourceStart", value: 1, units: "hours" }, { turns: 1 }]
  ])("%j -> %j", (input, expected) => {
    expect(dur(input)).toEqual(expected);
  });
  it("an unknown unit or no data -> null", () => {
    expect(dur({ value: 1, units: "fortnights" })).toBeNull();
    expect(dur({})).toBeNull();
    expect(dur(null)).toBeNull();
  });
  it("an onUse effect 'for 1 hour' carries duration { seconds: 3600 }, never { value, units }", () => {
    const [effect] = write([{ kind: "speed", scope: "fly", value: 60, when: "onUse", activity: 0, duration: { value: 1, units: "hours" } }]);
    expect(effect.transfer).toBe(false);
    expect(effect.duration).toEqual({ seconds: 3600 });
    expect(effect.flags["dnd5e-text-parser"].activity).toBe(0);
  });
  it("an onUse effect 'until the end of your next turn' carries { turns: 1 }", () => {
    const [effect] = write([{ kind: "ac", value: "+2", when: "onUse", activity: 0, duration: { until: "sourceEnd" } }]);
    expect(effect.duration).toEqual({ turns: 1 });
  });
  it("an unknown duration unit writes no duration", () => {
    const [effect] = write([{ kind: "ac", value: "+2", when: "onUse", activity: 0, duration: { value: 1, units: "fortnights" } }]);
    expect(effect).not.toHaveProperty("duration");
  });
  it("a passive effect has no duration", () => {
    expect(write([{ kind: "ac", value: "+1" }])[0]).not.toHaveProperty("duration");
  });
});

describe("P7: rarity is a string", () => {
  const item = (rarity) => P.parseItem("Ring", `<p><em>Ring, ${rarity}</em></p><p>You gain a +1 bonus to AC.</p>`, { keys, itemType: "equipment" });
  it("toItemPatch writes system.rarity = 'rare' and no rarities", () => {
    const patch = P.toItemPatch(item("rare"), { keys, item: { type: "equipment" } });
    expect(patch.rarity).toBe("rare");
    expect(patch).not.toHaveProperty("rarities");
  });
  it("describe names the path system.rarity", () => {
    const rarity = P.describe(item("rare")).find(d => d.key.endsWith("Rarity"));
    expect(rarity.paths).toEqual(["system.rarity"]);
  });
});

describe("P8: toNpcPatch speeds as movement.<type>", () => {
  const sys = (stats, opts) => { const p = P.toNpcPatch(stats, { keys, ...opts }); return p.system ?? p; };
  it("walk and fly at the top of movement, with units and hover; no speeds sub-object", () => {
    const m = sys(P.parseStatLines("Speed 30 ft., fly 60 ft. (hover)")).attributes.movement;
    expect(Number(m.walk)).toBe(30);
    expect(Number(m.fly)).toBe(60);
    expect(m.units).toBe("ft");
    expect(m.hover).toBe(true);
    expect(m).not.toHaveProperty("speeds");
  });
  it("jump is dropped (not a field of 5.3.3), even if the keys list it", () => {
    const stats = { speed: { speeds: { walk: 30, jump: 10 }, hover: false } };
    const m = sys(stats).attributes.movement;
    expect(m).not.toHaveProperty("jump");
    expect(Number(m.walk)).toBe(30);
  });
});

describe("P9: toNpcPatch armor class as calc", () => {
  it("natural armor -> { calc: 'natural', flat } and no calcs", () => {
    const p = P.toNpcPatch(P.parseStatLines("Armor Class 16 (natural armor)"), { keys });
    const ac = (p.system ?? p).attributes.ac;
    expect(ac).toEqual({ calc: "natural", flat: 16 });
    expect(ac).not.toHaveProperty("calcs");
  });
});
