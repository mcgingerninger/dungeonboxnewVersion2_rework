// Phase 0 proof-of-life: nothing about game mechanics lives here yet. This just proves the new
// skeleton's three pieces are actually wired together — Vite serving the page, the browser
// talking to the Node backend (proxied in dev by vite.config.js), and the backend persisting to
// SQLite — before any real engine/UI work starts in later phases.

const app = document.getElementById('app');

app.innerHTML = `
  <h1>Dungeon Master Box v2 — skeleton</h1>
  <p>Phase 0 proof of life: create a campaign and confirm it round-trips through the server's SQLite database.</p>
  <button id="createBtn">Create test campaign</button>
  <pre id="result" style="white-space: pre-wrap; border: 1px solid #ccc; padding: 0.75rem; margin-top: 1rem;"></pre>
`;

const resultEl = document.getElementById('result');

document.getElementById('createBtn').addEventListener('click', async () => {
  resultEl.textContent = 'Creating…';
  try {
    const createRes = await fetch('/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Skeleton test ${new Date().toISOString()}` }),
    });
    if (!createRes.ok) throw new Error(`POST /campaigns failed: ${createRes.status}`);
    const created = await createRes.json();

    const listRes = await fetch('/campaigns');
    if (!listRes.ok) throw new Error(`GET /campaigns failed: ${listRes.status}`);
    const all = await listRes.json();

    resultEl.textContent =
      `Created campaign:\n${JSON.stringify(created, null, 2)}\n\n` +
      `Server now reports ${all.length} campaign(s) total — confirms the row was actually persisted, not just echoed back.`;
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}\n\nIs the backend running? (npm run dev:server, or npm run dev:all for both.)`;
  }
});
