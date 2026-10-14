/**
 * Neutral descriptors `{ key, data }` of a plan or of a list of changes, for summaries and previews.
 * `key` is a localization key of this module (`lang/*.json`); the consumer localizes it with `data`.
 * Pure: no Foundry global.
 */

const PREFIX = "dnd5e-text-parser.";

/** Every key `describe` can emit (all exist in `lang/en.json` and `lang/fr.json`). */
export const DESCRIBE_KEYS = Object.freeze([
  "Describe.Attack", "Describe.Range", "Describe.Target", "Describe.Damage", "Describe.Save", "Describe.Template",
  "Describe.Uses", "Describe.Recharge", "Describe.LegendaryResistance", "Describe.Activation", "Describe.Skipped",
  "Describe.Weapon", "Describe.Armor", "Describe.Consumable", "Describe.Rarity", "Describe.Attunement",
  "Describe.Weight", "Describe.Price", "Describe.Effect", "Describe.Field", "Describe.Fallback",
  "Note.Unrecognized"
].map(key => PREFIX + key));

/**
 * Build a descriptor; a fact proposed by the fallback resolver is flagged with `data.origin = "fallback"`.
 * @param {string} name
 * @param {object} data
 * @param {object} [fact]
 * @returns {{key: string, data: object}}
 */
function entry(name, data, fact) {
  const descriptor = { key: `${PREFIX}Describe.${name}`, data };
  if ( fact?.origin === "fallback" ) descriptor.data = { ...data, origin: "fallback" };
  return descriptor;
}

/**
 * Readable formula of a damage part.
 * @param {object} part
 * @returns {string}
 */
export function formulaOf(part) {
  const dice = (part.number && part.denomination) ? `${part.number}d${part.denomination}` : "";
  const bonus = String(part.bonus ?? "");
  if ( !dice ) return bonus;
  if ( !bonus ) return dice;
  return /^[+-]/.test(bonus) ? `${dice} ${bonus[0]} ${bonus.slice(1).trim()}` : `${dice} + ${bonus}`;
}

const damageEntry = (part, save) => entry("Damage", {
  formula: formulaOf(part), type: part.type ?? "", raw: part.raw ?? "", save
}, part);

/**
 * Describe a plan (FeaturePlan / ItemPlan) or a list of changes (`mergeMissing` result).
 * Notes and ambiguities of the plan are passed through as they are; unrecognized sentences become
 * `dnd5e-text-parser.Note.Unrecognized`.
 * @param {object|{path: string, value: *}[]} planOrChanges
 * @returns {{key: string, data: object}[]}
 */
export function describe(planOrChanges) {
  if ( Array.isArray(planOrChanges) ) {
    return planOrChanges.map(({ path, value }) => entry("Field", { path, value }));
  }
  const plan = planOrChanges;
  const result = [];
  if ( !plan ) return result;
  if ( plan.skip ) result.push(entry("Skipped", { reason: plan.skip }));
  if ( plan.activation ) {
    result.push(entry("Activation", { type: plan.activation.type, cost: plan.activation.cost }, plan.activation));
  }
  if ( plan.attack ) {
    result.push(entry("Attack", {
      type: plan.attack.type, classification: plan.attack.classification, bonus: plan.attack.bonus
    }, plan.attack));
  }
  if ( plan.range ) result.push(entry("Range", { ...plan.range }, plan.range));
  if ( plan.target ) result.push(entry("Target", { count: plan.target.count, type: plan.target.type }, plan.target));
  for ( const part of plan.damage ?? [] ) result.push(damageEntry(part, false));
  if ( plan.save ) {
    result.push(entry("Save", { ability: plan.save.ability, dc: plan.save.dc, onSave: plan.save.onSave }, plan.save));
    for ( const part of plan.save.damage ?? [] ) result.push(damageEntry(part, true));
  }
  if ( plan.template ) result.push(entry("Template", { ...plan.template }, plan.template));
  if ( plan.uses ) result.push(entry("Uses", { max: plan.uses.max, period: plan.uses.period }, plan.uses));
  if ( plan.recharge ) result.push(entry("Recharge", { min: plan.recharge.min }, plan.recharge));
  if ( plan.legendaryResistance ) result.push(entry("LegendaryResistance", { count: plan.legendaryResistance }));
  const details = plan.details ?? {};
  if ( details.weapon ) {
    const w = details.weapon;
    result.push(entry("Weapon", {
      category: w.category, baseItem: w.baseItem, properties: [...(w.properties ?? [])],
      base: w.base ? formulaOf(w.base) : "", versatile: w.versatile ? formulaOf(w.versatile) : "",
      magicalBonus: w.magicalBonus, mastery: w.mastery
    }, w));
  }
  if ( details.armor ) result.push(entry("Armor", { ...details.armor }, details.armor));
  if ( details.consumable ) {
    result.push(entry("Consumable", {
      type: details.consumable.type, charges: details.consumable.charges?.max ?? null
    }, details.consumable));
  }
  if ( details.rarity ) result.push(entry("Rarity", { rarity: details.rarity }));
  if ( details.attunement ) {
    result.push(entry("Attunement", { attunement: details.attunement, condition: details.attunementCondition ?? "" }));
  }
  if ( details.weight ) result.push(entry("Weight", { ...details.weight }));
  if ( details.price ) result.push(entry("Price", { ...details.price }));
  for ( const effect of plan.effects ?? [] ) {
    result.push(entry("Effect", { kind: effect.kind, value: effect.value, scope: effect.scope }, effect));
  }
  result.push(...(plan.notes ?? []), ...(plan.ambiguous ?? []));
  for ( const sentence of plan.unrecognized ?? [] ) {
    result.push({ key: `${PREFIX}Note.Unrecognized`, data: { text: sentence.text } });
  }
  return result;
}
