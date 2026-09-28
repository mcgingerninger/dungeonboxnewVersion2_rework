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

import { rollD20, rollDamage } from '../dice/dice.js';
import { abilityModifier } from '../character/ability-scores.js';

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
 * Standard d20-plus-modifiers vs. AC (the old/original combat system, confirmed with the user
 * over the previous, tiered version this replaces): roll d20 + attack bonus, compare to the
 * target's AC. AC isn't just a pass/fail threshold, though — it acts as a MODIFIER: on an
 * ordinary hit, however far the roll cleared AC (`margin`) is added straight onto damage as a
 * +/- number, instead of snapping into discrete named tiers. A natural 1 always fumbles/misses
 * and a natural 20 always crits (doubles damage dice, the standard rule) regardless of margin,
 * matching 5e. `margin` is always returned on the result — a future effects system (the
 * "maybe imparts effects" half of this mechanic) can key off its exact value without any change
 * here; nothing beyond returning the number is built yet, since that part was explicitly
 * speculative ("maybe") rather than a confirmed requirement.
 *
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
  const isHit = !isFumble && (isCrit || margin >= 0);
  const outcome = isFumble ? 'Fumble' : isCrit ? 'Critical Hit' : isHit ? 'Hit' : 'Miss';

  let damage = null;
  if (isHit) {
    const base = rollDamage(weaponOrAction.damageDice, isCrit, rand);
    const abilityBonus = getDamageBonus(attacker, weaponOrAction);
    // A crit's own dice-doubling is the standard, separate 5e mechanic and isn't ALSO scaled by
    // margin — a natural 20 always hits even against an AC the attacker's bonus alone wouldn't
    // have cleared, where margin would be negative and misleading to add onto crit damage. An
    // ordinary hit's margin is already guaranteed >= 0 by the isHit check above.
    const marginBonus = isCrit ? 0 : margin;
    const total = Math.max(0, (base?.total ?? 0) + marginBonus + abilityBonus);
    damage = { rolls: base?.rolls ?? [], marginBonus, abilityBonus, total };
  }

  return {
    toHitRoll, toHitTotal, margin, outcome,
    isCrit, isFumble, isHit,
    damage, damageType: weaponOrAction.damageType,
  };
}
