// Real entry point — starts the server against an actual database file, not the in-memory db
// the tests use. Run with: node server/start.js
// Configurable via env vars so a future Phase 3+ deployment (or Phase 6's packaging) doesn't
// need code changes to point at a different port or database location.
import * as path from 'node:path';
import { networkInterfaces } from 'node:os';
import { openDatabase } from '../db/database.js';
import { createServer } from './server.js';
import { createWebSocketServer } from './websocket.js';

// Phase 6h prep: server.listen(PORT) below with no host already binds to every network
// interface (Node's own default — 0.0.0.0 for IPv4), so the server is already reachable from
// another device on the same LAN with zero code change. The one real gap was informational:
// printing only "localhost" here is actively misleading for LAN testing, since that hostname
// only ever resolves on the same machine — a player's phone needs the DM machine's actual LAN
// IP. multiplayer-sync.js never hardcodes a host (API_BASE/WS_URL both derive from
// window.location), so whichever URL a browser actually used to load the page is automatically
// the right one — nothing there needs to change either.
function lanAddresses() {
  const addrs = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) addrs.push(iface.address);
    }
  }
  return addrs;
}

const PORT = Number(process.env.PORT) || 4000;
// The repo root, one level up from this file.
// import.meta.dirname (not a file:// URL's .pathname) so this is a normal, correctly-formed
// native path on Windows too (a URL pathname would carry a leading '/' before the drive letter).
const REPO_ROOT = path.join(import.meta.dirname, '..');
// A real incident, not a hypothetical: this used to default to the bare relative string
// './dungeon-master-box.db', which resolves against whatever directory the PROCESS happens to
// be launched from — not this file's own location. Depending on how the server gets started
// (a plain `node server/start.js` from the repo root vs. a launcher/task runner spawning it with
// a different working directory, e.g. one folder up), that put the real, live database in a
// different place each time. That ambiguity directly caused a real database file to be mistaken
// for a stray leftover and deleted during a debugging session. Anchoring to REPO_ROOT (same
// pattern STATIC_ROOT already used) means the database always lives in exactly one predictable
// place regardless of launch method — DB_PATH can still override this explicitly when needed.
const DB_PATH = process.env.DB_PATH || path.join(REPO_ROOT, 'dungeon-master-box.db');
// Points at Vite's build output (`npm run build`), not the repo root — in dev, Vite's own dev
// server serves the frontend directly (see vite.config.js's proxy setup) and this static path is
// never hit; it only matters for a production `node server/start.js` run against a built `dist/`.
const STATIC_ROOT = process.env.STATIC_ROOT || path.join(REPO_ROOT, 'dist');

const db = openDatabase(DB_PATH);
const server = createServer(db, { staticRoot: STATIC_ROOT });
// Shares the same TCP port as the REST API (the 'ws' package upgrades HTTP connections to
// WebSocket on the same http.Server instance) rather than needing a second port.
createWebSocketServer(db, server);
server.listen(PORT, () => {
  console.log(`Dungeon Master Box server listening (db: ${DB_PATH}, WebSocket on the same port)`);
  console.log(`  This machine:  http://localhost:${PORT}`);
  const addrs = lanAddresses();
  if (addrs.length) {
    console.log(`  Other devices on this network - open one of these:`);
    addrs.forEach(addr => console.log(`    http://${addr}:${PORT}`));
  } else {
    console.log(`  No LAN network interface detected — other devices won't be able to reach this server.`);
  }
});
