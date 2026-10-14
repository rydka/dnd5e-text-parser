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

Valeurs écrites : bonus d'attaque fixe `attack.flat = true` + `attack.bonus = "N"` ; DD fixe `save.dc = { calculation: "", formula: "N" }` ; `damage.includeBase = false` quand les dégâts sont écrits ; usages sur l'objet (`system.uses`) + cible de consommation `itemUses` sur l'activité ; recharge « Recharge 5-6 » = `uses.max "1"` + `uses.recovery [{ period: "recharge", type: "recoverAll", formula: "5" }]` (période fixe de dnd5e 6, hors `limitedUsePeriods`). Seules des clés présentes dans `keys` sont écrites.

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

Clés : `dnd5e-text-parser.Describe.{Attack, Range, Target, Damage, ExtraDamage, Save, Template, Uses, Recharge, LegendaryResistance, Activation, Activity, Heal, Cast, Consume, Skipped, Weapon, Armor, Consumable, Charges, Rarity, Attunement, Weight, Price, Effect, Field, Fallback}` et `dnd5e-text-parser.Note.*`. Une donnée proposée par le secours porte `data.origin === "fallback"` : ajoutez `Describe.Fallback` (« proposé par l'assistant »).

#### Ambiguïtés et abstentions (`plan.ambiguous`, `plan.notes`)

Quand le texte ne permet pas d'écrire un fait sans l'inventer, la bibliothèque s'abstient et le dit (L3). Les descripteurs ci-dessous portent toujours `data.raw` (le passage source) ; ceux qui offrent un choix donnent `data.choices` au consommateur (un module peut les proposer à l'utilisateur ou à un résolveur).

| Clé (`dnd5e-text-parser.Note.*`) | Où | `data` | Cas |
|---|---|---|---|
| `AttackBonusMissing` | `notes` | `{ raw }` | En-tête d'attaque sans nombre (« Automatic hit ») : pas d'`attack`, dégâts seuls |
| `AttackBonuses` | `ambiguous` | `{ values: number[], raw: string[] }` | Plusieurs bonus différents : pas d'`attack`, dégâts conservés |
| `DamagePenalty` | `ambiguous` | `{ raw }` | « subtracts 3 (1d6) from its damage rolls » : pas de partie de dégâts |
| `SaveAbilities` | `ambiguous` | `{ values: { ability, dc }[], raw: string[] }` | Plusieurs sauvegardes différentes : pas de `save` |
| `DamageWithheld` | `ambiguous` | `{ raw: string[] }` | Dégâts qui dépendent d'une sauvegarde ambiguë : non écrits |

### Structure intermédiaire (plans, `SCHEMA_VERSION = 1`)

```js
FeaturePlan = { schema: 1, skip: "multiattack"|null,
  activation: { type, cost }|null,                       // action|bonus|reaction|legendary|special
  attack: { type: "melee"|"ranged"|null, classification: "weapon"|"spell"|null, bonus: number|null }|null,  // en-tête sans nombre (« Automatic hit ») : attack null, dégâts seuls, remarque Note.AttackBonusMissing
  range: { reach, value, long }|null,                    // pieds
  target: { count, type }|null,
  damage: DamagePart[],                                  // dégâts du coup, ou dégâts seuls
  save: { ability, dc, onSave: "half"|"none", damage: DamagePart[] }|null,
  template: { type, size, width, height }|null,
  uses: { max, period: "day"|"dawn"|"dusk"|"sr"|"lr", recoverFormula }|null,
  recharge: { min }|null, legendaryResistance: number|null,
  notes: Descriptor[], ambiguous: Descriptor[], unrecognized: { text, index }[] }
DamagePart = { number, denomination, bonus, type, raw }
```

```js
ItemPlan = FeaturePlan & { name, itemKind: "weapon"|"armor"|"potion"|"scroll"|"wand"|"rod"|"staff"|"ring"|"wondrous"|"ammo"|"poison"|"food"|null,
  details: { rarity?, attunement?: "required", attunementCondition?, weight?: { value, units: "lb" }, price?: { value, denomination },
    magical?: boolean,
    weapon?: { category: "simpleM"|"martialM"|"simpleR"|"martialR"|null, baseItem, properties[], base: DamagePart|null,
      versatile: DamagePart|null, magicalBonus: number|null, mastery },
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
  origin }
```

`scope` d'un effet : `null` (tous), `"weapon"` / `"spell"` / `mwak` / `rwak` / `msak` / `rsak` (attaque, dégâts), clé de caractéristique (`save`, `check`, `abilityScore`), de compétence (`advantage` avec `on: "skill"`), de type de dégâts ou d'état (`resistance`, `immunity`, `vulnerability`). Un bonus d'arme (+N aux jets d'attaque et de dégâts) et un bonus d'armure (+N à la CA) vont dans `details.weapon.magicalBonus` / `details.armor.magicalBonus`, jamais dans un effet. Un objet à usage unique détruit une fois vide (parchemin) a `uses.max = "1"` et `autoDestroy` dans `toItemPatch` ; la bibliothèque n'invente pas ce comportement pour une potion dont le texte ne le dit pas (au consommateur de le décider d'après le type).

Les plans d'acteur (`ActorPlan`) et de sorts (`SpellcastingPlan`) sont décrits dans `specs/dnd5e-text-parser/initial/design.md`. Chaque fait porte `raw` (le passage source) et `origin: "rules"|"fallback"`.

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
- Faits acceptés : `attack`, `range`, `target`, `damage`, `save`, `template`, `uses`, `recharge`, `activation` ; pour un objet aussi `effects`, `details` (rarity, attunement, weight, price) et, ajoutés comme `ActivityPlan` d'origine `fallback`, `heal` (DamagePart), `cast`, `consume`, `extraDamage`. Bornes : bonus d'attaque -5 à +30, DD 5 à 40, dés 1-100 d 2-100. Une phrase dont les faits sont acceptés quitte `plan.unrecognized`.

## Développement

```
npm install
npm test          # tests unitaires (Vitest)
npm run coverage  # couverture, seuil 90 % sur scripts/parse/** et scripts/dnd5e/**
npm run lint
```

Voir `CLAUDE.md` pour l'architecture et `CHANGELOG.md` pour les changements d'API.
