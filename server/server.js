// Phase 3 of the architecture migration (see docs/MIGRATION_PLAN.md, docs/ARCHITECTURE.md):
// a real Node.js server process, exposing Phase 2's SQLite persistence layer (db/database.js)
// over a small REST API. Plain Node `http` module, zero external dependencies — consistent
// with game-engine.js and the db layer, both dependency-free.
//
// Scope, confirmed before building: server + persistence API only. NOT wired into the live
// browser app yet (it still uses localStorage, untouched) — that's Phase 4's job
// ("server-authoritative game state"), once the server is trusted to actually own game truth
// rather than just store/retrieve it on request. This phase proves the server process itself
// works and correctly exposes what Phase 2 built.
//
// createServer(db) takes an already-open database (see db/database.js's openDatabase) rather
// than opening one itself, so tests can pass an in-memory db and production code can pass a
// real file — same dependency-injection shape Phase 1/2 already established.

import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  createCampaign, getCampaign, getCampaignByCode, listCampaigns,
  upsertCharacter, getCharacter, listCharacters,
  saveSubsystemState, loadSubsystemState, loadAllSubsystemState,
} from '../db/database.js';
import { SUBSYSTEMS } from '../db/schema.js';
import { handleGamblingAction } from './gambling.js';

// The solo/guest character slot has a null account_uid in the database (see db/schema.js) —
// URL path segments can't carry a literal null, so a fixed token stands in for it. Chosen to be
// unambiguous rather than reusing the string "null", which a real account_uid could theoretically
// collide with.
const SOLO_TOKEN = '_solo';
function accountUidFromParam(param) { return param === SOLO_TOKEN ? null : param; }

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}
function sendError(res, status, message) { sendJson(res, status, { error: message }); }

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch (e) { reject(new Error('Malformed JSON body')); }
    });
    req.on('error', reject);
  });
}

// Static file serving, so the DM's own machine can serve the built frontend (Vite's `dist/`
// output — see server/start.js's STATIC_ROOT) to every device on the LAN, not just answer JSON
// API requests. Deliberately narrow rather than "serve the whole repo":
// - Extension allowlist only. The default sqlite db file (see server/start.js's DB_PATH) lives
//   at the repo root, outside STATIC_ROOT — but the allowlist stays as defense-in-depth even so.
// - GET only, no directory listing, no caching/ETag headers, no gzip — this is a DM's own local
//   process on a LAN, not a public web server; those are real gaps if this were ever deployed
//   more broadly, noted here rather than silently assumed out of scope.
// - staticRoot is an explicit parameter (not hardcoded), same dependency-injection shape as `db`
//   — tests point it at a throwaway fixture directory, server/start.js points it at the repo root.
const STATIC_EXTENSIONS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Returns true (and has already written the response) if a static file was actually served;
// false means the caller should fall through to its own 404 handling. `pathname` is expected
// already decodeURIComponent'd. The resolved-path prefix check is what actually prevents a
// '/../../whatever' pathname from escaping staticRoot — path.join/resolve normalize '..'
// segments away, so this can't be fooled by an unnormalized path string, only by checking where
// the FINAL resolved path actually lands.
async function tryServeStatic(res, staticRoot, pathname) {
  if (!staticRoot) return false;
  const urlPath = pathname === '/' ? '/index.html' : pathname;
  const contentType = STATIC_EXTENSIONS[path.extname(urlPath).toLowerCase()];
  if (!contentType) return false;
  const resolvedRoot = path.resolve(staticRoot);
  const resolvedPath = path.resolve(staticRoot, '.' + urlPath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) return false;
  let data;
  try { data = await readFile(resolvedPath); }
  catch { return false; }
  res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': data.length });
  res.end(data);
  return true;
}

// Routes are matched against a small fixed set of path patterns rather than a general router
// library — the whole point of "plain http, no framework" is that this stays small enough not
// to need one. Segments are matched positionally after splitting on '/'.
export function createServer(db, { staticRoot } = {}) {
  return createHttpServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return sendError(res, 400, 'Malformed URL'); }
    const segments = url.pathname.split('/').filter(Boolean); // '/campaigns/3/characters' -> ['campaigns','3','characters']

    try {
      // POST /campaigns  |  GET /campaigns
      if (segments.length === 1 && segments[0] === 'campaigns') {
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          if (!body.name || typeof body.name !== 'string') return sendError(res, 400, '"name" is required');
          return sendJson(res, 201, createCampaign(db, body.name));
        }
        if (req.method === 'GET') return sendJson(res, 200, listCampaigns(db));
        return sendError(res, 405, `Method ${req.method} not allowed on /campaigns`);
      }

      // GET /campaigns/by-code/:code  (Phase 6b: resolves the DM's shareable join code to a
      // campaign — a 3-segment path shaped like /campaigns/:id/characters below, but segments[1]
      // is the literal string 'by-code' rather than a numeric id, so the two never actually match
      // the same request).
      if (segments.length === 3 && segments[0] === 'campaigns' && segments[1] === 'by-code') {
        if (req.method !== 'GET') return sendError(res, 405, `Method ${req.method} not allowed`);
        const campaign = getCampaignByCode(db, segments[2]);
        if (!campaign) return sendError(res, 404, `No campaign with code "${segments[2]}"`);
        return sendJson(res, 200, campaign);
      }

      // GET /campaigns/:id
      if (segments.length === 2 && segments[0] === 'campaigns') {
        const id = Number(segments[1]);
        if (!Number.isInteger(id)) return sendError(res, 400, 'Campaign id must be an integer');
        if (req.method !== 'GET') return sendError(res, 405, `Method ${req.method} not allowed`);
        const campaign = getCampaign(db, id);
        if (!campaign) return sendError(res, 404, `No campaign with id ${id}`);
        return sendJson(res, 200, campaign);
      }

      // GET /campaigns/:id/characters
      if (segments.length === 3 && segments[0] === 'campaigns' && segments[2] === 'characters') {
        const id = Number(segments[1]);
        if (!Number.isInteger(id)) return sendError(res, 400, 'Campaign id must be an integer');
        if (!getCampaign(db, id)) return sendError(res, 404, `No campaign with id ${id}`);
        if (req.method !== 'GET') return sendError(res, 405, `Method ${req.method} not allowed`);
        return sendJson(res, 200, listCharacters(db, id));
      }

      // GET/PUT /campaigns/:id/characters/:accountUid  (accountUid may be the SOLO_TOKEN)
      if (segments.length === 4 && segments[0] === 'campaigns' && segments[2] === 'characters') {
        const id = Number(segments[1]);
        if (!Number.isInteger(id)) return sendError(res, 400, 'Campaign id must be an integer');
        if (!getCampaign(db, id)) return sendError(res, 404, `No campaign with id ${id}`);
        const accountUid = accountUidFromParam(segments[3]);
        if (req.method === 'GET') {
          const character = getCharacter(db, id, accountUid);
          if (!character) return sendError(res, 404, 'No character for that account in this campaign');
          return sendJson(res, 200, character);
        }
        if (req.method === 'PUT') {
          const body = await readJsonBody(req);
          return sendJson(res, 200, upsertCharacter(db, id, accountUid, body));
        }
        return sendError(res, 405, `Method ${req.method} not allowed`);
      }

      // GET /campaigns/:id/state
      if (segments.length === 3 && segments[0] === 'campaigns' && segments[2] === 'state') {
        const id = Number(segments[1]);
        if (!Number.isInteger(id)) return sendError(res, 400, 'Campaign id must be an integer');
        if (!getCampaign(db, id)) return sendError(res, 404, `No campaign with id ${id}`);
        if (req.method !== 'GET') return sendError(res, 405, `Method ${req.method} not allowed`);
        return sendJson(res, 200, loadAllSubsystemState(db, id));
      }

      // GET/PUT /campaigns/:id/state/:subsystem
      if (segments.length === 4 && segments[0] === 'campaigns' && segments[2] === 'state') {
        const id = Number(segments[1]);
        if (!Number.isInteger(id)) return sendError(res, 400, 'Campaign id must be an integer');
        if (!getCampaign(db, id)) return sendError(res, 404, `No campaign with id ${id}`);
        const subsystem = segments[3];
        if (!SUBSYSTEMS[subsystem]) return sendError(res, 400, `Unknown subsystem "${subsystem}" — must be one of: ${Object.keys(SUBSYSTEMS).join(', ')}`);
        if (req.method === 'GET') {
          const state = loadSubsystemState(db, id, subsystem);
          if (state === null) return sendError(res, 404, `No "${subsystem}" state saved for this campaign yet`);
          return sendJson(res, 200, state);
        }
        if (req.method === 'PUT') {
          const body = await readJsonBody(req);
          saveSubsystemState(db, id, subsystem, body);
          return sendJson(res, 200, { ok: true });
        }
        return sendError(res, 405, `Method ${req.method} not allowed`);
      }

      // GET /campaigns/:id/gambling  |  POST /campaigns/:id/gambling/:subpath
      // Phase 4: the server itself decides gambling outcomes (see server/gambling.js) rather
      // than just storing whatever a client sends — distinct from the still-present, still-
      // unchanged Phase 3 route above (PUT /campaigns/:id/state/gambling), which still lets a
      // client overwrite the raw blob directly. Both exist; nothing in the live app calls
      // either yet.
      if (segments.length >= 3 && segments[0] === 'campaigns' && segments[2] === 'gambling') {
        const id = Number(segments[1]);
        if (!Number.isInteger(id)) return sendError(res, 400, 'Campaign id must be an integer');
        if (!getCampaign(db, id)) return sendError(res, 404, `No campaign with id ${id}`);
        const subpath = segments[3] || '';
        const body = req.method === 'POST' ? await readJsonBody(req) : {};
        const result = await handleGamblingAction(db, id, subpath, req.method, body);
        return sendJson(res, result.status, result.body);
      }

      if (req.method === 'GET' && await tryServeStatic(res, staticRoot, decodeURIComponent(url.pathname))) return;
      return sendError(res, 404, `No route for ${req.method} ${url.pathname}`);
    } catch (e) {
      if (e.message === 'Malformed JSON body') return sendError(res, 400, e.message);
      return sendError(res, 500, 'Internal server error');
    }
  });
}
