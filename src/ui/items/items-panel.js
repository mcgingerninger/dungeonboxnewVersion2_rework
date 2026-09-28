// Minimal read-only item browser for Phase 5 — lets the authored base items (and the base +
// modifier system) actually be looked at and tried out in the running app, not just proven by
// automated tests. Purely client-side and static for now: items aren't tied to a campaign/
// inventory yet (that's Phase 6's equip/inventory work), so this just renders src/data/*.js and
// lets you preview what a modifier does to an item, live.

import { weapons } from '../../data/weapons.js';
import { armor } from '../../data/armor.js';
import { validateItem } from '../../engine/items/validate-item.js';
import { computeItemInteractions } from '../../engine/items/interactions.js';
import { applyModifierToItem } from '../../engine/items/modifiers.js';

// A couple of representative test modifiers to demonstrate the base+modifier system live — not
// the final modifier pool (that's its own future authoring pass), just enough to prove
// applyModifierToItem works against real data in the browser.
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
    const label = a.armorType === 'shield' ? `+${a.baseAC + passiveAc} AC` : `AC ${a.baseAC + passiveAc}${dexNote}`;
    return label;
  }
  return '—';
}

function categoryCell(item) {
  return item.itemType === 'weapon' ? item.weapon.weaponCategory : item.armor.armorType;
}

function propertiesCell(item) {
  if (item.itemType === 'weapon') return (item.weapon.properties || []).join(', ') || '—';
  return item.armor.slot || '—';
}

export function mountItemsPanel(container) {
  let previewState = {}; // itemId -> applied modifier id, or null

  function renderTable(title, items) {
    return `
      <h3>${title}</h3>
      <table class="items-table">
        <thead><tr><th>Name</th><th>Category</th><th>Stats</th><th>Properties / Slot</th><th>Interactions</th><th>Try a modifier</th></tr></thead>
        <tbody>
          ${items.map(baseItem => {
            const appliedId = previewState[baseItem.id];
            const modifier = PREVIEW_MODIFIERS.find(m => m.id === appliedId);
            const shown = modifier ? applyModifierToItem(baseItem, modifier) : baseItem;
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
        ${renderTable('Weapons', weapons)}
        ${renderTable('Armor', armor)}
      </div>
    `;
    container.querySelectorAll('.items-modifier-select').forEach(sel => {
      sel.addEventListener('change', e => {
        previewState[e.target.dataset.itemId] = e.target.value || null;
        render();
      });
    });
  }

  render();
}
