# Reference set (PT1)

Hand-annotated truth for M2 (recall) and M3 (precision), shared with `compendium-json-importer` and `item-configurator`.
The annotations were committed BEFORE the first run of the parser (commit order is the proof).

| File | Content | Used by |
|---|---|---|
| `features-real.json` | Every actionable creature ability of `../compendium-json-importer/tools/out/items.json`, by `_id` (`ref`, not copied) | parseFeature |
| `features-synthetic.json` | FR translations of real abilities (`fr-*`) and synthetic EN/FR cases per formulation (`s-en-*`, `s-fr-*`) | parseFeature |
| `objects.json` | Items (weapons, armor, consumables, magic items with effects), EN and FR, 3 real | parseItem, toItemPatch, toEffects |
| `spellcasting.json` | Spellcasting / Innate / Incantation traits | parseSpellcasting |
| `actors.json` | Actor sources with trait lines and legendary text | parseActor |
| `partial.json` | Partially filled objects | mergeMissing |

## Canonical forms (see `tests/support/canon.mjs`)

Feature: `skip`, `activation` ("action", "legendary 2"; legendary without cost == 1), `attack` ("melee/weapon +6", "-" = classification null), `range` ("reach 5", "range 80/320", "reach 5 range 120", feet), `target` ("1 creature", "1 target"), `damage[]` ("1d4+4 bludgeoning", fixed "5 piercing", unknown type "2d6 -"), `save` ("wis 13 half" / "cha 12 none"), `saveDamage[]`, `template` ("cone 15", "line 60x5"), `uses` ("3/day", "1/sr"), `recharge` (min), `legendaryResistance`.

Case options: `ignore` (fields not scored), `onlySkip` (multiattack: only `skip` scored), `expectAmbiguous` (plan.ambiguous must be non-empty).

Object: dotted keys (`rarity`, `attunement`, `attunementCondition`, `weapon.*`, `armor.*`, `consumable.*`, `weight` "6 lb", `price` "50 gp") + `effects[]` ({kind, scope, value}; value ignored for resistance/immunity/advantage, scope ignored for speed).

Scoring: recall = expected facts found / expected facts; precision = produced facts correct / produced facts. Critical errors (attack bonus, damage part, save DC) counted apart.
