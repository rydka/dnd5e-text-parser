// Builds the second control set of objects (armors, staffs, items with effects), truth annotated by hand from
// what each name and description state.
//   node tests/tools/build-control2-objects.mjs <items.json>
import fs from "node:fs";

const items = new Map(JSON.parse(fs.readFileSync(process.argv[2], "utf8")).map(i => [i.id, i]));
const outFile = new URL("../fixtures/control-2/objects.json", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

const E = (kind, scope, value) => ({ kind, scope, value });
const CONS = ["consumable.type", "consumable.charges", "consumable.destroyOnEmpty"];
const FX = ["effect"];
const att = { attunement: "required" };
// [id, expected details, expected effects, ignored token keys]
const A = [
  ["07R6JFioylOCpVoL", { ...att, "weapon.baseItem": "scimitar" }, [], FX],
  ["ZdcEtbtU3VkuxIFE", { ...att }, [], FX],
  ["XwqNHyox5OQQio8q", {}, [], FX],
  ["orHjq3XDPz4eXcov", { "weapon.magicalBonus": 1, "weapon.baseItem": "greatsword" }, [], FX],
  ["r8yK6SrWOz4hqF01", { "weapon.baseItem": "lance" }, [], FX],
  ["i2puCDRaTxkuFfB4", { ...att }, [], FX],
  ["tJQXAJx92wL6GM1v", {}, [], FX],
  ["WnKWD1FuAFUE7f4v", {}, [], FX],
  ["MCMSZrhcD40oMJ9v", { ...att }, [], FX],
  ["ctKfjHjk9gs9UtZI", {}, [], FX],
  ["NM1dPyKwHw2DyUWA", { "armor.magicalBonus": 1 }, []],
  ["JDTO996oInbiZGHW", { "armor.magicalBonus": 3 }, []],
  ["1PMaZR6CX8fUnOZd", { "weapon.baseItem": "shortsword" }, [], FX],
  ["DT02xK1DzxLNlVaI", { ...att, "weapon.baseItem": "shortsword" }, [], FX],
  ["7i4s9msZWpAw4Ynv", { "weapon.magicalBonus": 1, "weapon.baseItem": "dagger" }, [], FX],
  ["hSY1b8yi8JWw2blf", { ...att }, [], FX],
  ["bHbbIhbTzu4lYMRz", { ...att, attunementCondition: "a paladin", "weapon.magicalBonus": 3, "weapon.baseItem": "shortsword" }, [], FX],
  ["VRT5GEusTFstOZdF", { ...att }, []],
  ["zBX8LLC2CjC89Dzl", {}, [], FX],
  ["iiQxTvDOhPGW5spF", { ...att }, [E("abilityScore", "con", 19)]],
  ["I5PWgE4IF40Iv9h4", { "weapon.magicalBonus": 1, "weapon.baseItem": "rapier" }, [], FX],
  ["AweD4kpKGM7Ilu3n", { ...att }, [], FX],
  ["otYAEwhsANKHZAmk", { ...att }, [], FX],
  ["CoUFHk5keIihsbYL", { ...att, "weapon.baseItem": "rapier" }, [], FX],
  ["iRDmig2qZ7LdP0ug", {}, []],
  ["lN1VbnGFo3HNZXNb", { ...att }, []],
  ["YjImJ3cVnArHH4ES", { ...att }, [], FX],
  ["uHL99JKLUpTKAbz8", { ...att }, [], [...FX, ...CONS]],
  ["p01JzD9RpIOkJiqK", { ...att, "weapon.baseItem": "rapier" }, [], FX],
  ["ET8Oo5vaTZqyb7rN", { "armor.magicalBonus": 2 }, []],
  ["XJFqU9COdk4ycFa2", { "armor.magicalBonus": 2 }, []],
  ["FCxG64QUxsnF4Lis", { ...att, attunementCondition: "a paladin", "weapon.magicalBonus": 3, "weapon.baseItem": "greatsword" }, [], FX],
  ["wBYmPQG3nZfD88aP", { ...att }, [E("abilityScore", "str", 29)]],
  ["8MPnSrvEeZhPhtTi", {}, [], FX],
  ["M5APnDW8bKQb7fHI", { ...att }, [], FX],
  ["eTNc8XPtvZNe3yQs", {}, [], FX],
  ["84z9mVy1mCipUWEY", { "armor.magicalBonus": 1 }, []],
  ["9uT9SXy1Gb1jiiZX", { "armor.magicalBonus": 3 }, []],
  ["2wxqnjpnPmkpPCC5", { ...att }, [], [...FX, ...CONS]],
  ["dmgEyesOfTheEagl", { rarity: "uncommon" }, [E("advantage", "prc", null)]],
  ["dmgScimitarOfSpe", { rarity: "veryRare", ...att, "weapon.baseItem": "scimitar", "weapon.magicalBonus": 2 }, [], FX],
  ["dmgRingOfFreeAct", { rarity: "rare", ...att }, [], FX],
  ["dmgstmBeltofGian", {}, [E("abilityScore", "str", 29)]],
  ["dmgStormPotionOf", { rarity: "legendary", "consumable.type": "potion" }, [], FX],
  ["dmgPotionOfSpeed", { rarity: "veryRare", "consumable.type": "potion" }, [], FX],
  ["dmgStaffOfHealin", { rarity: "rare", ...att, attunementCondition: "a bard, cleric, or druid" }, [], [...FX, ...CONS]],
  ["dmgStaffOfCharmi", { rarity: "rare", ...att, attunementCondition: "a bard, cleric, druid, sorcerer, warlock, or wizard" }, [], [...FX, ...CONS]],
  ["dmgStaffOfTheMag", { rarity: "legendary", ...att, attunementCondition: "a sorcerer, warlock, or wizard" }, [], [...FX, ...CONS]],
  ["caEn3ixCUFBnHTx6", { ...att, attunementCondition: "a druid", "weapon.magicalBonus": 2 }, [], [...FX, ...CONS]],
  ["dmgPlateArmorOfE", { rarity: "legendary", ...att }, [], FX],
  ["dmgPeriaptOfWoun", { rarity: "uncommon", ...att }, [], FX]
];

const cases = A.map(([id, expected, effects, ignore = []], i) => {
  const it = items.get(id);
  if ( !it ) throw new Error(`item not found: ${id}`);
  return { id: `o2-${i + 1}`, lang: "en", source: `${it.pack}/${it.name}`, name: it.name, itemType: it.type, html: it.html, expected, effects, ignore };
});
fs.writeFileSync(outFile, JSON.stringify({ description: "Second control set: compendium items, truth annotated by hand from what each name and description state.", cases }, null, 1));
console.log(`objects=${cases.length}`);
