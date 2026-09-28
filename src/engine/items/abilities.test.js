import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { activateAbility } from './abilities.js';

// No item currently has a real abilities[] facet (equip-mode wondrous items — the one place this
// would land — are still deferred), so this is proven against a synthetic item, same pattern
// already used for Phase 3's demo combat and Phase 5's demo-target consumable work.
const wandOfMagicMissile = {
  id: 'wand-stand-in', name: 'Wand (stand-in)', itemType: 'weapon', rarity: 'rare',
  weapon: { damageDice: '1d4', damageType: 'bludgeoning', weaponCategory: 'simple' },
  abilities: [
    { id: 'blast', name: 'Force Blast', kind: 'active_effect',
      effect: { kind: 'damage', damageDice: '2d4', damageType: 'force' },
      uses: { max: 3, recharge: 'dawn' }, usesLeft: 3 },
    { id: 'ward', name: 'Minor Ward', kind: 'active_effect',
      effect: { kind: 'buff', statMods: [{ stat: 'ac', value: 1 }], durationMs: 60000 },
      uses: { max: 1, recharge: 'long_rest' }, usesLeft: 0 },
  ],
};

describe('activateAbility', () => {
  test('resolves a damage effect via the same engine resolveConsumableEffect uses, and decrements usesLeft', () => {
    const target = { currentHp: 10 };
    const { result, usesLeft, exhausted } = activateAbility(wandOfMagicMissile, 0, target, () => 0.5);
    assert.equal(result.kind, 'damage');
    assert.equal(result.damageType, 'force');
    assert.ok(result.newCurrentHp < 10);
    assert.equal(usesLeft, 2);
    assert.equal(exhausted, false);
  });

  test('usesLeft never drops below 0, and reports exhausted', () => {
    const { usesLeft, exhausted } = activateAbility(wandOfMagicMissile, 1, { currentHp: 10 }, () => 0.5);
    assert.equal(usesLeft, 0);
    assert.equal(exhausted, true);
  });

  test('throws for an out-of-range ability index rather than silently no-op', () => {
    assert.throws(() => activateAbility(wandOfMagicMissile, 5, { currentHp: 10 }));
  });

  test('a buff effect reports statMods/durationMs, same shape resolveConsumableEffect already gives a consumable buff', () => {
    const item = { ...wandOfMagicMissile, abilities: [{ ...wandOfMagicMissile.abilities[1], usesLeft: 1 }] };
    const { result } = activateAbility(item, 0, { currentHp: 10 });
    assert.equal(result.kind, 'buff');
    assert.deepEqual(result.statMods, [{ stat: 'ac', value: 1 }]);
    assert.equal(result.durationMs, 60000);
  });
});
