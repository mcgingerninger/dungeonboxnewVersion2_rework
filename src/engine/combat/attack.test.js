import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack, getAttackBonus, getDamageBonus, UNARMED_STRIKE_ACTION } from './attack.js';

function fakeRand(...values) {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`fakeRand exhausted after ${values.length} calls`);
    return values[i++];
  };
}
// rollInt(1, N, r) = floor(r*N) + 1. For a d20, r=0.9 -> floor(18)+1 = 19; r=0.0 -> 1; r just
// under 1 -> 20. These helpers convert a desired face into the rand value that produces it.
const d20For = face => (face - 1) / 20 + 0.0001;
const d6For = face => (face - 1) / 6 + 0.0001;

describe('getAttackBonus', () => {
  test('uses a flat toHitBonus verbatim when present, ignoring the attacker entirely', () => {
    assert.equal(getAttackBonus({}, { toHitBonus: 9 }), 9);
  });
  test('otherwise derives from the action ability modifier plus proficiency bonus', () => {
    const attacker = { abilityScores: { str: 16 }, proficiencyBonus: 3 };
    assert.equal(getAttackBonus(attacker, { attackAbility: 'str' }), 3 + 3); // strMod(16)=3
  });
  test('proficient:false omits the proficiency bonus', () => {
    const attacker = { abilityScores: { str: 16 }, proficiencyBonus: 3 };
    assert.equal(getAttackBonus(attacker, { attackAbility: 'str', proficient: false }), 3);
  });
  test('defaults to STR when no attackAbility is given', () => {
    const attacker = { abilityScores: { str: 14, dex: 10 }, proficiencyBonus: 2 };
    assert.equal(getAttackBonus(attacker, {}), 2 + 2);
  });
  test('prefers precomputed abilityModifiers over raw abilityScores when both are present', () => {
    const attacker = { abilityScores: { str: 10 }, abilityModifiers: { str: 5 }, proficiencyBonus: 0 };
    assert.equal(getAttackBonus(attacker, { attackAbility: 'str' }), 5);
  });
});

describe('getDamageBonus', () => {
  test('uses a flat damageBonus verbatim when present', () => {
    assert.equal(getDamageBonus({}, { damageBonus: 4 }), 4);
  });
  test('otherwise derives from the action ability modifier', () => {
    const attacker = { abilityScores: { str: 12 } };
    assert.equal(getDamageBonus(attacker, { attackAbility: 'str' }), 1); // strMod(12)=1
  });
});

describe('resolveAttack (standard d20+mods vs. AC, AC acts as a damage modifier via margin)', () => {
  test('a natural 1 is always a fumble/miss, regardless of bonuses or target AC', () => {
    const result = resolveAttack({
      attacker: {}, target: { ac: 1 },
      weaponOrAction: { damageDice: '1d6', toHitBonus: 50 },
    }, fakeRand(d20For(1)));
    assert.equal(result.toHitRoll, 1);
    assert.equal(result.isFumble, true);
    assert.equal(result.isHit, false);
    assert.equal(result.damage, null);
    assert.equal(result.outcome, 'Fumble');
  });

  test('a natural 20 always hits and crits (doubled dice), regardless of margin', () => {
    const result = resolveAttack({
      attacker: {}, target: { ac: 999 },
      weaponOrAction: { damageDice: '1d6', toHitBonus: 0, damageBonus: 0 },
    }, fakeRand(
      d20For(20),
      d6For(3), d6For(3), // base damage doubled for crit: 2 dice
    ));
    assert.equal(result.isCrit, true);
    assert.equal(result.isHit, true);
    assert.equal(result.outcome, 'Critical Hit');
    // margin is deeply negative here (20+0-999), but a crit's damage isn't scaled by margin.
    assert.equal(result.damage.marginBonus, 0);
    assert.deepEqual(result.damage.rolls, [3, 3]);
    assert.equal(result.damage.total, 6);
  });

  test('an ordinary hit adds the exact margin (how far the roll cleared AC) onto damage', () => {
    const result = resolveAttack({
      attacker: {}, target: { ac: 10 },
      weaponOrAction: { damageDice: '1d6', toHitBonus: 10, damageBonus: 3 },
    }, fakeRand(
      d20For(19), // toHitTotal = 19+10 = 29, margin = 29-10 = 19
      d6For(4),   // base damage
    ));
    assert.equal(result.isCrit, false);
    assert.equal(result.margin, 19);
    assert.equal(result.outcome, 'Hit');
    assert.deepEqual(result.damage.rolls, [4]);
    assert.equal(result.damage.marginBonus, 19);
    assert.equal(result.damage.total, 4 + 19 + 3); // base + margin + damageBonus
  });

  test('a bare-minimum hit (margin 0) adds no bonus and no penalty', () => {
    const result = resolveAttack({
      attacker: {}, target: { ac: 15 },
      weaponOrAction: { damageDice: '1d6', toHitBonus: 5, damageBonus: 0 },
    }, fakeRand(
      d20For(10), // toHitTotal = 10+5 = 15, margin = 15-15 = 0
      d6For(4),
    ));
    assert.equal(result.margin, 0);
    assert.equal(result.outcome, 'Hit');
    assert.equal(result.damage.marginBonus, 0);
    assert.equal(result.damage.total, 4);
  });

  test('damage never goes below 0 even with a large negative damageBonus', () => {
    const result = resolveAttack({
      attacker: {}, target: { ac: 10 },
      weaponOrAction: { damageDice: '1d4', toHitBonus: 5, damageBonus: -10 },
    }, fakeRand(d20For(6), d6For(1))); // margin = 11-10 = 1
    assert.equal(result.damage.total, 0);
  });

  test('a negative margin (non-crit, non-fumble) is a miss with no damage rolled', () => {
    const result = resolveAttack({
      attacker: {}, target: { ac: 15 },
      weaponOrAction: { damageDice: '1d6', toHitBonus: 0 },
    }, fakeRand(d20For(10))); // toHitTotal=10, margin=-5
    assert.equal(result.isHit, false);
    assert.equal(result.outcome, 'Miss');
    assert.equal(result.damage, null);
  });

  test('advantage is passed through to the underlying d20 roll', () => {
    const result = resolveAttack({
      attacker: {}, target: { ac: 100 },
      weaponOrAction: { damageDice: '1d6', toHitBonus: 0 },
      advantage: 'advantage',
    }, fakeRand(d20For(5), d20For(15))); // keeps the higher of the two: 15
    assert.equal(result.toHitRoll, 15);
  });

  test('works identically for a PC-shaped attacker and a monster-shaped (flat-bonus) attacker', () => {
    const pcAttacker = { abilityScores: { str: 14 }, proficiencyBonus: 2 }; // +2 str mod +2 prof = 4
    const monsterAction = { damageDice: '1d6', toHitBonus: 4, damageBonus: 2 }; // same net +4 to hit
    const pcResult = resolveAttack({ attacker: pcAttacker, target: { ac: 10 }, weaponOrAction: UNARMED_STRIKE_ACTION }, fakeRand(d20For(10), d6For(3)));
    const monsterResult = resolveAttack({ attacker: {}, target: { ac: 10 }, weaponOrAction: monsterAction }, fakeRand(d20For(10), d6For(3)));
    assert.equal(pcResult.toHitTotal, monsterResult.toHitTotal);
    assert.equal(pcResult.margin, monsterResult.margin);
    assert.equal(pcResult.outcome, monsterResult.outcome);
  });

  describe('integration sanity (real Math.random, many trials)', () => {
    test('isHit is always exactly consistent with whether damage was rolled, damage is never negative', () => {
      for (let i = 0; i < 2000; i++) {
        const result = resolveAttack({
          attacker: { abilityScores: { str: 10 + (i % 10) }, proficiencyBonus: 2 },
          target: { ac: 8 + (i % 15) },
          weaponOrAction: UNARMED_STRIKE_ACTION,
        });
        assert.equal(result.isHit, result.damage !== null);
        if (result.damage) assert.ok(result.damage.total >= 0);
        assert.ok(['Fumble', 'Miss', 'Hit', 'Critical Hit'].includes(result.outcome));
      }
    });
  });
});
