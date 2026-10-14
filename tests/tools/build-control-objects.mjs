// Builds the control set of objects: compendium items (dnd5e.items, dnd5e.equipment24) that are not in the
// item-configurator sample, with a truth annotated by hand from what each description states.
//   node tests/tools/build-control-objects.mjs <items.json>
import fs from "node:fs";

const items = new Map(JSON.parse(fs.readFileSync(process.argv[2], "utf8")).map(i => [i.id, i]));
const outFile = new URL("../fixtures/control/objects.json", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

const E = (kind, scope, value) => ({ kind, scope, value });
// [id, expected details, expected effects, ignored token keys]
const A = [
  ["fvezXwRJ5PqUf5NN", { attunement: "required" }, [E("resistance", "cold")]],
  ["FkDyLSpiynKTQZdi", { attunement: "required" }, [], ["effect"]],
  ["SXjs8JghAPBv7d6j", { "weapon.magicalBonus": 1 }, [], ["effect"]],
  ["ZwFCZDgQljlidzns", {}, []],
  ["azxwKFHrNmG3HpVy", { attunement: "required" }, []],
  ["uLY74ppOrTaWKwer", {}, []],
  ["S7TrIOlE600KIOUx", { "weapon.magicalBonus": 1 }, [], ["effect"]],
  ["902yxeFDwavpm6cv", { attunement: "required" }, [], ["effect"]],
  ["oN4Glcmi4BhdAI3k", {}, [], ["effect"]],
  ["dG7iFak1YH1nXRpC", {}, [], ["effect"]],
  ["J8gQdJJi5e8LmD7H", { weight: "3 lb" }, []],
  ["44XNWmMGnwXn7bNW", { attunement: "required", attunementCondition: "a spellcaster" }, []],
  ["IY5PveXrF7VoFlWg", {}, []],
  ["aDEAwKwttl35dWaB", {}, []],
  ["ZYEqOSY9BLZs2GPx", { attunement: "required" }, [], ["effect"]],
  ["LdAj2ES9EzfnWcA1", {}, []],
  ["sXEkkTDXWQDUMzsC", { weight: "1 lb" }, []],
  ["BsyPV6eTNghT3Fho", {}, [E("advantage", "inv", null)]],
  ["xzZQIIxXjNJwNqnp", { "armor.magicalBonus": 2 }, []],
  ["dQxqcjDm0IxYusCV", { attunement: "required" }, []],
  ["63nb14yQRJMc4bIn", {}, []],
  ["JFiSlgcm3uSSBM5t", {}, []],
  ["HY8duCwmvlXOruTG", {}, []],
  ["dmgHeadbandOfInt", { rarity: "uncommon", attunement: "required" }, [E("abilityScore", "int", 19)]],
  ["dmgRodOfResurrec", { rarity: "legendary", attunement: "required" }, [], ["consumable.type", "consumable.charges", "consumable.destroyOnEmpty"]],
  ["dmgCircletOfBlas", { rarity: "uncommon" }, []],
  ["dmgAmuletOfProof", { rarity: "uncommon", attunement: "required" }, []],
  ["dmgNecklaceOfAda", { rarity: "uncommon", attunement: "required" }, [], ["effect"]],
  ["dmgElixirOfHealt", { rarity: "rare", "consumable.type": "potion" }, []],
  ["dmgRingOfResista", { rarity: "rare" }, []],
  ["dmgHillPotionOfG", { rarity: "uncommon", "consumable.type": "potion" }, [], ["effect"]],
  ["dmgWandOfMagicDe", { rarity: "uncommon" }, [], ["consumable.type", "consumable.charges", "consumable.destroyOnEmpty"]],
  ["dmgDwarvenPlate0", { rarity: "veryRare", "armor.magicalBonus": 2 }, []],
  ["dmgCloakOfInvisi", { rarity: "legendary", attunement: "required" }, [], ["consumable.type", "consumable.charges", "consumable.destroyOnEmpty"]],
  ["dmgRingOfSpellTu", { rarity: "legendary", attunement: "required" }, [], ["effect"]],
  ["dmgPotionOfClimb", { rarity: "common", "consumable.type": "potion" }, [], ["effect"]],
  ["dmgArmorOfResist", { rarity: "rare", attunement: "required" }, []],
  ["dmgTridentOfFish", { rarity: "uncommon", attunement: "required", "weapon.baseItem": "trident" }, [], ["consumable.type", "consumable.charges", "consumable.destroyOnEmpty"]],
  ["dmgPotionOfHeali", { rarity: "common", "consumable.type": "potion" }, []],
  ["dmgGemOfSeeing00", { rarity: "rare", attunement: "required" }, [], ["consumable.type", "consumable.charges", "consumable.destroyOnEmpty"]],
  ["dmgPotionOfHeroi", { rarity: "rare", "consumable.type": "potion" }, []],
  ["dmgWandOfPolymor", { rarity: "veryRare", attunement: "required", attunementCondition: "a spellcaster" }, [], ["consumable.type", "consumable.charges", "consumable.destroyOnEmpty"]],
  ["dmgHelmOfTelepat", { rarity: "uncommon", attunement: "required" }, [], ["effect"]],
  ["dmgBootsOfLevita", { rarity: "rare", attunement: "required" }, []]
];

const cases = [];
for ( const [id, expected, effects, ignore = []] of A ) {
  const it = items.get(id) ?? items.get(`${id}`) ?? [...items.values()].find(i => i.id.endsWith(id) && i.id.length === id.length + 1);
  if ( !it ) throw new Error(`item not found: ${id}`);
  cases.push({ id: `o-ctl-${cases.length + 1}`, lang: "en", source: `${it.pack}/${it.name}`, name: it.name, itemType: it.type, html: it.html, expected, effects, ignore });
}
fs.writeFileSync(outFile, JSON.stringify({ description: "Control set: compendium items outside the item-configurator sample; truth annotated by hand from what each description states.", cases }, null, 1));
console.log(`objects=${cases.length}`);
