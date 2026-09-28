// A single, unified attack-resolution pipeline — used identically whether a player attacks a
// monster, a monster attacks a player, or monster-vs-monster. Replaces the old app's three
// disconnected attack code paths (DM-rolls-monster, player-rolls-own-weapon as a standalone
// calculator that never touched HP, and a third path through a DM-review attack-request queue),
// each of which reimplemented to-hit/damage math slightly differently.
//
// No item system exists yet (that's Phase 4+), so `weaponOrAction` is either the built-in
// UNARMED_STRIKE_ACTION below or a monster-action-shaped object with the same fields
// (damageDice, damageType, and either attackAbility+proficient or a flat toHitBonus/damageBonus
// straight off a stat block) — real weapons plug into the same shape once items exist.

import { rollD20, rollDamage, rollInt, parseDiceNotation } from '../dice/dice.js';
import { abilityModifier } from '../character/ability-scores.js';

// Revives the old app's battleEffectivenessLabel concept (Devastating/Strong/Moderate/Weak/
// Critical-Failure tiers) but fixes its core flaw: that label graded the raw d20 alone,
// completely ignoring the target's AC. Here the tier is driven by `margin` — how far the total
// roll (d20 + modifiers) actually clears or misses the target's AC — so it's a real function of
// dice, modifiers, and AC together, and drives a concrete damage modifier rather than being a
// cosmetic label. Thresholds/modifiers are a first-pass tuning (confirmed as a "starting draft,
// tune later" in the rebuild plan) — easy to adjust here without touching resolveAttack itself.
export const EFFECT_TIERS = [
  { min: 15, label: 'Devastating Hit', bonusDice: 2, flatMod: 0 },
  { min: 10, label: 'Strong Hit', bonusDice: 1, flatMod: 0 },
  { min: 5, label: 'Solid Hit', bonusDice: 0, flatMod: 0 },
  { min: 0, label: 'Weak Hit', bonusDice: 0, flatMod: -2 },
  { min: -Infinity, label: 'Miss', bonusDice: 0, flatMod: 0 },
];

// Matches this project's own prior "1d6 + STR" unarmed strike convention (see the old app's
// rollUnarmedAttack button tooltip) rather than strict RAW 5e's flat 1 + STR — kept for
// continuity since this is a house convention, not a rules-accuracy question.
export const UNARMED_STRIKE_ACTION = {
  name: 'Unarmed Strike',
  damageDice: '1d6',
  damageType: 'bludgeoning',
  attackAbility: 'str',
};

function getAbilityModifierFor(entity, abbr) {
  if (entity.abilityModifiers) return entity.abilityModifiers[abbr] ?? 0;
  return abilityModifier(entity.abilityScores?.[abbr] ?? 10);
}

// weaponOrAction.toHitBonus, present, is used as-is — a monster stat block's flat "+9 to hit" —
// bypassing ability-score math entirely, so Phase 3 can resolve monster attacks without yet
// modeling a full monster ability-score sheet (that's Phase 7.2's job, when NPCs/monsters get
// re-added). A PC-like attacker instead derives its bonus from the action's attackAbility
// (defaults to 'str') plus proficiency, unless the action explicitly opts out via
// `proficient: false` (everyone is always proficient with an unarmed strike, matching 5e).
export function getAttackBonus(attacker, weaponOrAction) {
  if (weaponOrAction.toHitBonus != null) return weaponOrAction.toHitBonus;
  const abbr = weaponOrAction.attackAbility || 'str';
  const abilityMod = getAbilityModifierFor(attacker, abbr);
  const prof = weaponOrAction.proficient === false ? 0 : (attacker.proficiencyBonus ?? 2);
  return abilityMod + prof;
}

export function getDamageBonus(attacker, weaponOrAction) {
  if (weaponOrAction.damageBonus != null) return weaponOrAction.damageBonus;
  const abbr = weaponOrAction.attackAbility || 'str';
  return getAbilityModifierFor(attacker, abbr);
}

/**
 * @param {Object} params
 * @param {Object} params.attacker  // {abilityScores|abilityModifiers, proficiencyBonus}
 * @param {Object} params.target    // {ac}
 * @param {Object} params.weaponOrAction  // {damageDice, damageType, attackAbility?, proficient?, toHitBonus?, damageBonus?}
 * @param {'advantage'|'disadvantage'|undefined} [params.advantage]
 * @param {Function} [rand]  // injectable random source, defaults to Math.random
 */
export function resolveAttack({ attacker, target, weaponOrAction, advantage }, rand = Math.random) {
  const toHitRoll = rollD20(advantage, rand);
  const isFumble = toHitRoll === 1;
  const isCrit = toHitRoll === 20;
  const toHitTotal = toHitRoll + getAttackBonus(attacker, weaponOrAction);
  const margin = toHitTotal - target.ac;

  // A fumble always misses regardless of margin; a crit always hits and always grades as the top
  // tier, regardless of margin — matching 5e's "a nat 20 always hits" rule.
  const tier = isFumble ? EFFECT_TIERS[EFFECT_TIERS.length - 1]
    : isCrit ? EFFECT_TIERS[0]
    : EFFECT_TIERS.find(t => margin >= t.min);
  const isHit = !isFumble && (isCrit || margin >= 0);

  let damage = null;
  if (isHit) {
    const parsed = parseDiceNotation(weaponOrAction.damageDice);
    const base = rollDamage(weaponOrAction.damageDice, isCrit, rand);
    const bonusRolls = [];
    if (parsed) for (let i = 0; i < tier.bonusDice; i++) bonusRolls.push(rollInt(1, parsed.sides, rand));
    const abilityBonus = getDamageBonus(attacker, weaponOrAction);
    const total = Math.max(0, (base?.total ?? 0) + bonusRolls.reduce((a, b) => a + b, 0) + tier.flatMod + abilityBonus);
    damage = { rolls: [...(base?.rolls ?? []), ...bonusRolls], abilityBonus, tierFlatMod: tier.flatMod, total };
  }

  return {
    toHitRoll, toHitTotal, margin, tier: tier.label,
    isCrit, isFumble, isHit,
    damage, damageType: weaponOrAction.damageType,
  };
}
