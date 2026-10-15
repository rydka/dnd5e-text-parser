// Canonical forms of plans and of the hand-annotated truth, and scoring (M2 recall, M3 precision).
// A "fact" is a token string "field=value"; a plan and an annotation are both reduced to token lists
// and compared as multisets. See tests/fixtures/reference/README.md.

const norm = (s) => String(s ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;

/** Canonical string of a DamagePart: "1d4+4 bludgeoning", "5 piercing", "2d6 -". */
export function canonDamagePart(p, { withType = true } = {}) {
  if ( !p ) return null;
  const dice = (p.number && p.denomination) ? `${p.number}d${p.denomination}` : "";
  let bonus = String(p.bonus ?? "").replace(/\s/g, "");
  if ( bonus === "0" ) bonus = "";
  const formula = dice
    ? dice + (bonus ? (/^-/.test(bonus) ? bonus : `+${bonus.replace(/^\+/, "")}`) : "")
    : bonus.replace(/^\+/, "");
  return withType ? `${formula} ${p.type ?? "-"}` : formula;
}

function abilityOf(a) {
  return Array.isArray(a) ? a[0] : (a instanceof Set ? [...a][0] : a);
}

/** Tokens of a FeaturePlan (or of the "expected" block of a case). Fields: see README. */
export function featureTokens(plan) {
  const t = [];
  if ( plan.skip ) t.push(`skip=${plan.skip}`);
  const a = plan.activation;
  if ( a?.type ) t.push(`activation=${a.type}${a.cost > 1 ? ` ${a.cost}` : ""}`);
  const at = plan.attack;
  if ( at ) t.push(`attack=${at.type ?? "-"}/${at.classification ?? "-"} ${signed(at.bonus)}`);
  const r = plan.range;
  if ( r ) {
    const parts = [];
    if ( r.reach != null ) parts.push(`reach ${r.reach}`);
    if ( r.value != null ) parts.push(`range ${r.value}${r.long != null ? `/${r.long}` : ""}`);
    if ( parts.length ) t.push(`range=${parts.join(" ")}`);
  }
  if ( plan.target ) t.push(`target=${plan.target.count} ${plan.target.type || "target"}`);
  for ( const d of plan.damage ?? [] ) t.push(`damage=${canonDamagePart(d)}`);
  const s = plan.save;
  if ( s ) {
    t.push(`save=${abilityOf(s.ability)} ${s.dc} ${s.onSave}`);
    for ( const d of s.damage ?? [] ) t.push(`saveDamage=${canonDamagePart(d)}`);
  }
  const tp = plan.template;
  if ( tp ) t.push(`template=${tp.type} ${tp.size}${tp.width != null ? `x${tp.width}` : ""}`);
  if ( plan.uses ) t.push(`uses=${plan.uses.max}/${plan.uses.period}`);
  if ( plan.recharge ) t.push(`recharge=${plan.recharge.min}`);
  if ( plan.legendaryResistance != null ) t.push(`legendaryResistance=${plan.legendaryResistance}`);
  // B9: a conditional or alternative result is a second activity: one "variant" token per variant, with its facts
  // (attack, damage with the conditional extra, save and its damage).
  for ( const v of plan.variants ?? [] ) {
    t.push("variant=activity");
    if ( v.attack ) t.push(`variant.attack=${v.attack.type ?? "-"}/${v.attack.classification ?? "-"} ${signed(v.attack.bonus)}`);
    for ( const d of [...(v.damage ?? []), ...(v.extraDamage ? [v.extraDamage] : [])] ) t.push(`variant.damage=${canonDamagePart(d)}`);
    if ( v.save ) {
      t.push(`variant.save=${abilityOf(v.save.ability)} ${v.save.dc} ${v.save.onSave}`);
      for ( const d of v.save.damage ?? [] ) t.push(`variant.saveDamage=${canonDamagePart(d)}`);
    }
  }
  return t;
}

/** Expected tokens of a features case (string-based annotation). */
export function expectedFeatureTokens(c) {
  const e = c.expected ?? {};
  const t = [];
  for ( const [k, v] of Object.entries(e) ) {
    if ( v == null || k === "variants" ) continue;
    if ( Array.isArray(v) ) v.forEach(x => t.push(`${k}=${x}`));
    else t.push(`${k}=${v}`);
  }
  // Variants (B9): { damage[], saveDamage[], attack?, save? }; the attack and the save are those of the main result
  // unless given.
  for ( const v of e.variants ?? [] ) {
    t.push("variant=activity");
    const attack = v.attack ?? e.attack;
    for ( const x of [].concat(attack ?? []) ) t.push(`variant.attack=${x}`);
    (v.damage ?? []).forEach(x => t.push(`variant.damage=${x}`));
    const save = v.save ?? ((v.saveDamage ?? []).length ? e.save : null);
    for ( const x of [].concat(save ?? []) ) t.push(`variant.save=${x}`);
    (v.saveDamage ?? []).forEach(x => t.push(`variant.saveDamage=${x}`));
  }
  return filterTokens(t, c);
}

const FIELD_ALIASES = { damage: ["damage", "saveDamage"] };

/** Remove the ignored fields (and, for onlySkip, everything but skip). */
export function filterTokens(tokens, c) {
  if ( c.onlySkip ) return tokens.filter(x => x.startsWith("skip="));
  const ignored = new Set((c.ignore ?? []).flatMap(f => FIELD_ALIASES[f] ?? [f]));
  // Ignoring a field also ignores it in the variants ("variant.damage" for "damage"); "variant=activity" stays.
  return tokens.filter(x => { const f = x.split("=")[0]; return !ignored.has(f) && !ignored.has(f.replace(/^variant\./, "")); });
}

export function producedFeatureTokens(plan, c) {
  return filterTokens(featureTokens(plan), c);
}

/** Multiset comparison. Returns { expected, produced, correct, missing[], wrong[] }. */
export function compare(expected, produced) {
  const pool = new Map();
  for ( const x of expected ) pool.set(x, (pool.get(x) ?? 0) + 1);
  const wrong = [];
  let correct = 0;
  for ( const x of produced ) {
    const n = pool.get(x) ?? 0;
    if ( n > 0 ) { pool.set(x, n - 1); correct++; } else wrong.push(x);
  }
  const missing = [];
  for ( const [x, n] of pool ) for ( let i = 0; i < n; i++ ) missing.push(x);
  return { expected: expected.length, produced: produced.length, correct, missing, wrong };
}

/** Facts whose error is critical (attack bonus, damage dice, save DC). */
export const isCritical = (token) => /^(variant\.)?(attack|damage|saveDamage|save)=/.test(token);

// ---------------------------------------------------------------- items

const stripPrefix = (s) => norm(s).replace(/^(by|avec|par)\s+/, "");
const num = (v) => (v == null ? null : (typeof v === "number" ? v : Number(String(v).replace(/^\+/, ""))));

/** Canonical effect: "kind|scope|value" with per-kind tolerances. */
export function canonEffect(e) {
  const kind = e.kind;
  let scope = e.scope == null ? "" : norm(e.scope).replace(/^(save|check|saves?|checks?)[:.]/, "");
  let value = e.value == null ? "" : String(num(e.value) ?? e.value);
  if ( ["resistance", "immunity", "advantage"].includes(kind) ) value = "";
  if ( kind === "speed" ) scope = "";
  return `effect=${kind}|${scope}|${value}`;
}

/** Tokens of an ItemPlan: details + effects only. */
export function itemTokens(plan) {
  const t = [];
  const d = plan.details ?? {};
  if ( d.rarity ) t.push(`rarity=${d.rarity}`);
  if ( d.attunement ) t.push(`attunement=${d.attunement}`);
  if ( d.attunementCondition ) t.push(`attunementCondition=${stripPrefix(d.attunementCondition)}`);
  const w = d.weapon;
  if ( w ) {
    if ( w.category ) t.push(`weapon.category=${w.category}`);
    if ( w.baseItem ) t.push(`weapon.baseItem=${w.baseItem}`);
    (w.properties ?? []).forEach(p => t.push(`weapon.properties=${p}`));
    if ( w.base ) t.push(`weapon.base=${canonDamagePart(w.base)}`);
    if ( w.versatile ) t.push(`weapon.versatile=${canonDamagePart(w.versatile, { withType: false })}`);
    if ( w.magicalBonus != null ) t.push(`weapon.magicalBonus=${w.magicalBonus}`);
    if ( w.mastery ) t.push(`weapon.mastery=${w.mastery}`);
  }
  const a = d.armor;
  if ( a ) {
    if ( a.type ) t.push(`armor.type=${a.type}`);
    if ( a.ac != null ) t.push(`armor.ac=${a.ac}`);
    if ( a.dexCap != null ) t.push(`armor.dexCap=${a.dexCap}`);
    if ( a.strength != null ) t.push(`armor.strength=${a.strength}`);
    if ( a.stealthDisadvantage ) t.push("armor.stealthDisadvantage=true");
    if ( a.magicalBonus != null ) t.push(`armor.magicalBonus=${a.magicalBonus}`);
  }
  const c = d.consumable;
  if ( c ) {
    if ( c.type ) t.push(`consumable.type=${c.type}`);
    if ( c.charges ) t.push(`consumable.charges=${c.charges.max}/${c.charges.period}/${String(c.charges.formula ?? "").replace(/\s/g, "")}`.replace(/\/$/, ""));
    if ( c.destroyOnEmpty ) t.push("consumable.destroyOnEmpty=true");
  }
  if ( d.weight ) t.push(`weight=${d.weight.value} ${d.weight.units}`);
  if ( d.price ) t.push(`price=${d.price.value} ${d.price.denomination}`);
  for ( const e of plan.effects ?? [] ) t.push(canonEffect(e));
  return t;
}

export function expectedItemTokens(c) {
  const t = [];
  for ( const [k, v] of Object.entries(c.expected ?? {}) ) {
    if ( v == null || v === false ) continue;
    if ( Array.isArray(v) ) v.forEach(x => t.push(`${k}=${x}`));
    else t.push(`${k}=${k === "attunementCondition" ? stripPrefix(v) : v}`);
  }
  for ( const e of c.effects ?? [] ) t.push(canonEffect(e));
  const ignored = new Set(c.ignore ?? []);
  return t.filter(x => !ignored.has(x.split("=")[0]));
}

export function producedItemTokens(plan, c) {
  const ignored = new Set(c.ignore ?? []);
  return itemTokens(plan).filter(x => !ignored.has(x.split("=")[0]));
}

// ---------------------------------------------------------------- spellcasting

const spellName = (s) => norm(s);

export function spellTokens(plan, c = {}) {
  if ( plan == null ) return ["null"];
  const t = [];
  if ( plan.ability ) t.push(`ability=${plan.ability}`);
  if ( plan.dc != null ) t.push(`dc=${plan.dc}`);
  if ( plan.attack != null ) t.push(`attack=${plan.attack}`);
  if ( plan.casterLevel != null ) t.push(`casterLevel=${plan.casterLevel}`);
  t.push(`innate=${!!plan.innate}`);
  for ( const l of plan.lists ?? [] ) {
    const level = l.mode === "cantrip" ? 0 : (l.level ?? "");
    const head = `${l.mode}|${level}|${l.slots ?? ""}|${l.uses ?? ""}`;
    t.push(`list=${head}`);
    for ( const s of l.spells ?? [] ) t.push(`spell=${head}|${spellName(s)}`);
  }
  const ignored = new Set(c.ignore ?? []);
  return t.filter(x => !ignored.has(x.split("=")[0]));
}

export function expectedSpellTokens(c) {
  const e = c.expected;
  if ( e == null ) return ["null"];
  const plan = { ...e, lists: (e.lists ?? []).map(l => ({ level: null, slots: null, uses: null, ...l })) };
  return spellTokens(plan, c);
}

// ---------------------------------------------------------------- actors

export function actorTokens(plan) {
  const t = [];
  if ( plan.legact != null ) t.push(`legact=${plan.legact}`);
  if ( plan.legres != null ) t.push(`legres=${plan.legres}`);
  for ( const k of ["dr", "di", "dv", "ci"] ) {
    const tr = plan.traits?.[k] ?? {};
    (tr.values ?? []).forEach(v => t.push(`${k}.values=${v}`));
    (tr.bypasses ?? []).forEach(v => t.push(`${k}.bypasses=${v}`));
    (tr.custom ?? []).forEach(v => t.push(`${k}.custom=${norm(v)}`));
  }
  return t;
}

export function expectedActorTokens(c) {
  return actorTokens(c.expected);
}
