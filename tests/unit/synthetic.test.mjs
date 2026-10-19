// Synthetic cases for the formulations the library must read (EN and FR). Texts are written for these tests;
// the keys come from the real dnd5e 6.0.6 snapshot (tests/fixtures/dnd5e-keys.json).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as P from "../../scripts/index.mjs";

const keys = P.keysFromConfig(JSON.parse(readFileSync(new URL("../fixtures/dnd5e-keys.json", import.meta.url), "utf8")));
let n = 0;
const idGen = () => `s${++n}`.padEnd(16, "0");
const feature = (name, html) => P.parseFeature(name, html, { keys });
const item = (name, html, itemType = "equipment") => P.parseItem(name, html, { keys, itemType });
const dice = (parts) => (parts ?? []).map(d => `${d.number}d${d.denomination}${d.bonus ? `+${d.bonus}` : ""} ${d.type ?? "-"}`);

describe("damage: 'X type plus Y type'", () => {
  it("keeps both terms when the first one carries a type", () => {
    const plan = feature("Bite", "<p>Melee Weapon Attack: +10 to hit, reach 5 ft., one target. Hit: 12 (2d6 + 5) piercing plus 10 (3d6) cold damage.</p>");
    expect(dice(plan.damage)).toEqual(["2d6+5 piercing", "3d6 cold"]);
    const fr = feature("Morsure", "<p><em>Attaque d'arme au corps à corps :</em> +10 pour toucher, allonge 1,50 m, une cible. <em>Touché :</em> 12 (2d6 + 5) dégâts perforants plus 10 (3d6) dégâts de froid.</p>");
    expect(dice(fr.damage)).toEqual(["2d6+5 piercing", "3d6 cold"]);
  });

  it("2024 attack roll form", () => {
    const plan = feature("Rend", "<p>Melee Attack Roll: +11, reach 10 ft. Hit: 17 (2d10 + 6) Slashing plus 4 (1d8) Acid damage.</p>");
    expect(plan.attack).toMatchObject({ type: "melee", bonus: 11 });
    expect(plan.range.reach).toBe(10);
    expect(dice(plan.damage)).toEqual(["2d10+6 slashing", "1d8 acid"]);
  });

  it("damage that continues at the start of each turn is read as a second part", () => {
    const plan = feature("Burning Claw", "<p>Melee Weapon Attack: +6 to hit, reach 5 ft, one target. Hit: 10 (2d6 + 3) fire damage. Until a creature takes an action to douse the fire, the target takes 5 (1d10) fire damage at the start of each of its turns.</p>");
    expect(dice(plan.damage)).toEqual(["2d6+3 fire", "1d10 fire"]);
  });
});

describe("saving throws in the 2024 layout and areas", () => {
  const expectBreath = (plan, template) => {
    expect(plan.save).toMatchObject({ ability: "dex", dc: 11, onSave: "half" });
    expect(dice(plan.save.damage)).toEqual(["5d8 acid"]);
    expect(plan.damage).toEqual([]);
    expect(plan.template).toMatchObject(template);
  };
  it("EN", () => expectBreath(feature("Acid Breath", "<p>Dexterity Saving Throw: DC 11, each creature in a 15-foot Cone. Failure: 22 (5d8) Acid damage. Success: Half damage.</p>"), { type: "cone", size: 15 }));
  it("FR", () => expectBreath(feature("Souffle d'acide", "<p>Jet de sauvegarde de Dextérité : DD 11, chaque créature dans un cône de 4,50 m. Échec : 22 (5d8) dégâts d'acide. Réussite : demi-dégâts.</p>"), { type: "cone", size: 15 }));

  it("lines EN and FR (length and width)", () => {
    const en = feature("Breath", "<p>The dragon exhales acid in a 60-foot-long, 5-foot-wide Line. Each creature in that line must make a DC 18 Dexterity saving throw, taking 54 (12d8) acid damage on a failed save, or half as much damage on a successful one.</p>");
    const fr = feature("Souffle", "<p>Le dragon expire de l'acide en une ligne de 18 m de long et 1,50 m de large. Chaque créature dans cette ligne doit faire un jet de sauvegarde de Dextérité DD 18, subissant 54 (12d8) dégâts d'acide en cas d'échec, ou la moitié de ces dégâts en cas de réussite.</p>");
    for ( const plan of [en, fr] ) {
      expect(plan.template).toMatchObject({ type: "line", size: 60, width: 5 });
      expect(plan.save).toMatchObject({ ability: "dex", dc: 18, onSave: "half" });
    }
  });

  it("cone announced before the verb (FR)", () => {
    const plan = feature("Souffle", "<p>Le méphit expire un cône de feu de 4,50 m. Chaque créature dans cette zone doit faire un jet de sauvegarde de Dextérité DD 11, subissant 7 (2d6) dégâts de feu en cas d'échec, ou la moitié de ces dégâts en cas de réussite.</p>");
    expect(plan.template).toMatchObject({ type: "cone", size: 15 });
  });

  it("a DC written as a formula is never read as a fixed number", () => {
    const plan = feature("Spore Burst", "<p>Each creature within 10 feet must make a Constitution saving throw (DC 8 plus your proficiency bonus plus your Constitution modifier), taking 7 (2d6) poison damage on a failed save.</p>");
    expect(plan.save?.dc ?? null).toBeNull();
    expect(plan.save?.dcFormula).toMatch(/8/);
    const fixed = feature("Spore Burst", "<p>Each creature within 10 feet must make a DC 13 Constitution saving throw, taking 7 (2d6) poison damage on a failed save.</p>");
    expect(fixed.save).toMatchObject({ ability: "con", dc: 13 });
    expect(fixed.save.dcFormula ?? null).toBeNull();
  });
});

describe("units", () => {
  it("'pieds' for reach and range", () => {
    expect(feature("Griffe", "<p><em>Attaque d'arme au corps à corps :</em> +3 pour toucher, allonge 5 pieds, une cible. <em>Touché :</em> 4 (1d6 + 1) dégâts tranchants.</p>").range.reach).toBe(5);
    const bow = feature("Arc", "<p><em>Attaque d'arme à distance :</em> +4 pour toucher, portée 80/320 pieds, une cible. <em>Touché :</em> 5 (1d6 + 2) dégâts perforants.</p>");
    expect(bow.range).toMatchObject({ value: 80, long: 320 });
  });
});

describe("objects: armor and weapon bonuses", () => {
  it("'+2 bonus to Armor Class' is the armor's magical bonus, not an effect", () => {
    const plan = item("Dwarven Plate", "<p><em>Armor (Half Plate or Plate Armor), Very Rare</em></p><p>While wearing this armor, you gain a +2 bonus to Armor Class.</p>");
    expect(plan.details.armor.magicalBonus).toBe(2);
    expect(plan.effects).toEqual([]);
  });
  it("'a bonus to AC of +2' (shield)", () => {
    const plan = item("Shield, +2", "<p>While holding this shield, you have a bonus to AC of +2. This bonus is in addition to the shield's normal bonus to AC.</p>");
    expect(plan.details.armor.magicalBonus).toBe(2);
  });
  it("the bonus written in the name when the text only says 'a bonus'", () => {
    expect(item("Breastplate +3", "<p><em>This armor has been embellished with powerful runes, crafted in sorcerous fires, blessed by a powerful being, or some other event has seen it bequeathed with enhanced protection for the wearer.</em></p><p>You have a bonus to AC while wearing this armor.</p>").details.armor.magicalBonus).toBe(3);
    const w = item("Rapier +2", "<p>You have a bonus to attack and damage rolls made with this magic weapon.</p>", "weapon");
    expect(w.details.weapon).toMatchObject({ baseItem: "rapier", magicalBonus: 2 });
  });
  it("Vorpal: +3 bonus and nothing invented", () => {
    const plan = item("Vorpal Sword", "<p><em>Weapon (any sword that deals slashing damage), legendary (requires attunement)</em></p><p>You gain a +3 bonus to attack and damage rolls made with this magic weapon. In addition, the weapon ignores resistance to slashing damage. When you attack a creature that has at least one head with this weapon and roll a 20 on the attack roll, you cut off one of the creature's heads.</p>", "weapon");
    expect(plan.details.weapon.magicalBonus).toBe(3);
    expect(plan.details).toMatchObject({ rarity: "legendary", attunement: "required" });
    expect(plan.damage).toEqual([]);
  });
  it("Mithral: no armor class or bonus invented", () => {
    const plan = item("Mithral Chain Shirt", "<p>Mithral is a light, flexible metal. A mithral chain shirt or breastplate can be worn under normal clothes. If the armor normally imposes disadvantage on Dexterity (Stealth) checks or has a Strength requirement, the mithral version of the armor doesn't.</p>");
    expect(plan.details.armor?.ac ?? null).toBeNull();
    expect(plan.details.armor?.magicalBonus ?? null).toBeNull();
    expect(plan.effects).toEqual([]);
  });
});

describe("objects: effects", () => {
  it("'Your Intelligence is 19' and 'Strength score changes to 29' are fixed ability scores", () => {
    const a = item("Headband", "<p><em>Wondrous Item, Uncommon (Requires Attunement)</em></p><p>Your Intelligence is 19 while you wear this headband. It has no effect on you if your Intelligence is 19 or higher without it.</p>");
    expect(a.effects.map(e => [e.kind, e.scope, e.value])).toContainEqual(["abilityScore", "int", 19]);
    const b = item("Belt", "<p>While wearing this belt, your Strength score changes to 29. If your Strength is already equal to or greater than the belt's score, the item has no effect on you.</p>");
    expect(b.effects.map(e => [e.kind, e.scope, e.value])).toContainEqual(["abilityScore", "str", 29]);
  });

  it("immunity, and an advantage limited to a condition (not written as an active effect)", () => {
    const plan = item("Charm", "<p><em>Wondrous item, rare (requires attunement)</em></p><p>You have immunity to poison damage and advantage on saving throws against being charmed.</p>");
    expect(plan.effects.map(e => [e.kind, e.scope])).toContainEqual(["immunity", "poison"]);
    const adv = plan.effects.find(e => e.kind === "advantage");
    expect(adv.against).toBe("charmed");
    const written = P.toEffects(plan, { keys, idGen, name: "Charm" });
    const keysWritten = written.flatMap(e => e.system.changes.map(c => c.key)).join(" ");
    expect(keysWritten).toMatch(/di|immun|traits/i);
    expect(keysWritten).not.toMatch(/charmed/i);
  });

  it("negations are not read as effects", () => {
    const plan = item("Boots", "<p>You don't have disadvantage on Dexterity (Stealth) checks. You can't be knocked prone.</p>");
    expect(plan.effects.filter(e => e.kind === "disadvantage" || e.kind === "advantage")).toEqual([]);
  });

  it("a bonus to spell attack rolls and a flying speed", () => {
    const plan = item("Rod", "<p>While holding it, you have a +2 bonus to spell attack rolls. You have a flying speed of 60 feet.</p>");
    const got = plan.effects.map(e => [e.kind, e.scope, String(e.value)]);
    expect(got).toContainEqual(["attack", "spell", "+2"]);
    expect(got).toContainEqual(["speed", "fly", "60"]);
  });

  it("French attunement header with a class condition", () => {
    const plan = item("Chapeau", "<p><em>Objet merveilleux, rare (Nécessite un lien d'harmonisation par un magicien)</em></p><p>Vous avez un bonus de +1 à la CA.</p>");
    expect(plan.details).toMatchObject({ rarity: "rare", attunement: "required" });
    expect(plan.details.attunementCondition).toMatch(/magicien/);
    const bare = item("Chapeau", "<p><em>Objet merveilleux, rare (Nécessite un lien d'harmonisation)</em></p><p>Rien.</p>");
    expect(bare.details.attunement).toBe("required");
  });
});

describe("objects: activities", () => {
  it("charges and daily recovery", () => {
    const plan = item("Wand", "<p><em>Wand, rare</em></p><p>This wand has 7 charges. It regains 1d6 + 1 expended charges daily at dawn.</p>", "consumable");
    expect(plan.details.consumable).toMatchObject({ type: "wand", charges: { max: 7, period: "dawn", formula: "1d6 + 1" } });
  });

  it("healing written as an enricher", () => {
    const plan = item("Potion", "<p><em>Potion, common</em></p><p>You regain [[/heal 2d4 + 2]] hit points when you drink this potion.</p>", "consumable");
    const heal = plan.activities.find(a => a.kind === "heal");
    expect(heal.heal).toMatchObject({ number: 2, denomination: 4, bonus: "2" });
    const viaDamage = item("Potion", "<p>You regain [[/damage 4d4 + 4 type=healing]] hit points.</p>", "consumable");
    expect(viaDamage.activities.find(a => a.kind === "heal").heal).toMatchObject({ number: 4, denomination: 4 });
  });

  it("'extra damage of the weapon's type' never produces a typeless damage part", () => {
    const plan = item("Slayer", "<p>You gain a +1 bonus to attack and damage rolls made with this magic weapon. When you hit a dragon with this weapon, the dragon takes an extra 3d6 damage of the weapon's type.</p>", "weapon");
    const all = [...plan.damage, ...plan.activities.flatMap(a => [...a.damage, ...(a.extraDamage ? [a.extraDamage] : [])])];
    expect(all.filter(d => d.type == null || d.type === "")).toEqual([]);
    expect(plan.notes.some(x => /DamageTypeFromWeapon/.test(x.key))).toBe(true);
  });

  const casts = (plan) => plan.activities.filter(a => a.kind === "cast").map(a => [a.cast.name.toLowerCase(), a.consume?.amount ?? a.cast.charges ?? null]);
  it("staff spell list, inline (EN)", () => {
    const plan = item("Staff of Frost", "<p><em>Staff, rare (requires attunement)</em></p><p>This staff has 10 charges. While holding it, you can use an action to expend 1 or more of its charges to cast one of the following spells from it, using your spell save DC: ray of frost (1 charge), ice storm (4 charges), cone of cold (5 charges).</p>", "weapon");
    expect(casts(plan)).toEqual([["ray of frost", 1], ["ice storm", 4], ["cone of cold", 5]]);
  });
  it("staff spell list, inline (FR)", () => {
    const plan = item("Bâton de givre", "<p><em>Bâton, rare (nécessite un lien d'harmonisation)</em></p><p>Ce bâton a 10 charges. Vous pouvez dépenser des charges pour lancer l'un des sorts suivants : le rayon de givre (1 charge), la tempête de grêle (4 charges), le cône de froid (5 charges).</p>", "weapon");
    expect(casts(plan)).toEqual([["rayon de givre", 1], ["tempête de grêle", 4], ["cône de froid", 5]]);
  });
  it("staff spell list as a table", () => {
    const plan = item("Staff of Frost", "<p><em>Staff, rare (requires attunement)</em></p><p>This staff has 10 charges. While holding it, you can cast one of the spells on the following table from it. The table indicates how many charges you must expend to cast the spell.</p><table><thead><tr><th><p>Spell</p></th><th><p>Charge Cost</p></th><th></th></tr></thead><tbody><tr><td><p>@UUID[Compendium.dnd5e.spells24.Item.xxxxxxxxxxxxxxxx]{Ray of Frost}</p></td><td><p>1 charge per spell level (maximum 2 for a <span>level 2</span> spell)</p></td><td></td></tr><tr><td><p>@UUID[Compendium.dnd5e.spells24.Item.yyyyyyyyyyyyyyyy]{Ice Storm}</p></td><td><p>4</p></td><td></td></tr><tr><td><p>@UUID[Compendium.dnd5e.spells24.Item.zzzzzzzzzzzzzzzz]{Cone of Cold}</p></td><td><p>5</p></td><td></td></tr></tbody></table>", "weapon");
    expect(casts(plan)).toEqual([["ray of frost", 1], ["ice storm", 4], ["cone of cold", 5]]);
  });
});

describe("real dnd5e keys", () => {
  it("a recharge is written in the item uses with keys that exist in dnd5e 6.0.6", () => {
    const plan = feature("Fire Breath (Recharge 5-6)", "<p>The dragon exhales fire in a 60-foot cone. Each creature in that area must make a DC 18 Dexterity saving throw, taking 56 (16d6) fire damage on a failed save, or half as much damage on a successful one.</p>");
    const patch = P.toItemPatch(plan, { keys, item: { type: "feat" } });
    expect(patch.uses?.recovery?.[0]).toMatchObject({ period: "recharge", formula: "5" });
  });

  it("every damage type, ability and template type written exists in the real sets", () => {
    const plan = feature("Fire Breath", "<p>The dragon exhales fire in a 60-foot cone. Each creature in that area must make a DC 18 Dexterity saving throw, taking 56 (16d6) fire damage on a failed save, or half as much damage on a successful one.</p>");
    for ( const a of P.toActivities(plan, { keys, idGen, item: { type: "feat" } }) ) {
      for ( const ab of a.save?.ability ?? [] ) expect(keys.abilities.has(ab)).toBe(true);
      for ( const part of a.damage?.parts ?? [] ) for ( const t of part.types ) expect(keys.damageTypes.has(t)).toBe(true);
      if ( a.target?.template?.type ) expect(keys.areaTargetTypes.has(a.target.template.type)).toBe(true);
    }
  });
});

describe("activation and names", () => {
  it("nameKey ignores punctuation and recharge mentions", () => {
    expect(P.nameKey("Fire Breath (Recharge 5-6)")).toBe(P.nameKey("fire breath"));
    expect(P.nameKey("Claw.")).toBe(P.nameKey("Claw"));
    expect(P.nameKey("Bite - Rat Form")).toBe(P.nameKey("Bite Rat Form"));
  });

  it("an ability with no damage of its own never gets damage invented", () => {
    const plan = feature("Pounce", "<p>If the lion moves at least 20 feet straight toward a creature and then hits it with a claw attack on the same turn, that target must succeed on a DC 13 Strength saving throw or be knocked prone. If the target is prone, the lion can make one bite attack against it as a bonus action.</p>");
    expect(plan.damage).toEqual([]);
    expect(plan.save.damage).toEqual([]);
    const acts = P.toActivities(plan, { keys, idGen, item: { type: "feat" } });
    expect(acts.every(a => !(a.damage?.parts ?? []).length)).toBe(true);
  });

  it("'uses Charisma as its spellcasting ability'", () => {
    const sc = P.parseSpellcasting("<p>The creature casts the following spells, using Charisma as its spellcasting ability (spell save DC 14, +6 to hit with spell attacks):</p><p>At will: detect magic, mage hand</p><p>1/day each: charm person</p>");
    expect(sc.ability).toBe("cha");
    expect(sc.dc).toBe(14);
  });
});
