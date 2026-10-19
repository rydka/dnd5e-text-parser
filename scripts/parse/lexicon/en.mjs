/** English word tables: word -> dnd5e key (or value). Keys are looked up through `wordKey`. */
export const EN = {
  damage: {
    acid: "acid", bludgeoning: "bludgeoning", cold: "cold", fire: "fire", force: "force", lightning: "lightning",
    necrotic: "necrotic", piercing: "piercing", poison: "poison", psychic: "psychic", radiant: "radiant",
    slashing: "slashing", thunder: "thunder"
  },
  conditions: {
    blinded: "blinded", charmed: "charmed", deafened: "deafened", exhaustion: "exhaustion", frightened: "frightened",
    grappled: "grappled", incapacitated: "incapacitated", invisible: "invisible", paralyzed: "paralyzed",
    petrified: "petrified", poisoned: "poisoned", prone: "prone", restrained: "restrained", stunned: "stunned",
    unconscious: "unconscious", diseased: "diseased", disease: "diseased"
  },
  abilities: {
    strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha",
    str: "str", dex: "dex", con: "con", int: "int", wis: "wis", cha: "cha"
  },
  skills: {
    acrobatics: "acr", "animal handling": "ani", arcana: "arc", athletics: "ath", deception: "dec", history: "his",
    insight: "ins", intimidation: "itm", investigation: "inv", medicine: "med", nature: "nat", perception: "prc",
    performance: "prf", persuasion: "per", religion: "rel", "sleight of hand": "slt", stealth: "ste", survival: "sur"
  },
  zones: { cone: "cone", sphere: "sphere", line: "line", cube: "cube", cylinder: "cylinder", radius: "radius" },
  activation: {
    action: "action", "bonus action": "bonus", reaction: "reaction", "legendary action": "legendary"
  },
  periods: {
    "short or long rest": "sr", "short rest": "sr", "long rest": "lr", day: "day", dawn: "dawn", dusk: "dusk"
  },
  bypass: { nonmagical: "mgc", "non-magical": "mgc", silvered: "sil", adamantine: "ada" },
  weaponProps: {
    finesse: "fin", light: "lgt", heavy: "hvy", "two-handed": "two", versatile: "ver", thrown: "thr", reach: "rch",
    ammunition: "amm", loading: "lod", special: "spc"
  },
  armor: { light: "light", medium: "medium", heavy: "heavy", shield: "shield" },
  senses: { darkvision: "darkvision", blindsight: "blindsight", tremorsense: "tremorsense", truesight: "truesight" },
  // PHB 2024 weapon masteries (CONFIG.DND5E.weaponMasteries)
  weaponMasteries: {
    cleave: "cleave", graze: "graze", nick: "nick", push: "push", sap: "sap", slow: "slow", topple: "topple", vex: "vex"
  },
  rarity: {
    common: "common", uncommon: "uncommon", rare: "rare", "very rare": "veryRare", legendary: "legendary",
    artifact: "artifact"
  },
  currency: { cp: "cp", sp: "sp", ep: "ep", gp: "gp", pp: "pp" },
  numbers: {
    one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10
  },
  itemKinds: {
    weapon: "weapon", armor: "armor", armour: "armor", potion: "potion", scroll: "scroll", wand: "wand", rod: "rod",
    staff: "staff", ring: "ring", "wondrous item": "wondrous", ammunition: "ammo", poison: "poison", food: "food"
  },
  weaponIds: {
    battleaxe: "battleaxe", blowgun: "blowgun", club: "club", dagger: "dagger", dart: "dart", flail: "flail",
    glaive: "glaive", greataxe: "greataxe", greatclub: "greatclub", greatsword: "greatsword", halberd: "halberd",
    handaxe: "handaxe", "hand crossbow": "handcrossbow", "heavy crossbow": "heavycrossbow", javelin: "javelin",
    lance: "lance", "light crossbow": "lightcrossbow", "light hammer": "lighthammer", longbow: "longbow",
    longsword: "longsword", mace: "mace", maul: "maul", morningstar: "morningstar", musket: "musket", pike: "pike",
    pistol: "pistol", quarterstaff: "quarterstaff", rapier: "rapier", scimitar: "scimitar", shortsword: "shortsword",
    sickle: "sickle", spear: "spear", shortbow: "shortbow", sling: "sling", trident: "trident", "war pick": "warpick",
    warhammer: "warhammer", whip: "whip"
  }
};
