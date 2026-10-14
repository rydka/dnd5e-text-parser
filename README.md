# dnd5e Text Parser

Bibliothèque Foundry VTT v14 pour dnd5e 6.x. Elle lit le texte (ou le HTML) d'un stat block, d'une capacité ou d'un objet, **en anglais et en français**, et le traduit en données dnd5e 6 : activités (attaque, sauvegarde, dégâts, utilitaire), usages et recharge, détails d'objet, effets actifs v14, données de créature. Elle n'a ni interface ni réglage : elle s'utilise depuis un autre module.

Elle fonctionne en deux temps, tous deux purs (même entrée, même sortie, aucune globale Foundry) :

1. **Analyse** : `parseFeature(...)` -> un **plan** (structure intermédiaire, indépendante de la langue et de dnd5e). Chaque fait garde le passage d'origine (`raw`). Ce qui est ambigu ou non reconnu est rendu dans `ambiguous[]` / `unrecognized[]` : rien n'est inventé.
2. **Traduction** : `toActivities(plan, ...)`, `toItemPatch(plan, ...)`... -> fragments de **source dnd5e 6**. `mergeMissing` les applique aux champs vides seulement.

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

Toutes les fonctions sont synchrones et pures.

### Analyse

| Fonction | Rôle |
|---|---|
| `parseFeature(name, html, opts?) -> FeaturePlan` | Capacité, action ou attaque de créature |
| `parseActor(actor, opts?) -> ActorPlan` | Acteur (source dnd5e) : traits, ressources légendaires, incantation, plan par capacité |
| `parseSpellcasting(html, opts?) -> SpellcastingPlan\|null` | En-tête et listes de sorts |
| `nameKey(name) -> string` | Clé de comparaison d'un nom (minuscules, sans accents, sans mention « (Recharge 5-6) », « (3/Day) »…) |
| `htmlToText`, `splitSentences`, `splitLines`, `toFeet`, `toPounds` | Utilitaires de texte et d'unités |

`opts` : `{ languages?: ("en"|"fr")[], keys?: Keys }` (les deux langues par défaut).

### Traduction (plan -> source dnd5e 6)

| Fonction | Rôle |
|---|---|
| `toActivities(plan, { keys, idGen, item?, lang? }) -> object[]` | Activités `attack`, `save`, `damage`, `utility` (résistance légendaire). `idGen()` fournit les nouveaux `_id`. `item.type === "weapon"` : la portée reste sur l'objet |
| `toItemPatch(plan, { keys, item? }) -> object` | `system` partiel : `uses`, `range` d'arme, détails d'arme/armure/consommable, `rarities`, `attunement`, `weight`, `price`, `properties` |
| `toActorPatch(actorPlan, { keys, actor? }) -> { system, notes }` | Patch d'acteur : ressources légendaires, traits, incantation, emplacements |
| `toSpellStubs(spellcastingPlan) -> object[]` | Sorts listés -> données minimales (aucun contenu inventé) |
| `toDamagePart(part, keys?) -> object` | Une partie de dégâts du plan -> `DamageData` |

Valeurs écrites : bonus d'attaque fixe `attack.flat = true` + `attack.bonus = "N"` ; DD fixe `save.dc = { calculation: "", formula: "N" }` ; `damage.includeBase = false` quand les dégâts sont écrits ; usages sur l'objet (`system.uses`) + cible de consommation `itemUses` sur l'activité ; recharge `{ period: "recharge", formula: "5" }`. Seules des clés présentes dans `keys` sont écrites.

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
| `keysFromConfig(CONFIG.DND5E) -> Keys` | Ensembles de clés valides (`damageTypes`, `conditionTypes`, `abilities`, `skills`, `areaTargetTypes`, `individualTargetTypes`, `activityActivationTypes`, `limitedUsePeriods`, `itemRarity`, `weaponTypes`, `armorTypes`, `consumableTypes`, `currencies`, `validProperties.{weapon,equipment,consumable,feat}`…) |
| `describe(planOrChanges) -> Descriptor[]` | Plan ou liste de champs remplis -> `{ key, data }` neutres. Voir ci-dessous |
| `registerFallback(id, resolver, { priority? }) -> unregister` | Résolveur de secours (voir plus bas) |
| `getFallback() -> function\|null` | Résolveur actif |

### Descripteurs : afficher un résultat

`describe` rend des `{ key, data }` ; `key` est une clé de traduction de ce module, `data` ses variables :

```js
const lines = parser.describe(plan).map(d => game.i18n.format(d.key, d.data));
```

Clés : `dnd5e-text-parser.Describe.{Attack, Range, Target, Damage, Save, Template, Uses, Recharge, LegendaryResistance, Activation, Skipped, Weapon, Armor, Consumable, Rarity, Attunement, Weight, Price, Effect, Field, Fallback}` et `dnd5e-text-parser.Note.*`. Une donnée proposée par le secours porte `data.origin === "fallback"` : ajoutez `Describe.Fallback` (« proposé par l'assistant »).

### Structure intermédiaire (plans, `SCHEMA_VERSION = 1`)

```js
FeaturePlan = { schema: 1, skip: "multiattack"|null,
  activation: { type, cost }|null,                       // action|bonus|reaction|legendary|special
  attack: { type: "melee"|"ranged"|null, classification: "weapon"|"spell"|null, bonus: number }|null,
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

Les plans d'objet (`ItemPlan`, avec `details` et `effects`), d'acteur (`ActorPlan`) et de sorts (`SpellcastingPlan`) sont décrits dans `specs/dnd5e-text-parser/initial/design.md`. Chaque fait porte `raw` (le passage source) et `origin: "rules"|"fallback"`.

## Résolveur de secours (point d'extension)

Un module (par exemple une IA locale) peut proposer des faits pour les phrases non reconnues :

```js
const unregister = api.registerFallback("mon-module", async ({ sentence, context, wanted }, { signal }) => {
  return { facts: { /* partial plan */ }, confidence: 0.8 };   // ou null
}, { priority: 10 });
```

Il n'est appelé que par les fonctions asynchrones `parse*Async` (jamais par `parse*`), uniquement sur les phrases non reconnues ; ses propositions sont validées et marquées `origin: "fallback"`. Ces fonctions arrivent dans une version mineure ultérieure de la 1.x.

## Développement

```
npm install
npm test          # tests unitaires (Vitest)
npm run coverage  # couverture, seuil 90 % sur scripts/parse/** et scripts/dnd5e/**
npm run lint
```

Voir `CLAUDE.md` pour l'architecture et `CHANGELOG.md` pour les changements d'API.
