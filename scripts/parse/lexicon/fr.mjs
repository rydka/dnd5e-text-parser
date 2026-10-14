/** French word tables: word -> dnd5e key (or value). Keys are looked up through `wordKey`. */
export const FR = {
  damage: {
    acide: "acid", contondant: "bludgeoning", froid: "cold", feu: "fire", force: "force", foudre: "lightning",
    necrotique: "necrotic", "nécrotique": "necrotic", perforant: "piercing", poison: "poison",
    psychique: "psychic", radiant: "radiant", tranchant: "slashing", tonnerre: "thunder"
  },
  conditions: {
    "aveuglé": "blinded", "charmé": "charmed", assourdi: "deafened", "épuisement": "exhaustion",
    "effrayé": "frightened", "agrippé": "grappled", "neutralisé": "incapacitated", invisible: "invisible",
    "paralysé": "paralyzed", "pétrifié": "petrified", empoisonné: "poisoned", "à terre": "prone",
    "entravé": "restrained", "étourdi": "stunned", inconscient: "unconscious"
  },
  abilities: {
    force: "str", "dextérité": "dex", constitution: "con", intelligence: "int", sagesse: "wis", charisme: "cha",
    dex: "dex", con: "con", int: "int", sag: "wis", cha: "cha"
  },
  skills: {
    acrobaties: "acr", dressage: "ani", arcanes: "arc", "athlétisme": "ath", tromperie: "dec", histoire: "his",
    intuition: "ins", intimidation: "itm", investigation: "inv", "médecine": "med", nature: "nat",
    perception: "prc", "représentation": "prf", persuasion: "per", religion: "rel", escamotage: "slt",
    "discrétion": "ste", survie: "sur"
  },
  zones: {
    "cône": "cone", "sphère": "sphere", ligne: "line", cube: "cube", cylindre: "cylinder", rayon: "radius"
  },
  activation: {
    action: "action", "action bonus": "bonus", "réaction": "reaction", "action légendaire": "legendary"
  },
  periods: {
    "repos court ou long": "sr", "repos court": "sr", "repos long": "lr", jour: "day", aube: "dawn",
    "crépuscule": "dusk"
  },
  bypass: { "non magiques": "mgc", "non magique": "mgc", "argentées": "sil", adamantium: "ada" },
  weaponProps: {
    finesse: "fin", "légère": "lgt", lourde: "hvy", "à deux mains": "two", polyvalente: "ver", lancer: "thr",
    allonge: "rch", munitions: "amm", chargement: "lod", "spéciale": "spc"
  },
  armor: { "légère": "light", "intermédiaire": "medium", lourde: "heavy", bouclier: "shield" },
  rarity: {
    commun: "common", "peu commun": "uncommon", rare: "rare", "très rare": "veryRare", "légendaire": "legendary",
    artefact: "artifact"
  },
  currency: { pc: "cp", pa: "sp", pe: "ep", po: "gp", pp: "pp" },
  numbers: { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10 },
  itemKinds: {
    arme: "weapon", armure: "armor", potion: "potion", parchemin: "scroll", baguette: "wand", sceptre: "rod",
    "bâton": "staff", anneau: "ring", "objet merveilleux": "wondrous", munition: "ammo", poison: "poison",
    nourriture: "food"
  },
  weaponIds: {
    "hache d'armes": "battleaxe", sarbacane: "blowgun", massue: "club", dague: "dagger", "fléchette": "dart",
    "fléau": "flail", coutille: "glaive", "hache à deux mains": "greataxe", "grande massue": "greatclub",
    "épée à deux mains": "greatsword", hallebarde: "halberd", hachette: "handaxe",
    "arbalète de poing": "handcrossbow", "arbalète lourde": "heavycrossbow", javelot: "javelin",
    "lance d'arçon": "lance", "arbalète légère": "lightcrossbow", "marteau léger": "lighthammer",
    "arc long": "longbow", "épée longue": "longsword", "masse d'armes": "mace", maillet: "maul",
    morgenstern: "morningstar", pique: "pike", "bâton de combat": "quarterstaff", "rapière": "rapier",
    cimeterre: "scimitar", "épée courte": "shortsword", serpe: "sickle", lance: "spear", "arc court": "shortbow",
    fronde: "sling", trident: "trident", "pic de guerre": "warpick", "marteau de guerre": "warhammer", fouet: "whip"
  }
};
