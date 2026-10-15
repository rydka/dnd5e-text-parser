# dnd5e Text Parser

Bibliothèque Foundry VTT v14 pour dnd5e 6.x. Elle lit le texte (ou le HTML) d'un stat block, d'une capacité ou d'un objet, **en anglais et en français**, et le traduit en données dnd5e 6 : activités (attaque, sauvegarde, dégâts, utilitaire), usages et recharge, détails d'objet, effets actifs v14, données de créature. Elle n'a ni interface ni réglage : elle s'utilise depuis un autre module.

Elle fonctionne en deux temps, tous deux purs (même entrée, même sortie, aucune globale Foundry ; seules les fonctions `parse*Async` appellent le résolveur de secours enregistré) :

1. **Analyse** : `parseFeature(...)`, `parseItem(...)`, `parseActor(...)` -> un **plan** (structure intermédiaire, indépendante de la langue et de dnd5e). Chaque fait garde le passage d'origine (`raw`). Ce qui est ambigu ou non reconnu est rendu dans `ambiguous[]` / `unrecognized[]` : rien n'est inventé.
2. **Traduction** : `toActivities(plan, ...)`, `toItemPatch(plan, ...)`, `toEffects(plan, ...)`... -> fragments de **source dnd5e 6**. `mergeMissing` les applique aux champs vides seulement.

## Installation et dépendance

Dans le `module.json` du module consommateur :

```json
"relationships": {
  "requires": [
    { "id": "dnd5e-text-parser", "type": "module", "compatibility": { "minimum": "1.0.0", "verified": "1.0.0" } }
  ]
}
```

Foundry refuse alors d'activer le module si la bibliothèque manque, et propose de l'activer avec lui.

## Trois façons de l'utiliser

### 1. Import ES (dans Foundry, couche non pure de votre module)

```js
import * as parser from "/modules/dnd5e-text-parser/scripts/index.mjs";
```

`index.mjs` n'a aucun effet de bord. Tous les modules importent la même URL, donc la même instance.

### 2. `game.modules.get("dnd5e-text-parser").api` (macros, import dynamique)

Posée au hook `init`, **gelée** (`Object.isFrozen(api)`), identique à l'import ES. Pour être sûr qu'elle existe, lisez-la à partir de `ready`, ou écoutez le hook personnalisé `dnd5e-text-parser.ready` (argument : l'`api`).

```js
const api = game.modules.get("dnd5e-text-parser")?.api;
if (!api) return;   // bibliothèque absente ou inactive
```

### 3. Tests Vitest d'un autre dépôt (paquet local)

```json
"devDependencies": { "dnd5e-text-parser": "file:../dnd5e-text-parser" }
```

```js
import { parseFeature, toActivities } from "dnd5e-text-parser";   // résolu par "exports" -> scripts/index.mjs
```

Conseil : le cœur pur de votre module reçoit le parseur **en paramètre** (`enrichEntry(data, { parser, ... })`) ; seule votre couche Foundry importe l'URL.

## Vérifier la version

```js
const { API_VERSION, SCHEMA_VERSION } = parser;   // "1.0.0", 1
```

- `API_VERSION` (semver) = version du module. **Majeure** : fonction retirée ou signature modifiée, ou changement incompatible des plans. **Mineure** : nouveaux reconnaisseurs, champs *optionnels* ajoutés aux plans, nouvelles fonctions.
- `plan.schema === SCHEMA_VERSION` dans chaque plan.
- Au `ready`, comparez la majeure attendue :
  `foundry.utils.isNewerVersion(api.API_VERSION, "2.0.0")` -> si la majeure n'est pas la vôtre, désactivez votre enrichissement et affichez une notification (ne lancez jamais d'exception au chargement).

## Exemple complet

```js
const keys = parser.keysFromConfig(CONFIG.DND5E);            // clés dnd5e valides (une fois)
const idGen = () => foundry.utils.randomID();

const plan = parser.parseFeature(
  "Bite",
  "<p><em>Melee Weapon Attack:</em> +5 to hit, reach 5 ft., one target. <em>Hit:</em> 7 (1d8 + 3) piercing damage.</p>",
  { keys }
);

const activities = parser.toActivities(plan, { keys, idGen, item: { type: "feat" } });
const system = parser.toItemPatch(plan, { keys, item: { type: "feat" } });

// Compléter un objet existant sans rien écraser :
const data = item.toObject();
const filled = parser.mergeMissing(data.system, system);        // [{ path: "uses.max", value: "3" }, ...]
const summary = parser.describe(filled);                          // [{ key, data }] à traduire
```

## Référence de l'API v1

Toutes les fonctions sont synchrones et pures, sauf `parseFeatureAsync` / `parseItemAsync`.

### Analyse

| Fonction | Rôle |
|---|---|
| `parseFeature(name, html, opts?) -> FeaturePlan` | Capacité, action ou attaque de créature |
| `parseItem(name, html, opts?) -> ItemPlan` | Objet (arme, armure, consommable, objet magique) : `FeaturePlan` du texte restant + `details`, `effects`, `activities`. `opts.itemType` : type dnd5e de l'objet (`weapon`, `equipment`, `consumable`...) |
| `parseFeatureAsync(name, html, opts?) -> Promise<FeaturePlan>` | `parseFeature` + passe du résolveur de secours sur les phrases non reconnues (voir plus bas) |
| `parseItemAsync(name, html, opts?) -> Promise<ItemPlan>` | Idem pour un objet |
| `validateFallbackFacts(facts, { keys?, sentence? }) -> { facts, rejected }` | Contrôle des propositions d'un résolveur (types, clés, bornes) |
| `parseActor(actor, opts?) -> ActorPlan` | Acteur (source dnd5e) : traits, ressources légendaires, incantation, plan par capacité |
| `parseSpellcasting(html, opts?) -> SpellcastingPlan\|null` | En-tête et listes de sorts |
| `nameKey(name) -> string` | Clé de comparaison d'un nom (minuscules, sans accents, sans ponctuation ni parenthèses, sans mention « (Recharge 5-6) », « (3/Day) »… : « Hunter's Mark » = « Hunters Mark », « Rope, Hempen (50 feet) » = « Rope Hempen 50 feet ») |
| `htmlToText`, `splitSentences`, `splitLines`, `toFeet`, `toPounds` | Utilitaires de texte et d'unités |

`opts` : `{ languages?: ("en"|"fr")[], keys?: Keys }` (les deux langues par défaut).

### Traduction (plan -> source dnd5e 6)

| Fonction | Rôle |
|---|---|
| `toActivities(plan, { keys, idGen, item?, lang?, resolveSpell?, effects?, notes? }) -> object[]` | Activités `attack`, `save`, `damage`, `heal`, `cast`, `utility` (et résistance légendaire). `idGen()` fournit les nouveaux `_id`. `item.type === "weapon"` : la portée reste sur l'objet. Un `ItemPlan` avec `activities` donne une ou plusieurs activités par `ActivityPlan` ; `resolveSpell(nom) -> uuid\|null` est requis pour les `cast` (sort introuvable : pas d'activité et remarque `Note.SpellNotFound`, dans `notes` et sur la propriété non énumérable `result.notes`) ; `effects` (résultat de `toEffects`) remplit `activity.effects` des activités qui les déclenchent |
| `toEffects(plan, { keys?, idGen, name?, img? }) -> object[]` | Effets actifs v14 (`system.changes[].type`) : un effet `transfer: true` pour tous les effets passifs (porté / harmonisé), un effet `transfer: false` par activité pour les effets `onUse` (avec `duration`, et `flags["dnd5e-text-parser"].activity` = index de l'`ActivityPlan`). Remarques : `result.notes` |
| `toItemPatch(plan, { keys, item? }) -> object` | `system` partiel : `uses`, `range` d'arme, détails d'arme/armure/consommable, `rarities`, `attunement`, `weight`, `price`, `properties` |
| `toActorPatch(actorPlan, { keys, actor? }) -> { system, notes }` | Patch d'acteur : ressources légendaires, traits, incantation, emplacements |
| `toSpellStubs(spellcastingPlan) -> object[]` | Sorts listés -> données minimales (aucun contenu inventé) |
| `toDamagePart(part, keys?) -> object` | Une partie de dégâts du plan -> `DamageData` |

Disposition des activités d'un `FeaturePlan` : `attack` (avec `plan.damage`), puis `save` (avec `save.damage`), puis `damage` si `plan.damage` est renseigné sans attaque (dégâts seuls, ou dégâts d'un état continu à côté d'une sauvegarde : « takes 21 (6d6) acid damage at the start of each of its turns » pendant que la cible est avalée, empoisonnée, agrippée…), puis **une activité par variante conditionnelle** de `plan.variants` (voir « Dégâts d'une capacité » : « Bite (if the target is Bloodied) », même attaque ou même sauvegarde avec les dégâts de ce cas, même consommation), puis la résistance légendaire. dnd5e 6 trie les activités par `sort` (stable, tous à 0) : l'ordre du tableau est conservé.

Valeurs écrites : bonus d'attaque fixe `attack.flat = true` + `attack.bonus = "N"` ; DD fixe `save.dc = { calculation: "", formula: "N" }` ; `damage.includeBase = false` quand les dégâts sont écrits ; usages sur l'objet (`system.uses`) + cible de consommation `itemUses` sur l'activité ; recharge « Recharge 5-6 » = `uses.max "1"` + `uses.recovery [{ period: "recharge", type: "recoverAll", formula: "5" }]` (période fixe de dnd5e 6, hors `limitedUsePeriods`). Seules des clés présentes dans `keys` sont écrites.

Armure lourde : `toItemPatch` écrit `armor.dex = 0` quand le texte ne donne pas de plafond de Dextérité. Ce n'est pas un fait du texte mais la règle que dnd5e applique lui-même à ce type d'armure : le calcul de CA force le modificateur de Dextérité à 0 dès que `type.value === "heavy"` (`data/actor/templates/attributes.mjs`, `isHeavy ? 0 : Math.min(mod, armor.dex ?? Infinity)`), si bien que la valeur écrite ne change pas la CA et garde la fiche de l'objet cohérente avec ce calcul (un `dex` vide se lit « sans plafond » sur la fiche). Un plafond énoncé (« max 2 ») est toujours écrit tel quel.

### Fusion

| Fonction | Rôle |
|---|---|
| `mergeMissing(target, patch, { path?, zeroIsEmpty? }) -> { path, value }[]` | Copie dans `target` (modifié en place) les feuilles de `patch` dont la valeur est **vide** dans `target`. Ne modifie jamais une feuille renseignée. Rend la liste des champs remplis (`path` pointé) |
| `isEmpty(v)` | `undefined`, `null`, `""`, `[]`, objet sans clé. `0` et `false` sont des valeurs |
| `isEmptyUtility(activity)` | Activité utilitaire sans rien d'autre qu'un nom ou une activation (convertible) |

`zeroIsEmpty: ["system.resources.legact.max"]` : chemins où `0` compte comme vide.

### Divers

| Fonction | Rôle |
|---|---|
| `keysSnapshot(CONFIG.DND5E) -> object` | Instantané JSON des clés valides (tableaux triés). `keysFromConfig(JSON.parse(texte))` le relit : les tests s'exécutent sans Foundry |
| `keysFromConfig(CONFIG.DND5E) -> Keys` | Ensembles de clés valides (`damageTypes`, `conditionTypes`, `abilities`, `skills`, `areaTargetTypes`, `individualTargetTypes`, `activityActivationTypes`, `limitedUsePeriods`, `itemRarity`, `weaponTypes`, `armorTypes`, `consumableTypes`, `currencies`, `validProperties.{weapon,equipment,consumable,feat}`…) |
| `describe(planOrChanges) -> Descriptor[]` | Plan ou liste de champs remplis -> `{ key, data, group, raw, origin, paths }` neutres. Voir ci-dessous |
| `registerFallback(id, resolver, { priority? }) -> unregister` | Résolveur de secours (voir plus bas) |
| `getFallback() -> function\|null` | Résolveur actif |

### Descripteurs : afficher un résultat

`describe` rend des `{ key, data, group, raw, origin, paths }` ; `key` est une clé de traduction de ce module, `data` ses variables ; `group` vaut `"details"`, `"activities"` ou `"effects"` (`null` pour une remarque ou une phrase non reconnue) ; `raw` est la phrase ou le passage source du fait ; `origin` vaut `"rules"` ou `"fallback"` ; `paths` liste ce que le fait produit : chemins `system.*` (détails), `activities.<n>` (index dans le tableau rendu par `toActivities(plan)`) et `effects.<n>` (index dans celui de `toEffects(plan)`) :

```js
const lines = parser.describe(plan).map(d => game.i18n.format(d.key, d.data));
```

**Texte brut, à échapper avant tout affichage HTML.** La bibliothèque ne produit jamais de HTML, mais tout ce qu'elle rend du texte source est du **texte brut non fiable** : `raw` de chaque fait, `unrecognized[].text`, `data.*` des descripteurs (`data.raw`, `data.text`, `data.word`…) et les chaînes de `describe`. `htmlToText` décode les entités après avoir retiré les balises : `&lt;img onerror=…&gt;` dans une description devient le texte littéral `<img onerror=…>` dans ces champs. Un module qui les insère dans l'interface doit donc les échapper (`foundry.utils.escapeHTML`, `{{ }}` de Handlebars, `textContent`), jamais `innerHTML` ni `{{{ }}}` directement.

Clés : `dnd5e-text-parser.Describe.{Attack, Range, Target, Damage, ExtraDamage, Save, Template, Uses, Recharge, LegendaryResistance, Activation, Activity, Heal, Cast, Consume, Skipped, Weapon, Armor, Consumable, Charges, Rarity, Attunement, Weight, Price, Effect, Field, Fallback}` et `dnd5e-text-parser.Note.*`. Une donnée proposée par le secours porte `data.origin === "fallback"` : ajoutez `Describe.Fallback` (« proposé par l'assistant »).

#### Ambiguïtés et abstentions (`plan.ambiguous`, `plan.notes`)

Quand le texte ne permet pas d'écrire un fait sans l'inventer, la bibliothèque s'abstient et le dit (L3). Les descripteurs ci-dessous portent toujours `data.raw` (le passage source) ; ceux qui offrent un choix donnent `data.choices` au consommateur (un module peut les proposer à l'utilisateur ou à un résolveur).

| Clé (`dnd5e-text-parser.Note.*`) | Où | `data` | Cas |
|---|---|---|---|
| `AttackBonusMissing` | `notes` | `{ raw }` | En-tête d'attaque sans nombre (« Automatic hit ») : pas d'`attack`, dégâts seuls |
| `AttackBonuses` | `ambiguous` | `{ values: number[], raw: string[] }` | Plusieurs bonus différents : pas d'`attack`, dégâts conservés |
| `DamagePenalty` | `ambiguous` | `{ raw }` | « subtracts 3 (1d6) from its damage rolls » : pas de partie de dégâts |
| `AmbiguousDamageType` | `ambiguous` | `{ word, choices: string[], raw }` | « 3 (1d6) lightning or thunder damage », « bludgeoning, piercing, or slashing » : la partie est écrite avec ses dés et `types: []`, `part.typeChoices` = `choices` (clés dnd5e, par exemple `["lightning", "thunder"]`) |
| `SaveAbilities` | `ambiguous` | `{ values: { ability, dc }[], raw: string[] }` | Plusieurs sauvegardes différentes : pas de `save` |
| `DamageWithheld` | `ambiguous` | `{ raw: string[] }` | Dégâts qui dépendent d'une sauvegarde ambiguë : non écrits |
| `ConditionalDamage` | `ambiguous` | `{ formula, type, condition, raw }` | Résultat conditionnel ou alternatif (« , or 11 (2d8 + 2) Piercing damage if the creature is Bloodied », « takes an extra 2d6 Fire damage if… », « in melee or … at range », « ou 8 (2d6 + 1) dégâts perforants si… ») : jamais une partie lancée avec le résultat principal ; il donne une variante (`plan.variants`, ou un `ActivityPlan` avec `condition` dans `activities` pour un objet) que `toActivities` écrit en seconde activité. `type` vaut `""` sans type connu |
| `AbilityScoreChoices` | `ambiguous` | `{ ability, choices: { name, value }[], raw: string[] }` | Plusieurs valeurs fixées listées (« Hill Giant Strength: 21… Storm Giant Strength: 29 ») sans variante reconnaissable dans le nom de l'objet : aucun effet |
| `SaveDcFormula` | `ambiguous` | `{ raw, formula }` | DD écrit en formule (« DC 8 plus your Dexterity modifier ») : `save.dc` null, `save.dcFormula` = `formula` (écrite par `toActivities`) |
| `UsesConflict`, `RechargeConflict` | `ambiguous` | `{ raw: string[] }` | Plusieurs nombres d'utilisations ou de recharge différents : le premier est conservé |
| `LegendaryConflict` | `ambiguous` (ActorPlan) | `{ kind: "legact"\|"legres", values: number[] }` | Plusieurs valeurs trouvées dans l'acteur : la première est conservée |
| `TraitQualifier`, `TraitBypassMixed`, `TraitUnknown` | `ambiguous` (ActorPlan) | `{ kind: "dr"\|"di"\|"dv"\|"ci", text }` | Entrée de résistance / immunité qui n'est pas une simple clé (« from spells », contournements mélangés, mot inconnu) : gardée en texte libre dans `traits.<kind>.custom` |
| `EffectUnknown` | `ambiguous` (ItemPlan) | `{ kind, text }` | Effet d'objet non interprété : « nonmagical », « from spells », mot inconnu, bonus limité (« +1 to saving throws against spells ») |
| `UnknownDamageType` | `notes` | `{ word }` | Type de dégâts inconnu ou absent de `keys` : la partie est écrite sans type |
| `DamageTypeFromWeapon` | `notes` | `{ raw }` | « damage of the weapon's type » : aucune partie sans type n'est écrite |
| `RangeNotCarried` | `notes` | `{ reach, value }` | Allonge et portée dans la même attaque : type d'attaque déduit, portée non reportée |
| `ExtraDamageIgnored` | `notes` | `{ raw: string[] }` | Dégâts rattachés ni au coup ni à la sauvegarde |
| `MasteryUnknown` | `notes` (ItemPlan) | `{ text }` | « Mastery: … » / « Maîtrise : … » avec un nom qui n'est pas une maîtrise connue : `details.weapon.mastery` reste `null` |
| `FallbackRejected` | `plan.fallback.rejected` et `notes` | `{ field, reason: "type"\|"bound"\|"key", raw }` | Proposition du résolveur de secours refusée (voir plus bas) |

Remarques émises à la **traduction** (sur la propriété non énumérable `result.notes` des fonctions, ou dans leur retour), pas dans le plan :

| Clé (`dnd5e-text-parser.Note.*`) | Où | `data` | Cas |
|---|---|---|---|
| `EffectSkipped` | `toEffects(...).notes` | `{ kind, scope }` | Effet sans chemin dnd5e : clé absente de `keys`, `scope` invalide, ou avantage limité (`against`) |
| `SpellNotFound` | `toActivities(...).notes` (et `notes` passé en option) | `{ name }` | `resolveSpell(name)` a rendu `null` : pas d'activité `cast` |
| `TraitKeyInvalid` | `toActorPatch(...).notes` | `{ kind, value }` | Valeur de trait absente de `keys` : écartée |
| `TraitBypassSkipped` | `toActorPatch(...).notes` | `{ kind, bypasses: string[] }` | Contournements non écrits (ils s'appliqueraient aux mauvaises entrées) |
| `SpellcastingAbilityConflict` | `toActorPatch(...).notes` | `{ abilities: string[] }` | Plusieurs caractéristiques d'incantation : aucune n'est écrite |
| `Unrecognized` | `describe(plan)` seulement | `{ text }` | Une phrase de `plan.unrecognized` |

### Structure intermédiaire (plans, `SCHEMA_VERSION = 1`)

```js
FeaturePlan = { schema: 1, skip: "multiattack"|null,
  activation: { type, cost }|null,                       // action|bonus|reaction|legendary|special
  attack: { type: "melee"|"ranged"|null, classification: "weapon"|"spell"|null, bonus: number|null }|null,  // en-tête sans nombre (« Automatic hit ») : attack null, dégâts seuls, remarque Note.AttackBonusMissing
  range: { reach, value, long }|null,                    // pieds (« reach 5 ft. », « range 20/60 ft. », « range 20/60 » d'une liste de propriétés d'arme, « portée 6/18 m » converti)
  target: { count, type }|null,
  damage: DamagePart[],                                  // dégâts du coup, ou dégâts seuls
  save: { ability, dc, onSave: "half"|"none", damage: DamagePart[] }|null,
  template: { type, size, width, height }|null,
  uses: { max, period: "day"|"dawn"|"dusk"|"sr"|"lr", recoverFormula }|null,
  recharge: { min }|null, legendaryResistance: number|null,
  variants: ActivityPlan[],                              // variantes conditionnelles (ActivityPlan avec `condition`), voir « Dégâts d'une capacité »
  notes: Descriptor[], ambiguous: Descriptor[],
  unrecognized: { text, index }[] }                     // phrases qu'aucun reconnaisseur ne couvre, sans les fragments de ponctuation laissés par les passages reconnus ; au moins deux mots
DamagePart = { number, denomination, bonus, type, raw,
  typeChoices?: string[] }                               // « lightning or thunder damage » : type null, choix listés (Note.AmbiguousDamageType)
```

Dégâts d'une capacité : `damage` reçoit les dégâts du coup (ou les dégâts seuls), puis les **dégâts continus** d'un état (« While swallowed… takes 21 (6d6) acid damage at the start of each of its turns », « While Poisoned… », « Until the grapple ends… »), qui ne sont jamais `save.damage` ; `save.damage` reçoit les dégâts de l'échec (« Failure: 9 (2d8) Piercing damage », « …or take 12 (2d8 + 3) bludgeoning damage »).

**Résultat conditionnel** (B9) : un second résultat (« 6 (1d8 + 2) Piercing damage, or 11 (2d8 + 2) Piercing damage if the creature is Bloodied », « 7 (1d6 + 4) piercing damage in melee or 5 (1d4 + 3) piercing damage at range », « in Small or Medium form, or … in Large form », « ou 8 (2d6 + 1) dégâts perforants si… ») ou des dégâts supplémentaires soumis à une condition (« takes an extra 7 (2d6) Fire damage if it is Bloodied », « … plus 7 (2d6) Fire damage if the target is undead ») ne sont **jamais** une partie de dégâts de l'activité principale : dnd5e 6 lance toutes les parties ensemble. Ils donnent `Note.ConditionalDamage` dans `ambiguous` et une **variante** dans `plan.variants` : un `ActivityPlan` avec `condition` (texte de la condition tel qu'écrit, sans traduction), `kind` `attack` / `save` / `damage`, la même attaque (bonus, portée, cible ; « at range » / « à distance » donne `attack.type: "ranged"` et la portée correspondante, « in melee » / « au corps à corps » la mêlée) ou la même sauvegarde, et les dégâts de ce cas : la partie alternative (avec les dégâts continus qui s'y ajoutent), ou la partie principale plus l'`extraDamage`. `name` vaut « <nom de la capacité> (<condition>) », le suffixe entre parenthèses du nom (« (Recharge 5-6) ») retiré : « Bite (if the target is Bloodied) », « Morsure (si la cible est en sang) ». `toActivities` en fait une seconde activité après les activités principales, avec la même consommation. Pour un objet, les variantes sont des `ActivityPlan` de `activities` (après l'activité dont elles dérivent ; les dégâts supplémentaires conditionnels d'une arme deviennent une variante de son attaque) et `plan.variants` reste vide. Les tournures « instead », « à la place » et « if used with two hands » restent ignorées (usage polyvalent d'une arme, règle du jeu de référence). Une variante n'existe qu'à côté d'un **résultat principal** (dégâts du coup, dégâts seuls ou dégâts de la sauvegarde) : quand le seul dégât de la capacité est un supplément conditionnel (« deals an extra 14 (4d6) piercing damage when it hits … and has advantage », Sneak Attack), il reste le dégât de la capacité (`damage`), sans variante ni `Note.ConditionalDamage`.

```js
ItemPlan = FeaturePlan & { name, itemKind: "weapon"|"armor"|"potion"|"scroll"|"wand"|"rod"|"staff"|"ring"|"wondrous"|"ammo"|"poison"|"food"|null,
  details: { rarity?, attunement?: "required", attunementCondition?, weight?: { value, units: "lb" }, price?: { value, denomination },
    magical?: boolean,
    weapon?: { category: "simpleM"|"martialM"|"simpleR"|"martialR"|null, baseItem, properties[], base: DamagePart|null,
      versatile: DamagePart|null, magicalBonus: number|null,
      mastery: "cleave"|"graze"|"nick"|"push"|"sap"|"slow"|"topple"|"vex"|null },   // « Mastery: Nick », « Maîtrise : Coup rapide » (noms FR du PHB 2024) ; nom inconnu : null + Note.MasteryUnknown
    armor?: { type, ac, dexCap, strength, stealthDisadvantage, magicalBonus },
    consumable?: { type, charges: { max, period, formula }|null, destroyOnEmpty } },
  effects: ItemEffect[], activities: ActivityPlan[],
  fallback?: { status, calls, rejected: Descriptor[] } }                 // seulement avec parse*Async
ItemEffect = { kind: "ac"|"attack"|"damage"|"save"|"check"|"resistance"|"immunity"|"vulnerability"|"advantage"|"disadvantage"|"abilityScore"|"speed",
  value: number|string|null, scope: string|null, on?: "save"|"check"|"skill",
  when: "passive"|"onUse", duration: { value, units }|null, activity: number|null, raw, origin }
ActivityPlan = { kind: "attack"|"save"|"damage"|"heal"|"cast"|"utility", name, raw, index,
  activation, attack, range, target, template, damage: DamagePart[], save,       // comme FeaturePlan
  heal: DamagePart|null,                  // type "healing"
  cast: { name, level|null, dc|null, attack|null, charges|null, raw }|null,
  consume: { target: "itemUses", amount, raw }|null,
  extraDamage: DamagePart|null,           // dégâts en plus de la base, rattachés à l'activité d'attaque
  condition?: string,                     // variante conditionnelle (« if the target is Bloodied ») : seconde activité, voir « Résultat conditionnel »
  origin }
```

`scope` d'un effet : `null` (tous), `"weapon"` / `"spell"` / `mwak` / `rwak` / `msak` / `rsak` (attaque, dégâts), clé de caractéristique (`save`, `check`, `abilityScore`), de compétence (`advantage` et `check` avec `on: "skill"`), de type de dégâts ou d'état (`resistance`, `immunity`, `vulnerability`), de type de mouvement (`speed`). Un effet `speed` avec un type (« a flying speed of 60 feet » → `scope: "fly"`) s'écrit en `system.attributes.movement.speeds.<type>` (mode `upgrade`, valeur `"60"` : dnd5e 6 range les vitesses dans `movement.speeds`, `movement.<type>` n'étant qu'un alias déprécié) ; sans type (« your speed increases by 10 feet »), en `system.attributes.movement.bonus` (mode `add`, valeur `"+10"`). Un bonus limité à une compétence (« +5 bonus to Wisdom (Survival) checks », « bonus de +5 aux tests de Sagesse (Survie) », « +2 bonus to Stealth checks ») donne `{ kind: "check", on: "skill", scope: "sur" }` → `system.skills.sur.roll.bonus`, jamais un bonus à toute la caractéristique. Une caractéristique fixée s'écrit « Your Strength score changes to 21 », « Your Intelligence is 19 », ou avec deux-points : « Strength: 23 », « Force : 21 » (« Strength: DC 14 » et « Strength: +2 » ne sont pas des valeurs) ; des variantes nommées (« Hill Giant Strength: 21. Storm Giant Strength: 29. », ou « Géant des collines : 21 » après « votre valeur de Force passe à la valeur indiquée… ») donnent l'effet de la variante dont le nom figure dans le nom de l'objet, sinon `Note.AbilityScoreChoices`. Un bonus d'arme (+N aux jets d'attaque et de dégâts) et un bonus d'armure (+N à la CA) vont dans `details.weapon.magicalBonus` / `details.armor.magicalBonus`, jamais dans un effet. `toItemPatch` n'écrit `system.uses` que pour des charges ou des usages énoncés (« has 7 charges », « 3/Day », recharge) ; un parchemin ou une potion sans charges n'a **pas** de `uses.max` (même si le texte dit qu'il tombe en poussière : `details.consumable.destroyOnEmpty` reste disponible pour le consommateur), et `autoDestroy` n'accompagne que des charges (« crumbles into ashes » sur la dernière charge d'une baguette). Sans usages, `toActivities` n'ajoute pas non plus de consommation `itemUses`.

```js
ActorPlan = { schema: 1,
  legact: number|null, legres: number|null,              // actions et résistances légendaires (« can take 3 legendary actions », « Legendary Resistance (3/Day) »)
  traits: { dr, di, dv, ci: { values: string[], bypasses: string[], custom: string[] } },   // clés dnd5e, contournements (« mgc », « sil », « ada »), passages gardés en texte libre
  spellcasting: SpellcastingPlan[],                       // un par capacité d'incantation reconnue (« Spellcasting », « Innate Spellcasting », « Incantation »)
  features: Map<itemId, FeaturePlan>,                     // un FeaturePlan par objet de l'acteur (hors sorts), clé = `_id` de l'objet source
  notes: Descriptor[], ambiguous: Descriptor[] }
SpellcastingPlan = { ability: "int"|"wis"|"cha"|...|null, dc: number|null, attack: number|null, casterLevel: number|null,
  innate: boolean,                                        // « Innate Spellcasting », « innée », ou listes « 3/day »
  lists: { mode: "atwill"|"innate"|"cantrip"|"slots", uses: number|null, level: number|null, slots: number|null, spells: string[] }[] }
```

`parseActor(actorSource, opts?)` lit une source dnd5e (`actor.toObject()` ou une entrée de compendium : `system`, `items[]`) : la biographie, la description de chaque objet et les champs `traits.*.custom`. **`features` est une `Map`**, pas un objet : `JSON.stringify(plan)` la rend `{}` ; pour sérialiser, convertir d'abord (`Object.fromEntries(plan.features)` ou `[...plan.features]`). `toActorPatch(actorPlan, { keys, actor? })` traduit `legact`, `legres`, `traits` et `spellcasting` (caractéristique, emplacements) ; les `features` se traduisent une à une avec `toActivities` / `toItemPatch`. `toSpellStubs(spellcastingPlan)` rend, pour chaque sort listé, `{ name, system: { prepared, method: "spell"|"innate"|"atwill", level?, uses? } }` sans aucun contenu inventé (le sort lui-même reste à retrouver dans un compendium). Chaque fait porte `raw` (le passage source) et `origin: "rules"|"fallback"`.

## Résolveur de secours (point d'extension)

Un module (par exemple une IA locale) peut proposer des faits pour les phrases non reconnues :

```js
const unregister = api.registerFallback("mon-module", async ({ sentence, context, wanted }, { signal }) => {
  return { facts: { /* partial plan */ }, confidence: 0.8 };   // ou null
}, { priority: 10 });
```

Il n'est appelé que par les fonctions asynchrones `parse*Async` (jamais par `parse*`), uniquement sur les phrases non reconnues ; ses propositions sont validées (`validateFallbackFacts`) et marquées `origin: "fallback"`. Elles ne remplacent jamais un fait des règles.

```js
const plan = await parser.parseItemAsync(name, html, { keys, itemType, fallback /* sinon getFallback() */, signal, timeoutMs /* 5000 */ });
plan.fallback;   // { status, calls, rejected }
```

- Si le résolveur a une méthode `resolveMany(requests, { signal }) -> Promise<Array<{facts, confidence}|null>>` (alignée sur `requests`), **un seul appel** est fait pour toutes les phrases ; sinon un appel par phrase, **en parallèle**. `timeoutMs` et `signal` valent pour l'ensemble de la passe ; le `signal` transmis au résolveur est annulé à l'échéance.
- `plan.fallback.status` : `"unused"` (pas de résolveur ou rien à demander), `"ok"`, `"timeout"`, `"aborted"`, `"error"`, ou le statut du résolveur (`resolver.lastRun.status` / `results.status` : `unreachable`, `no-model`, `invalid`...). **Aucune exception du résolveur ne remonte.** `plan.fallback.rejected` : descripteurs `Note.FallbackRejected { field, reason: "type"|"bound"|"key", raw }` (aussi dans `plan.notes`).
- Faits acceptés : `attack`, `range`, `target`, `damage`, `save`, `template`, `uses`, `recharge`, `activation` ; pour un objet aussi `effects`, `details` (rarity, attunement, weight, price) et, ajoutés comme `ActivityPlan` d'origine `fallback`, `heal` (DamagePart), `cast`, `consume`, `extraDamage`. Bornes : bonus d'attaque -5 à +30, DD 5 à 40, dés 1-100 d 2-100. Un `effect` proposé doit avoir un `scope` de la liste fermée de son `kind` (voir « `scope` d'un effet » plus haut : `weapon`/`spell`/type de jet pour `attack` et `damage`, caractéristique ou compétence selon `on`, type de mouvement pour `speed`, type de dégâts ou d'état pour les résistances ; `null` pour `ac`) et une `value` qui est un nombre (|v| ≤ 1000) ou une formule de dés simple (`"+1"`, `"1d4"`, `"2d6 + 1"`) ; toute autre chaîne est refusée (`reason: "type"`). Les champs hérités du prototype (`constructor`, `toString`…) ne sont jamais des faits. Une phrase dont les faits sont acceptés quitte `plan.unrecognized`.

## Développement

```
npm install
npm test          # tests unitaires (Vitest)
npm run coverage  # couverture, seuil 90 % sur scripts/parse/** et scripts/dnd5e/**
npm run lint
```

Voir `CLAUDE.md` pour l'architecture et `CHANGELOG.md` pour les changements d'API.
