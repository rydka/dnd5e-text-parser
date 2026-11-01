// Corrections made after the control-2 measurement: six ability bugs and three item defects.
// Every text is written for these tests (none comes from a measured set). The keys come from the real dnd5e 6.0.6
// snapshot (tests/fixtures/dnd5e-keys.json).
//
// Format assumptions, to be confirmed against the developer's notes:
//  - "damage type with a choice" (bug 4): the formula is kept, its type stays null, and `plan.ambiguous` holds a
//    `Note.AmbiguousDamageType` whose `data` carries the choices as an ARRAY of damage-type keys. The README and
//    the CHANGELOG did not document this format when the tests were written.
//  - "second result" (bug 5): the alternative "or N (dice) type damage if ..." is added to `plan.damage`, the same way
//    the control truth lists it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as P from "../../scripts/index.mjs";

const keys = P.keysFromConfig(JSON.parse(readFileSync(new URL("../fixtures/dnd5e-keys.json", import.meta.url), "utf8")));
let n = 0;
const idGen = () => `c${++n}`.padEnd(16, "0");
const feature = (name, html) => P.parseFeature(name, html, { keys });
const item = (name, html, itemType = "equipment") => P.parseItem(name, html, { keys, itemType });
const dice = (parts) => (parts ?? []).map(d => `${d.number}d${d.denomination}${d.bonus ? `${d.bonus > 0 ? "+" : ""}${d.bonus}` : ""} ${d.type ?? "-"}`);
const keyOf = (descriptor) => descriptor.key.split(".").pop();
const withKey = (list, name) => (list ?? []).filter(d => keyOf(d) === name);
const changeKeys = (plan) => P.toEffects(plan, { idGen, keys }).flatMap(e => e.changes.map(c => c.key));

describe("bug 1: an attack header without a number invents no bonus", () => {
  const html = "<p>Melee Attack Roll: Automatic hit, reach 5 ft. Hit: 11 (2d6 + 4) Psychic damage.</p>";

  it("has no attack, keeps the damage, and says why", () => {
    const plan = feature("Mind Lash", html);
    expect(plan.attack).toBeNull();
    expect(dice(plan.damage)).toEqual(["2d6+4 psychic"]);
    expect(plan.range.reach).toBe(5);
    const note = withKey(plan.notes, "AttackBonusMissing");
    expect(note).toHaveLength(1);
    expect(JSON.stringify(note[0].data)).toMatch(/Automatic hit/i);
  });

  it("writes a damage activity and no attack activity", () => {
    const activities = P.toActivities(feature("Mind Lash", html), { keys, idGen });
    expect(activities.map(a => a.type)).not.toContain("attack");
    expect(activities.map(a => a.type)).toContain("damage");
  });

  it("an attack with a number is unchanged, including +0", () => {
    expect(feature("Nibble", "<p>Melee Weapon Attack: +0 to hit, reach 5 ft, one target. Hit: 1 piercing damage.</p>").attack).toMatchObject({ bonus: 0 });
    expect(feature("Slash", "<p>Melee Attack Roll: +7, reach 5 ft. Hit: 9 (2d4 + 4) Slashing damage.</p>").attack).toMatchObject({ type: "melee", bonus: 7 });
  });
});

describe("bug 2: a penalty to rolls is never a damage part", () => {
  it("'subtracts N (dice) from its damage rolls' after a saving throw", () => {
    const plan = feature("Sapping Breath", "<p>Constitution Saving Throw: DC 16, each creature that isn't currently affected by this breath in a 20-foot Cone. Failure: The target has Disadvantage on Charisma-based D20 Tests and subtracts 5 (1d10) from its damage rolls. It repeats the save at the end of each of its turns.</p>");
    expect(dice(plan.damage)).toEqual([]);
    expect(dice(plan.save.damage)).toEqual([]);
    expect(plan.save).toMatchObject({ ability: "con", dc: 16 });
    expect(plan.template).toMatchObject({ type: "cone", size: 20 });
    expect(withKey(plan.ambiguous, "DamagePenalty")).toHaveLength(1);
    expect(plan.unrecognized.filter(u => /subtracts/i.test(u.text))).toEqual([]);
  });

  it("'subtracts N (dice) from its attack rolls' next to real damage", () => {
    const plan = feature("Withering Gaze", "<p>Wisdom Saving Throw: DC 13, one creature within 30 feet. Failure: 9 (2d8) Fire damage, and the target subtracts 2 (1d4) from its attack rolls until the end of its next turn.</p>");
    expect(dice(plan.save.damage)).toEqual(["2d8 fire"]);
    expect(dice(plan.damage)).toEqual([]);
  });

  it("French 'soustrait ... à ses jets de dégâts' and 'retranche'", () => {
    const fr = feature("Souffle affaiblissant", "<p><em>Jet de sauvegarde de Force :</em> DD 15, chaque créature dans un cône de 6 m. <em>Échec :</em> la cible soustrait 3 (1d6) à ses jets de dégâts pendant 1 minute.</p>");
    expect(dice(fr.damage)).toEqual([]);
    expect(dice(fr.save.damage)).toEqual([]);
    expect(fr.save).toMatchObject({ ability: "str", dc: 15 });
    const other = feature("Regard", "<p>Elle retranche 1d6 à ses jets de dégâts.</p>");
    expect(dice(other.damage)).toEqual([]);
  });

  it("an extra damage sentence is still damage", () => {
    const plan = feature("Fang", "<p>Melee Weapon Attack: +6 to hit, reach 5 ft, one target. Hit: 7 (1d8 + 3) piercing damage plus 3 (1d6) poison damage.</p>");
    expect(dice(plan.damage)).toEqual(["1d8+3 piercing", "1d6 poison"]);
  });
});

describe("bug 3: an attunement condition in a list is kept whole", () => {
  const condition = (html, itemType = "equipment") => item("Test", html, itemType).details.attunementCondition?.toLowerCase();

  it("EN list of three", () => {
    expect(condition("<p>Staff, Rare (Requires Attunement by a Ranger, Paladin, or Warlock) This staff has 6 charges.</p>")).toBe("a ranger, paladin, or warlock");
  });

  it("EN list written with an enricher before it", () => {
    const html = "<p><em>@UUID[Compendium.dnd5e.equipment24.Item.abcdefgh]{Staff}, Uncommon (Requires Attunement by a Cleric, Druid, or Wizard)</em></p><p>This staff has 5 charges.</p>";
    expect(condition(html)).toBe("a cleric, druid, or wizard");
  });

  it("EN two items", () => {
    expect(condition("<p>Wondrous Item, Rare (Requires Attunement by a Bard or Sorcerer) A silver pin.</p>")).toBe("a bard or sorcerer");
  });

  it("FR list", () => {
    const text = condition("<p>Bâton, rare (nécessite un lien d'harmonisation avec un barde, un clerc ou un druide). Ce bâton possède 8 charges.</p>");
    expect(text).toMatch(/barde/);
    expect(text).toMatch(/clerc/);
    expect(text).toMatch(/druide/);
  });

  it("single condition and a comma that starts another sentence are unchanged", () => {
    expect(condition("<p>Wand, Rare (Requires Attunement by a Spellcaster) A thin wand.</p>")).toBe("a spellcaster");
    expect(condition("<p>Ring, Rare (Requires Attunement by a Wizard, who must also know the password) A plain ring.</p>")).toBe("a wizard");
    expect(item("Plain", "<p>Ring, Rare (Requires Attunement) A plain ring.</p>").details.attunementCondition).toBeUndefined();
  });
});

describe("bug 4: alternative damage types keep the formula and list the choices", () => {
  const choicesOf = (plan) => {
    const entries = withKey(plan.ambiguous, "AmbiguousDamageType");
    return entries.map(e => Object.values(e.data ?? {}).find(Array.isArray) ?? []);
  };

  it("three types in a comma list", () => {
    const plan = feature("Thrash", "<p>Melee Weapon Attack: +5 to hit, reach 5 ft, one target. Hit: 7 (1d8 + 3) piercing, slashing, or bludgeoning damage.</p>");
    expect(dice(plan.damage)).toEqual(["1d8+3 -"]);
    expect(choicesOf(plan)).toHaveLength(1);
    expect([...choicesOf(plan)[0]].sort()).toEqual(["bludgeoning", "piercing", "slashing"]);
  });

  it("two types after a typed part, with the creature's choice", () => {
    const plan = feature("Touch", "<p>Melee Weapon Attack: +6 to hit, reach 5 ft, one target. Hit: 8 (2d6 + 1) piercing plus 4 (1d8) fire or cold damage (the creature's choice).</p>");
    expect(dice(plan.damage)).toEqual(["2d6+1 piercing", "1d8 -"]);
    expect([...choicesOf(plan)[0]].sort()).toEqual(["cold", "fire"]);
  });

  it("French 'de feu ou de froid'", () => {
    const plan = feature("Toucher", "<p><em>Attaque d'arme au corps à corps :</em> +6 pour toucher, allonge 1,50 m, une cible. <em>Touché :</em> 9 (2d8) dégâts de feu ou de froid.</p>");
    expect(dice(plan.damage)).toEqual(["2d8 -"]);
    expect([...choicesOf(plan)[0]].sort()).toEqual(["cold", "fire"]);
  });

  it("a single clear type is not ambiguous", () => {
    const plan = feature("Burn", "<p>Melee Weapon Attack: +6 to hit, reach 5 ft, one target. Hit: 8 (2d6 + 1) fire damage.</p>");
    expect(dice(plan.damage)).toEqual(["2d6+1 fire"]);
    expect(withKey(plan.ambiguous, "AmbiguousDamageType")).toEqual([]);
  });
});

describe("bug 5 (B9): the second result 'or N (dice) ... if' is a variant, never a damage part", () => {
  const variantDice = (plan) => (plan.variants ?? []).map(v => dice(v.damage));
  it("bloodied variant", () => {
    const plan = feature("Gnaw", "<p>Melee Attack Roll: +4, reach 5 ft. Hit: 6 (1d8 + 2) Piercing damage, or 11 (2d8 + 2) Piercing damage if the creature is Bloodied.</p>");
    expect(dice(plan.damage)).toEqual(["1d8+2 piercing"]);
    expect(variantDice(plan)).toEqual([["2d8+2 piercing"]]);
    expect(plan.variants[0].condition).toMatch(/Bloodied/);
    expect(withKey(plan.ambiguous, "ConditionalDamage")).toHaveLength(1);
  });

  it("swarm variant, 2014 form", () => {
    const plan = feature("Swarming Bites", "<p>Melee Weapon Attack: +3 to hit, 0 ft., one creature in the swarm's space. Hit: 9 (2d8) piercing damage, or 4 (1d8) piercing damage if the swarm has half of its hit points or fewer.</p>");
    expect(dice(plan.damage)).toEqual(["2d8 piercing"]);
    expect(variantDice(plan)).toEqual([["1d8 piercing"]]);
  });

  it("a two-handed (versatile) alternative is not extra damage", () => {
    const plan = feature("Sword Cut", "<p>Melee Weapon Attack: +4 to hit, reach 5 ft, one target. Hit: 6 (1d8 + 2) slashing damage, or 7 (1d10 + 2) slashing damage if used with two hands.</p>");
    expect(dice(plan.damage)).toEqual(["1d8+2 slashing"]);
    expect(plan.variants ?? []).toEqual([]);
  });

  it("French 'ou ... si'", () => {
    const plan = feature("Morsure", "<p><em>Attaque d'arme au corps à corps :</em> +4 pour toucher, allonge 1,50 m, une cible. <em>Touché :</em> 5 (1d6 + 2) dégâts perforants, ou 8 (2d6 + 1) dégâts perforants si la créature est en péril.</p>");
    expect(dice(plan.damage)).toEqual(["1d6+2 piercing"]);
    expect(variantDice(plan)).toEqual([["2d6+1 piercing"]]);
    expect(plan.variants[0].condition).toMatch(/^si /);
  });

  it("a single result gives a single part", () => {
    const plan = feature("Bite", "<p>Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6 + 2) Piercing damage.</p>");
    expect(dice(plan.damage)).toEqual(["1d6+2 piercing"]);
  });
});

describe("bug 6: damage that continues is damage, not the damage of the save", () => {
  it("grappling with damage at the start of each turn after a failed save", () => {
    const plan = feature("Constrict", "<p>Constitution Saving Throw: DC 14, one creature the worm can see within 5 feet. Failure: 9 (2d8) Piercing damage, and the target has the Grappled condition (escape DC 12). Until the grapple ends, the target takes 5 (1d10) Acid damage at the start of each of the worm's turns.</p>");
    expect(plan.save).toMatchObject({ ability: "con", dc: 14 });
    expect(dice(plan.save.damage)).toEqual(["2d8 piercing"]);
    expect(dice(plan.damage)).toEqual(["1d10 acid"]);
  });

  it("a condition that deals damage at the start of each turn", () => {
    const plan = feature("Rotting Spores", "<p>Constitution Saving Throw: DC 13, each creature in a 15-foot Emanation originating from the fungus. Failure: The target has the Poisoned condition and repeats the save at the end of each of its turns. While Poisoned, the target takes 7 (2d6) Poison damage at the start of each of its turns.</p>");
    expect(plan.save).toMatchObject({ ability: "con", dc: 13 });
    expect(dice(plan.save.damage)).toEqual([]);
    expect(dice(plan.damage)).toEqual(["2d6 poison"]);
  });

  it("swallowed creature", () => {
    const plan = feature("Gulp", "<p>The wyrm makes one Bite attack against a Medium or smaller target it is Grappling. If the attack hits, the target is also swallowed, and the grapple ends. While swallowed, the target is Blinded and Restrained, and it takes 14 (4d6) acid damage at the start of each of the wyrm's turns.</p>");
    expect(dice(plan.damage)).toEqual(["4d6 acid"]);
    expect(plan.save?.damage ?? []).toEqual([]);
  });

  it("an attack that attaches", () => {
    const plan = feature("Leech Bite", "<p>Melee Attack Roll: +5, reach 5 ft. Hit: 6 (1d6 + 3) Piercing damage, and the leech attaches to the target. While attached, the target takes 4 (1d8) Necrotic damage at the start of each of the leech's turns.</p>");
    expect(dice(plan.damage)).toEqual(["1d6+3 piercing", "1d8 necrotic"]);
  });

  it("damage of the failed save stays with the save", () => {
    const plan = feature("Pulse", "<p>Dexterity Saving Throw: DC 15, each creature in a 10-foot Emanation. Failure: 14 (4d6) Thunder damage. Success: Half damage.</p>");
    expect(dice(plan.save.damage)).toEqual(["4d6 thunder"]);
    expect(plan.save.onSave).toBe("half");
    expect(dice(plan.damage)).toEqual([]);
  });
});

describe("item defect 1: a bonus limited to a skill applies to that skill only", () => {
  const abilityCheckKeys = (plan) => changeKeys(plan).filter(k => /^system\.abilities\.[a-z]+\.bonuses\.check$|^system\.bonuses\.abilities\.check$/.test(k));

  it("'+2 bonus to Dexterity (Stealth) checks' is not a Dexterity check bonus", () => {
    const plan = item("Cloak", "<p>Wondrous Item, Uncommon. While wearing this cloak, you gain a +2 bonus to Dexterity (Stealth) checks.</p>");
    expect(plan.effects.filter(e => e.kind === "check" && e.scope === "dex")).toEqual([]);
    expect(abilityCheckKeys(plan)).toEqual([]);
  });

  it("'+5 bonus to Strength (Athletics) checks made to climb or swim' is not a Strength check bonus", () => {
    const plan = item("Gauntlets", "<p>Wondrous Item, Uncommon. While wearing these gauntlets, you gain a +5 bonus to Strength (Athletics) checks made to climb or swim.</p>");
    expect(plan.effects.filter(e => e.kind === "check" && e.scope === "str")).toEqual([]);
    expect(abilityCheckKeys(plan)).toEqual([]);
  });

  it("French 'bonus de +2 aux tests de Dextérité (Discrétion)'", () => {
    const plan = item("Cape", "<p>Objet merveilleux, peu commun. Tant que vous portez cette cape, vous bénéficiez d'un bonus de +2 aux tests de Dextérité (Discrétion).</p>");
    expect(plan.effects.filter(e => e.kind === "check" && e.scope === "dex")).toEqual([]);
    expect(abilityCheckKeys(plan)).toEqual([]);
  });

  it("a bonus to all checks of an ability is still written", () => {
    const plan = item("Band", "<p>Wondrous Item, Rare. While wearing this band, you gain a +2 bonus to Dexterity checks.</p>");
    expect(plan.effects).toContainEqual(expect.objectContaining({ kind: "check", scope: "dex" }));
    expect(changeKeys(plan)).toContain("system.abilities.dex.bonuses.check");
  });

  it("a bonus to saving throws of an ability is still written", () => {
    const plan = item("Charm", "<p>Wondrous Item, Rare. You gain a +1 bonus to Wisdom saving throws while you hold this charm.</p>");
    expect(changeKeys(plan)).toContain("system.abilities.wis.bonuses.save");
  });
});

describe("item defect 2: a fixed ability written '<Name>: N'", () => {
  const scoreOf = (plan, ability) => plan.effects.find(e => e.kind === "abilityScore" && e.scope === ability);

  it("EN 'Strength: 23'", () => {
    const plan = item("Gauntlets of Might", "<p>Wondrous Item, Rare (Requires Attunement). Strength: 23. The gauntlets have no effect if your Strength is already 23 or higher.</p>");
    expect(scoreOf(plan, "str")).toMatchObject({ value: 23 });
    expect(changeKeys(plan)).toContain("system.abilities.str.value");
  });

  it("EN another ability, in the middle of a sentence", () => {
    const plan = item("Headband", "<p>Wondrous Item, Rare (Requires Attunement). While you wear this headband, your Intelligence: 19.</p>");
    expect(scoreOf(plan, "int")).toMatchObject({ value: 19 });
  });

  it("FR 'Force : 21'", () => {
    const plan = item("Ceinture de force", "<p>Objet merveilleux, rare (nécessite un lien d'harmonisation). Force : 21. Cette ceinture n'a aucun effet si votre Force est déjà égale ou supérieure à 21.</p>");
    expect(scoreOf(plan, "str")).toMatchObject({ value: 21 });
  });

  it("the older forms still work", () => {
    expect(scoreOf(item("Belt", "<p>Wondrous Item, Rare. Your Strength score changes to 21 while you wear this belt.</p>"), "str")).toMatchObject({ value: 21 });
    expect(scoreOf(item("Band", "<p>Wondrous Item, Rare. Your Intelligence is 19 while you wear this band.</p>"), "int")).toMatchObject({ value: 19 });
  });

  it("a saving throw DC or a bonus is not an ability score", () => {
    expect(item("Trap", "<p>Wondrous Item, Rare. Strength: DC 14 to push the lid open.</p>").effects.filter(e => e.kind === "abilityScore")).toEqual([]);
    expect(item("Idol", "<p>Wondrous Item, Rare. Strength: +2 when you carry it.</p>").effects.filter(e => e.kind === "abilityScore")).toEqual([]);
  });
});

describe("item defect 3: a scroll gets no 'uses.max = 1'", () => {
  const patch = (name, html, type = "consumable") => P.toItemPatch(item(name, html, type), { item: { type }, keys });

  it("EN scroll", () => {
    const result = patch("Scroll of Light", "<p>Scroll, Common. This scroll bears the formula for a single spell. When you cast it, the scroll crumbles to dust.</p>");
    expect(result.type).toMatchObject({ value: "scroll" });
    expect(result.uses?.max).toBeUndefined();
  });

  it("FR scroll", () => {
    const result = patch("Parchemin de lumière", "<p>Parchemin, commun. Ce parchemin contient la formule d'un seul sort. Une fois le sort lancé, le parchemin tombe en poussière.</p>");
    expect(result.type).toMatchObject({ value: "scroll" });
    expect(result.uses?.max).toBeUndefined();
  });

  it("a potion has none either", () => {
    expect(patch("Potion of Vigor", "<p>Potion, Uncommon. For 1 hour after drinking it, you gain 10 temporary hit points.</p>").uses?.max).toBeUndefined();
  });

  it("a wand keeps its charges", () => {
    const result = patch("Wand of Sparks", "<p>Wand, Rare. This wand has 5 charges. It regains 1d4 charges daily at dawn. If you expend the last charge, roll a d20. On a 1, the wand crumbles into ashes and is destroyed.</p>");
    expect(result.uses).toMatchObject({ max: "5" });
  });
});

// Corrections after control-3 (bugs 1, 9, 10). Texts written for these tests only.
describe("control-3 bug 1: versatile damage in French and English adds no second part", () => {
  it("FR 'si elle est maniée à deux mains'", () => {
    const plan = feature("Hache runique", "<p>Attaque au corps à corps avec une arme : +6 pour toucher, allonge 1,50 m. Touché : 8 (1d8 + 4) dégâts tranchants, ou 9 (1d10 + 4) dégâts tranchants si elle est maniée à deux mains.</p>");
    expect(plan.damage).toHaveLength(1);
  });

  it("FR 'à deux mains'", () => {
    const plan = feature("Bâton de garde", "<p>Attaque au corps à corps avec une arme : +5 pour toucher, allonge 1,50 m. Touché : 6 (1d6 + 3) dégâts contondants, ou 7 (1d8 + 3) dégâts contondants à deux mains.</p>");
    expect(plan.damage).toHaveLength(1);
  });

  it("EN control: versatile", () => {
    const plan = feature("Spear Strike", "<p>Melee Attack Roll: +5, reach 5 ft. Hit: 6 (1d6 + 3) Piercing damage, or 7 (1d8 + 3) Piercing damage if used with two hands.</p>");
    expect(plan.damage).toHaveLength(1);
  });
});

describe("control-3 bug 9: a target AC is not the item's armor class", () => {
  const patch = (name, html, type = "equipment") => P.toItemPatch(item(name, html, type), { item: { type }, keys });

  it("EN 'against AC 24' on a non-armor object", () => {
    const plan = item("Lens of Aim", "<p>Wondrous Item, Rare. Once per day you can make an attack roll against AC 24 with advantage.</p>");
    expect(plan.armor?.ac ?? null).toBeNull();
    expect(patch("Lens of Aim", "<p>Wondrous Item, Rare. Once per day you can make an attack roll against AC 24 with advantage.</p>").armor?.value).toBeUndefined();
  });

  it("FR 'contre une CA de 20' on a non-armor object", () => {
    const html = "<p>Objet merveilleux, rare. Une fois par jour, vous pouvez effectuer un jet d'attaque contre une CA de 20 avec avantage.</p>";
    expect(item("Lentille de visée", html).armor?.ac ?? null).toBeNull();
    expect(patch("Lentille de visée", html).armor?.value).toBeUndefined();
  });

  it("positive control: an armor 'AC 18' keeps it", () => {
    const html = "<p>Armor (Plate), Rare. AC 18. You gain a +1 bonus to saving throws while wearing it.</p>";
    expect(patch("Bastion Plate", html).armor?.value).toBe(18);
  });
});

describe("control-3 bug 10: 'Potion of X' / 'Potion de X' is a potion", () => {
  const patch = (name, html) => P.toItemPatch(item(name, html, "consumable"), { item: { type: "consumable" }, keys });

  it("EN", () => {
    expect(patch("Potion of Swiftness", "<p>Rare. When you drink this liquid, you gain the effect of the haste spell for 1 minute.</p>").type).toMatchObject({ value: "potion" });
  });

  it("FR", () => {
    expect(patch("Potion de célérité", "<p>Rare. Quand vous buvez ce liquide, vous bénéficiez de l'effet du sort rapidité pendant 1 minute.</p>").type).toMatchObject({ value: "potion" });
  });
});
