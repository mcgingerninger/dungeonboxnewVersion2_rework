// Real hit-dice-based HP, replacing the old app's three independently-editable freeform fields
// (level/maxHp/"hit dice" as a text label nothing was derived from). No class table — just a
// chosen hit die size (6/8/10/12) and level, matching the rebuild's "generic, not class-locked"
// constraint while still using the real 5e math: level 1 is the die's max face + CON mod; every
// level after averages the die (rounded up, i.e. floor(size/2)+1) + CON mod again.

export function computeMaxHp(level, hitDieSize, conModifier) {
  if (level < 1 || !hitDieSize) return 0;
  let hp = hitDieSize + conModifier;
  for (let lvl = 2; lvl <= level; lvl++) {
    hp += Math.floor(hitDieSize / 2) + 1 + conModifier;
  }
  return Math.max(hp, 1); // a very negative CON at low level shouldn't produce 0-or-less max HP
}
