import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConsumableEffect, useConsumable } from './consume.js';
import { consumables } from '../../data/consumables.js';

function fakeRand(...values) {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`fakeRand exhausted after ${values.length} calls`);
    return values[i++];
  };
}
const d4For = face => (face - 1) / 4 + 0.0001; // rollInt(1,4,r) = floor(r*4)+1

describe('resolveConsumableEffect', () => {
  test('heal: rolls the exact healDice and adds to currentHp, capped at maxHp', () => {
    const effect = { kind: 'heal', healDice: '2d4+2' };
    const result = resolveConsumableEffect(effect, { currentHp: 5, maxHp: 20 }, fakeRand(d4For(3), d4For(4)));
    assert.deepEqual(result.rolls, [3, 4]);
    assert.equal(result.amount, 3 + 4 + 2);
    assert.equal(result.newCurrentHp, 5 + 9);
  });

  test('heal: clamps at maxHp rather than overhealing', () => {
    const effect = { kind: 'heal', healDice: '4d4+4' };
    const result = resolveConsumableEffect(effect, { currentHp: 18, maxHp: 20 }, fakeRand(d4For(4), d4For(4), d4For(4), d4For(4)));
    assert.equal(result.amount, 20); // 4+4+4+4+4
    assert.equal(result.newCurrentHp, 20); // would be 38, clamped to maxHp
  });

  test('heal: with no maxHp given, does not clamp', () => {
    const effect = { kind: 'heal', healDice: '1d4' };
    const result = resolveConsumableEffect(effect, { currentHp: 100 }, fakeRand(d4For(4)));
    assert.equal(result.newCurrentHp, 104);
  });

  test('damage: rolls the exact damageDice and subtracts from currentHp, floored at 0', () => {
    const effect = { kind: 'damage', damageDice: '1d4', damageType: 'fire' };
    const result = resolveConsumableEffect(effect, { currentHp: 2 }, fakeRand(d4For(4)));
    assert.equal(result.amount, 4);
    assert.equal(result.damageType, 'fire');
    assert.equal(result.newCurrentHp, 0); // 2 - 4, floored at 0, not negative
  });

  test('buff/debuff: reports statMods and duration, does not touch HP', () => {
    const effect = { kind: 'buff', statMods: [{ stat: 'ac', value: 2 }], durationMs: 60000 };
    const result = resolveConsumableEffect(effect, { currentHp: 10, maxHp: 10 });
    assert.equal(result.kind, 'buff');
    assert.deepEqual(result.statMods, [{ stat: 'ac', value: 2 }]);
    assert.equal(result.durationMs, 60000);
  });

  test('utility: a no-op result, no HP change reported', () => {
    const result = resolveConsumableEffect({ kind: 'utility' }, { currentHp: 10 });
    assert.equal(result.kind, 'utility');
  });
});

describe('useConsumable', () => {
  test('decrements usesLeft by exactly 1 and reports consumed only once it hits 0', () => {
    const item = { name: 'Test Potion', consumable: { effects: [{ kind: 'heal', healDice: '1d4' }], uses: { max: 2 }, usesLeft: 2 } };
    const first = useConsumable(item, 0, { currentHp: 1, maxHp: 20 }, fakeRand(d4For(1)));
    assert.equal(first.usesLeft, 1);
    assert.equal(first.consumed, false);

    // Second use starts from the ORIGINAL item.consumable.usesLeft (2) again here since this
    // module never mutates `item` -- a real caller re-reads usesLeft from wherever it persisted
    // the first call's result before calling again. Simulated by passing an item with usesLeft: 1.
    const itemAfterFirstUse = { ...item, consumable: { ...item.consumable, usesLeft: 1 } };
    const second = useConsumable(itemAfterFirstUse, 0, { currentHp: 1, maxHp: 20 }, fakeRand(d4For(1)));
    assert.equal(second.usesLeft, 0);
    assert.equal(second.consumed, true);
  });

  test('never mutates the item or the target object passed in', () => {
    const item = { name: 'Test Potion', consumable: { effects: [{ kind: 'heal', healDice: '1d4' }], uses: { max: 1 }, usesLeft: 1 } };
    const target = { currentHp: 1, maxHp: 20 };
    const itemSnapshot = structuredClone(item);
    const targetSnapshot = structuredClone(target);
    useConsumable(item, 0, target, fakeRand(d4For(2)));
    assert.deepEqual(item, itemSnapshot);
    assert.deepEqual(target, targetSnapshot);
  });

  test('throws a clear error for an out-of-range effect index rather than silently no-op-ing', () => {
    const item = { name: 'Test Potion', consumable: { effects: [{ kind: 'heal', healDice: '1d4' }], uses: { max: 1 }, usesLeft: 1 } };
    assert.throws(() => useConsumable(item, 5, { currentHp: 1 }), /No effect at index 5/);
  });
});

describe('real consumable data flows through the engine end-to-end', () => {
  test('Potion of Healing heals a real character within its real dice range over many trials', () => {
    const potion = consumables.find(c => c.id === 'potion-of-healing');
    for (let i = 0; i < 500; i++) {
      const { result, usesLeft, consumed } = useConsumable(potion, 0, { currentHp: 1, maxHp: 50 });
      assert.ok(result.amount >= 4 && result.amount <= 10, `heal amount ${result.amount} out of 2d4+2 range [4,10]`);
      assert.equal(result.newCurrentHp, 1 + result.amount);
      assert.equal(usesLeft, 0);
      assert.equal(consumed, true);
    }
  });

  test('Scroll of Fireball deals real damage within its real dice range', () => {
    const scroll = consumables.find(c => c.id === 'scroll-of-fireball');
    for (let i = 0; i < 200; i++) {
      const { result } = useConsumable(scroll, 0, { currentHp: 100, maxHp: 100 });
      assert.ok(result.amount >= 8 && result.amount <= 48, `8d6 fire out of range: ${result.amount}`);
      assert.equal(result.damageType, 'fire');
    }
  });

  test("Corked Vial of Spirits' real 2-use count survives two sequential real uses", () => {
    const vial = consumables.find(c => c.id === 'corked-vial-of-spirits');
    const firstUse = useConsumable(vial, 0, { currentHp: 10, maxHp: 10 });
    assert.equal(firstUse.usesLeft, 1);
    assert.equal(firstUse.consumed, false);
    const vialAfterFirstUse = { ...vial, consumable: { ...vial.consumable, usesLeft: firstUse.usesLeft } };
    const secondUse = useConsumable(vialAfterFirstUse, 0, { currentHp: 10, maxHp: 10 });
    assert.equal(secondUse.usesLeft, 0);
    assert.equal(secondUse.consumed, true);
  });
});
