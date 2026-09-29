# Architecture

Living documentation of the migration (see `docs/MIGRATION_PLAN.md` for the full phase plan),
organized by phase. Each section documents what that phase actually did — not just what was
planned — including dependencies discovered and mistakes made along the way, since those are
useful context for whoever (human or Claude) picks up the next phase.

## Phase 1: Game-Engine Extraction

This documents what Phase 1 actually did: what moved into `game-engine.js`, what stayed in the
monolithic HTML file and why, what the dependency audit found, and — importantly — a couple of
real mistakes made and caught during this phase.

### What's in `game-engine.js`

A single dependency-light ES module (`export function` / `export const` throughout, no default
export). No `document`, `window`, `localStorage`, or other browser API anywhere in the file.
Organized into five sections:

1. **Item classification** — `classifyItemFull` and its full call graph: `classifyItemHierarchy`,
   `deriveItemProperties`, `deriveItemTags`, `computeItemInteractions`, `canInteract`,
   `itemRequiresAttunement`, plus the `INTERACTIONS` rule table and the `*_PARTS` Sets /
   `ARMOR_BODY_SLOT_LABEL` constants it reads.
2. **Character sheet** — `computeCharacterSheetFor` and its full call graph:
   `collectEquippedStatBreakdown`, `collectEquippedAcBreakdown`, `uniqueEquippedSlotEntries`,
   `extractStatDeltasFromText`, `sumBreakdown`, `statusFor`, `describeStatSources`,
   `abilityModifier`, `proficiencyBonusForLevel`, `fmtMod`, plus `ABILITY_NAMES`,
   `SKILL_ABILITY_MAP`, `SHEET_STAT_ALIASES`.
3. **Battle** — `battleParseAttack`, `battleRollDamage`, `battleEffectivenessLabel`.
4. **Shared random helpers** — `rn`, `ri`, `weightedPickFromObject` (see "Randomness" below for
   why these exist here as well as in the monolith).
5. **Gambling** — all four games' table constructors, action resolvers, and (for Roulette and
   Blackjack) the newly-split-out pure resolution cores: `newRouletteTable`,
   `applyRouletteAction`, `resolveRouletteSpin`, `rouletteColor`, `rouletteMultiplier`,
   `ROULETTE_WHEEL_ORDER`/`ROULETTE_RED_NUMBERS`/`ROULETTE_OUTSIDE_BETS`; `newBlackjackTable`,
   `applyBlackjackAction`, `resolveBlackjackDeal`, `resolveBlackjackDealerPlay`,
   `blackjackHandValue`, `isBlackjackHand`, `blackjackAllDone`, `cardValue`, `freshShuffledDeck`,
   `CARD_SUITS`/`CARD_RANKS`; `newSlotsTable`, `applySlotsAction`, `SLOTS_SYMBOLS`;
   `newPokerTable`, `applyPokerAction`, `evaluatePokerHand`, `pokerRankValue`,
   `POKER_RANK_ORDER`/`POKER_PAYOUTS`.

### What was already pure vs. what needed splitting

**Already fully dependency-free, moved verbatim:** item classification and character sheet math
were both already designed with dependency injection in mind — `computeCharacterSheetFor` takes
`slots`/`resolveItem` as parameters rather than reaching for a hardcoded global, and
`classifyItemFull` only ever reads the `item` object passed to it. Neither needed any redesign
to extract; this is a credit to how they were originally written, not something this phase gets
to take credit for.

**Needed a pure/impure split — Roulette and Blackjack's actual resolution logic:** the registered
`GAMBLING_HANDLERS.<game>.applyAction` function is a reasonable place to look for "the resolution
logic," and for Slots and Poker it genuinely is the whole thing — `applySlotsAction` and
`applyPokerAction` were already fully self-contained and moved with no changes beyond the
optional `rand` parameter. But for Roulette and Blackjack, `applyAction` (`applyRouletteAction` /
`applyBlackjackAction`) turned out to only handle *bet placement* — the actual spin / deal /
dealer-play logic lived in separate DM-only functions (`spinRouletteWheel`, `blackjackDeal`,
`blackjackDealerPlay`) that mixed the real game math with permission checks
(`isRealPlayerAccount()`), reads of the mutable global `gamblingState`, and direct
`renderGamblingTab()` / `pushGamblingState()` calls.

Those three functions were split: the pure computation (draw a number and compute payouts;
shuffle and deal; run the dealer AI and resolve outcomes) moved to game-engine.js as
`resolveRouletteSpin(table, rand)`, `resolveBlackjackDeal(table, rand)`, and
`resolveBlackjackDealerPlay(table)`, each taking the table object explicitly and returning it
mutated — same behavior as before, just relocated across the module boundary. The original
three functions stay in the monolith as thin wrappers: permission check, call the extracted
resolver, render, push.

This is the one place this phase did more than "move code" — it's a genuine (small, scoped)
refactor to establish a real module boundary, which the instructions for this phase explicitly
permit ("move/refactor only what is necessary to establish the module boundary"). The game rules
themselves (wheel order, payout multipliers, dealer-stands-on-17, blackjack pays 2.5x, etc.) are
byte-for-byte unchanged — only where the DOM/global-touching code stops and the pure code starts
moved.

### Randomness

Every function that needs randomness (`battleRollDamage`, `rn`, `ri`, `weightedPickFromObject`,
`freshShuffledDeck`, `resolveRouletteSpin`, `resolveBlackjackDeal`, `applySlotsAction`,
`applyPokerAction`) takes an **optional trailing `rand` parameter** — a `() => number in [0,1)`
function, defaulting to `Math.random`. Existing callers that don't pass one get identical
behavior to before extraction. The regression tests pass a fixed/constant `rand` to get
deterministic, assertable output without needing to touch or weaken the actual game rules.

**Known, intentional duplication:** `rn`, `ri`, and `weightedPickFromObject` also still exist as
their own separate definitions in the monolithic HTML file, unchanged, because they're
general-purpose utilities used throughout the app far beyond the six Phase 1 target areas (loot
generation, chest/corpse rolls, journey encounters, etc.). Removing the monolith's own copies and
routing every one of those call sites through the `window.X` bridge instead was judged a bigger
blast radius than this phase's scope warranted — see "Not extracted" below. game-engine.js's
internal copies are self-contained (it can't import from the monolith, by definition) and
behaviorally identical to the monolith's originals.

### Not extracted, and why

- **`rn`, `ri`, `weightedPickFromObject`** (monolith's own copies) — general utilities with a
  much wider blast radius than the six target areas; left in place rather than routing dozens of
  unrelated call sites through the bridge for no behavior change. game-engine.js has its own
  internal copies (see "Randomness" above).
- **`spinRouletteWheel`, `blackjackDeal`, `blackjackDealerPlay`, `blackjackNewRound`,
  `rouletteNewRound`, and every `render*Html`/`*PullLever`/`*Deal`/`*Draw`/`*ToggleHold` gambling
  UI function** — genuinely DOM- and multiplayer-state-coupled (permission checks, `document.
  getElementById`, `gamblingState` global reads/writes, `renderGamblingTab()`/
  `pushGamblingState()`). These stay in the monolith by design; the pure cores they call now live
  in game-engine.js (see above).
- **`computeWeaponAttackRoll`, `weaponAttackRollHtml`, `rollEquippedWeaponAttack`,
  `collectEquippedWeaponInfo`, `parseWeaponEffectBonuses`** — genuinely UI-coupled (DOM reads/
  writes, modal open/close) and not on the original target list. `computeWeaponAttackRoll` calls
  the now-bridged `battleRollDamage`, same as before. Not extracted this phase, but a reasonable
  Phase 2+ candidate if a future phase wants the weapon-attack math itself pulled out separately
  from its DOM wrapper.
- **The entire Dice Roller feature** (`DICE_TYPES`, `DICE_SHAPES`, `diceIconSvg`, the dice tray
  state and all its render/roll functions) — not a Phase 1 target at all (not game *rules*, just
  a UI utility with its own animation timing), left untouched in the monolith.
- **`GAMBLING_HANDLERS`, `gamblingState`, `pushGamblingState`, `hostGamblingGame`,
  `closeGamblingTable`, `submitGamblingAction`, `applyGamblingAction`, `renderGamblingShell`,
  `checkOwnGamblingPayout`, `placeGamblingBet`, `renderGamblingTab`, `gamblingSelfUid`,
  `gamblingSelfName`** — the shared gambling framework shell. Reads `window.getMultiplayerSelf`,
  mutates the `gamblingState` global, calls `window.pushGamblingState`. Correctly UI/multiplayer
  coupled; not a candidate for this phase.

### The `window.X` bridge

A small inline `<script type="module">` near the top of the main HTML file (right before the
`APP_VERSION` script block) does:

```js
import * as GameEngine from './game-engine.js';
Object.assign(window, GameEngine);
```

Every extracted function/constant is then called from the rest of the (still classic, non-module)
script exactly as it was before extraction — `classifyItemFull(item, rarity)`,
`battleParseAttack(text)`, etc. — resolving through the global object rather than a local
`function` declaration. This is explicitly a temporary migration shim, matching the same pattern
`multiplayer-sync.js` already established for its own (differently-directed) bridge — not the
intended final architecture, which should use explicit module imports throughout once more of the
app has followed the engine out of the monolith.

#### The ordering problem this created, and how it was actually handled

Module scripts execute after the document finishes parsing but *before* `DOMContentLoaded` fires,
regardless of where in the document the `<script type="module">` tag sits. The main script is a
classic (non-module) script, which runs synchronously, in document order, *during* parsing — so
it always finishes running *before* the bridge module executes, no matter where the bridge tag is
placed. Any code that runs at the main script's **top level** (i.e., not inside a function body
that's only called later) and touches a bridged name will hit a `ReferenceError`, because the
bridge hasn't run yet.

This phase's original audit checked for direct top-level *calls* to the six target function names
and found exactly one (the initial `lootData` classification pass). That single call was deferred
into a `document.addEventListener('DOMContentLoaded', ...)` listener and the fix was believed
complete.

**It wasn't.** Real browser validation (not just the Node regression suite, which has no
knowledge of script-loading order at all) surfaced two more categories the original audit missed:

1. **Top-level bare *references*, not calls** — `GAMBLING_HANDLERS.roulette = { newTable:
   newRouletteTable, applyAction: applyRouletteAction, ... }` reads `newRouletteTable` and
   `applyRouletteAction` as plain values, not function calls, so the original "search for
   `functionName(`" audit never matched it. All four `GAMBLING_HANDLERS.*` registration lines
   had this problem and were each wrapped in their own `DOMContentLoaded` listener.
2. **Transitive top-level calls** — the real app-entry-point call, `refreshAllViewsAfterStateApply()`
   (called at top level, right after `loadAppState()`), reaches `computeCharacterSheetFor` several
   layers down (`refreshAllViewsAfterStateApply` → `renderPlayerSlots` → `renderCharacterSheet` →
   `computeCharacterSheet` → `computeCharacterSheetFor`). No amount of grepping for the six target
   names directly would have caught this — the audit needed to check *every* top-level statement
   in the file, not just ones naming the target functions. That broader sweep was done after this
   bug surfaced (every non-function-declaration top-level statement in the main script was
   individually reviewed) and confirmed these were the only two additional cases.

**Lesson for future phases:** a "search for calls to the target function names" audit is not
sufficient to find every top-level ordering hazard a `window.X` bridge introduces. The reliable
check is to enumerate *every* top-level statement in the file (not just ones matching the target
names) and verify each one either doesn't touch bridged code, or is safely inside an event
listener / timeout callback that won't fire until well after the bridge has loaded.

#### A second mistake, also worth recording

While removing the (correctly targeted) character-sheet functions from the monolith, a bulk
line-range deletion (removing everything between two grep-located line numbers) was used without
first re-reading the *entire* span about to be deleted. The line range actually contained a large
amount of unrelated code that was never meant to be touched — `collectEquippedWeaponInfo`,
`parseWeaponEffectBonuses`, `computeWeaponAttackRoll`, `weaponAttackRollHtml`,
`rollEquippedWeaponAttack`, `closeWeaponAttackPopup`, and the entire Dice Roller feature — all
sitting between `collectEquippedAcBreakdown` (a real target) and `computeCharacterSheetFor`
(also a real target). This was caught by the same real-browser validation pass (a
`ReferenceError: collectEquippedWeaponInfo is not defined`), diagnosed via `git diff` against the
pre-edit working tree, and restored verbatim from the diff's removed-lines.

**Lesson for future phases:** before any bulk line-range deletion, read the *complete* span about
to be removed, not just its start/end boundary markers — grep-based boundary-finding after
earlier edits have shifted line numbers is not a substitute for confirming what's actually inside
the range. Prefer precise, exact-string `Edit` operations over line-range deletion wherever
practical; they fail loudly (no match found) instead of silently deleting unintended content.

### How the extracted engine is consumed today

- **The monolithic HTML app** (`dungeon_loot_wheel_v96_spell_details.html`) — via the `window.X`
  bridge described above. This is the only real consumer right now.
- **The regression test suite** (`game-engine.test.js`) — via a direct `import * as GE from
  './game-engine.js'`, run with `node --test`. No browser, no DOM, no bridge involved — this is
  the clearest proof the module genuinely has zero DOM dependency, since Node has no DOM at all.

### What this enables for the future server architecture

`game-engine.js` can be `import`ed directly by a future Node.js server (Phase 3) with zero
changes — it already has no dependency on `window`/`document`/`localStorage`, and every
randomness-dependent function already accepts an injectable source, which a
server-authoritative design will want anyway (e.g., a server-side seeded RNG per game session,
rather than trusting `Math.random()` per client). The gambling resolution split (pure
`resolve*`/`apply*` functions vs. DOM-coupled wrappers) is exactly the shape a server-authoritative
model needs: the server would own the `table` state and call the same pure resolvers this phase
already extracted, with the client-side wrappers eventually replaced by network calls instead of
direct function calls.

### Validation performed

- All 25 Node regression tests pass (`node --test`), covering item classification (weapon/potion/
  ring classification, idempotency, attunement interactions), character sheet math (gear bonuses,
  proficiency scaling, save/skill/AC/max-HP totals), battle parsing (multi-damage-type clauses,
  save DCs, deterministic damage rolls, crit doubling, effectiveness boundaries), and all four
  gambling games (roulette payouts and spin resolution, blackjack hand values and dealer AI,
  slots weighted reels, poker hand evaluation across every rank tier).
- The live app was loaded in a real browser (not just Node) and confirmed to load without
  JavaScript errors — this is what surfaced the two bridge-ordering bugs and the accidental
  deletion described above, none of which the Node test suite alone could have caught, since it
  has no concept of script-loading order or of code paths the tests don't happen to exercise.
- Manually spot-checked after all fixes: item generation (classification still shows), the
  character sheet (stats/AC/skills compute), equipping a weapon and using the ⚔ Attack button
  (exercises the restored weapon-attack code specifically), and the dice roller (exercises the
  other restored code) — all confirmed working.
- No unrelated files were modified — `loot-data.js`, `puzzle-data.js`, `multiplayer-sync.js`,
  `index.html` are untouched.

## Phase 2: SQLite / Database Foundation

Scope for this phase, confirmed before starting: build the schema and a Node-side data-access
layer only, with its own regression tests — same pattern as Phase 1's `game-engine.js`. **Not**
wired into the live browser app yet; that's later work (the live app still uses
`localStorage`/`saveAppState`/`loadAppState`, untouched). This phase exists to have something
real for Phase 3's Node.js server to build on rather than inventing the schema and the server at
the same time.

### Library choice: `node:sqlite`, not `better-sqlite3`

Node's own built-in SQLite module, not an npm package. Confirmed working on the Node version
installed for this migration (`node:sqlite`'s `DatabaseSync` class). Chosen over `better-sqlite3`
specifically to avoid adding a native-compiled dependency (an npm package that compiles C++ on
install) for something Node now ships itself. **Real risk, stated plainly:** `node:sqlite` is
still marked experimental by Node as of this writing. If a future phase's Node version drops it,
renames its API, or a production deployment needs a Node version where it's unavailable/unstable,
swapping to `better-sqlite3` would be a contained change — nothing outside `db/database.js`
imports from `node:sqlite` directly, and `better-sqlite3`'s synchronous `.prepare()/.run()/.get()/
.all()` API is close enough to `node:sqlite`'s that the rest of `database.js` likely wouldn't need
to change shape, just the `import` line and the constructor call in `openDatabase`.

### Schema design: partial normalization, not a full relational redesign

`db/schema.js` has the full `CREATE TABLE` statements and the reasoning inline; summarized here.
The current app persists one flat JSON blob (see `saveAppState`/`applyStateBlob` in the monolith)
covering everything from equipped gear to gambling table state. Rather than either (a) leaving
it as one blob column in SQLite, which wouldn't be much of a foundation, or (b) speculatively
designing a fully normalized schema for every field before any future phase has established real
query patterns against this data, this phase split the difference:

- **`campaigns`** — one row per save/campaign. The natural top-level entity everything else hangs
  off of.
- **`characters`** — genuinely relational, real columns (ability scores, level, HP, AC, class,
  etc.), one row per character per campaign. This is the one piece of the old blob that clearly
  benefits from being queryable rows rather than JSON — it maps directly onto
  `computeCharacterSheetFor`'s inputs from Phase 1's `game-engine.js`, and a server-authoritative
  future phase will very plausibly want to query/filter on these columns (e.g. "every character
  below half HP").
- **`campaign_state`** — a generic `(campaign_id, subsystem, data)` bucket for the eleven other
  areas the old blob covered (inventory, battle, merchant, bounties, mangler, loot_settings,
  effects, claims, journey, puzzle_log, gambling — see `SUBSYSTEMS` in `db/schema.js` for the
  exact old-field-name mapping for each). These keep their current JSON shape unchanged, but
  scoped per campaign *and* per subsystem instead of one flat blob — a real improvement (updating
  the gambling table no longer means reading/writing the entire rest of the campaign's state too)
  without guessing at a larger relational design nothing has validated a need for yet. Each
  subsystem row is a clean seam for a later phase to normalize individually, on its own schedule,
  without disturbing the others.

### Data-access layer (`db/database.js`)

`openDatabase(path)` opens (or creates) a database file, turns on `PRAGMA foreign_keys`, and
applies the schema — safe to call repeatedly (every `CREATE TABLE`/`CREATE INDEX` is
`IF NOT EXISTS`). Everything else is a small set of plain functions taking `db` as their first
argument (no class, no hidden state) — `createCampaign`, `getCampaign`, `listCampaigns`,
`touchCampaign`, `upsertCharacter`, `getCharacter`, `getCharacterById`, `listCharacters`,
`saveSubsystemState`, `loadSubsystemState`, `loadAllSubsystemState`.

`upsertCharacter` deliberately mirrors `applyStateBlob`'s existing "field-by-field, only
overwrite what's actually present" behavior — passing a partial sheet (e.g. just `{ level: 6 }`)
updates only that field and leaves the rest of the row untouched, the same contract the current
localStorage-based save/load already promises callers.

`saveSubsystemState`/`loadSubsystemState` validate the subsystem name against `SUBSYSTEMS` from
`db/schema.js` and throw on an unrecognized one, rather than silently accepting a typo'd
subsystem name that would then never be found again.

### What this enables for Phase 3

A Node.js server can `import { openDatabase, ... } from './db/database.js'` directly — this
module has no dependency on the browser app at all (confirmed the same way Phase 1 confirmed
`game-engine.js`'s browser-independence: it only runs under Node, in tests, with no DOM involved
anywhere). Phase 3/4 will need to decide how the monolith's current `saveAppState`/
`applyStateBlob` field-by-field logic maps onto calls into this module (likely: the server calls
`upsertCharacter`/`saveSubsystemState` on writes it receives from clients, and
`getCharacter`/`loadAllSubsystemState` to reconstruct a full state blob to send to a newly
connecting client) — that mapping is Phase 3/4 work, not done here.

### Validation performed

- All 41 Node regression tests pass (`node --test` — 25 from Phase 1's `game-engine.test.js`,
  16 new in `db/database.test.js`), covering campaign CRUD, character upsert (both full-sheet
  creation and partial-field updates), per-subsystem state save/load/overwrite/isolation-between-
  campaigns, subsystem-name validation, and foreign-key cascade deletes.
- Confirmed `node:sqlite` actually works on the Node version installed for this project before
  writing any code against it (a real, not assumed, dependency check).
- Not wired into the live browser app, per the confirmed scope — no live-app validation needed or
  performed this phase, unlike Phase 1.
- No unrelated files modified.

## Phase 3: Node.js Server

Scope for this phase, confirmed before starting: stand up a real Node.js server exposing Phase
2's persistence layer over a REST API, with its own regression tests. **Not** wired into the live
browser app yet — that's Phase 4 ("server-authoritative game state"), once the server is trusted
to actually own game truth rather than just store/retrieve it on request. Also confirmed before
starting: plain Node `http`, not Express — this is the project's first point where adding a real
npm dependency was a live option, and the deliberate choice was to stay dependency-free rather
than add one by default.

### What the server exposes (`server/server.js`)

`createServer(db)` takes an already-open database (same dependency-injection shape as Phase 1/2)
and returns a plain `http.Server` with these routes, all wrapping the Phase 2 functions of the
same shape:

```
POST   /campaigns                                  create a campaign
GET    /campaigns                                  list campaigns
GET    /campaigns/:id                               get one campaign
GET    /campaigns/:id/characters                    list characters in a campaign
GET    /campaigns/:id/characters/:accountUid         get one character
PUT    /campaigns/:id/characters/:accountUid         upsert one character
GET    /campaigns/:id/state                          load every saved subsystem's state
GET    /campaigns/:id/state/:subsystem               load one subsystem's state
PUT    /campaigns/:id/state/:subsystem               save one subsystem's state
```

`:accountUid` accepts the literal token `_solo` to address the null-account-uid solo/guest
character slot from Phase 2's schema — a URL path segment can't carry a real `null`, and reusing
the string `"null"` risked colliding with a real (if unlikely) account uid, so a distinct token
was used instead.

No routing framework — the whole point of choosing plain `http` was staying small enough not to
need one, and a handful of fixed path-segment patterns matched positionally is genuinely simpler
here than adding a dependency to get pattern-matching syntax sugar.

### Error handling

Every route validates its inputs and returns a real status code rather than throwing an
unhandled exception into the process: `400` for a non-numeric campaign id, a missing/invalid
body field, an unrecognized subsystem name (reusing Phase 2's own `SUBSYSTEMS` validation, not a
separate list that could drift out of sync with it), or malformed JSON; `404` for a campaign,
character, or unsaved-subsystem that doesn't exist; `405` for a valid route hit with the wrong
HTTP method; `500` as a last-resort catch-all for anything unexpected. A malformed-JSON request
is confirmed (by a regression test, not just an assumption) to leave the server able to handle
the *next* request normally — the whole process doesn't go down over one bad client request.

### Validation performed

- All 59 Node regression tests pass (`node --test` — 41 from Phase 1/2, 18 new in
  `server/server.test.js`), covering every route's success path, every documented error status,
  the `_solo` token mapping, and that a malformed request doesn't take the server down.
- The server tests make real HTTP requests (Node's built-in `fetch`) against a real
  `http.Server` listening on an OS-assigned port, not mocked request/response objects — this
  exercises the actual routing and JSON-parsing code exactly as a real client would.
- Beyond the automated suite: manually started the server for real (`server/start.js`) against
  an actual SQLite file (not the tests' `:memory:` database) and hit it with `curl` — created a
  campaign and listed it back — confirming the real end-to-end path (file-backed DB, a process
  actually listening on a TCP port) works, not just the in-process test harness.
- Not wired into the live browser app, per the confirmed scope.
- No unrelated files modified.

## Phase 4: Server-Authoritative Game State (first slice)

This phase's scope is deliberately much narrower than its name might suggest. "Server-
authoritative game state" as a literal reading of the roadmap could mean re-architecting every
state mutation across the entire monolith — confirmed before starting that this was too large
and risky to attempt as one phase (informed directly by how much Phase 1's much smaller scope
still surfaced real bugs under actual testing). What was built instead: **gambling resolution**
is now genuinely server-authoritative, as a first, well-bounded proof of the concept, with
everything else — combat, inventory, character state, the rest of multiplayer — untouched and
still working exactly as it does today.

### What "authoritative" means here, concretely

Every resolution step (`resolveRouletteSpin`, `resolveBlackjackDeal`,
`resolveBlackjackDealerPlay`, `applySlotsAction`, `applyPokerAction`) is called from
`server/gambling.js` with **no `rand` argument**, so each one falls back to its own default —
the server process's own `Math.random`. Nothing in the request body is ever read as a source of
randomness or a proposed outcome. A client can ask the server to host a game, place a bet, or
trigger a spin/deal/dealer-play — it cannot supply what number the wheel lands on or what cards
get dealt. This is provable by inspection (`resolveRouletteSpin(state.table)` — one argument,
the table, nothing from `body`) and is exercised by a regression test that sends an extra
`number` field alongside a real spin request and confirms it has no special handling anywhere in
the code path.

This is a narrow, specific definition of "authoritative" — it does not yet mean the server
enforces *who* is allowed to do what (see "Known gap: no authorization" below).

### New routes (`server/gambling.js`, wired into `server/server.js`)

```
GET  /campaigns/:id/gambling             current { game, table } (or the empty state if nothing hosted)
POST /campaigns/:id/gambling/host        body: { game } — creates a fresh table for that game
POST /campaigns/:id/gambling/action      body: { type, ... } — place_bet / hit / stand / spin / deal / draw,
                                          dispatched to the hosted game's applyAction, same shape
                                          the monolith's own GAMBLING_HANDLERS[game].applyAction already uses
POST /campaigns/:id/gambling/resolve     body: { step: 'spin' | 'deal' | 'dealerPlay' } — the DM-only
                                          steps that were split out of the monolith's spinRouletteWheel /
                                          blackjackDeal / blackjackDealerPlay back in Phase 1
POST /campaigns/:id/gambling/close       clears the hosted table
```

Slots and Poker fully resolve inside a single `/action` call (their `applyAction` already does
everything, per Phase 1's finding that those two games needed no pure/impure split). Roulette
and Blackjack need `/action` for bets (and hit/stand, for Blackjack) plus a separate `/resolve`
call for the actual spin/deal/dealer-play — this mirrors exactly the split Phase 1 already
documented between each game's `applyAction` and its separate DM-triggered resolution function.

**The Phase 3 route is untouched and still works**: `PUT /campaigns/:id/state/gambling` still
lets a caller overwrite the raw gambling blob directly, no different from Phase 3. Both routes
read and write the exact same underlying storage (`campaign_state` where `subsystem =
'gambling'`) — the new routes don't replace the old one, they add a second, validated way to
reach the same data that actually runs the game rules instead of trusting a client's own
computed result.

### Known gap: no authorization (deliberately not invented here)

Nothing in this phase checks *who* is allowed to host a game, place a bet on someone else's
behalf, or trigger a dealer-play step — there is no account/session/auth concept anywhere in
this server yet (Phase 2/3 never introduced one). The monolith's own client-side equivalent
(`isRealPlayerAccount()`) is a UI-trust convention, not real enforcement, and this phase
deliberately did not invent a real authorization system to paper over that gap — doing so would
mean guessing at a design nothing has asked for yet. **This is a real, acknowledged limitation,
not an oversight**: a genuinely secure deployment (anyone able to reach the server over a
network, not just a DM's own local process) would need real auth before these routes could be
trusted the way "authoritative" implies. Worth deciding explicitly in Phase 5 or a dedicated
follow-up, not assumed away here.

### What this enables for Phase 5

Phase 5 ("WebSocket multiplayer — replaces the current Firebase-based sync layer") is where the
live browser app would actually start calling these routes instead of resolving gambling
locally and pushing the result to Firestore. This phase deliberately stopped short of that
wiring (per the confirmed scope) so Phase 5 can focus entirely on the transport-layer swap
(Firestore's `onSnapshot` model → WebSocket) without also debugging new server-side game logic
at the same time.

### Validation performed

- All 72 Node regression tests pass (`node --test` — 59 from Phases 1–3, 13 new in
  `server/gambling.test.js`), covering hosting/closing, every game's action + resolve flow
  (roulette bet+spin, a full blackjack round through deal/stand/dealer-play, a slots spin, a
  poker deal+draw), rejecting resolve steps that don't match the hosted game or current phase,
  rejecting actions before anything is hosted, and confirming the Phase 3 raw-blob route still
  works unchanged alongside the new ones.
- These tests use the server's real, non-deterministic randomness (no injected `rand`, unlike
  Phase 1's own tests) — run six consecutive times during validation with no flakiness, rather
  than trusting a single green run given real RNG is involved.
- Not wired into the live browser app, per the confirmed scope.
- No unrelated files modified.

## Phase 5a: WebSocket Sync — Core State Loop (first sub-phase of Phase 5)

"Phase 5: WebSocket multiplayer, replaces the current Firebase-based sync layer" turned out to
be a much bigger phase than its name suggests once actually audited (see below) — large enough
that attempting it as one phase was explicitly rejected in favor of breaking it into sub-phases.
This is the first one: replacing only `multiplayer-sync.js`'s core state push/listen loop
(`pushOwnState`/`startPlayerListener`) and its three cross-player writes (`applyHpDelta`,
`giftItemToPlayer`, `setPlayerInventoryFields`). Everything else `multiplayer-sync.js` does —
listed in full below — is explicitly out of scope for this sub-phase.

### Why this got broken into sub-phases

A full audit of `multiplayer-sync.js` (1,538 lines) found it's not one system but four bundled
together:

1. **Authentication** — real Firebase accounts, username/password disguised as fake emails,
   session persistence, signup rollback-on-failure logic. Has nothing to do with WebSocket vs.
   Firestore as a transport — it's a full login system.
2. **Real-time state sync** — the core push/listen loop, with real hard-won correctness logic: a
   `rev` counter to detect and drop stale/out-of-order writes, and a separate `extRev` counter so
   a DM's write to a player's doc is never mistaken for that player's own echo.
3. **Race-condition arbitration** — real-time loot claims rely specifically on Firestore's
   create-vs-update security rule semantics to get true first-write-wins with zero server-side
   code. Replacing the transport doesn't replace this arbitration; something else has to do that
   job.
4. **A whole login/account UI** — the gate screen, signup/login forms, account panel, roster
   display, guest mode. Injected DOM/CSS, tightly coupled to the auth flow.

Plus, underneath those: room/campaign membership, a DM-review queue for player attacks
(`submitBattlefieldAttack`/`startAttackRequestListener`), battlefield/puzzle-log broadcast with
loot-visibility filtering, and a DM-only roster listener across every player in a room.

Given Phase 1 already demonstrated that real bugs surface even at a much smaller scope than
this, attempting all four systems (plus the six-plus remaining subsystems) in one phase was
rejected. **Confirmed scope for this sub-phase**: keep Firebase Auth completely untouched
(system #1 above, and the account UI, #4, stay exactly as they are); build only the core sync
loop and cross-player writes (system #2); explicitly defer loot-claim arbitration, battlefield/
puzzle-log broadcast, and the roster listener to their own future sub-phases.

### What changed vs. the original design, and why it's simpler

The original's `rev`/`extRev` two-counter scheme exists entirely to solve a problem specific to
Firestore's `onSnapshot`: it always echoes a client's own writes back to that same client, so the
app needs its own logic to tell "this is just my own write bouncing back, ignore it" apart from
"the DM actually changed something." A WebSocket server is stateful and knows exactly which
connection sent which message — so it can simply never send a `state_update` back to the
connection that sent the `push_state` that caused it. This eliminates the self-echo problem by
construction rather than by counter-comparison logic; confirmed by a dedicated regression test
(`the pushing connection never receives its own push back`) that would fail loudly if this
invariant were ever broken.

What's still needed and still present: a single `rev` field, guarding against a narrower problem
that doesn't go away — two rapid pushes from the *same* client arriving out of order over the
network, where an older one's round-trip happens to finish after a newer one's. `push_state`
compares the incoming `rev` against what's already persisted and drops anything not strictly
newer.

### Schema addition: `player_states` (see `db/schema.js`)

Phase 2's `campaign_state` table is scoped per `(campaign_id, subsystem)` — built for
campaign-wide DM settings (loot rarity weights, journey log, etc.), all owned by one account.
A player's full save-state blob (inventory, equipped gear, character sheet) is inherently
per-*player*, mirroring exactly what Firestore's `rooms/{code}/players/{uid}` document already
was — a shape Phase 2 never needed to model since it only ever handled a DM's own data. Rather
than force per-player blobs into the campaign-wide table (which the code doesn't even allow —
`saveSubsystemState` validates the subsystem name against a fixed list) or invent something more
elaborate, this phase added one small, directly-analogous table: `(campaign_id, account_uid,
state, rev)`, one row per player per campaign. `db/database.js` gained `savePlayerState`,
`loadPlayerState`, `loadAllPlayerStates` to match, with their own regression tests.

### Message protocol (`server/websocket.js`)

JSON messages over a `ws` WebSocket connection, sharing the same TCP port as the REST API (the
`ws` package upgrades HTTP connections on the existing `http.Server` instance — no second port
needed):

```
client -> server:
  { type: 'identify', campaignId, accountUid, role, username }   -- must be sent first
  { type: 'push_state', rev, state }                              -- persists the sender's own state
  { type: 'hp_delta', targetUid, delta }                          -- DM only
  { type: 'gift_item', targetUid, item }                          -- DM only
  { type: 'set_inventory_fields', targetUid, fields }             -- DM only
server -> client:
  { type: 'identified', state, rev }    -- ack, plus whatever was already persisted for this account
  { type: 'state_update', state, rev }  -- this account's state changed (a DM cross-write landed)
  { type: 'error', message }
```

`hp_delta` clamps the same way the original did (floors at 0, ceilings at
`characterMaxHpEffective`/`characterMaxHp` if known) — including the same behavior for a target
with no prior state at all (current HP treated as 0, so any negative delta floors straight to 0,
not a negative number). A cross-player write to a target with no live connection still persists
correctly and is delivered the next time that account identifies — confirmed by a dedicated test,
not just assumed.

### `ws` package — first real npm dependency

Node has no built-in WebSocket *server* (only an experimental client, for connecting outward).
Per the user's confirmed choice, this uses the `ws` package — the de facto standard, rather than
hand-rolling the handshake/framing protocol from raw `http`/`net`. This is the project's first
real dependency; `package.json` and `.gitignore` (for `node_modules/`, plus `*.db`/`*.db-journal`
so a locally-running server's database file is never accidentally committed) were added this
phase.

### Deliberate, documented gap: no identity verification

The server trusts whatever `accountUid`/`role` a client's `identify` message claims — it does not
cryptographically verify this against a real Firebase session. Real verification would mean
pulling in Firebase Admin SDK to check ID tokens server-side on every connection, which is a
separate integration effort from what this sub-phase is actually about (sync-loop correctness).
Same trust model Phase 4 already established for gambling ("no authorization" gap) — noted here
explicitly rather than silently inherited.

### What's still needed for "Phase 5" as originally named (future sub-phases)

- **Loot-claim first-write-wins arbitration** — needs the WebSocket server itself to do what
  Firestore's create-vs-update security rules did implicitly: reject a second claim on the same
  drop once the first has landed.
- **Battlefield/puzzle-log broadcast** — DM-authored state pushed to every connected player in a
  room, including the loot-visibility filtering (`pushBattlefieldState` strips unrevealed/
  reserved/claimed items before it ever reaches a player).
- **DM roster listener** — a live, thin (username/HP/AC) summary across every player in a room,
  for the Combat tab's targeting UI.
- **Attack-request review queue** — a player submits a weapon-attack roll, the DM applies/
  dismisses it.
- **Authentication and the account/login UI** — deliberately untouched in this sub-phase;
  whether Firebase Auth stays permanently (only ever replacing the real-time sync/game-state
  parts) or eventually gets replaced too is an open question for a future conversation, not
  decided here.

### Validation performed

- All 90 Node regression tests pass (`node --test` — 78 from Phases 1–4 plus the `player_states`
  schema additions, 12 new in `server/websocket.test.js`), covering identify (including unknown
  campaign and pre-identify-message rejection), push/reconnect round-tripping, the no-self-echo
  guarantee, stale-push rejection, all three cross-player writes (including HP clamping at both
  floor and ceiling), non-DM rejection, and delivery-on-reconnect for an offline target.
- A real end-to-end smoke test: started the actual server process (`server/start.js`) against a
  real file-backed SQLite database, created a campaign via the REST API, then connected a real
  `ws` client to the *same port* and successfully identified — confirming the shared-port HTTP/
  WebSocket upgrade actually works outside the in-process test harness, not just inside it.
- Not wired into the live browser app, per the confirmed scope.

### Two real bugs found by running the suite dozens of times, not just once

After merging, running the full suite a single time isn't enough to trust it — both of these
were caught only by deliberately running `node --test` 40–50 times in a row and treating any
non-zero failure count as worth chasing down, not dismissing as a fluke.

1. **`websocket.test.js` used fixed `setTimeout` delays** ("give the server a moment to
   process") instead of waiting for real confirmation, which is a classic source of rare,
   load-dependent flakiness — a delay that's "usually enough" isn't the same as actually knowing
   an operation finished. The real fix wasn't a longer delay: `server/websocket.js` gained two
   new server→client acks it was missing — `push_ack` (confirms a `push_state` was actually
   persisted) and `cross_write_ack` (confirms `hp_delta`/`gift_item`/`set_inventory_fields`
   landed, sent back to the DM's own connection). This closes a real gap, not just a test
   convenience: the original Firestore design already let a caller `await` `pushOwnState`'s own
   promise to know a write landed; this WebSocket version had no equivalent until now. Tests were
   rewritten to await these acks instead of guessing a delay — incidentally also making the suite
   noticeably faster (several hundred milliseconds of artificial sleeps removed).
2. **A pre-existing Phase 4 test in `server/gambling.test.js`** ("dealerPlay is rejected while a
   hand is still mid-play") implicitly assumed a dealt blackjack hand would never happen to be a
   natural 21 — but with real, non-seeded randomness (the HTTP layer exposes no way to inject a
   deterministic `rand`), that happens roughly 1 deal in 20, which sets the player's status to
   `'blackjack'` instead of `'playing'` and makes `dealerPlay` legitimately succeed instead of
   being rejected — not an application bug, but a test whose stated precondition ("p1 never
   stands/busts — still 'playing'") wasn't actually being enforced. Fixed with a bounded retry
   (re-deal until the real precondition holds, capped at 20 attempts with a clear failure message
   if it somehow never does) rather than papering over it.

Confirmed fixed, not just quieted: 80 consecutive clean runs (`node --test`, 0 failures) after
both fixes, versus a roughly 5-10% failure rate per run beforehand.

## Phase 5b: WebSocket Sync — Loot-Claim Arbitration

The second Phase 5 sub-phase (see Phase 5a above for why Phase 5 was broken up in the first
place). Replaces `createLootClaim`/`startLootClaimListener` — the original's real-time,
first-write-wins loot claiming.

### What the original relied on, and its direct SQL equivalent

The original design never wrote any arbitration logic at all: a claim doc write at a
deterministic id (`monsterUid_itemId`) either succeeds as Firestore's own "create" (first writer)
or fails as a denied "update" (everyone after), enforced entirely by the security rules quoted at
the top of `multiplayer-sync.js`. This phase's equivalent is a `UNIQUE(campaign_id, claim_id)`
constraint on the new `loot_claims` table (`db/schema.js`) — an `INSERT` for a pair that already
exists fails outright with a constraint error rather than silently overwriting, which
`db/database.js`'s `createLootClaim` catches and translates into a plain `{ won: false, ... }`
return value naming the actual winner, rather than an exception callers have to unwrap. Same
no-read-then-write-race-window guarantee, different engine.

### Deliberately does not carry item data

Matching the original exactly: a claim only ever records *who won the race for a given claim id*
— never the item itself. In the original, delivering the actual item to the winner was always a
separate step (a reactive listener on the winning client, using item data it already had
locally). This phase preserves that split rather than collapsing it, since actually delivering
loot is tangled up with battlefield state (which items are even visible/claimable in the first
place) — a separate, not-yet-built sub-phase.

### Message protocol addition (`server/websocket.js`)

```
client -> server:
  { type: 'create_loot_claim', claimId, claimedByUid, claimedByUsername }
    -- claimedByUid must equal the sender's own accountUid, UNLESS the sender is the DM
    -- claiming on someone else's behalf (a gift) -- matches dmGiveLootItem's own permission
    -- check in the original.
server -> client:
  { type: 'loot_claim_result', claimId, won, claimedByUid, claimedByUsername }
    -- sent back to whoever sent create_loot_claim, win or lose, always naming the real winner
  { type: 'loot_claim_update', claimId, claimedByUid, claimedByUsername }
    -- sent to the DM's live connection (only if the DM wasn't the one claiming), so their
    -- roster can mark the item claimed -- matches markLootClaimOnRoster's role in the original
```

No one else is notified of a claim — matching the original precisely: a losing *other* player's
own listener in `multiplayer-sync.js` (`claim.claimedBy !== mp.uid`) was always a silent no-op
for them, so there was never any real behavior to replicate there.

### Finding the DM's connection

Reaching the DM's live connection (for `loot_claim_update`) needed something Phase 5a's room
tracking didn't have — Phase 5a's `rooms` map was keyed `accountUid -> ws` for direct
target-uid lookups only, with no way to ask "who is the DM here" without also knowing their uid.
Widened to store `{ ws, role, username }` per entry instead of a bare `ws`, so `findDmConnection`
can scan a room's connections for `role === 'dm'`. A small, backward-compatible widening — every
existing lookup by uid still works unchanged, just reads `.ws` off the stored object now.

### Validation performed

- 10 new tests (5 in `server/websocket.test.js`, 5 in `db/database.test.js`), and the full suite
  (100 tests total) still passes, including a real race test: two client connections fire
  `create_loot_claim` for the *same* claim id without awaiting between them (deliberately not
  controlling which one the server happens to process first), and the test asserts exactly one
  side reports `won: true` and the other's `loot_claim_result` correctly names the actual winner.
- Given the fixed-test-flakiness lesson immediately above, this wasn't trusted after one clean
  run: 70 consecutive clean runs (40 full-suite, 30 targeted at just this file) before treating
  it as validated.
- Not wired into the live browser app, per the confirmed scope.

## Phase 5c: WebSocket Sync — Battlefield/Puzzle-Log Broadcast

The third Phase 5 sub-phase. Replaces `pushBattlefieldState`/`startBattlefieldListener` and
`pushPuzzleLogState`/`startPuzzleLogListener` — the DM-to-all-players broadcast of combat and
puzzle state, including the original's loot-visibility filtering.

### New subsystem buckets, not a new table

`battlefield_broadcast` and `puzzle_log_broadcast` were added to the existing `SUBSYSTEMS` map
(`db/schema.js`), reusing Phase 2's `campaign_state` table rather than adding a new one.
Deliberately kept separate from the pre-existing `battle`/`puzzle_log` subsystems, which hold the
DM's own *private* full save-state (matching `saveAppState`'s raw fields verbatim) — the
broadcast versions hold the loot-*filtered*, player-facing publication of that data. Conflating
the two under one name would either leak DM-only data to players or silently drop the DM's own
unfiltered save data.

### Loot-visibility filtering, replicated exactly

`filterBattleRosterForPlayers` mirrors the original's own destructuring line-for-line: an
**allowlist** of safe fields (never a blacklist of sensitive ones — "there is nothing for a
player to find via devtools that the DM hasn't chosen to share," per the original's own comment),
loot entirely absent until `lootRevealed`, and even after reveal, individually stripping
`reserved`/already-`claimedBy` items. Confirmed with dedicated tests for each condition
separately (unrevealed loot never sent at all; revealed loot strips reserved/claimed items but
keeps the rest; a field deliberately not on the allowlist never reaches a player), not just one
combined happy-path check.

### Deliberate simplification: no debounce

The original debounced both pushes client-side by 400ms, purely to limit Firestore *write
frequency* — a real cost/quota concern for a cloud database billed per write. That reasoning
doesn't transfer to a local SQLite file the DM's own server process writes to directly; there's
no per-write cost to amortize. Not replicated, noted here as a considered omission rather than a
missed detail.

### Catch-up on identify

A player who connects (or reconnects) after the DM already published a battlefield/puzzle-log
state doesn't have to wait for the *next* push — `identify` now also sends whatever's currently
in `battlefield_broadcast`/`puzzle_log_broadcast`, if anything, right after the `identified` ack.
This matches what Firestore's `onSnapshot` already did by firing immediately with the document's
current contents the moment a listener subscribes, rather than only on the next write.

### A real, structural test bug found while writing these tests — not just flakiness

Every new test in this sub-phase initially failed with a hard timeout, 100% reproducible (not
intermittent like the previous two sub-phases' bugs). The cause: this file's `nextMessage` helper
attaches a `.once('message', ...)` listener only at the moment it's *called*. If a message can
arrive on a connection before the test gets around to calling `nextMessage` on it — e.g. a
broadcast triggered by a *different* connection's action, while the test is still busy `await`ing
something else on that other connection first — Node's `EventEmitter` does not buffer the message
for a listener that attaches later. It fires into the void and is gone; the later `nextMessage`
call then waits forever for a message that already arrived and was already lost.

This is a different class of bug than the earlier fixed-delay flakiness: not "how long should I
wait," but "did I start listening before the message could possibly arrive at all." The fix is a
`messageQueue(ws)` helper that attaches a *persistent* `.on('message', ...)` listener the instant
it's called, queuing anything that arrives before the test asks for it — so a message genuinely
cannot be lost to this race regardless of how much other work happens in between. Used for every
connection in this sub-phase's tests that receives a broadcast it didn't itself trigger (the
receiving player, a late-joining player), while the original `nextMessage`/`assertNoMessage`
helpers were left in place for direct request→response exchanges (a connection awaiting its own
action's ack), where this race doesn't apply.

### Validation performed

- 10 new tests (`server/websocket.test.js`), full suite now 110 tests, all passing.
- Given both prior sub-phases' test-quality lessons, and this sub-phase surfacing a third,
  different kind of test bug on top: 70 consecutive clean runs (40 full-suite, 30 targeted at
  just this file) before treating it as validated.
- Not wired into the live browser app, per the confirmed scope.

## Phase 5d: WebSocket Sync — DM Roster Listener & Attack-Request Review Queue

The fourth and final planned Phase 5 sub-phase. Replaces `startRosterListener` (the DM's live view
of connected players' HP/AC) and `submitBattlefieldAttack`/`startAttackRequestListener`/
`resolveAttackRequest` (the DM-review queue a player's attack sits in until the DM applies or
dismisses it). With this sub-phase, every piece of Phase 5's original scope is done except
Firebase Auth itself — see "Open question" below.

### New table: `attack_requests`

Unlike `loot_claims`, deliberately has **no uniqueness constraint** (`db/schema.js`) — several
players each having an attack pending review at once is the normal, expected case, not a race to
arbitrate. `attack_data` stores the attack payload verbatim as JSON, matching the original's own
`{...attack, playerUid, playerUsername}` spread: this table doesn't need to understand the
payload's shape, only store and list it in submission order (`database.js`'s `listAttackRequests`
orders by `id ASC`, i.e. oldest first, matching the original's queue semantics).

### The roster is derived, not stored

There's no `roster` table. `buildRoster` (`server/websocket.js`) reads directly from the
in-memory `rooms` map (which connections are live right now, in which role) joined with each
connected player's already-persisted `player_states` row for their HP/AC — the same data
`push_state`/`hp_delta` already write for Phase 5a's sync loop. Recomputed fresh on every trigger
rather than cached anywhere, which is cheap at the scale a single DM's table game runs at and
avoids a second source of truth that could drift from `player_states`.

### Deliberate simplification: connected players only

The original tracked every player who had ever joined the campaign — Firestore's collection
listener sees every doc regardless of whether that browser is currently open, including a
last-known username/role for someone who's since gone offline. `buildRoster` only sees whoever is
currently in the in-memory `rooms` map. Replicating the original fully would mean persisting
username/role alongside `player_states` (today that table only stores the state blob + `rev`) — a
real, if small, schema change judged not worth it here, given the roster's main practical use
(targeting a live player in combat) only matters for players who are actually connected right now.
Noted as a genuine, deliberate scope reduction, not an oversight.

### When the roster refreshes

`broadcastRoster` fires to the DM's live connection only, on: the DM's own `identify` (immediate
initial view); a player's `identify` (join) and disconnect (leave); a player's own `push_state`;
and a DM cross-write (`hp_delta`/`gift_item`/`set_inventory_fields`) landing on a target, since
that can change the stats being displayed. HP is clamped to max HP in the roster payload itself,
matching `startRosterListener`'s own clamp in the original — a display-time correction distinct
from `hp_delta`'s own separate clamp on the stored value.

### Attack-request queue: full list, not a diff

Matching `startAttackRequestListener`'s own "hands the main file the full current list of pending
requests on every change" behavior exactly: both `submit_attack_request` and
`resolve_attack_request` re-send the DM's live connection the complete current list afterward,
never an incremental patch. A DM who connects after requests already exist catches up immediately
via the same `attack_request_list` sent on `identify`, the same catch-up spirit as Phase 5c's
battlefield/puzzle-log push.

### A second, larger instance of the Phase 5c test-message-loss bug

Adding `broadcastRoster` calls to `identify`, `push_state`, and the cross-write handlers meant the
DM's own connection could now receive an unsolicited `roster_update` at points several
already-passing Phase 5a/5b/5c tests didn't anticipate — not just the two tests that broke
outright (the battlefield/puzzle-log "never the DM" tests, both failing with
`actual: 'roster_update'` where a specific push ack was expected).

The deeper issue, found while investigating those two failures: a DM's own `identify` now
unconditionally sends two extra messages after `identified` (`roster_update` and
`attack_request_list`, for the DM's own catch-up) — messages every existing `connectAs` test
helper across the file only ever drained one of (`identified` alone). Any test that later
inspected the DM's own message stream (`nextMessage(dm)`/`assertNoMessage(dm)`) was at risk of
picking up a stale leftover instead of the message actually being tested for; two tests did so
outright, several others were passing only because they happened not to assert on message
`.type`. This is the same root cause as Phase 5c's bug (a listener that isn't there yet, or isn't
looking for the right thing, loses or misattributes a message) showing up at a wider scope, not a
new bug class.

Fixed by consolidating every describe block's separately-duplicated `connectAs` helper into one
shared version that uses `messageQueue` internally and, for a DM identify specifically, drains
exactly the three messages the protocol now guarantees (`identified`, `roster_update`,
`attack_request_list`) before returning — so a connection handed back by `connectAs` always starts
with an empty queue, matching what every caller already assumed. The returned connection also
exposes its queue's `next()` (as `ws.next`) for later, robust reads. A `nextNonRosterMessage`
helper skips past legitimate-but-irrelevant `roster_update` noise when a test is waiting for some
other specific message on the DM's connection (e.g. a push ack), without pinning down an exact
interleaving order that's an implementation detail, not something these tests should assert on.

### New tests for this sub-phase's actual features

Prior sub-phases largely fixed regressions in existing tests; this one also needed coverage for
what Phase 5d actually adds, since none existed yet: the DM's initial empty roster/request-list on
identify, a joining player appearing on the roster and their pushed stats reflecting a moment
later, the HP-clamp-to-max display behavior, a DM cross-write refreshing the roster, a
disconnecting player dropping off it, confirmation players never receive `roster_update` at all,
submitting an attack (ack to the submitter plus full list to the DM), multiple pending requests
staying in submission order, resolving a request (DM-only, removes it, re-sends the updated full
list), and a DM catching up on pending requests that existed before they connected.

### Open question carried forward: Firebase Auth

Every other piece of `multiplayer-sync.js` identified in the original Phase 5 audit has now been
replaced. What remains, out of scope for all of Phase 5: Firebase Auth itself (account
creation/login) and the account UI built on it. This server still trusts whatever `identify`
claims about `accountUid`/`role`, unchanged since Phase 5a — real verification would mean pulling
in a way to check identity server-side, a distinct concern from sync-loop correctness. Whether and
how to replace Firebase Auth is an explicit open decision for a future phase, not a gap discovered
late.

### Validation performed

- 11 new tests (5 roster listener, 5 attack-request queue, plus one bug found and fixed while
  writing them — see below), full suite now 126 tests, all passing.
- One test-writing bug of its own, distinct from the message-loss fix above: an early draft of the
  cross-write/roster test expected an extra `roster_update` after `connectAs('uid-dm', 'dm')`
  returned, not realizing `connectAs` itself now already drains the DM's own initial one. Fixed in
  the test, not the server — a reminder that `connectAs`'s new draining behavior changes what
  every subsequent `dm.next()` call in a test should expect to see first.
- 50 consecutive clean runs of `server/websocket.test.js` alone, plus 30 consecutive clean
  full-suite runs, before treating this sub-phase — and all of Phase 5 — as validated.

### Phase 5, complete

With 5a (core state sync and cross-player writes), 5b (loot-claim arbitration), 5c
(battlefield/puzzle-log broadcast), and 5d (roster listener and attack-request queue) all done,
every real-time multiplayer system identified in the original `multiplayer-sync.js` audit has a
WebSocket-based replacement, backed by SQLite instead of Firestore, none of it wired into the live
browser app yet. Firebase Auth's replacement (or retention) remains the one explicitly open
question for a future phase.

## Phase 6: Frontend Wiring

Closing the gap between "the backend exists" and "a DM could actually run this with real
players." `docs/NEXT_SESSION_BRIEF.md` (written at the end of Phase 5) proposed auditing
`multiplayer-sync.js`'s 52 exported functions and the monolith's 27+13 call sites into it before
writing any code. That audit turned up two things not previously documented:

**`multiplayer-sync.js` is five subsystems, not two.** Beyond "Firebase Auth + account UI" (long
known to be out of scope for Phase 5, see above) and "real-time sync" (which Phase 5a-d fully
replaced), the file also contains real-time **gambling** sync (`pushGamblingState`/
`startGamblingListener`/`submitGamblingActionRemote`/`startGamblingActionListener`/
`resolveGamblingActionRemote`), the DM's live per-player **viewed-player listener**
(`startViewedPlayerListener`/`stopViewedPlayerListener`, backing the Players tab's spectator
view), and **player removal** (`removePlayer`/`removeAllPlayers`). None of these three have a
WebSocket or database counterpart yet — Phase 4's gambling work made resolution
server-authoritative over REST, but never built the live push/listen loop around it. These were
missed by the original Phase 5a audit's own "what's still needed" list and are treated as their
own scoped sub-phases (6d-6f below), not folded silently into "wiring."

**The monolith's 27 call sites resolve to ~15 named bridge functions**, not 27 distinct
behaviors — `window.dmSetPlayerInventoryFields`, `window.pushBattlefieldState`, etc. are each
called from several places. The bridge surface (both directions — the functions
`multiplayer-sync.js` exposes on `window`, and the hook functions it expects the monolith to have
defined, like `window.applyRemoteMultiplayerState`) is already clean, which is why keeping
exported names/signatures stable during the rewrite is viable.

**`saveAppState`/`loadAppState` have a head start**: `db/schema.js`'s `SUBSYSTEMS` map and the
`characters` table already give a complete field-by-field decomposition of the old localStorage
blob — that groundwork was laid in Phase 2, well before Phase 6 was scoped. What's not yet solved:
`loadAppState()` is called synchronously today (page-load init assumes it returns immediately);
a REST-backed version is async, touching the init sequence. There's also no human-shareable
"campaign code" in the new backend yet — `campaigns` are bare auto-increment integers, whereas the
old Firestore room code (read aloud at the table) was the document id itself. Resolved by the
identity decision below.

**Confirmed with the user**: identity uses a lightweight model — a DM creates a campaign and gets
a short shareable code; players enter the code and pick a display name; no passwords, no accounts
table, no Firebase-Auth-equivalent to build. The WebSocket `identify` message already accepts
this shape (`accountUid`/`role`/`username`, no credential) unchanged. This eliminates
`multiplayer-sync.js`'s entire Auth + login/account-gate-UI subsystems (~25 functions, ~500 lines)
outright rather than porting them — the single largest scope reduction found in the audit.

Sub-phases, in confirmed order: 6a (static file serving — this section), 6b (room-code identity),
6c (rewrite `multiplayer-sync.js`'s internals for the subsystems Phase 5 already covers), 6d
(gambling real-time sync), 6e (viewed-player listener), 6f (player removal), 6g (rewrite
`saveAppState`/`loadAppState` against REST), 6h (real multi-device LAN testing), 6i (Phase 6
packaging, i.e. the original roadmap's "Phase 6"). 6d-6f build genuinely new server-side surface
area (not translation of existing WS work) and are each confirmed with the user individually
before being built, matching Phase 5's own a-d precedent.

### Phase 6a: Static File Serving

Small and standalone by design — `server/server.js` had no way to serve the actual app files
(the monolith HTML, `multiplayer-sync.js`, `game-engine.js`, `loot-data.js`, `puzzle-data.js`),
only answer JSON API requests. `createServer(db, { staticRoot })` now takes an optional second
argument (same dependency-injection shape as `db` itself — tests point it at a throwaway fixture
directory, `server/start.js` points it at the repo root via `import.meta.dirname`); when a request
matches no API route and is a GET, it falls through to `tryServeStatic` before returning 404.

Deliberate simplifications, to revisit if this is ever exposed beyond a DM's own LAN:
- **Extension allowlist, not "serve whatever exists under the root."** The default sqlite db file
  (`server/start.js`'s `DB_PATH`) lives at the repo root right alongside the app files; without an
  allowlist, campaign data would be fetchable over plain HTTP as e.g. `GET /dungeon-master-box.db`.
- **GET only** — nothing here needs HEAD/Range support today.
- **No directory listing, no caching/ETag headers, no gzip/compression.** A DM's own local
  process on a LAN has no meaningful cache-invalidation or bandwidth story to optimize yet.
- Path-traversal protection is a resolved-path prefix check (`tryServeStatic` in
  `server/server.js`) rather than relying solely on `new URL()`'s own dot-segment normalization —
  belt-and-suspenders, since the normalization already makes an actual escape essentially
  unreachable through a spec-compliant HTTP client, but cheap enough to keep as defense-in-depth
  for anything that isn't one.

Validated with a real end-to-end smoke test (started `server/start.js` for real, fetched `/`,
`/game-engine.js`, and the actual ~1.2MB monolith HTML over real HTTP) in addition to the 8 new
regression tests in `server/server.test.js`. Full suite: 134 tests, 45 consecutive clean runs.

Also required installing Node.js itself (v24.19.0 LTS via winget) — this session started on a
machine with no Node install at all, confirming the handoff brief's anticipated "continuing from
a different computer" scenario.

### Phase 6b: Room-Code Identity (server-side)

Server-side half of the identity decision confirmed with the user above. `campaigns` gains a
`code` column: a 5-character join code from the same visually-unambiguous alphabet (no 0/O/1/I/L)
`multiplayer-sync.js`'s original `generateRoomCode` used, for the same reason (read aloud and
typed by hand at the table). `createCampaign` generates and assigns one automatically, retrying
on the rare `UNIQUE` collision (~33.5M possible codes at this length, so this is a formality, not
a real contention point). `getCampaignByCode` resolves a typed code back to a campaign,
case-insensitively — new `GET /campaigns/by-code/:code` route exposes it.

Deliberately server-only for this sub-phase: no client-side UI (join screen, code entry) yet —
that lands in 6c alongside the rest of `multiplayer-sync.js`'s rewrite, since the new lightweight
gate UI is inherently part of replacing that file's DOM-injected login screen. What 6b actually
unblocks: a client can now go from "DM typed/read out a 5-character code" to "a real campaign id
to `identify` against" without needing accounts, sessions, or a password anywhere in the loop.

**Deliberate non-migration**: the `code` column was added directly to the `CREATE TABLE IF NOT
EXISTS campaigns` statement, not introduced via an `ALTER TABLE` migration path. Fine for now
because nothing has been deployed with real campaign data yet — an existing on-disk `.db` file
from before this change would keep its old schema (`CREATE TABLE IF NOT EXISTS` is a no-op against
an existing table) and every `code`-dependent query would then fail. Worth revisiting with a real
migration mechanism before this is ever deployed somewhere a database file needs to survive an
upgrade; noted here rather than silently assumed away.

Validated: 7 new tests (4 in `db/database.test.js` covering code generation/uniqueness/lookup, 3
in `server/server.test.js` covering the REST route), full suite now 141 tests, 50 consecutive
clean runs.

### Phase 6c: Rewrite `multiplayer-sync.js` Against the WebSocket Protocol

Full rewrite of `multiplayer-sync.js` (see the file's own header comment for the complete design
rationale — this section summarizes it and records what building it actually found). Every
exported `window.*` function and expected hook name is unchanged from the original — the 27 call
sites in the monolith needed zero edits, confirming the bridge-surface design from Phase 5 held up
under a real rewrite, not just in theory.

**What got simpler, not just swapped:**
- `sanitizeNestedArrays`/`unsanitizeNestedArrays` are gone entirely. That machinery existed only
  because Firestore rejects array-of-arrays fields and `undefined` values; the new backend stores
  state as a plain `JSON.stringify`'d text blob (`db/database.js`), which has neither restriction.
- The `rev`/`extRev` self-echo detection dance is gone from the client. A WebSocket server never
  sends a `state_update` back to the connection that caused it (by construction, per
  `server/websocket.js`), so `state_update` is now applied unconditionally. `rev` is still sent
  with every `push_state` (guards genuinely out-of-order delivery of the same client's rapid
  pushes — a problem that doesn't go away), but the client no longer reasons about it beyond
  incrementing it.

**The one new client-side mechanism this rewrite genuinely needed**: raw WebSocket has no
request/response correlation the way a Firestore write's returned promise did. `waitForNext(
predicate)` registers a one-shot waiter matched against the next incoming message satisfying an
arbitrary predicate (correlated on whatever field a given response actually carries — `rev` for
push acks, `targetUid` for cross-write acks, `claimId` for loot claims), resolved by the
WebSocket's `message` handler. Not perfect distributed request tracking (two of the exact same
kind of request in flight at once could theoretically cross-resolve if neither carries a
correlating field), but this is a single DM's local console talking to their own server, not a
high-concurrency system — documented as a reasonable-effort tradeoff, not overlooked.

**Identity, confirmed with the user**: room code + display name, no accounts (see Phase 6b above
and this file's own header comment for the full reasoning). A per-browser random id
(`getOrCreateDeviceUid`, localStorage) replaces the Firebase uid — what makes a returning player's
character persist across reloads. **Deliberate, documented scope reduction**: because this id is
in localStorage (shared across every tab of one browser) rather than the original's
sessionStorage (private per tab), running the DM role and a player role simultaneously in two tabs
of the *same* browser is no longer supported — both tabs would share one accountUid, and
`server/websocket.js`'s `rooms` map is keyed by accountUid per campaign, so the second identify
would displace the first's connection (see the bug below). Accepted deliberately: a character
surviving a closed tab/browser restart (the common case) matters more than same-browser dual-role
testing, which still works fine across two different browsers or a private window.

**A real bug found by testing, not invented as a hypothetical**: manual two-tab browser testing
(deliberately exercising the "shared localStorage" edge case above) surfaced that
`server/websocket.js`'s `identify` handler, when a second connection identifies with an
`accountUid` already live in the room map, silently *replaced* the map entry — leaving the first
connection's socket still open but completely untracked. No crash; the old tab just went
permanently deaf to every future broadcast (for a DM, this means `findDmConnection` stops finding
them — no more roster updates, no attack requests, nothing). Fixed in `server/websocket.js`:
identify now explicitly notifies (`{type:'error', message:'Connected from another tab or device…'}`)
and closes the displaced connection before taking over, converting an invisible zombie into a
visible, honest disconnect. Two new regression tests in `server/websocket.test.js` cover this
(the displacement itself, and confirming a same-connection re-identify is a no-op that doesn't
close itself). This is the one change in this sub-phase that touched already-merged Phase 5 code.

**Also added, beyond a literal protocol translation**: a capped-backoff auto-reconnect on
unexpected WebSocket close. The protocol itself has no opinion on reconnection, but a real,
usable app over a LAN needs it regardless (a WiFi hiccup or a server restart shouldn't require a
manual page reload) — `connectWebSocket`'s close handler retries with backoff up to 10s, using the
same in-memory identity (not re-reading localStorage), and surfaces "Connection lost —
reconnecting…" via the gate status line if the reconnect attempt is visible.

**What's still deliberately absent (not oversights — see the file's header comment and Phase
6d/6e/6f below)**: real-time gambling sync, the DM's per-player viewed-player listener, and player
removal. None of their `window.*` functions are defined by this rewrite; every monolith call site
already guards with `typeof window.X === 'function'`, so these subsystems simply don't work yet in
multiplayer mode, with no crash — exactly the same graceful-absence property the original file's
own header comment already relied on for "if this file doesn't exist at all."

**Testing approach for this file specifically**: `multiplayer-sync.js` is fundamentally
browser-coupled (`document`, `window`, `WebSocket` client, `fetch`, `localStorage`) — unlike
`game-engine.js`'s pure extracted core, there's no DOM-free logic worth pulling out here, and
adding a DOM-shim dependency (e.g. jsdom) under `node --test` would cut against the project's
zero-framework-dependencies stance for a file whose real correctness question is "does it behave
right in an actual browser talking to the actual server," not "does this pure function return the
right value." Validated instead by: the already-extensive `server/websocket.test.js` protocol
coverage (143 tests total now, 50 consecutive clean runs) plus real, manual end-to-end browser
testing against a live `server/start.js` instance — DM campaign creation, a player joining by
code, first-time character setup firing, live roster sync reaching the DM with zero page reload,
full state round-tripping through the server (verified by wiping a player's local save entirely
and confirming `identified`'s persisted state restored it), role-restricted tabs, and the
reconnect-on-displacement fix, all observed directly rather than assumed. Real multi-device LAN
testing remains its own explicit step (Phase 6h) — this was still one machine's browser tabs
against a local server, not physically separate devices.

### Post-6c Fix: Player Self-Loot Never Delivered the Item

A real bug found via the user's own live testing (a player looting a chest spawned into Combat
saw a success message but nothing ever reached their inventory), not caught until real
multi-device play because nothing in the automated suite exercises the monolith's own client-side
loot-delivery code. Root cause: `playerLootItem` (the player's actual "Loot" button handler) only
ever created the loot claim over WebSocket — the piece that used to actually place the item,
`window.applyWonLootClaim`, was designed for the ORIGINAL Firestore listener that replayed every
claim doc a reload would re-receive, and nothing in the Phase 6c rewrite ever wired it up to fire
from `createSelfLootClaim`'s resolved promise instead. The function existed, looked complete, and
was simply never called — confirmed via `grep`, zero call sites anywhere in the file.

Fixed by having `playerLootItem` look the item up from its own already-synced `battlefieldRoster`
(the same data its own button was rendered from) and deliver it directly the moment the claim
promise resolves — no separate listener/replay step needed now that the claim result IS the
delivery signal. `window.applyWonLootClaim` and its supporting `appliedLootClaimIds` (a Firestore-
replay guard with no equivalent replay to guard against anymore) were deleted as genuinely dead
code, not just unused — leaving them in place is what let this gap go undetected, since they gave
the impression delivery was handled.

**Also changed, per explicit user request while diagnosing this**: every loot pickup path (chest,
corpse, wheel-spin, combat, Fleshmancer, Monster Mangler) now places the item directly into open
inventory space first, falling back to the Recently Looted staging grid only when inventory has no
room — replacing `lootItemToRecentlyLooted` with `lootItemDirectly` everywhere it was called. The
Recently Looted tab, its 36-slot grid, and its move/discard/clear functions are all still in place
(a real fallback, and still needed for any pre-existing saved data already sitting there) — new
loot just no longer routes through it as a mandatory extra step by default.

Verified live in the browser (not just read): two separate identities (DM + a player using a
distinct device uid in a second tab) connected to the same campaign, a chest pushed to Combat and
revealed, the player looted an item, and `inventoryPlacements`/`inventoryGrid` confirmed the item
landed in the grid while Recently Looted stayed at 0/36.

### Post-6c Fix: Player-Submitted Attacks Never Actually Applied

A second real bug found chasing the user's report that "damage attack rolls... do not seem to do
anything." Monster-attacks-a-player was already working correctly (`resolveBattleAttack` already
calls `window.applyHpDeltaToPlayer` when a monster's roll resolves against a connected player) —
confirmed live, not assumed. What was actually broken was the DM's own "Pending Player Attacks"
review queue (`renderPendingAttacksPanel`/`applyPendingAttackRequest`), which is how a player's own
weapon-attack roll (`submitBattlefieldAttack`) is supposed to reach a monster's HP. Two independent
bugs there, both silent (no error, no crash — everything just quietly did nothing):

1. **Wrong field shape.** `db/database.js`'s attack-request row mapping nests the actual roll data
   under `attackData` (`{ id, playerUid, playerUsername, attackData: {...}, createdAt }` —
   confirmed as the deliberate, tested contract by `server/websocket.test.js`'s own assertions),
   but `renderPendingAttacksPanel`/`applyPendingAttackRequest` were reading `req.monsterUid`,
   `req.toHitTotal`, etc. directly off the request object. Every field read `undefined` — the panel
   rendered "undefined" throughout and Apply could never find the monster.
2. **String vs. number id.** `req.id` is a plain SQLite autoincrement number, but the row's
   `onclick="applyPendingAttackRequest('${req.id}')"` wrapped it in quotes, passing a *string* into
   a function that compares it against `r.id` with strict `===`. Neither Apply nor Dismiss could
   ever match a request to itself, even once bug 1 was fixed.

Fixed by reading through `req.attackData` and dropping the quotes so the id passes through as the
number it actually is. Also added a **manual DM HP control** (`applyManualHpDelta`, a small ±HP
input + Apply button on each connected player's row in the Players tab) per the user's explicit
request — reuses the same `window.applyHpDeltaToPlayer` bridge the automatic monster-attack path
already calls, so a DM can apply a monster attack, a heal, or any other ad-hoc HP ruling by hand
regardless of whether the automatic/reviewed paths are in play for a given moment.

Verified live in the browser with two connected identities: a monster's automatic attack landed on
the connected player's HP correctly (no fix needed there); a player-submitted weapon attack showed
correctly in the DM's Pending Attacks panel and, on Apply, correctly docked the monster's HP and
cleared the pending list; the new manual HP control correctly applied a delta and round-tripped to
the player's own client in real time. Full server suite (159 tests) unaffected, since none of this
touched server/db code — the bug was entirely a client-side consumption mismatch of an
already-correct, already-tested server contract.

### Post-6c: Store Purchase Sync (Shared Staple Stock)

Real, previously-missing gap: buying something from a merchant was entirely per-player, client-
local state (`merchantStapleStock`/`merchantDailyItems`/`merchantDailySold`) — nothing about a
purchase reached the DM or any other player, and two players could each "buy" the same last unit
of a limited staple in their own independent local simulations.

**Deliberately scoped to staples only, not daily wares.** `MERCHANTS[key].staples` is static
content identical for every client — safe to arbitrate a shared depleting count against. Each
merchant's 5 daily wares are randomly rolled per account by design; there's no shared catalog two
clients' random rolls would even agree on, so "index 2 sold" would be meaningless across them.
Syncing daily wares would mean a real redesign (the DM seeding one shared roll for everyone) —
noted as a real, deliberate scope boundary, not attempted here.

**Real arbitration, not DM-relay** — this is the same shape as loot claims (Phase 5b), not
gambling (Phase 6d): a shared depleting resource two players can race for needs the server to be
the actual decision-maker, not a "tell the DM and let them apply it" relay. New WS messages
(`server/websocket.js`): `buy_staple` (any connected account; carries the merchant's full static
stock array so the server can lazily seed shared state the first time a merchant is ever bought
from in a campaign, without needing to know the merchant catalog itself — same reasoning loot
claims already lean on, the server only arbitrates, it doesn't need to understand what the item
is) → `buy_staple_result` to the buyer, and — only on an actual change, never on a rejected
attempt — `merchant_stock_update` broadcasts the merchant's full current array to *every*
connection in the room, DM included (unlike every other broadcast type in this file, which is
always DM-authored and never echoed back to the DM). `restock_merchant` (DM only) resets a
merchant back to full for everyone. Reuses Phase 2's generic `campaign_state` mechanism via a new
`merchant_stock` subsystem (`db/schema.js`) — no new table.

**A real bug found and fixed while writing this, not hypothetical**: the first draft broadcast
`merchant_stock_update` on *every* `buy_staple` request, including rejected ones. Since a rejected
purchase changes nothing, this meant a hot contest over one popular item (or, more mundanely, the
regression test for exactly this scenario) produced a redundant broadcast per losing attempt —
harmless in content but noisy, and it broke the natural "exactly one broadcast per successful
purchase" invariant the arbitration is supposed to guarantee. Fixed by only broadcasting when
`bought` is true; a rejection is now fully answered by `buy_staple_result` alone. The state is
still *persisted* either way, since even a rejected buy may have just lazily seeded a merchant's
stock for the first time in this campaign.

**A real, structural test bug found while writing the tests for this — not flakiness, not the
fix above**: this file's own documented Phase 5c lesson ("a listener that isn't attached yet loses
the message") applies to `buy_staple` specifically because it always fires *two* messages back to
back on the buyer's own connection (`buy_staple_result`, then that buyer's own copy of the
`merchant_stock_update` broadcast) — close enough together that both could arrive and get
'message'-emitted before a test's `await nextMessage(...)` continuation even ran to attach the
*second* listener. Every test in this section uses `connectAs`'s exposed `.next()` queue instead
of raw `nextMessage` for exactly this reason — the same fix this project already established for
Phase 5c/5d, now confirmed to matter for a brand-new feature that happens to share the same
two-messages-in-a-row shape.

**Client side** (`buyStapleItem` in the monolith): the existing local out-of-stock/afford checks
run first, unchanged, for solo/guest play. When connected, after spending gold locally (same as
before), it awaits `window.buyStapleRemote` before finalizing the purchase; a server rejection
(lost the race) refunds the gold via `addPlayerGold` and shows an honest "someone else just bought
the last one" message rather than silently eating the player's gold for nothing.
`window.applyMerchantStockSync` (multiplayer-sync.js → monolith) overwrites this account's local
`merchantStapleStock[key]` outright on every update/catch-up — never merged — so every connected
client, DM included, converges on the exact same shared numbers.

Validated: 9 new tests in `server/websocket.test.js` (full suite now 168 tests) covering seeding
from client-supplied maxStock, buying out to exactly zero without going negative, a genuine
two-player race for the last unit (classified by message type, not position, per the test-bug
note above), the DM seeing a player's purchase live, restock (DM-only, resets for everyone),
catch-up via `merchant_stock_full` on identify (both with and without existing purchases), and
input validation. 40 consecutive clean full-suite runs. Verified live in the browser with two
connected identities: a player bought a staple, and the DM's already-open Store panel updated its
displayed stock count with zero action on the DM's part.

### Phase 6g: Superseded By 6c — No Rewrite Needed

The original handoff brief scoped a "6g" as "rewrite `saveAppState`/`loadAppState` against the
REST API." Revisited after actually building 6c and confirmed with the user rather than built on
the stale premise: **this task no longer exists in the shape it was originally scoped.**

`saveAppState`/`loadAppState` (in the monolith) were already fully transport-agnostic before 6c —
they only ever called the generic `window.onMultiplayerStateChange`/`window.applyRemoteMultiplayerState`
hooks, never anything Firebase- or Firestore-specific directly. That's exactly why Phase 5's
bridge-function design let 6c rewrite every hook's *implementation* without touching a single
monolith call site. Once 6c wired those hooks against the WebSocket protocol, `player_states`
(Phase 5a) became the full persistence layer for connected play — proven directly, not assumed:
6c's own validation wiped a player's local save entirely, reloaded, and confirmed the server's
`identified` message restored everything (both the player's own data and, by the same mechanism,
the DM's — a DM's state pushes through the identical `push_state` path as a player's). Solo/guest
play was never in scope for server persistence and correctly stays on localStorage untouched.

Net effect: there is no leftover Firebase-shaped code in `saveAppState`/`loadAppState` to replace,
and no durability gap — connected state already round-trips through real SQLite via the WS layer,
disconnected/solo state already round-trips through localStorage. Confirmed with the user: no
code changes needed for this sub-phase.

**Side effect worth flagging explicitly, not silently left dangling**: this leaves Phase 2/3's
REST `characters` and `campaign_state` PUT/GET routes (`server/server.js`) genuinely unused by the
live app — they were built before `player_states` existed and have since been superseded for this
purpose. Confirmed with the user: leave them in place for now (tested, harmless, possibly useful
later for tooling or a future companion view) rather than deleting them as part of this pass.

### Phase 6e: Viewed-Player Spectator Listener

The DM's Players-tab live view of one specific player's full state (`startViewedPlayerListener`/
`stopViewedPlayerListener`/`applyViewedPlayerState` in the original) — one of the two gaps the
original Phase 5 audit missed, alongside 6f below. Real-time gambling sync (the third gap) stays
deliberately deprioritized per the user, to return to later.

Two new `server/websocket.js` messages: `subscribe_player`/`unsubscribe_player` (DM only) and
`player_state_update` (server -> the subscribing DM connection). A room-map entry gained a
`viewingUid` field (null unless a DM has subscribed); `notifyViewers` checks it on every
`push_state` and cross-write, alongside the existing `broadcastRoster` call at each of those
sites. Subscribing sends an immediate catch-up read of the target's current persisted state (or
`null` if they've never pushed), matching the original's `onSnapshot`-fires-immediately-on-
subscribe behavior. Only one subscription per DM connection, matching the original's own "only
ever one of these active at a time."

**A real, previously-undetected bug found while browser-testing this sub-phase** (not by 6e's own
new code — in already-merged Phase 5d): `buildRoster()` never included a `role` field on its
entries, but the monolith's `renderPlayersTab()` filters on exactly `p.role === 'player'` — so
every entry was silently excluded, and the Players tab has shown "No players have joined yet."
since Phase 5d was built. Undetected until now because nothing exercised `renderPlayersTab()`'s
actual consumption of the roster shape end-to-end before 6e made it possible to reach the Players
tab live for the first time. Fixed by adding `role: 'player'` to every `buildRoster` entry (every
entry there is already known to be a player, via the `dm` filter immediately above it) — one line,
covered by a new regression assertion in the existing "adds them to the DM's roster" test.

Validated with the full server test suite (153 tests, 50 consecutive clean runs) plus real
browser testing: DM viewing a live player's character sheet with zero page reload, confirmed via
the actual Players tab UI, not just the protocol messages.

### Phase 6f: Player Removal

`removePlayer`/`removeAllPlayers` from the original — deletes a player's character/inventory
progress for the campaign; there's no separate login to revoke in this identity model (see Phase
6b/6c), so unlike the original there's nothing else to clean up — a removed player can rejoin
fresh with the same device uid and campaign code any time, the same "known limitation, kept
deliberately simple" the original documented for its own equivalent case.

New `db/database.js` function `deletePlayerState`. New `server/websocket.js` message `kick_player`
(DM only, cannot target the DM's own accountUid): deletes the persisted state, and if the target
has a live connection, explicitly sends `{type:'kicked'}` before closing it — reusing the same
"tell them, don't just silently disconnect" pattern the Phase 6c displaced-connection fix
established, rather than leaving them to guess why they got dropped. `kick_ack` confirms the DM's
own request landed either way (target online or not).

Client side (`multiplayer-sync.js`): `window.removeAllPlayers` kicks every roster entry in
parallel (`Promise.allSettled`, returning the count actually removed, matching the original's own
"count actually removed, not count attempted" contract) and the account panel's roster rows got
their "Remove" button back (held back in 6c pending this). A kicked player's own client handles
the `kicked` message by resetting local session state, clearing the persisted session, and showing
the gate with an explicit "You were removed from this campaign by the DM." message — confirmed
directly in the browser, not just inferred from the protocol.

Validated: 4 new server tests (kicking an online player closes their connection with a reason and
genuinely deletes their state; a non-DM cannot kick; the DM cannot remove themselves; kicking an
already-offline player still deletes their state), full suite 153 tests, 50 consecutive clean
runs, plus real browser testing of the full loop (DM removes a connected player, that player's
own tab immediately shows the removal message, the DM's roster and Players list both update).

### Phase 6h Prep: LAN Reachability

Checked before handing real multi-device testing to the user (this genuinely needs a second
physical device, not something drivable from here): `server/start.js`'s `server.listen(PORT)`
already binds to every network interface by Node's own default (no host argument = 0.0.0.0 for
IPv4) — the server was already LAN-reachable with zero code change. Confirmed directly, not
assumed: started the server and hit it over an actual LAN IP (not `localhost`) from a separate
process, got a real `200`.

`multiplayer-sync.js` also needed no change — `API_BASE`/`WS_URL` both derive from
`window.location`, never a hardcoded host, so a phone browsing to the DM machine's LAN IP
automatically talks to the right origin.

The one real gap was informational, not functional: `start.js` only ever printed
`http://localhost:PORT`, which is actively misleading for this exact use case (`localhost` only
ever resolves on the same machine). Now prints every non-internal IPv4 address from
`os.networkInterfaces()` alongside it, so the DM can just read the URL to give players rather than
hunting for their own IP.

**Known gotcha for the user to expect, not something fixable from here**: Windows Firewall
commonly prompts (or silently blocks) the first time a process accepts an inbound connection on a
new port — if a LAN device can't reach the printed URL, that's the first thing to check, not a
server bug.

Confirmed working for real: the user set up a physically separate Mini PC on their home network,
ran the app there, and reached it from a second device over LAN. Phase 6h is done, not just
prepped.

### Phase 6d: Real-Time Gambling Sync

The one gap left over from the original Phase 5 audit, picked back up after being explicitly
deprioritized by the user earlier in the project ("gambling is the lowest priority... loop back
later"). Replaces the monolith's three optional gambling bridge hooks
(`window.pushGamblingState`/`window.submitGamblingActionRemote`/
`window.resolveGamblingActionRemote`) — previously simply undefined, so gambling worked solo but
never synced between a DM and connected players.

**No schema change.** Phase 2's `campaign_state` table already has a `gambling` subsystem bucket
(`SUBSYSTEMS` in `db/schema.js`), and Phase 4's `server/gambling.js` REST routes already read/
write it. Phase 6d's new WebSocket messages (`server/websocket.js`) read and write that exact same
bucket via `saveSubsystemState`/`loadSubsystemState` — this is genuinely the same data as Phase 4,
just with a live push/listen loop added on top so it actually reaches connected players; the Phase
4 REST routes are untouched and still work, same relationship Phase 4 itself had with Phase 3's
raw-blob route.

**Two message types**, mirroring the Battlefield/Puzzle Log broadcast pattern (Phase 5c) with one
addition that pattern didn't need:
- `push_gambling_state` (DM only) — persists `{ game, table }` and broadcasts `gambling_state_update`
  to every connected player (never the DM, who already has it locally), plus a catch-up send on
  `identify` if a table is currently hosted. This covers hosting a game, closing a table, AND the
  DM's own client applying an action — all three already funnel through the monolith's single
  `pushGamblingState()` wrapper, so no separate host/close/action-result message was needed.
- `submit_gambling_action` (any connected account) — relayed **live** to the DM's connection as
  `gambling_action_list` (a single-item list, matching the shape
  `window.applyIncomingGamblingActions` already expects), then the DM's client applies it and
  re-pushes state via `push_gambling_state`, closing the loop back out to every player including
  the one who submitted it.

**Deliberately not persisted in a queue table**, unlike `attack_requests`: the monolith's own
`applyIncomingGamblingActions` applies an incoming action immediately and re-pushes — there's no
manual DM review step the way an attack request has, so a durable queue a DM works through later
doesn't match how this feature actually behaves. Gambling already assumes the DM is the live
dealer (per the monolith's own long-standing comment — "the DM is always the dealer/host"), so an
action arriving while the DM is briefly disconnected is dropped, same as a real dealer stepping
away from the table would drop it — not silently swallowed forever, just not queued. If this ever
needs to survive a DM reconnect, the fix is a small table shaped like `attack_requests`, not a
redesign of the relay. `window.resolveGamblingActionRemote` is correspondingly left undefined on
the client (its one call site already guards with `typeof x === 'function'`) — there's nothing
server-side to resolve.

Validated: 6 new tests in `server/websocket.test.js` (full suite now 159 tests) covering the
broadcast-to-players-never-DM shape, catch-up on identify (both with and without a hosted table),
non-DM push rejection, the action-relay-to-DM shape (including the assigned id and submitter
identity), and a graceful no-op when an action is submitted with no DM connected. 40 consecutive
clean full-suite runs. Not yet exercised in a real multi-device browser session — that's part of
the planned test session, not this pass.

### Phase 6i: Packaging — Windows Auto-Start

The original roadmap's catch-all "make this easy to actually run" phase, scoped down to what
matters for the user's actual deployment target (a Windows Mini PC, confirmed directly rather than
assumed): starting the server automatically so a DM never has to open a terminal and type
`node server/start.js` before a session.

Three new files under `scripts/`, run directly on the machine hosting the game (no remote access
to that machine from this project, so these are written to be copy-paste-run by the user, not
executed as part of this session):

- **`start-server.bat`** — the actual launcher. Resolves the repo root from its own file location
  (`%~dp0..`), not the caller's working directory — the same anchoring fix `server/start.js`
  already needed after the Phase 6h database-loss incident, applied here too since a process
  started by Task Scheduler has no predictable working directory of its own. Output is appended to
  `server.log` at the repo root (added to `.gitignore`) so a DM can check what happened if the
  server didn't come up — not rotated, a deliberate simplification for a home deployment, noted in
  the file itself.
- **`install-windows-autostart.ps1`** — registers a Windows Scheduled Task (`Register-
  ScheduledTask`, PowerShell's own built-in module) that runs `start-server.bat` at login, with
  automatic restart (up to 5 times, 1 minute apart) if the process ever crashes.
- **`uninstall-windows-autostart.ps1`** — removes it.

**Scheduled Task, not a real Windows Service, and why**: turning an arbitrary process into a true
service (one Windows can start before anyone logs in at all) needs a service wrapper like NSSM —
a small, well-known tool, but still a third-party download. A Scheduled Task triggered "at log on"
needs nothing beyond what Windows already ships. Combined with Windows' own built-in auto-login
option (`netplwiz` — mentioned in the install script's own output, not automated, since changing a
login policy is exactly the kind of standing system-configuration change that should be the user's
own explicit action) this gets the same practical result for a dedicated Mini PC: the server is
already running by the time anyone opens a browser to it, with no NSSM dependency introduced.

**A real bug caught before it reached the user**: the first draft of both `.ps1` files used
em dashes and typographic punctuation (matching this project's own prose style elsewhere) inside
double-quoted strings and comments. `[System.Management.Automation.Language.Parser]::ParseFile`
(used to verify syntax without actually registering a scheduled task on the dev machine — running
the install script itself would have been an unwanted side effect on the wrong computer) caught
real parse errors from this: PowerShell 5.1 misreads certain non-ASCII punctuation depending on
file encoding, corrupting quote-boundary detection for code appearing *after* the offending
character, not just garbling the character itself. Fixed by rewriting both scripts (and the
`.bat`'s comments, for the same reason under `cmd.exe`'s own codepage sensitivity) using plain
ASCII punctuation only (`--` instead of `—`, straight quotes only) — a real, generalizable lesson
for any future Windows batch/PowerShell script this project writes, not just these two files.

**Validation performed**: both `.ps1` files parse cleanly via `Parser.ParseFile` (syntax-only,
zero side effects). The install/uninstall scripts were deliberately NOT executed from here — doing
so would register a real scheduled task on the development machine, not the Mini PC that's
actually meant to run this, which is a standing system-configuration change outside this project's
own scope to make unprompted. Real execution and end-to-end validation (does the task actually
survive a reboot, does the server come up, does auto-restart-on-crash actually work) is the user's
own next step, to run directly on the Mini PC.

### Post-6h Fix: Reconnect Loop on the Mini PC (No WebSocket Keepalive)

**Reported symptom**: a player connecting to the Mini PC over the home WiFi would see the
"Connected" gate close, then almost immediately "Connection lost — reconnecting…" fire, reconnect
successfully, and repeat this forever — never staying connected long enough to actually do
anything.

**Root cause**: `server/websocket.js` never sent anything once a connection was idle — no
periodic ping, nothing. A WebSocket with zero traffic for a while is indistinguishable, on the
wire, from a dead one, and most home routers/OS WiFi stacks silently drop an "idle" NAT or
firewall mapping after a timeout with no FIN and no error raised on either side — the connection
just stops delivering data. The client's own `close` event (multiplayer-sync.js) only fires once
something *tries* to use that dead mapping and fails, which for a mostly-idle player tab could be
the very next heartbeat-free minute. The reconnect succeeds (a fresh TCP connection gets a fresh
NAT mapping), goes idle again, and the same silent death repeats — exactly the observed loop. This
is a well-known class of bug with the `ws` package specifically (documented in its own README
under "how to detect and close broken connections") — the library deliberately leaves the
keepalive strategy up to the application rather than assuming one.

**Fix**: `createWebSocketServer` now runs a 25-second heartbeat — `ws.ping()` to every connection
in `wss.clients`, tracked via an `isAlive` flag flipped by the automatic `pong` reply (browsers and
the `ws` client both answer a ping frame with a pong with no application code involved — this
needed zero changes to multiplayer-sync.js). A connection that misses two consecutive pings gets
`ws.terminate()`'d, which fires the existing `close` handler's room-cleanup path same as any other
disconnect. The interval is `.unref()`'d and cleared on the underlying `httpServer`'s own `close`
event, so it doesn't keep a test process (or a real shutdown) alive — `server/websocket.test.js`'s
existing per-test `httpServer.close()` in `afterEach` was enough, no test changes needed.

**Validation performed**: full suite (168 tests) run 5 consecutive times, 0 failures, process exits
cleanly each time (confirming the heartbeat interval doesn't leak a hanging handle). The actual
fix — whether this eliminates the reconnect loop over real WiFi to the Mini PC — still needs the
user's own confirmation on their LAN; a dropped-NAT-mapping bug is inherently something a local
dev-machine test run can't reproduce.

### Phase 6j: Auto-Update on Startup

`scripts/check-for-updates.bat` — checks GitHub for a newer commit on `main` and fast-forwards the
Mini PC's working copy to it, so the DM never has to `git pull` by hand. Wired into
`start-server.bat` (with a `--silent` flag) so it runs automatically every time the Scheduled Task
fires at login; also directly double-click-able on its own, in which case it pauses at the end so
the console window doesn't just flash and close.

Deliberate choices, confirmed with the user:
- **`git pull --ff-only`, never `reset --hard`.** If the Mini PC's copy has any local commits or
  uncommitted edits that don't cleanly fast-forward onto `origin/main`, git aborts on its own
  without touching any files. The script never discards work a DM did by hand on that machine.
- **A failed or skipped update never blocks the server from starting.** No git on PATH, no network
  reachable, or a non-fast-forward working copy all fall through to a logged message and the server
  starts anyway on whatever version is already on disk.
- **Self-relaunch from a `%TEMP%` copy before touching git.** This script lives inside the exact
  repo it updates, and `cmd.exe` executes a running `.bat` by seeking to byte offsets in the file as
  it goes rather than loading it into memory first — if `git pull` rewrote this file's own bytes
  mid-execution, later lines could be read from the wrong offset and misexecute. It copies itself
  to `%TEMP%`, re-invokes that copy (passing the real repo root and the silent flag through as
  arguments, since `%~dp0` in the copy would otherwise resolve to `%TEMP%` instead of `scripts\`),
  and deletes the copy when done. Everything past that point is safe to have rewritten out from
  under the original file.
- **`npm install` runs only when the pull actually moved `HEAD`** (compared before/after by commit
  hash), so a no-op check doesn't pay npm's startup cost on every single login.

**Not validated end-to-end on real Windows** (no such machine reachable from this session, same
constraint as Phase 6i's install/uninstall scripts) — the batch syntax was checked carefully by
hand, but actually running it on the Mini PC (does the fast-forward apply cleanly, does the
self-relaunch survive a real `git pull` mid-flight, does `start-server.bat` still come up
afterward) is the user's own next step.

### Post-6j: Hiding Monster HP/AC From Players (8-bit Condition Icons)

A DM table convention this app wasn't respecting: players could see a monster's exact HP bar,
exact HP numbers, and exact AC on their own Battlefield cards — full combat math a DM traditionally
keeps behind the screen so players read the fight through fiction (a monster "looking wounded"), not
a number ticking down. Requested fix: hide both, and give players a fuzzy substitute for HP instead
of nothing.

**AC**: `combatCardHtml` (dungeon_loot_wheel...html) now only renders the `AC N` span in the `isDm`
branch. `buildMonsterTooltipHtml`'s hover popup had the same leak (it showed exact AC and HP
unconditionally to anyone hovering a card, DM or player) — now checks
`window.getMultiplayerSelf()?.role !== 'dm'` and drops both stat lines for a connected non-DM
viewer. Solo/guest play (no `self` at all) keeps full stats — there's no separate player to hide
anything from.

**HP → condition icon**: in place of the player's old `combat-hp-bar-outer`/`-inner` bar and exact
`hp/maxHp` text, `renderMonsterConditionIcon` draws a small inline SVG "8-bit" icon (no external
image assets — a handful of `<rect>` pixels at a shared 10x10 resolution) whose damage look
escalates across four HP quartiles: healthy (>75%), hurt (51-75%), wounded (26-50%), and bloodied
(<=25%, the threshold explicitly requested) — bloodied gets a distinct look (blood streaming from
the eyes, dripping off the chin) plus a pulsing red glow via CSS, not just a color swap, so it reads
as unmistakably different at a glance. The DM's own card is completely unaffected — same exact HP
slider/numbers as always.

**Why a shared wound overlay instead of one art set per monster**: hand-authoring four full
redraws for every monster type wasn't worth it, and would have made "the wolf is bloodied" and "the
zombie is bloodied" look inconsistent. Instead the wound overlay (`MONSTER_ICON_OVERLAYS`, one grid
per quartile, using `R` for a wound pixel) is completely shared across every creature archetype and
layers on top of whichever base silhouette applies — "getting hurt" reads the same way regardless of
what's being fought, while the base shape is still what tells a wolf apart from a zombie.

**Archetypes, not one grid per family**: reuses the existing `getCreatureFamily` detector from the
Monster Parts v2 system (see the "Monster Parts v2" section elsewhere in this doc) rather than
inventing a second classifier, but collapses its 16 families down to 7 hand-drawn silhouettes
(`beast`, `humanoid`, `undead`, `dragon`, `ooze`, `aberration`, `construct`) via
`MONSTER_ICON_ARCHETYPE_BY_FAMILY` — drawing and maintaining 16 distinct blocky faces wasn't worth
it when several families already read as visually similar (a giant is just a big humanoid at this
resolution; a fiend reads fine as a horned dragon-ish shape). A monster with missing/unrecognized
type data falls all the way through to `getCreatureFamily`'s own existing `beast` catch-all
(`detect: () => true`) exactly as it already did for Monster Parts v2 — confirmed during testing
against a pre-existing malformed compendium entry ("Ogre Skeleton", type "Unknown" on the DM's own
card too, unrelated to this change) that this degrades gracefully to the generic beast icon instead
of erroring.

Each archetype's 10x10 grid is authored as five hand-written characters per row (`mirrorRow`
reflects it into the full symmetric width) purely to cut the authoring effort in half — every
monster face this draws happens to be left-right symmetric, so this isn't a general-purpose
constraint on future archetypes, just a shortcut for these seven.

**Validation performed**: live end-to-end test — a real DM connection and a real player connection
(two separate `dmbox_device_uid`s, same campaign) over an actual WebSocket, not just unit tests
(this is pure client-rendering logic with no server-side surface, so there's nothing to add to
`server/websocket.test.js`). Confirmed: player's card shows no AC and no HP numbers/bar at any HP
level; the icon correctly walks Healthy → Hurt → Wounded → Bloodied as the DM drags the HP slider
through each threshold; a wolf (beast) and a zombie (undead) render visibly distinct base shapes;
the DM's own card is unaffected throughout (still shows exact `AC 13` and a live `10/14` slider).
Full suite still 168/168 (this change has no server-side code, so this just confirms nothing else
broke).

### Post-6j: Item Equip Slots, Gambling Sync, and DM-Side Loot Display (Real Bugs Found in Testing)

A single round of user-reported issues turned up four independent, previously-undiscovered bugs —
none related to each other, all confirmed live with a real DM + a real connected player before and
after the fix. Also removed the Players/Compendium/Journey/Puzzles tabs from a connected player's
account entirely (added to `enforceRoleRestrictions`'s CSS and redirect-away list in
multiplayer-sync.js, alongside the pre-existing Loot/Combat restriction), per direct request — a
player's usable surface is now just Inventory, Store, Gambling, and Battlefield.

**1. Armor items whose name doesn't say what they are.** `inferSlotType`/`classifySubcategory`
only ever looked at an item's NAME to decide its equip slot. Every hand-authored "legendary" item
in loot-data.js (named after a person — "Keland Silith, the Bellower" — never the item itself) only
reveals what it actually is ("...who first made this gauntlets...") in the description's opening
line, so every one of them silently defaulted to generic chest armor. Fixed in two places:
`inferSlotType` now gives its own `'chest'` result a second look through the same description-aware
text scan an item with no subcategory at all already got (word-boundaried where a bare `includes`
risked colliding with ordinary English — `cape`/`escape`, `hood`/`childhood`, `mantle`/`dismantle`,
`robe`/`wardrobe`, `mask`/`masks`, `orb`/`absorb`); `classifySubcategory` gained an optional 4th
`desc` parameter for the same fallback, wired into the two DM-facing call sites that actually have
a description at classification time (Add Item, Edit Item) plus the generic metadata-inference
pass, so this self-heals for the whole catalog on every page load without a data migration.

**2. A much bigger version of the same bug, for `type:"misc"` items.** classifySubcategory's misc
branch only ever checked for ring/amulet, dumping everything else (including real wearables) into
the generic Common/Rare/Wondrous Misc "charm" bucket. 95 real accessories across the catalog —
several genuinely iconic named items (**Boots of Elvenkind, Cloak of Elvenkind, Hat of Disguise,
Winged Boots, Gloves of the Thief, Eyes of Minute Seeing**, Boots of Speed, and more) — were all
equipping into the generic trinket slot instead of Feet/Back/Hands/Waist/Face/Head. Each of these
items already carries a hand-tagged `classification` array (`["Accessory","Feet","Boots"]`) that's
strictly more reliable than guessing from words — `inferSlotType` now checks
`classification[0] === 'Accessory'` first and maps `classification[1]` directly via a 6-entry
lookup table, before falling through to anything else. Verified: all 95 previously-miscategorized
items now resolve correctly; the 249 genuinely-mundane misc items (torches, rope, keys, bedrolls —
anything not tagged `Accessory`) are untouched.

**3. Gambling was completely, unconditionally broken for every connected player.** Root cause: a
naming collision. This file (a classic, non-module `<script>`) declares its own top-level
`function pushGamblingState()` — which, being a global function declaration, attaches to
`window.pushGamblingState` same as any other global. `multiplayer-sync.js` (a `<script
type="module">`, always finishing execution after every classic script on the page regardless of
tag order) then runs `window.pushGamblingState = function(state){...}` — the real bridge — silently
**overwriting** the monolith's own function under the same name. Every one of the 9 bare
`pushGamblingState()` calls throughout the gambling code (host, close, bet/hit/stand/spin, deal,
dealer-plays, new round) was therefore actually invoking the bridge with zero arguments; its
`state` parameter came out `undefined`, which `JSON.stringify` drops entirely, so the server's own
`state || {game:null,table:null}` fallback silently collapsed every single push down to "no table."
A player's Gambling tab could never show anything but "wait for the DM," and the DM's Deal/Spin
buttons stayed permanently disabled ("no players") because no bet could ever reach the table either
— confirmed live: hosting sent literally `{"type":"push_gambling_state"}` with no `state` key at
all. Fixed by renaming the monolith's own wrapper to `pushGamblingStateToServer` (matching the
established pattern battlefield/puzzle-log already use — they call `window.pushBattlefieldState`/
`window.pushPuzzleLog` directly with no same-named local wrapper at all, which is exactly why they
never collided) and updating all 9 call sites. Verified end-to-end after the fix: DM hosts
Blackjack, player's tab receives the table live, player places a bet, DM sees the seated player,
DM deals, player sees cards appear — the entire loop, working, for the first time.

**4. A player looting a defeated monster's item never showed as taken on the DM's own card.**
`window.markLootClaimOnRoster(claimId, claim)` read `claim.claimedBy` — but its one caller
(multiplayer-sync.js, matching the server's own `loot_claim_update` message shape) sends
`claim.claimedByUid`. `item.claimedBy` was therefore always set to `undefined`, and every other
`claimedBy` check in the file (the claimed-tag label, the Reserve/Save/Loot/Discard/Give-to
controls) treats a falsy `claimedBy` as "still up for grabs" — so a DM's card kept offering full
controls on an item a player had already taken, with no visible sign it was gone. One-line fix
(`claim.claimedBy` → `claim.claimedByUid`); verified live — a player looting a Goblin's dropped
item now immediately shows `"Beasts Heartstone → LootTestPlayer"` on the DM's own card.

**Investigated, not resolved — the reported drag-and-drop freeze**: extensive attempts to reproduce
a report of "dragging an item off my character freezes the app pretty bad" — synthetic
`DragEvent`(dragstart/dragover/drop) sequences dispatched directly at the doll slot and the
inventory remove-zone, in both solo play and a real two-account multiplayer session — every
attempt completed in 1-2ms with no error and the correct end state (item unequipped/moved). No
infinite loop, no obviously expensive per-dragover work, and no evidence in the code of anything
that would block synchronously. Two real possibilities neither confirmed nor ruled out: (a) native
HTML5 drag-image compositing can genuinely freeze a page on lower-powered hardware regardless of
application code, which browser automation can't reproduce since it never triggers real drag-image
rasterization; (b) this may be a downstream symptom of the Mini PC not yet having pulled the
WebSocket heartbeat fix earlier in this document — a connection mid-reconnect at the exact moment
of a drop wouldn't itself freeze anything, but is worth ruling out once that fix is confirmed live.
Needs the user's own reproduction details (browser, whether it recovers or needs a reload, whether
it's every item or specific ones) to make further progress.

### Post-6j: DM Roster Strip, Weight/Encumbrance, Consumable Stat Effects, Compendium Gaps

Six requests in one pass — a new persistent DM UI element, a new game-rule feature, and three
investigate-and-fix bug reports.

**Always-visible DM player roster strip.** New `#dmRosterBar` div, a sibling of the tabs (same
placement pattern as the existing `#globalInvSummaryBar`) so it's visible on every tab, not just
Players — per direct request, since previously the only way to see who's connected was to switch
tabs. Each chip shows the player's name and HP (color-coded — see below); hovering one reuses the
same shared `#itemTooltip` element every other hover tooltip already uses to show Race/Class/
Affinity/AC. Hidden entirely for a connected player account and for solo/guest play (gated on
`getMultiplayerSelf()?.role === 'dm'`, re-checked in `enforceRoleRestrictions` on every identify
since a player's own identify never triggers the `roster_update` that would otherwise refresh it).
`characterRace` and `characterAffinity` are two brand new character-sheet fields (free text, no
validation, mirroring how `characterClass` already works end to end — sheet input, DM-edit modal,
save/load, the DM's read-only viewed-player panel) added specifically because the requested
tooltip needed them and neither existed anywhere in the app before now. The server's `buildRoster`
now includes `characterClass`/`characterRace`/`characterAffinity` in its broadcast alongside the
existing HP/AC fields.

**HP color-coding.** `hpColorClass(cur, max)` — green (`hp-color-full`) at 100%, gold
(`hp-color-hurt`) below that, red (`hp-color-low`) at or below 25% — reused by the new roster
strip, the Players tab list, and the shared tooltip, so "full/hurt/low" reads identically
everywhere a player's current HP appears. Same quartile-style threshold as the player-facing
monster condition icon elsewhere in this file, just as text color instead of pixel art.

**Weight/encumbrance bar, scaled off Strength per 5e's actual rule.** A small bar under the
existing "Inventory Weight" readout, filled to `current / (Strength × 15)` — the core carrying-
capacity rule — colored using the optional Variant Encumbrance thresholds most tables actually
pair with it: green (unencumbered) to Str×5, gold (Encumbered, -10 ft. speed) to Str×10, red
(Heavily Encumbered, -20 ft. speed + disadvantage) to the Str×15 cap. Uses the character's
*effective* Strength (base + gear + any active potion override — see below), not just the raw
typed base, so a Strength-boosting potion correctly raises carrying capacity too; refreshed
wherever the inventory, ability scores, or active effects change.

**Real bug: a Potion of Storm Giant Strength did nothing.** Root cause, found in
`game-engine.js`: `extractStatDeltasFromText` (the function that lets equipped gear give a "+2
Strength"-style bonus) only ever recognizes a leading +/- sign — it had no idea what to do with
"Strength set to 29 (Storm Giant) for 1 hour," an ABSOLUTE-value phrasing every Belt/Potion of
Giant Strength item in the catalog uses. Worse, and more consequential: **`activeTimedEffects`
(what drinking any potion or using any timed power actually creates) was never read by the
character sheet computation at all** — only equipped gear was. So even a hypothetical "+2
Strength for 1 hour" potion using the delta phrasing that already worked for gear would have been
just as inert. Fixed both: added `extractStatSetValuesFromText` (recognizes "is/becomes/set to N"
phrasing) and `collectStatSetOverrides`/`addActiveEffectDeltas`, wired into
`computeCharacterSheetFor` via a new optional `activeEffects` parameter (backward compatible —
existing callers/tests that don't pass it are unaffected) at all 4 call sites in the monolith. A
set-value effect only ever raises a score up to its stated value, matching every one of these
items' own "no effect if already at or above N" wording (`Math.max`, never a blind overwrite).
Verified: the exact reported potion now correctly sets Strength to 29; a character already at 30
Strength is correctly left untouched; a plain "+N Stat" temporary buff (previously also silently
inert) now works too.

**Real bug: hundreds of Compendium monsters had no description at all.** Quantified with the
actual 19-source bestiary the Compendium fetches from at runtime: 511 of 1,907 creatures — over a
quarter of the entire bestiary, spread across every source including the core Monster Manual, not
a rare handful — had no fluff text and weren't covered by the existing ~64-entry hand-written
mundane-animal fallback either. Two sources (Xanathar's Guide, Rise of Tiamat) have no fluff file
at all on the 5etools-mirror-3 GitHub mirror this app reads from; the rest is simply official
fluff never covering every single stat-block entry (dragon age variants, one-off named NPCs,
environmental hazards). Not a leftover from the Firebase migration — this app has always fetched
monster/spell data live from that external mirror, never bundled it. Rather than hand-author
hundreds more one-liners, added `synthesizeMonsterDesc` — a last-resort fallback (after real fluff
text and the mundane-animal list, in that order) that builds a short, honest sentence from fields
the stat block already provides: size, type, alignment (with a small alignment-code-to-word table,
deliberately conservative — a monster's genuinely mixed/chance-based alignment spread is left
blank rather than rendered wrong), plus its first named trait or action, e.g. "A Large fiend,
typically chaotic evil. Notable for its Magic Resistance." Verified against the live external
data: 0 of 1,907 monsters now come back with a blank description (was 511).

**Real bug: the spell Compendium defaulted to showing every spell twice.** Not a stale/regressed
fix from an earlier session — verified there was never a commit addressing this specifically, in
this repo or its predecessor. Root cause: `<select id="spellRuleset">` defaulted to `"both"`,
which fetches the 2014 AND 2024 rulebooks and shows every spell that exists in both as two
separate rows. Confirmed with real data (fetched both official sources directly) that even a
spell as stable as Fireball has different wording between the two editions — a byte-equality
dedup would essentially never fire, since the 2024 refresh deliberately rewrote most spell text —
so the fix is the default itself, not the dedup logic: changed to default to `"2014 5e +
supplements"` (most tables run one edition at a time), with "Both rulesets" still available as an
explicit, opt-in comparison view for anyone who wants it.

**Validation performed**: full suite still 168/168 after every change above (the roster-broadcast
field addition, the character-sheet signature change, and the weight-bar/HP-color work are all
additive or client-side-only). The DM roster strip, HP coloring, and Race/Class/Affinity fields
were verified live end-to-end with a real DM + a real connected player (a live-set "Half-Orc
Barbarian, Frost affinity, 8/32 HP" correctly appeared in both the roster chip — colored red — and
its hover tooltip). The weight bar was verified against real ability-score and equipped-item
changes, including that it re-reads Strength through the effective (potion-inclusive) sheet
total. The potion fix and the monster-description synthesis were both verified against real data
(the actual game-engine.js function for the former; the actual live 5etools-mirror-3 fetch for
the latter) before and after, not just unit-level.

### Post-6j: Drag Freeze (Likely Cause Found), Inventory Ability Bar, Fleshmancer Attach, Terrain Removed

**Likely real cause of the drag-and-drop freeze, found after two failed reproduction attempts.**
Every earlier attempt to reproduce "dragging an item freezes the app" via synthetic `DragEvent`
dispatch found nothing — every handler measured under 10ms even against an 80-item inventory.
That approach could never have caught the actual suspect: `itemPixelIcon`'s `icon-fx-legendary`/
`icon-fx-celestial` frame classes run TWO to FOUR simultaneous animated `box-shadow`/`filter`
effects (a pulsing glow plus two ember-particle pseudo-elements) on every legendary/celestial
item's icon, continuously, the whole time it's on screen — equipped or just sitting in the
inventory grid. A native HTML5 drag forces the browser to keep rasterizing/compositing the page
for as long as the drag is held, and doing that alongside several actively-animating blurred
box-shadows is a well-known freeze source on weaker/integrated GPUs (exactly what a Mini PC
has) — and it's invisible to any synthetic-event test, since those never touch real drag-image
compositing at all. Fixed by pausing every `icon-fx-*` animation for the duration of any drag
(`body.dragging-item`, toggled by the two existing document-level `dragstart`/`dragend`
listeners that already existed for the tooltip cleanup) — cosmetic only, confirmed via
`getComputedStyle` that the animation and box-shadow are fully suppressed while dragging and
restored immediately after. Not confirmed as THE fix (no Mini PC reachable from this session),
but the most concrete, well-reasoned lead found across two separate investigation passes.

**Inventory ability bar — players can now actually use granted item abilities.** Previously, an
equipped item granting a spell/power/natural-attack ability (anything with charges or a
duration — the exact set `handleItemActivation` already recognized) was only usable by
right-clicking its tiny equip-slot icon, something nothing in the UI ever hinted was possible.
New `#inventoryAbilityBar` on the Inventory tab (`renderAbilityBar`, called everywhere
`renderPlayerSlots` already is, plus every second alongside the existing Active Effects
countdown tick) shows one icon per equipped weapon (an Attack button, reusing the existing
`rollEquippedWeaponAttack` self-roll popup) and one per equipped item with a usable ability —
each using the item's own existing pixel icon (no new art system needed) so it reads as
"generic, hover for details" automatically via the same shared tooltip every other icon in this
app already has. Clicking a granted ability calls `handleItemActivation` — the exact same
function a right-click already ran, so there's only ever one implementation of "what does using
this item do" — and grays out (with a reason in its `title`) once its charges hit 0 or its own
timer (`activeTimedEffects`) is still running, showing a live "1m"/"45s"-style countdown badge
that clears the instant the effect actually expires. Verified live: a 3-charge ring correctly
grays out after the 3rd use and stays grayed on a 4th attempt; a duration-based amulet grays out
with a ticking cooldown badge and re-enables the instant `expiresAt` passes; the weapon Attack
icon opens the same roll popup as before.

**Fleshmancer's "Loot" button renamed "Attach," equips directly.** A grafted limb only ever has
one sensible destination — worn — so treating it like ordinary loot (drop it in the inventory
grid, make the player equip it as a separate step) was pure friction. `lootItemDirectly` gained
an optional `preferEquip` argument that tries `equipTokenToFirstOpenSlot` before falling back to
its existing inventory-placement logic (never lost, just not attached, if e.g. all 5 limb slots
are already full); the new `attachFleshItem` (replacing `lootFleshItem`) passes it. Verified
live: a test graft equipped straight to `limbArm1` with a "✓ ... attached." confirmation.

**Removed 'terrain' as a modifier type for weapons and generated items.** Per direct request —
not balanced against the catalog's other modifier types. Removed from `MOD_WEIGHT_DEFAULTS` (so
it can never be selected at all, not just weighted to zero) and the `generateModifierOfType`
branch that rolled it; `SYNERGY_RULES`' terrain boost/suppress entries and the storm/nature/void
flavor text that promised terrain effects were cleaned up to match. A save from before this
change gets its stale `modWeights.terrain` stripped on load. The Fleshmancer's own, entirely
separate terrain-alteration system (its own independent weight table) is untouched — this was
scoped to weapons/generated items specifically, per the request.

**Player HP added to the persistent name banner.** The "🧑 PlayerName" badge (visible on every
tab) now shows the player's own current/max HP alongside their name, color-coded the same
full/hurt/low scheme as the DM's roster strip and the Players tab — updated everywhere
`renderCharacterSheet` already runs, so it stays live through equipment changes, DM cross-writes,
and potion effects alike.

**Validation performed**: full suite still 168/168 (every change this pass is client-side only).
The ability bar, Fleshmancer attach, terrain removal, and HP banner were all verified live in a
running browser session against real equipped items and real generation output, not just read
through.

### Post-6j: Gambling Payout Messages, 8-bit Casino Reskin

**Payout messages.** Slots and Poker already showed "Won N gp" on a win (per-player independent
result queues, so "my own last result" was always the right thing to show). Roulette and
Blackjack — round-based, potentially several simultaneous winners — only ever showed what
happened (the winning number, the dealer's total), never who actually won or how much. Both now
get an explicit `gambling-payout-banner` line built from `result.payouts` (winners only, already
computed by `resolveRouletteSpin`/`resolveBlackjackDealerPlay` in game-engine.js — the DM's own
client is the dealer/authority for these two games, same as everywhere else in this system)
cross-referenced against `result.bets`/`table.players` for usernames: "🎉 PlayerName won 1,800
gp!" per winner, or an explicit "No winners this round" when there were real bets but nobody hit. Blackjack's per-seat status tag also gets the amount inline
("BLACKJACK +125 gp"), not just a bare result tag.

**8-bit casino reskin.** Added Google's "Press Start 2P" pixel font (alongside this file's
existing two fonts, same `@import`) for every gambling header/button/label. Three concrete visual
changes, all reusing techniques already established elsewhere in this file rather than inventing
new ones:
- **Cards** (`bjCardHtml`, shared by Blackjack and Poker): the plain Unicode suit character is
  replaced by a small hand-pixeled suit icon (`cardSuitIconSvg`/`CARD_SUIT_ICON_GRIDS` — spade/
  heart/diamond built via the same half-row-plus-`mirrorRow` shortcut the monster condition icons
  established, club as hand-authored full rows since its three-lobed shape doesn't reduce to one
  clean mirrored half). The card frame itself gets a hard, unblurred drop-shadow and the rank in
  Press Start 2P instead of a soft shadow and a plain serif/mono digit.
- **Slots reels**: the reel symbols were plain emoji; `slotsSymbolPixelIcon` now renders them via
  `pixelIconSvg` reusing existing `STORE_ICONS` shapes that already matched the concept (potion,
  sword for "weapon", gem, and `paw` — already used for Companion goods — doubling as "monster").
  One genuinely new shape, `coin` (a solid disc, literally `ring`'s silhouette with the hollow
  center filled in), for "gold."
- **Roulette wheel** (`rouletteWheelSvg`): every circle became a square/octagon — pocket dots are
  now small `<rect>`s on the same trig-computed ring positions as before, the outer rim and hub
  are 8-sided polygons instead of perfect circles, and the whole SVG sets
  `shape-rendering="crispEdges"` so every edge stays sharp instead of antialiased. The winning
  number's highlight is now in Press Start 2P.

Buttons (`gambling-action-btn`, `gambling-host-btn`) got a hard drop-shadow that flattens to
nothing on `:active` (shifting the button by the shadow's own offset) — a classic 8-bit
"press-down" micro-interaction — alongside the font change.

**Validation performed**: full suite still 168/168 (every change this pass is client-side
rendering only, no game-engine.js logic touched). Verified live for all four games — Roulette's
payout banner and blocky wheel, Blackjack's inline + banner payout amounts and all 4 pixel suit
icons rendering distinctly, Slots' pixel reel icons in both the machine and the recent-spins feed,
Poker's cards via the same shared `bjCardHtml`, and the roulette number grid's two-digit labels
(0-36) confirmed not to overflow their buttons at the smaller pixel-font size.

### Post-6j: Healing Potions Actually Heal; Unarmed Attack

**Root cause of "potions do nothing".** `handleItemActivation` (the one function behind every
right-click-to-use and every Ability Bar click) only ever did two things: start a duration timer
(`parseDurationMs` found something like "for 1 hour") or expend a charge. Neither path reads
`item.hp` — the dice-formula field (`"2d4+2"`) that Healing Potion has carried since it was first
authored, used only for its own tooltip/card display (`❤ Heals 2d4+2`). So drinking one expended
its `charges: '1 use'` down to 0 — which made it crumble to dust per `itemShouldCrumble`, since
any consumable with charges defaults to that interaction — and did precisely nothing else. It
wasn't a broken roll; the roll never happened at all.

Fixed by giving `handleItemActivation` a third branch: if `item.hp` is set, roll it
(`rollDiceFormulaTotal`, a `DICE_CHARGE_RE`-based "NdM+K -> number" helper sitting next to the
existing charge-dice roller) and apply it via the existing `updateCharacterField('characterCurrentHp',
...)` — already the single correct way to change current HP, since it clamps to
`characterMaxHpEffective` and handles the render + `scheduleSave` side effects on its own, so a
heal can never overheal past max and never needed a parallel save path. The amount actually
restored (post-clamp) is stashed in a module-level `lastActivationHealAmount` rather than changing
`handleItemActivation`'s own boolean return shape, since both its callers (`slotContextMenu`,
`activateAbilityFromBar`) just do `if (handleItemActivation(...))` today. Both callers now read it
to flash "Heals N HP." (or "Already at full HP." at 0) — `slotContextMenu`'s equipped-item path had
no flash message of any kind before this, healing or otherwise.

**Audited every other potion while in there** (the user's fear was other potions might be equally
broken): Potion of Water Breathing already works correctly as-is (its "for 1 hour" text drives the
existing timer path, which was never in question — a duration is all that potion needs). Stamina
Potion ("Removes one level of exhaustion") and Antidote ("Cures one poison affecting the drinker")
are not bugged so much as inert by design gap: this app has no tracked exhaustion-level or
poisoned-condition state on the player character sheet at all (those conditions live only in the
DM's narration/monster stat blocks, never as a field on the player), so there is no state for
these two to actually clear — they just quietly expend their charge and crumble, identical to
before this pass. Left alone rather than inventing new character-sheet state the user didn't ask
for; flagged here in case exhaustion/poison tracking is ever wanted as its own feature.

**Unarmed Attack button.** Added a second, always-present ability-bar icon (👊 Unarmed) next to
the per-weapon ⚔ Attack buttons `renderAbilityBar` already drew — previously a player with nothing
equipped in either weapon slot had no attack button on the bar at all. `computeUnarmedAttackRoll`
mirrors `computeWeaponAttackRoll`'s exact return shape (so it renders through the same
`weaponAttackRollHtml` popup) with a flat `1d6` base die and STR always as the ability score (no
finesse for bare fists). Per the request ("1d6 unless something modifies unarmed"), a new
`findUnarmedModifiers` scans every equipped slot's effect text (not just one weapon's own — an
unarmed strike has no single item to carry its own bonus) for phrasing that already exists in this
project's own data, e.g. the Fleshmancer hand-graft pool's Iron Claw ("+4 damage on unarmed
strikes.", see `FLESH_GRAFT_EFFECT_POOL`), plus a die-override pattern for any future item
authored as "Unarmed strikes deal 1d8."

**Validation performed**: full suite still 168/168 (both changes are monolith-only; no
game-engine.js logic touched). Verified live: bought a Healing Potion from the Alchemist, damaged
the character to 5/20 HP, equipped and activated the potion from the Ability Bar — HP went to
11/20 (a valid 2d4+2 roll) and the flash message read "Healing Potion crumbles to dust. Heals 6
HP."; repeated at full HP and confirmed "Already at full HP." with no HP change. Verified the
Unarmed button opens the same attack popup as a weapon (1d6 + STR + proficiency, no finesse), and
confirmed a synthetic Iron-Claw-worded item in an unrelated equip slot correctly added its +4 to
`computeUnarmedAttackRoll`'s damage bonus.

### Post-6j: Colored Property Chips, Fixed Token-Library Discard Button

**Property chips.** The Item Compendium/tooltip's `.tt-prop-chip` badges (RARE/UNIQUE/MAGICAL/
NECROTIC/etc. — see `deriveItemProperties` in game-engine.js for the full 14-value list) all
shared one gold box with no way to tell them apart at a glance. Added `PROP_CHIP_CLASS`/
`propChipClass(p)` mapping each property string to a `.tp-*` modifier class, each with its own
color and — reusing the exact `tagFlicker`/`tagGlowPulse`/`tagCrackle`/`tagBreathe`/`tagHueShift`/
`tagWarp` keyframes the synergy flavor tags (`.ic-tag.t-fire` etc.) already established, not a new
visual language — its own small thematic animation (Rare: blue pulse; Unique: purple warp; Magical:
teal hue-shift; Cursed: magenta crackle; Necrotic: violet breathe; Radiant: pale-gold pulse; Heavy/
Durable stay static, being mundane physical traits rather than magical ones). Both render sites
(`classificationTagsRowHtml`, the full tooltip builder) updated identically.

**Token Library discard button did nothing for ~99.9% of items.** The Token Library (Inventory
tab) deliberately shows the ENTIRE item catalog (3,800+ entries) as a searchable equip browser, not
just what you own — but its ✕ discard button rendered unconditionally on every card, and
`removeTokenEverywhere` (by design — see its own long-standing comment) only ever actually deletes
a `gen:` (player-generated) instance or a consumed monster-part craftable; every ordinary shared
catalog template is deliberately left untouched, since deleting one would permanently erase it from
the whole game for the rest of the session. The result: clicking ✕ on a plain catalog item (a
Torch, say) flashed "✓ Torch discarded." and the card just sat there, unchanged — reproduced live
and confirmed. Fixed by adding `isTokenDiscardable(e)` (mirrors `removeTokenEverywhere`'s own
gen:/monsterpart check exactly) and only rendering the discard button in `tokenCardHtml` when it
returns true — a real generated item still shows ✕ and still works; a shared catalog browse card
no longer offers a button that lied about what it did.

**Validation**: full suite 168/168. Verified live: a `loot:` catalog entry (Torch) renders with no
discard button; a `gen:` instance still renders one and `discardTokenLibraryItem` still removes it.

### Phase 6k: Wearable vs. Non-Wearable Monster Parts; "Simulate a Day" (Long Rest + Shop Restock)

**Wearable/unwearable monster parts.** Every one of the 14 monster-part types (`FLESHMANCER_PARTS`
in game-engine.js) could already be dropped into the Fleshmancer and turned into a worn graft via
`PART_TO_LIMB_CATEGORY`, with no distinction between, say, a Claw (plausibly a hand graft) and a
Venom Sac (a gland — not something a body has a slot for) or a Bone (raw skeletal crafting
material, not a limb). Added two new INTERACTIONS entries, `wearable_part`/`unwearable_part`, and
a new `UNWEARABLE_MONSTER_PARTS` set (`venomsac`, `bone` — everything else in FLESHMANCER_PARTS
stays wearable) in game-engine.js. Both `fleshMaterialDrop` (drag) and `fleshAssignMaterialByKey`
(click-to-select) — the two paths into the Fleshmancer's Rework workshop — now also require
`wearable_part`, with the drag path explaining why ("Venom Sac can't be worn as a graft — use it
as a crafting material or reagent instead"); the click path stays silent on rejection, matching its
pre-existing behavior for the ineligible-entirely case. The unwearable parts remain fully usable
everywhere they already were (reagent, weapon/armor material, ritual/summoning component) — this
only blocks the one "wear it" action. The `fleshInvGrid` dim filter was switched from
`fleshmancer_input` to `wearable_part` too, so the "Your Items" picker visually reflects the same
rule instead of looking eligible for something that will actually be turned away.

**"Simulate a Day."** Two behaviors changed together because they're the same underlying gap: shop
stock had no real day/night cycle behind it, and the game had no long-rest action at all.
- The per-merchant "🔄 Restock (resets stock)" button was reachable by ANY connected account, not
  just the DM — nothing gated it. A player mashing it themselves (thinking of it as a personal
  "reroll," since each account's daily wares were already private/unsynced to begin with — see
  `buyStapleRemote`'s own comment) is exactly what "items refresh every time someone visits the
  shop" looks like from that seat. Now gated `isRealPlayerAccount() ? '' : ...`, same convention
  as every other DM-only control in this app.
- Added `applyLongRestToPlayerState(state, rand)` to game-engine.js — dependency-free and
  rand-injectable so it runs identically in the browser and on the server: full HP (to
  `characterMaxHpEffective`), every `activeTimedEffects` entry cleared, death-save counters reset
  to 0, and every item in `savedGeneratedItems` whose charge format reads as per-day
  (`isPerDayCharge` — "3/day", dice-based "1d4+1/day", "per long rest", etc., via the new
  `refillDailyItemCharges`) refilled back to its pristine `chargesFormat`, re-rolling if that
  template is itself dice notation. A flat "1 use" or "7" (days of rations) is deliberately left
  alone — nothing about a day passing brings a fully-spent consumable back.
- New 🌅 FAB (`simulateADay()`, DM/solo-only, confirm-gated) sits above the existing Dice Roller
  FAB. Local-first: always long-rests THIS account's own character and restocks every real
  daily-wares merchant (`DAILY_WARES_MERCHANT_KEYS` — skips Fleshmancer/Monster Mangler/Bounty
  Hunter, which don't use the mechanic) immediately, so solo/offline play gets the full effect
  with zero server round-trip. If connected as DM, also calls `simulateDayRemote()`.
- Server: new `simulate_day` message (DM-only). Mutates every OTHER player's PERSISTED
  `player_states` row directly via the new `loadAllPlayerStates` query — reaching players who
  aren't even connected right now, the same reasoning `hp_delta`/`gift_item` already use rather
  than only pushing to a live socket — pushing `state_update` to whoever's actually connected
  (reusing the exact same client-side apply path `hp_delta` already rides, so no new client code
  was needed for the long-rest half at all). Daily wares were deliberately never a shared/
  arbitrated catalog (only the staple STOCK numbers are), so there's no single "the shop" to push;
  instead a `day_advanced` broadcast reaches every connected PLAYER (never echoed back to the
  triggering DM, who already did its own local half) telling their own client to reroll its own
  local daily wares via the new `window.onDayAdvanced`.

**Validation**: full suite now 180/180 (12 new tests: 7 in game-engine.test.js for the pure
long-rest/charge-recharge functions and the new interaction tags, 5 in websocket.test.js covering
the DM-only gate, a connected player's full rest, an OFFLINE player's rest delivered on next
identify, and `day_advanced` reaching players but never echoing to the DM). Verified live: damaged
a DM character to 5/30 HP with an active timed effect and a `0/day`-charged item, depleted the
Alchemist's stock, clicked Simulate a Day — HP restored to 30/30, the effect cleared, the item
read `3/day` again, and Alchemist stock returned to its full `[200,150,150,40,60]`. Verified a
synthetic Claw is accepted into the Fleshmancer workshop while a Venom Sac and a Bone are rejected
(with the drag path's explanatory message confirmed), and that both remain classified with
`fleshmancer_input` (still usable for other purposes) despite carrying `unwearable_part`.

### Post-6j: Puzzle Library — Action-Oriented Rework, Lore/Meta Removed

Per direct request: the Puzzles tab's 15 categories (puzzle-data.js) were, without exception, pure
"DM reads text aloud, players talk it out, click reveal" cards — zero mechanical involvement, no
roll with real stakes, no combat, no loot tied to the puzzle itself. Reworked four categories
toward "the players have to actually do something" (combat, destroying something, finding
something, looting something), and removed two entirely.

**Riddles (51 entries)** had no mechanical hook field at all — just `{q, a, tier}`. Rather than
re-embedding narrative into `q` itself (a previous pass already tried wrapping riddles in NPC/scene
framing and deliberately stripped it back out as monotonous — see the file's own header comment),
added a new `hook` field to every entry: a short, tier-scaled in-dungeon stake describing what's
actually guarding the riddle and what a right/wrong answer DOES, deliberately rotating across
combat ("a stone toad attacks on a wrong guess"), destruction ("smash the heavier egg to find a
key"), search ("flip the bed to reveal a strongbox"), and loot payoffs rather than leaning on one
formula for all 51. Rendered always-visible on the riddle card (styled as a DM note, above the
reveal button) via `renderPuzzleCategory`.

**Logic (21), Ciphers (20), Anti-Puzzle (19)** already had `note` fields, but nearly every one
ended the same way: "a wrong answer just resets/does nothing, no penalty — reward: whatever fits
your scene." Rewrote all 21 Logic notes and all 19 Anti-Puzzle notes (11 of the 19 — the other 8
already had real stakes) to replace the no-consequence wrong-answer language with an actual
mechanical result (a real if fair fight, a real trap, a forced alternate/harder path) and replaced
vague rewards with concrete loot. Anti-Puzzle's inherent fairness constraint (these exist
specifically to subvert a pattern the DM must have established first — see each entry's own "use
sparingly" guidance) was preserved: three genuinely roleplay/curiosity-driven entries (Guardian's
Question, Whispered Answer, Unbalanced Scale) were left low-stakes on purpose rather than punishing
a reasonable good-faith guess with combat.

**Ciphers** got an additional pass beyond stakes: 5 of the 20 were set somewhere that had nothing
to do with a dungeon at all (a tavern sing-along, a noble's writing desk, an overland trade road, a
harbor full of ships, a town notice board) — reframed into dungeon/ruin/stronghold scenes instead
(an abandoned mine shaft, a dead king's tomb-fortress, underground tunnel forks, a fortress
garrison hall, a prison guard post), keeping each cipher's actual letter-math intact (new location
names were chosen to preserve the exact same first-letter/count/position encoding, just renamed —
e.g. Duskhollow/Ironvein/Gravedeep/Nightcairn/Oreshaft/Ravengate/Tombwell/Hollowmere still spells
D-I-G-N-O-R-T-H for "Tunnel Forks," same trick the original "Trade Road Map" used for RIDE EAST).

**Lore/Continuity and Meta removed entirely** (`LORE_PUZZLES`/`META_PUZZLES` deleted from
puzzle-data.js, their tabs removed from `PUZZLE_CATEGORIES` and `puzzleCategoryData`'s switch in
the main file) — per direct request, out of scope for now rather than reworked.

**Validation**: full suite still 180/180 (puzzle-data.js is pure content with no test coverage of
its own). Verified live: riddle cards show their hook above the reveal button; entry counts confirm
51/21/20/19 preserved exactly (only content changed, nothing added or dropped) and Lore/Meta are
gone from both the tab bar and `puzzleCategoryData`; the five reframed cipher titles (The Tunnel
Chant, The Fallen King's Elegy, The Tunnel Forks, The Garrison Banners, The Warden's Proclamation)
render correctly in place of their originals.

---

# Ground-Up Mechanics Rebuild (supersedes the "Phase 6+ deployment" direction above)

**Everything above this line documents real, completed work on the original monolith app**
(`dungeon_loot_wheel_v102_spell_details.html`) **and its Phase 1–6 backend-wiring migration** (game
engine extraction, SQLite, the Node server, server-authoritative gambling, WebSocket multiplayer,
then wiring `multiplayer-sync.js`/the monolith against that backend, packaging, and a run of
content/UX passes on top). That work is real and this app's git history back through `8939d4c` is
its record — it is not being discarded or rewritten here.

**What changed:** after that work, a separate, approved plan launched a ground-up rebuild of the
mechanics layer, starting from commit `a1bb69d` ("Phase 0: strip the monolith HTML and all content
data files"). This is a **new, independently-numbered Phase 0–6** — not a continuation of the
Phase 1–6 numbering above, and easy to confuse with it since both used the same phase-number labels
for different work. `server/`, `db/`, `game-engine.js`, and `multiplayer-sync.js` — i.e. everything
the Phase 1–6 backend-wiring work above built — were deliberately left in place and are being reused
as the new engine's backend; only the monolith HTML and its content data files (`loot-data.js`,
`npc-data.js`, `cult-data.js`, `journey-data.js`, `reference-data.js`, `trap-data.js`,
`puzzle-data.js`) were removed. The two efforts share one continuous git history; they are not two
separate repos merged together.

## Rebuild Phase 0 — Vite scaffolding and proof-of-life

Replaced the old redirect-stub `index.html` with a real Vite entry point, added `vite.config.js`
(dev-server proxy for the backend's `/campaigns` REST routes and the WebSocket upgrade, both
unprefixed rather than behind a guessed `/api` prefix), and a minimal `src/main.js` that creates a
campaign and confirms it round-trips through the server's SQLite database — proving Vite, the Node
backend, and SQLite persistence are genuinely wired together before any real engine/UI work starts.
`server/start.js`'s `STATIC_ROOT` now defaults to `dist/` (Vite's build output) for a future
production run; dev mode never touches this path since Vite's own dev server serves the frontend
directly. Verified live: `npm run dev:all` starts both processes and the skeleton page created two
campaigns with a growing total count. 211 tests passing at this point.

## Rebuild Phase 1 — Dice engine

`src/engine/dice/dice.js`: pure, dependency-free dice primitives — `rollInt` (injectable-rand
inclusive random integer), `rollD20` (advantage/disadvantage by rolling twice and keeping the
natural high/low), `parseDiceNotation` (`NdM+K`, returns `null` rather than throwing on bad input),
`rollDamage` (doubles dice count, not the flat modifier, on a crit — the standard 5e rule). Every
function takes an injectable rand source defaulting to `Math.random`, matching `game-engine.js`'s
existing `rn()`/`battleRollDamage` convention. 18 new tests; full suite (229 tests) run 40
consecutive times with zero failures given the statistical distribution checks involved.

## Rebuild Phase 2 — Character/rules foundation

Adds a real player stat sheet before any item exists, per the rebuild plan's mechanics-first
ordering:
- `src/engine/character/ability-scores.js`: `ABILITY_NAMES`, `SKILL_ABILITY_MAP` (the 18 standard
  skills), `abilityModifier`, `proficiencyBonusForLevel` — ported as-is from `game-engine.js` (this
  math was never what the original audit flagged as broken).
- `src/engine/character/hp.js`: `computeMaxHp(level, hitDieSize, conModifier)` — real
  hit-dice-based HP, replacing the old app's three disconnected freeform level/maxHp/"hit dice
  label" fields.
- `src/engine/character/stat-modifiers.js`: a generic `{stat, value}` `StatModifier` aggregator,
  shared by traits now and by item passive effects later.
- `src/engine/character/character-sheet.js`: `computeDerivedSheet` ties it together — ability
  modifiers, proficiency bonus, derived max HP, derived AC (10 + Dex; armor comes in Phase 6),
  skill/save bonuses, all trait-statMod-aware.

Traits are structured with real mechanical effects (`{id, name, description, statMods}`), consumed
by `computeDerivedSheet` exactly like item passive effects consume their own `statMods` later.
`db/schema.js`'s `characters` table: replaced the freeform `hit_dice` TEXT label with structured
`hit_die_size`, added `skill_expertise`, `spell_slots_max`/`spell_slots_used` (per-level JSON maps,
DM/player-set directly, no class-derived progression table), and `traits` (JSON). A vanilla-DOM
character sheet (`src/ui/character-sheet/character-sheet.js`) mounts via `src/main.js`, replacing
Phase 0's proof-of-life button. 23 new tests; full suite (252 tests) run 15 consecutive times clean.

**Phase 2 addendum** — speed (defaults 30 ft., `computeDerivedSheet` returns a separate
`effectiveSpeed`, never written back into the stored base), creature size (6 standard D&D sizes),
alignment (9 standard alignments plus a blank "unset"), and `proficiency_bonus` promoted from a pure
computed display to a directly stored, directly editable field (falls back to the standard
level-derived value only when genuinely absent — an explicit value, including 0, always wins). Full
suite 257 tests.

## Rebuild Phase 3 — Combat engine core

Replaces the old app's three disconnected attack code paths (DM-rolls-monster, a standalone player
weapon-roll calculator that never touched HP, a DM-review attack-request queue) with one
`resolveAttack` pipeline (`src/engine/combat/attack.js`) used identically for player-vs-monster,
monster-vs-player, or monster-vs-monster. Initial version graded hit margin into
Devastating/Strong/Solid/Weak/Miss damage tiers; **a same-day fix** replaced that with the plain
5e roll-vs-AC check the user actually wanted, where AC acts as a direct modifier on damage (however
far the roll clears AC is added straight onto damage; a crit still just doubles dice, not scaled by
margin, since a natural 20 can force a hit against an AC the attacker's own bonus wouldn't have
cleared). `outcome` is a plain Fumble/Miss/Hit/Critical Hit label; `margin` is still returned for a
possible future effects system.

Server-side (`server/websocket.js`): new `push_combat_state` (DM wholesale-replaces the
roster/active/round) and `combat_attack` (either side may trigger their own PC's attack) messages.
`combat_attack` resolves server-side using the server's own copy of both combatants' state — never
a client-supplied roll. Combat state lives in a new `combat` `campaign_state` subsystem bucket.
Minimal combat UI (`src/ui/combat/combat-panel.js`) — roster table, HP bars, add-monster form,
attacker/target selectors, attack button, log; deliberately correctness-over-polish (initiative,
advantage/disadvantage controls, and a real DM Controls tab are later-phase work). This panel
identifies over WebSocket using its own fixed `demo-pc`/`dm` test account rather than the Character
Sheet's solo/guest slot, since the identify protocol needs a real non-empty `accountUid` and
bridging that with the solo slot's NULL `account_uid` is real design work deferred to the
DM-Controls/multiplayer porting work, not something improvised here. 16 engine tests + 8 server
integration tests; full suite 281 tests, various sub-suites run 20–40 consecutive times clean given
the real-randomness components.

## Rebuild Phase 4 — Item schema, validation, interactions, base-item + modifier system

Scoped to weapon/armor/consumable only, per explicit request — material/tool/wondrous/quest/
treasure deferred until their own subcategories get discussed.
- `src/engine/items/item-schema.js`: typedefs and vocab constants. Every mechanical value is a real
  typed field; `flavorText` is display-only and never parsed. `StatModifier` gained
  `attackRoll`/`damageRoll` targets; a new `Grants` shape covers non-numeric effects (an item
  granting a skill/save/weapon-or-armor proficiency outright, or a full trait, reusing Phase 2's
  trait shape so it flows through `computeDerivedSheet`'s existing math).
- `src/engine/items/validate-item.js`: structurally enforces a facet table (weapon requires
  `weapon`, allows passive/abilities/grants, never armor or onUse; armor is the mirror; consumable
  requires `consumable`, allows nothing else) — "swords don't have AC" is now a validation failure,
  not a convention nobody checks.
- `src/engine/items/interactions.js`: re-derived (not ported verbatim) against the new schema,
  narrowed to the ~11 entries relevant to weapon/armor/consumable. Found and fixed a real gap while
  re-deriving: the old registry had no interaction for scrolls at all — added `read`.
- `src/engine/items/modifiers.js`: the requested scalable base-item + modifier system instead of
  hand-authored unique magic items. `applyModifierToItem` clones a base item and merges a reusable,
  rarity-tagged `Modifier`'s effects in; `applyModifiers` sequences several, skipping (and
  reporting) any incompatible with the item's type rather than throwing. Exact rarity-to-
  modifier-count scaling deferred to Phase 5, once the real loot-generation algorithm is audited.

36 new tests, all passing on first run (pure deterministic logic). Full suite 317 tests, no UI
changes this phase.

## Rebuild Phase 5 — Item content batches (weapons, armor, consumables, materials, tools)

Base items only, sourced from the (pre-strip) monolith's `loot-data.js` as reference material —
confirmed each time as the correct reference project, distinct from the older, less-current
"Dungeon Loot Tool" also present. General pattern across every batch: ground new base items in
real mundane entries from the reference data rather than inventing numbers, and log explicitly
where the reference data didn't have a plain (non-magical) version of something so the
extrapolation is visible rather than silent.

- **Weapons** (7 → 14 after a fix): the first pass only read half the reference tier and missed a
  block of mundane martial weapons; redone against the complete tier. Final 14: 9 simple + 5
  martial. A material-variant naming convention ("Iron Mace" → "Mace") was established here — a
  material prefix reads as Modifier-system territory, not a distinct base item.
- **Armor** (4 → 9 after the same fix): light/medium/heavy/shield all represented; heavy armor and
  shields never add a Dex modifier, light/medium do, medium caps its bonus. Schema gained
  `strengthRequirement`/`stealthDisadvantage` and an explicit `additive` boolean (shield/accessory
  pieces add to existing armor AC; body armor replaces the base-10 formula) once multiple real
  additive items existed at once.
- `src/ui/items/items-panel.js`: a live item browser (new Items tab) — renders real computed
  interactions per item and lets a test modifier be applied to see base+modifier composition work
  against real data.
- **Consumables** (7 base items): unlike weapons/armor, the reference data does NOT model potions
  as base+modifier — each healing tier is its own separate catalog entry — so this batch mirrors
  that directly. `OnUseEffect` gained `damageDice`/`damageType`. Two items (Vial of Antitoxin,
  Corked Vial of Spirits) have real "advantage on X" effects not representable by the current
  numeric `StatModifier` vocabulary — left with empty `statMods` and the real effect in
  `flavorText` rather than a wrong numeric approximation (same gap as the modifier-pool pause
  below).
- **Real charges/uses + effect resolution**, pulled forward from its originally-planned later slot
  after the user asked directly whether a Greater Healing potion would actually heal HP (it didn't
  yet). Replaced a boolean `consumesItem` with real `consumable.uses`/`usesLeft`. New
  `src/engine/items/consume.js` — `resolveConsumableEffect`/`useConsumable`, the consumable-side
  counterpart to `attack.js`'s `resolveAttack`: rolls heal/damage dice for real, reports new HP
  (clamped), decrements `usesLeft`, pure and side-effect-free. Wired into the Items tab with a Demo
  Target HP bar and a Use button so this is provably functional in the running app.
- **Modifier pool audit — paused, not built**: an audit of the old catalog's magic-item modifiers
  found a real, reusable pool (enhancement tiers +1..+5, three structural materials, elemental
  on-hit variants, Masterwork, several triggered-on-hit/on-crit bolt-ons) — but most of it isn't
  numeric, and extending `Modifier` to express it raises an open design question (a loose
  `flags: string[]` catch-all vs. a fuller typed triggered-effect system) that the user asked to
  hold off deciding. Documented as a `PENDING` block at the top of `modifiers.js`,
  `items-panel.js`'s `PREVIEW_MODIFIERS` marked explicitly temporary, plus a project memory so this
  resurfaces even across a session boundary. **Still open — check before extending the modifier
  system further.**
- **Materials** (3) **and tools** (5): two new item types (`material`/`tool`) — material allows no
  mechanical facets at all (pure crafting input), tool allows an optional passive facet (a
  hypothetical masterwork tool). Confirmed before building that the old app's materials are almost
  entirely monster-part-derived (procedurally generated from a specific monster's anatomy at drop
  time) — that system had no equivalent yet, so only the smaller set of plain static
  crafting-material/tool catalog entries were ported here; documented rather than faked.
- **Monster-part family/theme system ported**: replaced an earlier flat stand-in with a faithful
  port of the old app's `CREATURE_FAMILIES`/`CREATURE_SUBTYPES`/`PART_THEMES`/`MONSTER_PARTS`
  system (`src/engine/items/monster-parts.js`) — 16 creature families, named subtypes, ~20
  anatomy-eligible part definitions with per-monster variant naming. Only combine-mode parts feed
  material generation right now; equip-mode parts (a real passive bonus) belong to the `wondrous`
  item type, still deferred. Run against synthetic example monsters
  (`src/data/example-monsters.js`, since no monster/NPC system exists yet) to produce 4 curated
  generated materials.

Full suite reached 415 tests across this phase's batches (some later superseded/consolidated by
Phase 6's own additions — see current `node --test` output for the live count, not this historical
figure).

## Rebuild Phase 6 — Real inventory/equip

Ports the old app's `SLOT_CATEGORY`/`collectEquippedAcBreakdown` structure (scoped to the slots
weapon/armor items can target today) rather than inventing a new equip model: body armor replaces
the base-10 AC formula and gates Dex per `addsDexMod`/`dexModCap`; everything else additive
(shield/helm/gauntlets/greaves/boots) adds its own `baseAC` on top.
- `src/engine/character/equipment.js`: `equipItem`/`unequipSlot` (two-handed weapons mirror both
  hand slots), `computeEquippedArmorClass`, and `computeDerivedSheetWithEquipment`, which merges
  equipped items' passive `StatModifier`s into `computeDerivedSheet`'s existing trait pipeline —
  every non-AC bonus (ability scores, skills, saves, HP, speed, attack/damage rolls) already worked
  for free through that reuse. Fixed a real Phase 2 gap surfaced by that reuse: an
  ability-abbreviation `StatModifier` was documented to bump the derived modifier but never
  actually did.
- `src/engine/items/abilities.js`: `activateAbility`, reusing `consume.js`'s
  `resolveConsumableEffect` for an item's `abilities[]` facet instead of duplicating
  effect-resolution logic.
- `db/schema.js`: `characters.inventory`/`equipped_slots` JSON columns, added directly to the
  `characters` table.
- `src/data/catalog.js`: a single id → `Item` lookup across all data files.
- `src/ui/inventory/inventory-panel.js`: real Inventory tab wired to the same persisted character
  as the Character Sheet tab — equip/unequip updates AC live, Use actually heals/damages real HP
  and persists `usesLeft`, Activate is wired for any future item with a real `abilities[]` facet.

Verified live: equipping Plate Armor + a Wooden Shield took AC 10 → 16 → 18; potions moved real HP
down then back up and persisted `0/1` uses through a reload; unequipping armor dropped AC back to
12. This is the most recent commit on the branch as of this writing (`7edf189`).

## Where this actually stands today (verify against `node --test` / the running app, not this doc)

Four UI tabs exist and are wired to the persisted backend: Character Sheet, Combat (live over
WebSocket against `server/websocket.js`), Items (browser/test harness), Inventory (real equip/use).
Nothing from the older Phase-6-Frontend-Wiring feature set above (Battlefield, Journey encounters,
Puzzles, NPCs, Map Builder, Store, Gambling, DM Controls, the Firebase-era account/login UI, the
packaged Windows auto-start/auto-update installer) has been rebuilt on this new engine yet — those
systems exist only in the old monolith's design/history, not in `src/`. The `server/`, `db/`, and
`multiplayer-sync.js` backend from the Phase 1–6 work above is being reused as-is/extended, not
rebuilt. See `docs/MIGRATION_PLAN.md` for the (now superseded) original plan and
`docs/NEXT_SESSION_BRIEF.md` for the current accurate handoff.
