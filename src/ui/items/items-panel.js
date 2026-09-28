// Minimal read-only item browser for Phase 5 — lets the authored base items (and the base +
// modifier system) actually be looked at and tried out in the running app, not just proven by
// automated tests. Purely client-side and static for now: items aren't tied to a campaign/
// inventory yet (that's Phase 6's equip/inventory work), so this just renders src/data/*.js and
// lets you preview what a modifier does to an item, live.

import { weapons } from '../../data/weapons.js';
import { armor } from '../../data/armor.js';
import { consumables } from '../../data/consumables.js';
import { materials } from '../../data/materials.js';
import { tools } from '../../data/tools.js';
import { validateItem } from '../../engine/items/validate-item.js';
import { computeItemInteractions } from '../../engine/items/interactions.js';
import { applyModifierToItem } from '../../engine/items/modifiers.js';
import { useConsumable } from '../../engine/items/consume.js';

// TEMPORARY placeholders, not the real modifier pool — just enough to prove applyModifierToItem
// works against real data in the browser. PAUSED: see the "PENDING: real modifier pool" comment
// block at the top of modifiers.js for the full audited catalog (enhancement tiers, materials,
// elemental damage, masterwork, triggered bolt-ons) and the open schema question blocking it.
// Replace this list once that's resolved, don't extend it in the meantime.
const PREVIEW_MODIFIERS = [
  { id: 'plus-one', name: '+1', appliesTo: ['weapon', 'armor'], rarity: 'uncommon',
    passiveMods: [{ stat: 'attackRoll', value: 1 }, { stat: 'damageRoll', value: 1 }], nameTemplate: '{base} +1' },
  { id: 'plus-one-ac', name: '+1 AC', appliesTo: ['armor'], rarity: 'uncommon',
    passiveMods: [{ stat: 'ac', value: 1 }], nameTemplate: '{base} +1' },
  { id: 'of-flaming', name: 'of Flaming', appliesTo: ['weapon'], rarity: 'rare',
    weaponBonusDamage: { dice: '1d6', type: 'fire' }, nameTemplate: '{base} of Flaming' },
];

function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

function statsCell(item) {
  if (item.itemType === 'weapon') {
    const w = item.weapon;
    return `${escapeHtml(w.damageDice)} ${w.damageType}${(w.bonusDamage || []).map(b => ` + ${b.dice} ${b.type}`).join('')}${w.versatileDice ? ` (versatile ${w.versatileDice})` : ''}`;
  }
  if (item.itemType === 'armor') {
    const a = item.armor;
    const dexNote = a.addsDexMod ? (a.dexModCap ? ` + Dex (max ${a.dexModCap})` : ' + Dex') : '';
    const passiveAc = (item.passive || []).filter(m => m.stat === 'ac').reduce((s, m) => s + m.value, 0);
    const reqNote = a.strengthRequirement ? `, Str ${a.strengthRequirement}` : '';
    const stealthNote = a.stealthDisadvantage ? ', Stealth disadv.' : '';
    const label = a.additive ? `+${a.baseAC + passiveAc} AC` : `AC ${a.baseAC + passiveAc}${dexNote}`;
    return `${label}${reqNote}${stealthNote}`;
  }
  if (item.itemType === 'consumable') {
    return item.consumable.effects.map(e => {
      if (e.kind === 'heal') return `heal ${e.healDice}`;
      if (e.kind === 'damage') return `${e.damageDice} ${e.damageType}`;
      return e.kind;
    }).join(', ');
  }
  return '—';
}

function categoryCell(item) {
  if (item.itemType === 'weapon') return item.weapon.weaponCategory;
  if (item.itemType === 'armor') return item.armor.armorType;
  if (item.itemType === 'consumable') return item.consumable.consumableCategory;
  if (item.itemType === 'tool') return item.tool.toolCategory;
  return 'material';
}

function propertiesCell(item) {
  if (item.itemType === 'weapon') return (item.weapon.properties || []).join(', ') || '—';
  if (item.itemType === 'armor') return item.armor.slot || '—';
  if (item.itemType === 'consumable') return `${item.consumable.usesLeft}/${item.consumable.uses.max} uses`;
  if (item.itemType === 'material') return (item.material.materialTags || []).join(', ') || '—';
  return '—';
}

export function mountItemsPanel(container) {
  let previewState = {}; // itemId -> applied modifier id, or null
  let demoTarget = { currentHp: 12, maxHp: 20 };
  // Local, client-side-only usesLeft per consumable id — items aren't tied to a real inventory
  // yet (Phase 6), so this just tracks the demo state for this panel rather than mutating the
  // imported src/data/consumables.js module data directly.
  let consumableUsesLeft = Object.fromEntries(consumables.map(c => [c.id, c.consumable.usesLeft]));
  let lastUseLog = '';

  function renderTable(title, items) {
    return `
      <h3>${title}</h3>
      <table class="items-table">
        <thead><tr><th>Name</th><th>Category</th><th>Stats</th><th>Properties / Slot / Uses</th><th>Interactions</th><th>Try a modifier</th>${items === consumables ? '<th>Use on Demo Target</th>' : ''}</tr></thead>
        <tbody>
          ${items.map(baseItem => {
            const appliedId = previewState[baseItem.id];
            const modifier = PREVIEW_MODIFIERS.find(m => m.id === appliedId);
            let shown = modifier ? applyModifierToItem(baseItem, modifier) : baseItem;
            if (shown.itemType === 'consumable') {
              shown = { ...shown, consumable: { ...shown.consumable, usesLeft: consumableUsesLeft[baseItem.id] } };
            }
            const validation = validateItem(shown);
            const interactions = computeItemInteractions(shown);
            return `
              <tr>
                <td><strong>${escapeHtml(shown.name)}</strong>${!validation.valid ? ` <span class="items-invalid">INVALID: ${escapeHtml(validation.errors.join('; '))}</span>` : ''}</td>
                <td>${categoryCell(shown)}</td>
                <td>${statsCell(shown)}</td>
                <td>${propertiesCell(shown)}</td>
                <td>${interactions.join(', ')}</td>
                <td>
                  <select data-item-id="${baseItem.id}" class="items-modifier-select">
                    <option value="">— none —</option>
                    ${PREVIEW_MODIFIERS.map(m => `<option value="${m.id}" ${appliedId === m.id ? 'selected' : ''} ${!m.appliesTo.includes(baseItem.itemType) ? 'disabled' : ''}>${escapeHtml(m.name)}</option>`).join('')}
                  </select>
                </td>
                ${shown.itemType === 'consumable' ? `<td><button type="button" class="items-use-btn" data-item-id="${baseItem.id}" ${consumableUsesLeft[baseItem.id] <= 0 ? 'disabled' : ''}>Use</button></td>` : ''}
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  function render() {
    container.innerHTML = `
      <div class="items-panel">
        <h2>Item Browser (Phase 5)</h2>
        <p class="cs-dim">Base items only, sourced from the old project's loot-data.js where it had a mundane equivalent. Try a modifier to see the base+modifier system live.</p>
        <div class="items-demo-target">
          <strong>Demo Target</strong> —
          <div class="hp-bar-track"><div class="hp-bar-fill" style="width:${Math.max(0, Math.min(100, (demoTarget.currentHp / demoTarget.maxHp) * 100))}%"></div></div>
          ${demoTarget.currentHp} / ${demoTarget.maxHp} HP
          ${lastUseLog ? `<span class="cs-dim"> — ${escapeHtml(lastUseLog)}</span>` : ''}
        </div>
        ${renderTable('Weapons', weapons)}
        ${renderTable('Armor', armor)}
        ${renderTable('Consumables', consumables)}
        ${renderTable('Materials', materials)}
        ${renderTable('Tools', tools)}
      </div>
    `;
    container.querySelectorAll('.items-modifier-select').forEach(sel => {
      sel.addEventListener('change', e => {
        previewState[e.target.dataset.itemId] = e.target.value || null;
        render();
      });
    });
    container.querySelectorAll('.items-use-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const itemId = e.target.dataset.itemId;
        const item = consumables.find(c => c.id === itemId);
        const itemWithLiveUses = { ...item, consumable: { ...item.consumable, usesLeft: consumableUsesLeft[itemId] } };
        const { result, usesLeft } = useConsumable(itemWithLiveUses, 0, demoTarget);
        consumableUsesLeft[itemId] = usesLeft;
        if (result.kind === 'heal') {
          demoTarget = { ...demoTarget, currentHp: result.newCurrentHp };
          lastUseLog = `${item.name}: healed ${result.amount} (rolled ${result.rolls.join('+')})`;
        } else if (result.kind === 'damage') {
          demoTarget = { ...demoTarget, currentHp: result.newCurrentHp };
          lastUseLog = `${item.name}: dealt ${result.amount} ${result.damageType} (rolled ${result.rolls.join('+')})`;
        } else if (result.kind === 'buff' || result.kind === 'debuff') {
          lastUseLog = `${item.name}: ${result.kind} — ${result.statMods.length ? JSON.stringify(result.statMods) : 'no numeric effect modeled yet, see item flavorText'}`;
        } else {
          lastUseLog = `${item.name}: used (${result.kind})`;
        }
        render();
      });
    });
  }

  render();
}
