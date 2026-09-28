// App bootstrap: get (or create) a campaign, then mount a tab (Character Sheet / Combat) for it.
// Phase 0's proof-of-life button is gone now that there are real features to show — the campaign
// round-trip it proved is exercised here implicitly by every load/save.

import './style.css';
import { mountCharacterSheet } from './ui/character-sheet/character-sheet.js';
import { mountCombatPanel } from './ui/combat/combat-panel.js';
import { mountItemsPanel } from './ui/items/items-panel.js';
import { mountInventoryPanel } from './ui/inventory/inventory-panel.js';

const SOLO_ACCOUNT_PARAM = '_solo';
const app = document.getElementById('app');
let activeTab = 'sheet';
let campaignRef = null;

async function getOrCreateCampaign() {
  const listRes = await fetch('/campaigns');
  if (!listRes.ok) throw new Error(`GET /campaigns failed: ${listRes.status}`);
  const campaigns = await listRes.json();
  if (campaigns.length) return campaigns[0];

  const createRes = await fetch('/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Dev Campaign' }),
  });
  if (!createRes.ok) throw new Error(`POST /campaigns failed: ${createRes.status}`);
  return createRes.json();
}

function renderShell() {
  app.innerHTML = `
    <p class="cs-dim">Campaign: ${campaignRef.name} (code ${campaignRef.code})</p>
    <div class="tab-row">
      <button type="button" id="tab-sheet" class="${activeTab === 'sheet' ? 'tab-active' : ''}">Character Sheet</button>
      <button type="button" id="tab-combat" class="${activeTab === 'combat' ? 'tab-active' : ''}">Combat</button>
      <button type="button" id="tab-items" class="${activeTab === 'items' ? 'tab-active' : ''}">Items</button>
      <button type="button" id="tab-inventory" class="${activeTab === 'inventory' ? 'tab-active' : ''}">Inventory</button>
    </div>
    <div id="tab-mount"></div>
  `;
  document.getElementById('tab-sheet').addEventListener('click', () => { activeTab = 'sheet'; renderShell(); });
  document.getElementById('tab-combat').addEventListener('click', () => { activeTab = 'combat'; renderShell(); });
  document.getElementById('tab-items').addEventListener('click', () => { activeTab = 'items'; renderShell(); });
  document.getElementById('tab-inventory').addEventListener('click', () => { activeTab = 'inventory'; renderShell(); });
  const mount = document.getElementById('tab-mount');
  if (activeTab === 'sheet') mountCharacterSheet(mount, campaignRef.id, SOLO_ACCOUNT_PARAM);
  else if (activeTab === 'combat') mountCombatPanel(mount, campaignRef.id);
  else if (activeTab === 'inventory') mountInventoryPanel(mount, campaignRef.id, SOLO_ACCOUNT_PARAM);
  else mountItemsPanel(mount);
}

async function init() {
  app.innerHTML = '<p>Loading…</p>';
  try {
    campaignRef = await getOrCreateCampaign();
    renderShell();
  } catch (err) {
    app.innerHTML = `<p>Error: ${err.message}</p><p>Is the backend running? (npm run dev:server, or npm run dev:all for both.)</p>`;
  }
}

init();
