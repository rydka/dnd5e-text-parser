# Changelog

## 1.0.0-dev

- Généralisation après mesure sur jeu de contrôle : type de dégâts avant « plus » / « and » sans le mot « damage » (« 12 (2d6 + 5) piercing plus 10 (3d6) cold damage ») ; jet de sauvegarde au format 2024 (« Dexterity Saving Throw: DC 11 », « Jet de sauvegarde de Dextérité : DD 11 », « moitié des dégâts ») ; zones (« 60-foot-long, 5-foot-wide Line », « cône de … de 4,50 m », lignes longueur/largeur dans les deux ordres) ; unité « pieds » en français (allonge, portée, zones) ; bonus de CA d'armure (« +2 bonus to Armor Class », « bonus to AC of +2 », bonus lu dans le nom « Shield +2 ») rangé en `armor.magicalBonus` ; « Your Intelligence is 19 » sans « score » (EN et FR) ; dégâts continus d'une phrase de suite ajoutés aux dégâts de l'attaque ; FR « dégâts de feu supplémentaires » = dégâts en plus de l'attaque ; FR « Vous récupérez … points de vie » ; immunités à un état (« immune to being charmed / to disease », « immunisé contre la peur ») ; « advantage on saving throws against … » lu dans `effect.against` (ignoré par `toEffects`, note `EffectSkipped`) ; charges d'un équipement non consommable dans `details.charges` (champs optionnels ajoutés, descripteur `Describe.Charges`, `system.uses`).
- Objets : `parseItem` (reconnaisseurs `item-meta`, `weapon`, `armor`, `consumable`, `magic-effects`, activités d'objet), `ItemPlan` avec `details`, `effects` et `activities` (plusieurs activités par objet, soin, lancement de sort, consommation de charges, dégâts supplémentaires, effets temporaires `onUse`), `toEffects` (effets actifs v14), `toActivities` pour les activités `heal` et `cast` (`resolveSpell`), `autoDestroy` dans `toItemPatch`.
- Secours : `parseFeatureAsync`, `parseItemAsync`, `validateFallbackFacts`, `resolveMany`, délai global, `plan.fallback.status`.
- `describe` : `group`, `raw`, `origin`, `paths` sur chaque descripteur. `keysSnapshot` (clés valides sérialisables).
- Corrections : aucune attaque inventée sans en-tête (« adds 3 to its AC »), article « une créature » non compté comme cible, résistance légendaire jamais rangée en action légendaire, `raw` dans les remarques d'ambiguïté, contournements des dégâts physiques dans les unions de traits, caractéristique d'incantation innée (FR), consommation des usages une seule fois par capacité.
- Tous les textes de remarques (`Note.*`) sont traduits en et fr ; une seule table mots -> clés (`scripts/parse/lexicon/`).

- Bibliothèque : `API_VERSION` 1.0.0, `SCHEMA_VERSION` 1.
- Traduction : `toActivities`, `toItemPatch`, `toDamagePart` ; fusion `mergeMissing`, `isEmpty`, `isEmptyUtility` ; `keysFromConfig` ; `describe` ; registre `registerFallback` / `getFallback`.
- Exposition : import ES (`scripts/index.mjs`, champ `exports` de `package.json`) et `game.modules.get("dnd5e-text-parser").api` (gelée).
- Retrait du modèle : réglage `enabled`, `main.mjs`, feuille de style.
