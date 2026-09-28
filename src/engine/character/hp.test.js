import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeMaxHp } from './hp.js';

describe('computeMaxHp', () => {
  test('level 1 is the die\'s max face plus CON modifier', () => {
    assert.equal(computeMaxHp(1, 8, 2), 10);   // d8 + 2
    assert.equal(computeMaxHp(1, 12, 0), 12);  // d12 + 0
  });

  test('each level after 1 adds the average die roll (rounded up) plus CON modifier', () => {
    // d8, CON +2, level 3: 10 (lvl1) + (4+1+2) (lvl2) + (4+1+2) (lvl3) = 10+7+7 = 24
    assert.equal(computeMaxHp(3, 8, 2), 24);
  });

  test('a d10 fighter-style progression at level 5, CON +1', () => {
    // lvl1: 10+1=11 ; lvl2-5 each: floor(10/2)+1+1 = 7 ; total = 11 + 7*4 = 39
    assert.equal(computeMaxHp(5, 10, 1), 39);
  });

  test('never returns less than 1, even with a very negative CON modifier', () => {
    assert.ok(computeMaxHp(1, 6, -5) >= 1);
  });

  test('level 0 or missing hit die size returns 0', () => {
    assert.equal(computeMaxHp(0, 8, 2), 0);
    assert.equal(computeMaxHp(1, 0, 2), 0);
  });
});
