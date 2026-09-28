// App bootstrap: get (or create) a campaign, then mount the character sheet for the solo/guest
// slot. Phase 0's proof-of-life button is gone now that there's a real feature to show — the
// campaign round-trip it proved is exercised here implicitly by every load/save.

import './style.css';
import { mountCharacterSheet } from './ui/character-sheet/character-sheet.js';

const SOLO_ACCOUNT_PARAM = '_solo';
const app = document.getElementById('app');

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

async function init() {
  app.innerHTML = '<p>Loading…</p>';
  try {
    const campaign = await getOrCreateCampaign();
    app.innerHTML = `<p class="cs-dim">Campaign: ${campaign.name} (code ${campaign.code})</p><div id="sheet-mount"></div>`;
    mountCharacterSheet(document.getElementById('sheet-mount'), campaign.id, SOLO_ACCOUNT_PARAM);
  } catch (err) {
    app.innerHTML = `<p>Error: ${err.message}</p><p>Is the backend running? (npm run dev:server, or npm run dev:all for both.)</p>`;
  }
}

init();
