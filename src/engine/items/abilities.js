// Activates one of an item's Ability entries (the weapon/armor `abilities[]` facet — activatable,
// charge-gated effects, e.g. a wand's daily blast or a ring's once-per-day buff). Reuses consume.js's
// resolveConsumableEffect for the actual effect resolution rather than duplicating it — an
// Ability's `effect` field is the exact same OnUseEffect shape a consumable's effect already is;
// the only real differences are where the charge count lives (ability.uses/usesLeft vs.
// item.consumable.uses/usesLeft) and that an ability's uses carry a `recharge` kind (short_rest/
// long_rest/dawn/charges) instead of just running out for good. No rest/time-passage system exists
// yet, so recharge isn't enforced here — usesLeft only ever goes down, same simple model
// useConsumable already has; wiring recharge back in is a future state-persistence question, not
// an engine-math one.

import { resolveConsumableEffect } from './consume.js';

/**
 * @param {import('./item-schema.js').Item} item
 * @param {number} abilityIndex
 * @param {{currentHp: number, maxHp?: number}} target
 * @param {Function} [rand]
 */
export function activateAbility(item, abilityIndex, target, rand = Math.random) {
  const ability = item.abilities?.[abilityIndex];
  if (!ability) throw new Error(`No ability at index ${abilityIndex} on "${item.name}"`);
  const result = resolveConsumableEffect(ability.effect, target, rand);
  const currentUsesLeft = ability.usesLeft ?? ability.uses.max;
  const usesLeft = Math.max(0, currentUsesLeft - 1);
  return { result, usesLeft, exhausted: usesLeft <= 0 };
}
