# BUG_FIX_REPORT.md — Treasure Hunt 2K26

> **Prioritized Bug & Feature Audit · Phase 3**
> Full breakdown of every identified bug, its root cause, impact, exact location, proposed fix, and risk assessment.

---

## Prioritized Bug Inventory

| ID | Priority | Subsystem | Issue Summary |
|---|---|---|---|
| **BUG-01** | **CRITICAL** | Hint System | Hint token rule broken: hints tracked per-stage in localStorage instead of one-token-per-game; no server enforcement |
| **BUG-02** | **CRITICAL** | QR Scanner | Camera flickering, blinking clue card on scan, multiple scanner instances, stream leak |
| **BUG-03** | **CRITICAL** | Security & RLS | Plaintext QR keys and hints exposed in frontend queries; client-authoritative state changes |
| **BUG-04** | **HIGH** | Progression | Stage 3 forced into COVE pause (`isCove = targetRound === 3`), breaking 6-stage clue flow |
| **BUG-05** | **HIGH** | Media & Storage | Admin Clue Forge uses `getPublicUrl` on private `clue-media` bucket, causing 403 broken image/audio previews |
| **BUG-06** | **HIGH** | Audio System | Audio files `scan-success.mp3`, `ui-click.mp3`, `wrong-scan.mp3` are 0 bytes (empty corrupt files) |
| **BUG-07** | **MEDIUM** | Store & Sync | `syncFromDB` queries `clue_settings` by `chamber_number` only (no `team_id`), crashing on multiple rows |
| **BUG-08** | **MEDIUM** | Realtime Loop | Realtime UPDATE event calls `login()` on player, wiping `revealedClue: null` and causing full UI flash |
| **BUG-09** | **MEDIUM** | Final Stage | Clue 5 (Final Clue) renders hint button and loads hint text into DOM/state if present in DB |
| **BUG-10** | **LOW** | Code Hygiene | Unused components `AdventureButton.js` and `components/index.js`; test files with hardcoded credentials |
| **BUG-11** | **LOW** | PWA Manifest | `manifest.json` refers to non-existent `/icon-192.png` and `/icon.png` |

---

## Detailed Root Cause Analysis & Proposed Fixes

---

### BUG-01: Hint System Permissiveness & Lack of Single-Token Server Enforcement
- **What is happening**:
  Teams can use a hint on *every single stage* (Stages 1 through 5). The state is stored in `localStorage` under `treasure-hunt-hint-used:{team.id}:{sector}`.
- **Where**: `src/pages/dashboard.js` lines 466–493, `store.js`.
- **Why it is happening**:
  The developer keyed the hint tracking by `{sector}`, making it stage-scoped instead of game-scoped. Additionally, there is no column in `teams` or backend RPC enforcing hint consumption.
- **Root Cause**: Missing database-backed hint token tracking and absence of server-side atomic validation.
- **Proposed Solution**:
  1. Add `hint_used` (boolean), `hint_used_round` (int), and `hint_used_at` (timestamptz) columns to `teams`.
  2. Implement `consume_hint_token(p_team_id, p_chamber_number)` PostgreSQL RPC function:
     - Rejects any request where `p_chamber_number >= 5` (`'HINTS_INELIGIBLE_FOR_FINAL_CLUE'`).
     - Rejects if `teams.hint_used = true` (`'HINT_TOKEN_ALREADY_USED'`).
     - Validates that team is active and on that chamber.
     - Atomically consumes the token and returns the hint text.
  3. In `dashboard.js`:
     - Show hint control ONLY on Clues 1–4.
     - Show status: `AVAILABLE` (if token unused), `USED` (if used on this clue), or disabled/hidden (if used on another clue).
     - On Clue 5 (Final Clue), the hint control is completely absent.
- **Risk Assessment**: Low risk to core game loop; dramatically increases competitive fairness and game rule compliance.

---

### BUG-02: QR Scanner Flickering, Blinking Clue Card, and Stream Management
- **What is happening**:
  1. While the camera is open, the camera frame or background blinks/jitters on mobile devices.
  2. Immediately upon a successful QR scan, the clue card blinks (disappears and reappears).
  3. Camera stream sometimes remains locked or throws `Already scanning` errors on retry.
- **Where**: `src/pages/dashboard.js` lines 440–462, 518–632, 690–719, 1125–1154.
- **Why it is happening**:
  - **Flicker Cause A (Clue Card Blink)**: Upon successful scan, `advanceRound()` updates the store with the new clue. 150ms later, Supabase Realtime sends a `postgres_changes` UPDATE event back to the same client. The listener calls `usePlayerStore.getState().login(payload.new)`. In `store.js`, `login()` explicitly executes `set({ team, revealedClue: null })`! This wipes the clue to `null`, triggering Framer Motion exit animation. Then `fetchClueDirectly()` completes 200ms later and sets `revealedClue` back, animating it in again!
  - **Flicker Cause B (Camera Viewport Jitter)**: The timer `setInterval` calls `setTimeLeft` every 1000ms. This re-renders `Dashboard`. `<style jsx global>` inside the component re-injects CSS into `<head>` on re-renders. Combined with `backdrop-filter: blur(16px)` and the keyframe animation `ocean-drift` running on the fixed background, mobile GPUs re-composite the video layer repeatedly.
  - **Flicker Cause C (Camera Lifecycle)**: `stopScanner` is called while the scanner is in a paused state, causing unhandled promise rejections in `html5-qrcode` v2.3.8. Multiple `useEffect` hooks both register cleanup callbacks calling `stopScanner`.
- **Root Cause**:
  1. Store `login()` resetting `revealedClue: null` on Realtime updates.
  2. Timer updates triggering full dashboard re-renders while the modal is open.
  3. Styled-JSX global style re-evaluation.
  4. Inadequate stream teardown in `Html5Qrcode`.
- **Proposed Solution**:
  1. Create a dedicated, memoized `QRScannerModal` component isolated from parent re-renders:
     - Uses a ref-locked single instance of `Html5Qrcode`.
     - Explicitly stops native MediaStream tracks (`stream.getTracks().forEach(t => t.stop())`) upon close.
     - Disables heavy blur and continuous keyframe animations directly adjacent to the video container.
  2. In `store.js`, add `updateTeamFromRemote(dbData)` which updates team fields without touching `revealedClue`.
  3. In `dashboard.js`, move `GLOBAL_STYLES` outside of the component or to `_document.js` / `globals.css` so it is not re-injected on timer ticks.
- **Risk Assessment**: Low risk; thoroughly isolates camera DOM from React virtual DOM reconciliations.

---

### BUG-03: Security & RLS Vulnerabilities
- **What is happening**:
  - The client runs `.from('clue_settings').select('*')`, retrieving `qr_secret_key` and `hint_text` into browser memory.
  - Client directly writes to `teams` table to change sectors and statuses.
- **Where**: `src/pages/dashboard.js`, `src/lib/store.js`.
- **Root Cause**: Lack of restrictive RLS policies and lack of server-side validation RPCs.
- **Proposed Solution**:
  1. Implement SQL migration with strict RLS policies on `clue_settings` and `teams`.
  2. Provide server RPC `validate_and_advance_scan` that keeps `qr_secret_key` confidential.
  3. Ensure anon users can only read authorized fields.
- **Risk Assessment**: High security benefit; requires frontend to use the provided RPC or secured columns.

---

### BUG-04: Forced COVE on Stage 3
- **What is happening**:
  In `store.js` line 165:
  `const isCove = targetRound === 3; if (isCove) targetPhase = 'COVE';`
  Scanning QR 3 immediately freezes the team into COVE mode, clearing the clue and requiring manual admin intervention.
- **Where**: `src/lib/store.js` lines 164–206.
- **Why it is happening**:
  Leftover test code from a previous event version with a mandatory midway pause. The current game specification states: "Stage 3: Team scans QR 3. Validate the QR. Unlock Clue 3. Continue normal game progression."
- **Root Cause**: Hardcoded `targetRound === 3` check in `advanceRound`.
- **Proposed Solution**:
  Remove `targetRound === 3` hardcoding from `advanceRound`. COVE must only be triggered when explicitly requested by an admin via the Admin Portal (`handlePauseTeam`).
- **Risk Assessment**: Very low; restores normal clue unlocking for Stage 3.

---

### BUG-05: Admin Clue Forge Media Previews Fail on Private Storage Bucket
- **What is happening**:
  In `src/pages/admin/clues.js`, `getMediaUrl(path)` calls `supabase.storage.from(BUCKET).getPublicUrl(path)`. Since `clue-media` is a private bucket, this returns a public URL that responds with HTTP 403 Forbidden.
- **Where**: `src/pages/admin/clues.js` lines 78–82.
- **Root Cause**: Incompatible API call (`getPublicUrl` on private bucket).
- **Proposed Solution**:
  Change `getMediaUrl` in `clues.js` to generate a signed URL using `supabase.storage.from(BUCKET).createSignedUrl(path, 3600)`. Cache signed URLs in state or component map so preview images and audio clips play reliably.
- **Risk Assessment**: Low risk; repairs broken image and audio preview cards in the Admin Clue Forge.

---

### BUG-06: 0-Byte Corrupt Audio Files
- **What is happening**:
  `public/audio/scan-success.mp3`, `public/audio/ui-click.mp3`, and `public/audio/wrong-scan.mp3` are 0-byte empty files. When the browser attempts `audio.play()`, it fails silently or throws a decode error.
- **Where**: `public/audio/`.
- **Root Cause**: Files were committed as 0-byte placeholders in commit `3b224c6`.
- **Proposed Solution**:
  1. Generate clean, valid pirate-themed sound effects (synthetic Web Audio tones / synthesized WAV data encoded into the audio files or fallback audio synthesizer).
  2. Implement an audio manager `src/lib/sound.js` that checks for audio validity and falls back to Web Audio API synthesized chimes (e.g. golden bell for scan success, wooden thud for error, crisp click for UI buttons).
- **Risk Assessment**: Very low risk; guarantees sound plays in all browsers without crashing.

---

### BUG-07: `syncFromDB` Fails on Multiple Clue Rows
- **What is happening**:
  In `store.js` lines 311–319:
  ```javascript
  const { data: clue, error: clueError } = await supabase
    .from('clue_settings')
    .select('riddle_text')
    .eq('chamber_number', dbTeam.current_sector)
    .maybeSingle();
  ```
  If there are multiple teams with team-specific clues for that chamber number, `maybeSingle()` throws an error because multiple rows match `chamber_number`.
- **Where**: `src/lib/store.js` line 314.
- **Root Cause**: Query omitted `team_id` filter.
- **Proposed Solution**:
  Query `clue_settings` matching `team_id = dbTeam.id` first, and if not found, match `team_id IS NULL OR team_id = 'ALL'`.
- **Risk Assessment**: Very low risk; prevents clue disappearance on background sync.

---

### BUG-08: Realtime UPDATE Loop Wipes Revealed Clue
- **What is happening**:
  In `src/pages/dashboard.js` line 452:
  `usePlayerStore.getState().login(payload.new);`
  The `login` action resets `revealedClue: null`. This causes the active clue to flash off-screen every time any team field updates in Realtime.
- **Where**: `src/pages/dashboard.js` line 452, `src/lib/store.js` line 99.
- **Root Cause**: `login()` is designed for fresh auth, not reactive state updates.
- **Proposed Solution**:
  Use `updateTeamFromRemote(payload.new)` which retains `revealedClue` when `current_sector` has not changed.
- **Risk Assessment**: Very low risk; resolves clue card flickering.

---

### BUG-09: Clue 5 (Final Clue) Displays Hint Option
- **What is happening**:
  In `dashboard.js` line 962:
  `revealedClue && phase === 'SAILING' && currentHint`
  If a hint exists in the database for round 5, the "USE HINT" button appears on the final clue.
- **Where**: `src/pages/dashboard.js` lines 962–977.
- **Root Cause**: Stage boundary check missing (`progress < 5`).
- **Proposed Solution**:
  Check `team.current_sector < 5` before rendering the hint button. If `team.current_sector >= 5`, hint is completely ineligible.
- **Risk Assessment**: Very low risk; aligns UI with strict game rules.

---

### BUG-10: Exposed Credentials in Test Files & Unused Files
- **What is happening**:
  `test-db.mjs`, `test-db2.mjs`, `test-rpc.mjs`, `test-rpc2.mjs` contain raw Supabase credentials.
- **Where**: Project root.
- **Root Cause**: Ad-hoc debug scripts left in workspace.
- **Proposed Solution**:
  Clean up test scripts to read from environment variables; remove hardcoded secrets; clean up unused components `AdventureButton.js` and `components/index.js`.
- **Risk Assessment**: None; improves security and codebase clarity.
