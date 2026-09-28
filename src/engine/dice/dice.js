// Pure, dependency-free dice primitives — no DOM, no character/item knowledge. Every function
// takes an injectable `rand` source (defaulting to Math.random) so tests can drive exact outcomes
// instead of asserting only on statistical distribution. Same shape as the old game-engine.js's
// `rn`/`battleRollDamage` (rand as the last param, defaulting the same way) — that part of the
// old engine was never the problem (see the rebuild plan's audit notes); this module keeps that
// convention rather than inventing a new one.

// Inclusive random integer in [min, max].
export function rollInt(min, max, rand = Math.random) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

// A single d20, honoring advantage/disadvantage by rolling twice and keeping the higher/lower
// result — the returned value IS the "natural" roll a caller checks for a nat-20/nat-1, exactly
// as 5e defines it (advantage doesn't change what counts as a natural 20, it just changes which
// of two independent dice you keep).
export function rollD20(advantage, rand = Math.random) {
  const first = rollInt(1, 20, rand);
  if (advantage !== 'advantage' && advantage !== 'disadvantage') return first;
  const second = rollInt(1, 20, rand);
  return advantage === 'advantage' ? Math.max(first, second) : Math.min(first, second);
}

// Parses standard 'NdM', 'NdM+K', 'NdM-K' notation (leading count optional, defaults to 1, e.g.
// 'd8' == '1d8'; whitespace around the modifier sign tolerated, e.g. '2d6 + 3'). Returns null for
// anything unparseable rather than throwing — matches the old battleRollDamage's convention, so a
// caller (e.g. item-schema validation in a later phase) decides what an invalid value means
// instead of this module deciding for them.
const DICE_RE = /^(\d*)d(\d+)\s*([+-]\s*\d+)?$/i;

export function parseDiceNotation(expr) {
  const m = DICE_RE.exec(String(expr).trim());
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  const sides = Number(m[2]);
  const mod = m[3] ? Number(m[3].replace(/\s+/g, '')) : 0;
  if (count < 1 || sides < 1) return null;
  return { count, sides, mod };
}

// Rolls dice notation, doubling the DICE (not the flat modifier) on a crit — the standard 5e
// crit rule, same behavior the old battleRollDamage already got right. Returns null if `diceExpr`
// doesn't parse, same "let the caller decide" convention as parseDiceNotation.
export function rollDamage(diceExpr, isCrit = false, rand = Math.random) {
  const parsed = parseDiceNotation(diceExpr);
  if (!parsed) return null;
  const { count, sides, mod } = parsed;
  const rollCount = isCrit ? count * 2 : count;
  const rolls = [];
  for (let i = 0; i < rollCount; i++) rolls.push(rollInt(1, sides, rand));
  return { rolls, mod, total: rolls.reduce((a, b) => a + b, 0) + mod };
}
