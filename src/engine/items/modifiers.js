// The scalable base-item + modifier system (confirmed with the user: build a small pool of base
// items plus reusable modifiers, rather than hand-authoring every magic variant as a one-off).
// A base item is a plain Item (item-schema.js) with no appliedModifiers. A Modifier is a
// standalone, rarity-tagged bundle of effects that can be layered onto any compatible base item
// at generation time — applyModifierToItem clones the base and merges the modifier in, so the
// same "+1" or "of Flaming" modifier works identically across every weapon it's compatible with,
// instead of being re-authored per item.
//
// ============================== PENDING: real modifier pool =================================
// PAUSED, come back to this before Phase 5 is considered done. An audit of the old
// dungeon-master-box's loot-data.js (its magic-item catalog, not just the mundane base items
// weapons.js/armor.js already drew from) found the old data already IS a consistent modifier
// system in spirit — just baked into free-text per item rather than composable. Full findings are
// in this session's transcript; condensed:
//   - Enhancement tiers +1..+5 (uncommon≈+1 up to celestial≈+4/+5), attack+damage together on
//     weapons, AC on armor — this part fits the CURRENT Modifier shape fine (passiveMods).
//   - Three materials, each a STRUCTURAL effect, not a stat bonus: Silvered (bypasses certain
//     resistance, explicitly not magical), Mithral (removes armor's stealthDisadvantage/
//     strengthRequirement, halves weapon weight), Adamantine (crits against the wearer become
//     normal hits; weapons auto-crit vs. objects).
//   - Elemental damage add-ons: one template ("+extra Xd? [type] on hit") reused across ~9 damage
//     types, die size scaling by rarity; mirrored on armor as resistance + reflect-on-hit.
//   - Masterwork: attack-only +1, explicitly non-magical — distinct from a true +1.
//   - Five recurring TRIGGERED bolt-ons that don't fit "always-on stat bonus": Fortune (reroll
//     attack, 1/long rest — this one DOES fit the existing Ability shape cleanly), Bloodletting
//     (life-drain on hit), Swiftness (+10ft speed on hit), Warding (+1 saves vs. spells while
//     held), Echoing/Wild (AoE or restrain ON A CRIT specifically).
//   - Cursed: not its own category — a drawback bolted onto any other modifier via normal
//     stacking (applyModifiers already supports this, confirmed no new mechanism needed).
//   - Hidden Power unlocks: a condition-gated upgrade system layered on modifiers — explicitly
//     OUT OF SCOPE for the modifier pool itself, flagged as its own future design topic.
//
// Schema gap this surfaces (NOT yet added to the Modifier typedef above): most of the above isn't
// numeric. Proposed additions, not yet built, pending the user's call on the open question below:
//   - armorOverrides / weaponOverrides — direct field patches (Mithral clearing
//     stealthDisadvantage/strengthRequirement)
//   - weightMultiplier — Mithral's weight halving
//   - grantedResistances — elemental armor variants
//   - magical: boolean (default true) — Masterwork/plain-Silvered are the only non-magical
//     modifiers; matters later for resistance-bypass rules
//   - flags: string[] — proposed catch-all for named triggered-on-hit/on-crit effects
//     (thunderclap_on_crit, lifedrain_on_hit, etc.) not yet wired into live combat resolution
//
// OPEN QUESTION, explicitly deferred by the user rather than decided: use the loose `flags:
// string[]` catch-all above for triggered effects, or design a fuller typed triggered-effect
// system now instead of deferring the real mechanic until combat needs to evaluate it? Don't
// build either without picking back up that conversation first.
// ===============================================================================================

/**
 * @typedef {Object} Modifier
 * @property {string} id
 * @property {string} name              // e.g. "+1", "of Flaming"
 * @property {('weapon'|'armor')[]} appliesTo
 * @property {string} rarity            // the rarity tier this modifier is drawn from
 * @property {import('./item-schema.js').StatModifier[]} [passiveMods]
 * @property {import('./item-schema.js').Ability[]} [grantedAbilities]
 * @property {{dice: string, type: string}} [weaponBonusDamage]  // additive extra dice, e.g. +1d6 fire
 * @property {string} nameTemplate      // '{base} +1' / '{base} of Flaming'
 */

export function formatModifiedName(nameTemplate, baseName) {
  return nameTemplate.replace('{base}', baseName);
}

/**
 * @param {import('./item-schema.js').Item} baseItem
 * @param {Modifier} modifier
 * @returns {import('./item-schema.js').Item|null}  null if the modifier doesn't apply to this item's type
 */
export function applyModifierToItem(baseItem, modifier) {
  if (!modifier.appliesTo.includes(baseItem.itemType)) return null;

  const item = structuredClone(baseItem);
  item.passive = [...(item.passive || []), ...(modifier.passiveMods || [])];
  item.abilities = [...(item.abilities || []), ...(modifier.grantedAbilities || [])];
  if (modifier.weaponBonusDamage && item.weapon) {
    item.weapon = { ...item.weapon, bonusDamage: [...(item.weapon.bonusDamage || []), modifier.weaponBonusDamage] };
  }
  item.name = formatModifiedName(modifier.nameTemplate, baseItem.name);
  item.appliedModifiers = [...(item.appliedModifiers || []), modifier.id];
  return item;
}

/**
 * Applies several modifiers in sequence (order matters for name stacking — each modifier's
 * nameTemplate wraps the previous result's name). Skips (and reports) any modifier that doesn't
 * apply to this item's itemType rather than throwing, since a generation routine may offer a
 * shared modifier pool across multiple item types.
 * @returns {{item: import('./item-schema.js').Item, skipped: string[]}}
 */
export function applyModifiers(baseItem, modifiers) {
  let item = baseItem;
  const skipped = [];
  for (const modifier of modifiers) {
    const next = applyModifierToItem(item, modifier);
    if (next) item = next;
    else skipped.push(modifier.id);
  }
  return { item, skipped };
}
