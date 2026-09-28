import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rollInt, rollD20, parseDiceNotation, rollDamage } from './dice.js';

// A deterministic fake `rand` that returns a fixed queue of values in order, so tests assert
// exact behavior instead of just "the result is in range" — real distribution sanity is covered
// separately below with Math.random over many trials.
function fakeRand(...values) {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`fakeRand exhausted after ${values.length} calls`);
    return values[i++];
  };
}

describe('rollInt', () => {
  test('rand=0 returns min, rand just under 1 returns max', () => {
    assert.equal(rollInt(1, 20, fakeRand(0)), 1);
    assert.equal(rollInt(1, 20, fakeRand(0.9999999)), 20);
  });

  test('maps a mid-range rand value to the expected integer', () => {
    // rand=0.5 over [1,20]: floor(0.5*20)+1 = 11
    assert.equal(rollInt(1, 20, fakeRand(0.5)), 11);
  });
});

describe('rollD20', () => {
  test('with no advantage/disadvantage, consumes exactly one roll', () => {
    assert.equal(rollD20(undefined, fakeRand(0.5)), 11);
  });

  test('advantage keeps the higher of two rolls', () => {
    assert.equal(rollD20('advantage', fakeRand(0.5, 0.9999999)), 20);
    assert.equal(rollD20('advantage', fakeRand(0.9999999, 0.5)), 20);
  });

  test('disadvantage keeps the lower of two rolls', () => {
    assert.equal(rollD20('disadvantage', fakeRand(0.5, 0)), 1);
    assert.equal(rollD20('disadvantage', fakeRand(0, 0.5)), 1);
  });

  test('a natural 20 under advantage is still a natural 20 (not offset)', () => {
    assert.equal(rollD20('advantage', fakeRand(0.9999999, 0)), 20);
  });

  describe('distribution sanity (real Math.random, many trials)', () => {
    test('plain d20 stays within [1,20] and reaches both bounds over enough trials', () => {
      let min = 21, max = 0, sum = 0;
      const trials = 20000;
      for (let i = 0; i < trials; i++) {
        const r = rollD20();
        assert.ok(r >= 1 && r <= 20, `roll ${r} out of range`);
        min = Math.min(min, r);
        max = Math.max(max, r);
        sum += r;
      }
      assert.equal(min, 1);
      assert.equal(max, 20);
      const avg = sum / trials;
      assert.ok(Math.abs(avg - 10.5) < 0.3, `average ${avg} too far from expected 10.5`);
    });

    test('advantage raises the average roll, disadvantage lowers it', () => {
      const trials = 20000;
      let advSum = 0, disSum = 0;
      for (let i = 0; i < trials; i++) {
        advSum += rollD20('advantage');
        disSum += rollD20('disadvantage');
      }
      const advAvg = advSum / trials;
      const disAvg = disSum / trials;
      // Theoretical: advantage ≈ 13.825, disadvantage ≈ 7.175
      assert.ok(Math.abs(advAvg - 13.825) < 0.3, `advantage average ${advAvg} too far from 13.825`);
      assert.ok(Math.abs(disAvg - 7.175) < 0.3, `disadvantage average ${disAvg} too far from 7.175`);
      assert.ok(advAvg > disAvg);
    });
  });
});

describe('parseDiceNotation', () => {
  test('parses a full NdM+K expression', () => {
    assert.deepEqual(parseDiceNotation('2d6+3'), { count: 2, sides: 6, mod: 3 });
  });

  test('parses a bare NdM with no modifier', () => {
    assert.deepEqual(parseDiceNotation('1d8'), { count: 1, sides: 8, mod: 0 });
  });

  test('parses a negative modifier', () => {
    assert.deepEqual(parseDiceNotation('1d10-1'), { count: 1, sides: 10, mod: -1 });
  });

  test('defaults an omitted leading count to 1', () => {
    assert.deepEqual(parseDiceNotation('d20'), { count: 1, sides: 20, mod: 0 });
  });

  test('tolerates whitespace around the modifier sign', () => {
    assert.deepEqual(parseDiceNotation('2d6 + 3'), { count: 2, sides: 6, mod: 3 });
    assert.deepEqual(parseDiceNotation('2d6 - 1'), { count: 2, sides: 6, mod: -1 });
  });

  test('returns null for garbage input', () => {
    assert.equal(parseDiceNotation('not dice'), null);
    assert.equal(parseDiceNotation(''), null);
    assert.equal(parseDiceNotation('2d'), null);
    assert.equal(parseDiceNotation('d'), null);
  });

  test('returns null for a zero count or zero-sided die', () => {
    assert.equal(parseDiceNotation('0d6'), null);
    assert.equal(parseDiceNotation('1d0'), null);
  });
});

describe('rollDamage', () => {
  test('rolls the exact expected total from a deterministic rand', () => {
    // 2d6+3 with rand values mapping to dice faces 4 and 5 (rollInt(1,6,r): floor(r*6)+1)
    // r=0.5 -> floor(3)+1=4 ; r=0.7 -> floor(4.2)+1=5
    const result = rollDamage('2d6+3', false, fakeRand(0.5, 0.7));
    assert.deepEqual(result.rolls, [4, 5]);
    assert.equal(result.mod, 3);
    assert.equal(result.total, 12);
  });

  test('crit doubles the dice count, not the flat modifier', () => {
    const normal = rollDamage('1d8+2', false, fakeRand(0.5));
    assert.equal(normal.rolls.length, 1);
    assert.equal(normal.mod, 2);

    const crit = rollDamage('1d8+2', true, fakeRand(0.5, 0.5));
    assert.equal(crit.rolls.length, 2, 'crit should roll double the dice');
    assert.equal(crit.mod, 2, 'the flat modifier is added once, not doubled');
    assert.equal(crit.total, crit.rolls[0] + crit.rolls[1] + 2);
  });

  test('returns null for an unparseable dice expression', () => {
    assert.equal(rollDamage('nonsense'), null);
  });
});
