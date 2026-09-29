# Handoff brief: continuing the ground-up mechanics rebuild

Paste this whole file as your first message in a new Claude Code session to pick up where this one
left off. It's written to be self-contained — no prior conversation context required.

**This replaces an older version of this file** that described a different, already-finished effort
("wiring the frontend to the new backend" — i.e. wiring the old monolith HTML against the new
SQLite/server/WebSocket backend). That work is real and complete (see `docs/ARCHITECTURE.md`'s
"Phase 6: Frontend Wiring" section), but the project has since moved on: an approved plan replaced
it with a ground-up rebuild that strips the monolith entirely and rebuilds the mechanics layer as
real modules. The old brief kept describing the finished, earlier effort as "what's next," which
was wrong and went uncorrected for a while — this version reflects the rebuild's actual state.

## What this project is

`dungeon-master-box` is a local-first architectural migration of `dungeon-loot-tool`, a D&D 5e
loot/combat/campaign browser tool. Two repos, never confuse them — `dungeon-loot-tool` is the
original, stable and deployed; **never modify it**. This repo is the migration's development home.

Two efforts happened here, in order:
1. An earlier migration kept the monolith HTML in place and built a SQLite + Node server +
   WebSocket-multiplayer backend around it, then wired the monolith/`multiplayer-sync.js` against
   that backend and packaged it (Windows auto-start/auto-update). **Complete.** Full account:
   `docs/ARCHITECTURE.md`, sections before "Ground-Up Mechanics Rebuild".
2. **The current effort**: a ground-up rebuild (its own Phase 0–6, commit `a1bb69d` onward) that
   removed the monolith HTML and every content data file, and is rebuilding the mechanics layer from
   scratch as ES modules under `src/engine/`, `src/data/`, `src/ui/` — reusing the `server/`, `db/`,
   `game-engine.js`, and `multiplayer-sync.js` backend from effort 1 rather than rebuilding it.
   Full account: `docs/ARCHITECTURE.md`'s "Ground-Up Mechanics Rebuild" section (added when this
   brief was corrected) — read that section for the real phase-by-phase history before assuming
   anything about "next" from memory.

## Standing rules (apply to everything from here on)

- **Confirm scope with the user before building anything new.** Narrow and get explicit approval
  before writing code, especially once a phase could bundle multiple concerns.
- **Audit before building** — read existing code fully, trace dependencies, don't assume behavior.
  For each rebuild phase so far, that meant reading the pre-strip monolith's actual reference data
  (`loot-data.js` etc., recoverable via `git show <pre-a1bb69d commit>:loot-data.js` since it was
  removed, not history-scrubbed) rather than inventing item stats from scratch.
- **Never trust one clean test run for anything involving randomness.** Run `node --test` 15–40+
  consecutive times before calling new work validated — this project's history includes real,
  non-flaky bugs a single run missed.
- **Document every deliberate simplification, gap, or paused decision explicitly** rather than
  silently dropping it. Example already in place: the magic-item modifier pool (enhancement tiers,
  materials, elemental variants, triggered bolt-ons) was audited and found real, but extending it is
  paused on an open design question — see the `PENDING` block at the top of
  `src/engine/items/modifiers.js` before touching that file.
- **Don't commit without explicit instruction.** Once told to commit: descriptive message with
  `Co-Authored-By: Claude <noreply@anthropic.com>`, push after committing without a separate
  confirmation question. Never merge a PR without a separate, explicit "merge it."
- **`main` and any `backup/*` branches, and the separate `dungeon-loot-tool` repo, are never
  touched** by this work.

## Current state (as of this handoff)

Ground-up rebuild Phases 0–6 complete (commit `7edf189` is HEAD as of this writing):
- Dice engine, character/rules foundation (ability scores/HP/AC/skills/saves/spell
  slots/traits/speed/size/alignment/proficiency bonus), a unified server-authoritative combat
  engine, a real item schema/validation/interactions/base+modifier system, item content batches
  (14 weapons, 9 armor, 7 consumables with real charge/effect resolution, 3 materials, 5 tools,
  monster-part-derived materials), and real inventory/equip (equip/unequip drives live AC,
  Use/Activate work against real HP and persisted charges).
- Four working UI tabs, wired to the persisted SQLite backend via the REST/WebSocket server:
  Character Sheet, Combat, Items (browser), Inventory.
- Test suite: run `node --test` from repo root to get the live count (386 passing / 1 failing as
  of this brief — the 1 failure was only a missing `npm install`, `ws` unresolved for
  `server/websocket.test.js`, not a code bug; run `npm install` first).
- **Not yet rebuilt on the new engine at all**: the `wondrous`/quest/treasure/document item types
  (deferred since Phase 4's original scoping), any monster/NPC system, Battlefield, Journey
  encounters, Puzzles, NPC tab, Map Builder, Store, Gambling, DM Controls, or an
  account/login-equivalent identity system. These exist only in the pre-strip monolith's history,
  not in `src/`.
- **Open, unresolved design question**: the magic-item modifier pool (see above) — don't extend
  `modifiers.js` without resurfacing this decision to the user first.

## What's next

Not yet scoped or approved — per the standing rules above, the next session should propose a scoped
plan and get sign-off before writing code, rather than picking a direction unilaterally. Candidates
visible from the gap list above (roughly in an order that keeps depending-on-nothing-unbuilt-yet):
1. Resolve the paused modifier-pool design question (blocks a lot of interesting item content).
2. Decide and build the deferred `wondrous`/quest/treasure/document item types (Phase 4 explicitly
   scoped these out; `wondrous` in particular blocks equip-mode monster parts, which Phase 5's
   monster-parts port already left half-finished for exactly this reason).
3. A monster/NPC system for `src/`, since the combat engine already supports monster-shaped
   attackers but has no real data source for them yet (`src/data/example-monsters.js` is
   explicitly a synthetic stand-in).
4. Any of Battlefield/Journey/Puzzles/NPC tab/Map Builder/Store/Gambling/DM Controls, each an
   independent rebuild-from-the-old-monolith effort of its own.

### First message to send once in a new session

Something like: *"Continue the dungeon-master-box ground-up rebuild. Read
docs/ARCHITECTURE.md's 'Ground-Up Mechanics Rebuild' section and docs/NEXT_SESSION_BRIEF.md's
'What's next' list, then propose a scoped next phase and wait for sign-off before writing code.
Don't touch dungeon-loot-tool at all."*
