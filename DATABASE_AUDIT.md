# DATABASE_AUDIT.md — Treasure Hunt 2K26

> **Database & Security Audit · Phase 2**
> Comprehensive inspection of Supabase PostgreSQL schema, Row-Level Security (RLS), Storage bucket policies, Realtime subscriptions, and atomic RPC functions.

---

## 1. Schema Analysis

### Table: `teams`
Authoritative record for each participating team, game state, and timing.

| Column | Data Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | Registration timestamp |
| `team_name` | `TEXT` | No | — | Unique name of the team |
| `leader_name` | `TEXT` | Yes | `NULL` | Team captain name |
| `leader_phone` | `TEXT` | Yes | `NULL` | Contact phone number |
| `member_2` | `TEXT` | Yes | `NULL` | Team member 2 |
| `member_3` | `TEXT` | Yes | `NULL` | Team member 3 |
| `member_4` | `TEXT` | Yes | `NULL` | Team member 4 |
| `password` | `TEXT` | No | — | Team login password |
| `current_sector` | `INTEGER` | No | `0` | Current completed sector / QR stage (0 = not started, 1..6) |
| `last_clue_start` | `TIMESTAMPTZ` | Yes | `NULL` | Timestamp when current 40-minute countdown started |
| `status` | `TEXT` | No | `'ACTIVE'` | `'ACTIVE'`, `'ELIMINATED'`, `'FINISHED'` |
| `current_phase` | `TEXT` | No | `'WAITING'` | `'WAITING'`, `'SAILING'`, `'COVE'`, `'RELEASED'`, `'FINISHED'`, `'PLANKED'` |
| `failed_scans` | `INTEGER` | No | `0` | Count of wrong QR scans recorded |
| `total_time_taken` | `INTEGER` | No | `0` | Cumulative seconds spent actively hunting |
| `total_time_bank` | `INTEGER` | No | `0` | Time bank accumulator (synchronized with total_time_taken) |
| `hint_used` | `BOOLEAN` | No | `false` | **NEW/REQUIRED**: Strict single hint token usage flag |
| `hint_used_round` | `INTEGER` | Yes | `NULL` | **NEW/REQUIRED**: Which stage (1, 2, 3, or 4) consumed the hint |
| `hint_used_at` | `TIMESTAMPTZ` | Yes | `NULL` | **NEW/REQUIRED**: Timestamp when hint was consumed |

#### Schema Verification Notes:
- Code references both `phase` and `current_phase`. `current_phase` is the canonical column used in the Zustand store and UI rendering. The migration includes a generated or fallback trigger to ensure backward compatibility.
- Code references both `total_time_taken` and `total_time_bank`. The migration ensures both columns exist and are synchronized.
- Legacy columns mentioned in previous revisions (`isEliminated`, `startTime`, `round1Time`, `round2Time`, `round3Time`) are deprecated in favor of `status`, `last_clue_start`, and `total_time_taken`.

---

### Table: `clue_settings`
Stores stage riddles, hints, QR secret keys, and media attachments.

| Column | Data Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `created_at` | `TIMESTAMPTZ` | No | `now()` | Row creation timestamp |
| `team_id` | `TEXT` | Yes | `NULL` | `UUID` for team-specific clues, `NULL` or `'ALL'` for universal clues |
| `chamber_number` | `INTEGER` | No | — | Stage number (1 to 6) |
| `qr_secret_key` | `TEXT` | No | — | Unique secret key encoded in the physical QR code |
| `riddle_text` | `TEXT` | Yes | `NULL` | Decrypted riddle text shown to the crew |
| `hint_text` | `TEXT` | Yes | `NULL` | Optional stage hint (revealed only if token consumed) |
| `clue_type` | `TEXT` | No | `'text'` | `'text'`, `'image'`, or `'audio'` |
| `media_path` | `TEXT` | Yes | `NULL` | Relative path inside the `clue-media` storage bucket |
| `media_mime_type` | `TEXT` | Yes | `NULL` | MIME type of uploaded file (e.g. `image/png`, `audio/mpeg`) |
| `media_size_bytes` | `BIGINT` | Yes | `NULL` | Size of uploaded file in bytes |

#### Universal vs. Team-Specific Clues:
- **Stages 1–5**: Can be team-specific (`team_id = '<UUID>'`) or universal (`team_id IS NULL` or `team_id = 'ALL'`). Team-specific takes precedence.
- **Stage 6 (Final QR)**: Must be universal (`team_id IS NULL` or `team_id = 'ALL'`). There is only one shared final QR for all crews.

---

### Table: `app_metrics`
Tracks application telemetry such as PWA installations.

| Column | Data Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `install_count` | `INTEGER` | No | `0` | Total PWA installations tracked |
| `updated_at` | `TIMESTAMPTZ` | No | `now()` | Last updated timestamp |

---

## 2. Row-Level Security (RLS) Audit

### Current Vulnerabilities Identified:
1. **Plaintext Password Exposure**: The `teams` table includes `password`. A public `SELECT *` query by any anon user could expose other teams' passwords.
2. **Direct Frontend Team Table Updates**: The client updates `current_sector`, `last_clue_start`, and `status` directly via `supabase.from('teams').update(...)`. If RLS allows unrestricted `UPDATE`, malicious teams can alter their stage or status via DevTools.
3. **QR Secret Key Leakage**: If `clue_settings` permits public `SELECT *`, teams can inspect network responses or run `supabase.from('clue_settings').select('qr_secret_key')` to read all QR codes in advance without visiting the locations!
4. **Hint Text Pre-Exposure**: If `hint_text` is included in the initial clue fetch, DevTools network logs reveal the hint without consuming the hint token.
5. **Private Storage Access**: Public URLs fail for private buckets, but creating unauthenticated public read policies would allow anyone to scrape clues.

### Required RLS Architecture:

```
┌──────────────────────────────────────────────────────────────┐
│                    RLS Access Control                         │
├───────────────────┬──────────────────────────────────────────┤
│ Public / Anon     │ • Authenticate team via RPC / verify     │
│ (Team Players)    │ • Read own team record (by verified ID)  │
│                   │ • Consume hint token via atomic RPC only │
│                   │ • Advance round via atomic RPC or secure │
│                   │   scan validation                        │
│                   │ • Read clue text (WITHOUT qr_secret_key) │
│                   │   for current stage only                 │
├───────────────────┼──────────────────────────────────────────┤
│ Authenticated     │ • Full read/write on all tables          │
│ Admin             │ • Manage clues, teams, metrics           │
│ (UID = Admin ID)  │ • Storage bucket full management         │
└───────────────────┴──────────────────────────────────────────┘
```

---

## 3. Storage Bucket Configuration (`clue-media`)

- **Bucket Name**: `clue-media`
- **Bucket Type**: **Private** (Public access disabled)
- **Path Structure**:
  - Team media: `{team_id}/round-{chamber_number}/{file_uuid}.{ext}`
  - Final media: `final/round-6/{file_uuid}.{ext}`
- **Security Policies**:
  - `SELECT`: Allowed for authenticated admin, and via Supabase Storage **Signed URLs** for team players.
  - `INSERT` / `UPDATE` / `DELETE`: Allowed only for authenticated Admin (`auth.uid() = admin_id`).
- **Client Handling**:
  - Admin Portal uses `createSignedUrl(path, 3600)` for preview.
  - Team Dashboard uses `createSignedUrl(path, 3600)` with automatic caching and graceful expiration handling.

---

## 4. Atomic RPC Functions Required

### 1. `consume_hint_token(p_team_id UUID, p_chamber_number INT)`
Enforces the **STRICT ONE-TOKEN-PER-GAME** rule:
1. Verifies that `p_chamber_number` is between 1 and 4. If `p_chamber_number >= 5`, raises an exception (`'HINTS_INELIGIBLE_FOR_FINAL_CLUE'`).
2. Checks that `teams.hint_used` is `FALSE`. If already `TRUE`, raises an exception (`'HINT_TOKEN_ALREADY_USED'`).
3. Verifies that `p_chamber_number` matches the team's authoritative `current_sector`.
4. Checks that the clue has valid, non-empty `hint_text`.
5. Atomically sets `teams.hint_used = true`, `teams.hint_used_round = p_chamber_number`, `teams.hint_used_at = now()`.
6. Returns `{ success: true, hint_text: '...' }`.

### 2. `validate_and_advance_scan(p_team_id UUID, p_scanned_key TEXT)`
Server-authoritative QR validation and stage advancement:
1. Looks up the team and verifies it is in an active game state (`status = 'ACTIVE'`, not `ELIMINATED` or `FINISHED`).
2. Determines expected target stage: `target_sector = teams.current_sector + 1` (max 6).
3. Matches `p_scanned_key` against `clue_settings` for `chamber_number = target_sector`:
   - Checks team-specific clue first (`team_id = p_team_id`).
   - Falls back to universal clue (`team_id IS NULL OR team_id = 'ALL'`).
4. If no match: increments `teams.failed_scans` and returns `{ success: false, error: 'INVALID_SEAL' }`.
5. If match:
   - Calculates elapsed session time from `last_clue_start`.
   - Adds session seconds to `total_time_taken` and `total_time_bank`.
   - Sets `current_sector = target_sector`.
   - Sets `last_clue_start = (target_sector == 6 ? NULL : now())`.
   - Sets `status = (target_sector == 6 ? 'FINISHED' : 'ACTIVE')`.
   - Sets `current_phase = (target_sector == 6 ? 'FINISHED' : 'SAILING')`.
   - Returns `{ success: true, new_sector: target_sector, riddle_text: ..., media_path: ..., clue_type: ... }`.

### 3. `get_team_clue(p_team_id UUID, p_chamber_number INT)`
Fetches the current clue for a team **without exposing `qr_secret_key` or `hint_text`**:
- Returns `riddle_text`, `clue_type`, `media_path`, `media_mime_type`.
- If the team has already consumed its hint token on this chamber (`teams.hint_used = true AND teams.hint_used_round = p_chamber_number`), it also returns `hint_text`.
- For Chamber 5 (Final Clue) or 6 (Game End), `hint_text` is ALWAYS `NULL`.

---

## 5. Realtime Subscriptions Audit

- **Player Dashboard**: Subscribes to `postgres_changes` on `public:teams:id=eq.{teamId}`.
  - *Fix needed*: Do NOT call full `login()` which resets `revealedClue: null`. Only update reactive fields (`status`, `current_sector`, `last_clue_start`, `current_phase`).
- **Admin Dashboard**: Subscribes to `postgres_changes` on `public:teams` (all rows) and `broadcast` on `live_monitoring`.
  - Debounced at 500ms to avoid stampedes on concurrent updates.
  - Proper unmount cleanup via `supabase.removeChannel()`.
