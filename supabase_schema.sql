-- ====================================================================
-- TREASURE HUNT 2K26 — DATABASE MIGRATION & SECURITY CONFIGURATION
-- ====================================================================
-- Apply this SQL migration in your Supabase SQL Editor:
-- Dashboard -> SQL Editor -> New Query -> Run
-- ====================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ====================================================================
-- 2. TEAMS TABLE
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    team_name TEXT NOT NULL UNIQUE,
    leader_name TEXT,
    leader_phone TEXT,
    member_2 TEXT,
    member_3 TEXT,
    member_4 TEXT,
    password TEXT NOT NULL,
    current_sector INTEGER NOT NULL DEFAULT 0,
    last_clue_start TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'ELIMINATED', 'FINISHED'
    current_phase TEXT NOT NULL DEFAULT 'WAITING', -- 'WAITING', 'SAILING', 'COVE', 'RELEASED', 'FINISHED', 'PLANKED'
    failed_scans INTEGER NOT NULL DEFAULT 0,
    total_time_taken INTEGER NOT NULL DEFAULT 0,
    total_time_bank INTEGER NOT NULL DEFAULT 0,
    hint_used BOOLEAN NOT NULL DEFAULT false,
    hint_used_round INTEGER,
    hint_used_at TIMESTAMPTZ
);

-- Ensure all required columns exist if the table was created previously
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='teams' AND column_name='status') THEN
        ALTER TABLE public.teams ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='teams' AND column_name='current_phase') THEN
        ALTER TABLE public.teams ADD COLUMN current_phase TEXT NOT NULL DEFAULT 'WAITING';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='teams' AND column_name='failed_scans') THEN
        ALTER TABLE public.teams ADD COLUMN failed_scans INTEGER NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='teams' AND column_name='total_time_taken') THEN
        ALTER TABLE public.teams ADD COLUMN total_time_taken INTEGER NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='teams' AND column_name='total_time_bank') THEN
        ALTER TABLE public.teams ADD COLUMN total_time_bank INTEGER NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='teams' AND column_name='hint_used') THEN
        ALTER TABLE public.teams ADD COLUMN hint_used BOOLEAN NOT NULL DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='teams' AND column_name='hint_used_round') THEN
        ALTER TABLE public.teams ADD COLUMN hint_used_round INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='teams' AND column_name='hint_used_at') THEN
        ALTER TABLE public.teams ADD COLUMN hint_used_at TIMESTAMPTZ;
    END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_teams_team_name ON public.teams (team_name);
CREATE INDEX IF NOT EXISTS idx_teams_status ON public.teams (status);
CREATE INDEX IF NOT EXISTS idx_teams_sector ON public.teams (current_sector);

-- ====================================================================
-- 3. CLUE_SETTINGS TABLE
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.clue_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    team_id TEXT, -- NULL or 'ALL' for universal/shared clues, UUID string for team-specific
    chamber_number INTEGER NOT NULL, -- 1 through 6
    qr_secret_key TEXT NOT NULL,
    riddle_text TEXT,
    hint_text TEXT,
    clue_type TEXT NOT NULL DEFAULT 'text', -- 'text', 'image', 'audio'
    media_path TEXT,
    media_mime_type TEXT,
    media_size_bytes BIGINT
);

-- Ensure all columns exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clue_settings' AND column_name='clue_type') THEN
        ALTER TABLE public.clue_settings ADD COLUMN clue_type TEXT NOT NULL DEFAULT 'text';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clue_settings' AND column_name='media_path') THEN
        ALTER TABLE public.clue_settings ADD COLUMN media_path TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clue_settings' AND column_name='media_mime_type') THEN
        ALTER TABLE public.clue_settings ADD COLUMN media_mime_type TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clue_settings' AND column_name='media_size_bytes') THEN
        ALTER TABLE public.clue_settings ADD COLUMN media_size_bytes BIGINT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clue_settings_chamber ON public.clue_settings (chamber_number);
CREATE INDEX IF NOT EXISTS idx_clue_settings_team_chamber ON public.clue_settings (team_id, chamber_number);
CREATE INDEX IF NOT EXISTS idx_clue_settings_qr ON public.clue_settings (qr_secret_key);

-- ====================================================================
-- 4. APP_METRICS TABLE
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.app_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    install_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed initial row if empty
INSERT INTO public.app_metrics (install_count)
SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM public.app_metrics);

-- ====================================================================
-- 5. ATOMIC RPC FUNCTIONS (SECURITY ENFORCEMENT)
-- ====================================================================

-- A. STRICT ONE-HINT-PER-GAME ENFORCEMENT FUNCTION
-- Atomically validates and consumes the single hint token
CREATE OR REPLACE FUNCTION public.consume_hint_token(
    p_team_id UUID,
    p_chamber_number INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_team RECORD;
    v_hint TEXT;
BEGIN
    -- 1. Strictly reject Final Clue (Chamber 5) or Game End (Chamber 6)
    IF p_chamber_number >= 5 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'HINT_INELIGIBLE_FOR_FINAL_CLUE',
            'message', 'No hints are permitted for the Final Clue or Final QR.'
        );
    END IF;

    IF p_chamber_number < 1 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'INVALID_STAGE',
            'message', 'Invalid stage specified.'
        );
    END IF;

    -- 2. Lock team row for atomic verification
    SELECT * INTO v_team
    FROM public.teams
    WHERE id = p_team_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'TEAM_NOT_FOUND',
            'message', 'Team record not found.'
        );
    END IF;

    -- 3. Check team status
    IF v_team.status = 'ELIMINATED' OR v_team.status = 'FINISHED' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'TEAM_NOT_ACTIVE',
            'message', 'Team is eliminated or already finished.'
        );
    END IF;

    -- 4. Check if hint was already consumed
    IF v_team.hint_used = true THEN
        -- If already used for this exact stage, return the previously unlocked hint
        IF v_team.hint_used_round = p_chamber_number THEN
            SELECT hint_text INTO v_hint
            FROM public.clue_settings
            WHERE chamber_number = p_chamber_number
              AND (team_id = p_team_id::text OR team_id IS NULL OR team_id = 'ALL')
            ORDER BY (CASE WHEN team_id = p_team_id::text THEN 0 ELSE 1 END) ASC
            LIMIT 1;

            RETURN jsonb_build_object(
                'success', true,
                'already_unlocked', true,
                'hint_text', COALESCE(v_hint, 'No hint text configured for this stage.'),
                'hint_used_round', v_team.hint_used_round
            );
        END IF;

        -- Used on a different stage -> completely rejected
        RETURN jsonb_build_object(
            'success', false,
            'error', 'HINT_ALREADY_USED',
            'message', format('Your single hint token was already used in Stage %s.', v_team.hint_used_round)
        );
    END IF;

    -- 5. Verify the team is actually on this stage
    IF v_team.current_sector <> p_chamber_number THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'STAGE_MISMATCH',
            'message', 'Hints can only be consumed for your current stage.'
        );
    END IF;

    -- 6. Fetch hint text from clue_settings (team-specific first, universal fallback)
    SELECT hint_text INTO v_hint
    FROM public.clue_settings
    WHERE chamber_number = p_chamber_number
      AND (team_id = p_team_id::text OR team_id IS NULL OR team_id = 'ALL')
    ORDER BY (CASE WHEN team_id = p_team_id::text THEN 0 ELSE 1 END) ASC
    LIMIT 1;

    IF v_hint IS NULL OR trim(v_hint) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'NO_HINT_CONFIGURED',
            'message', 'No hint has been added for this stage yet. Token was not consumed.'
        );
    END IF;

    -- 7. Atomically consume token
    UPDATE public.teams
    SET hint_used = true,
        hint_used_round = p_chamber_number,
        hint_used_at = now()
    WHERE id = p_team_id;

    RETURN jsonb_build_object(
        'success', true,
        'already_unlocked', false,
        'hint_text', v_hint,
        'hint_used_round', p_chamber_number
    );
END;
$$;

-- B. ATOMIC QR SCAN VALIDATION & ROUND ADVANCEMENT
CREATE OR REPLACE FUNCTION public.validate_and_advance_scan(
    p_team_id UUID,
    p_scanned_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_team RECORD;
    v_target_round INTEGER;
    v_clue RECORD;
    v_now TIMESTAMPTZ := now();
    v_session_seconds INTEGER := 0;
    v_new_time_bank INTEGER;
    v_is_final BOOLEAN;
    v_target_phase TEXT;
    v_target_status TEXT;
BEGIN
    -- 1. Lock team row
    SELECT * INTO v_team
    FROM public.teams
    WHERE id = p_team_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'TEAM_NOT_FOUND');
    END IF;

    IF v_team.status = 'FINISHED' OR v_team.current_phase = 'FINISHED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'HUNT_ALREADY_FINISHED');
    END IF;

    IF v_team.status = 'ELIMINATED' OR v_team.current_phase = 'PLANKED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'TEAM_ELIMINATED');
    END IF;

    v_target_round := COALESCE(v_team.current_sector, 0) + 1;
    v_is_final := (v_target_round >= 6);

    -- 2. Verify QR key against clue_settings
    SELECT * INTO v_clue
    FROM public.clue_settings
    WHERE chamber_number = v_target_round
      AND UPPER(TRIM(qr_secret_key)) = UPPER(TRIM(p_scanned_key))
      AND (team_id = p_team_id::text OR team_id IS NULL OR team_id = 'ALL')
    ORDER BY (CASE WHEN team_id = p_team_id::text THEN 0 ELSE 1 END) ASC
    LIMIT 1;

    IF NOT FOUND THEN
        -- Record failed scan
        UPDATE public.teams
        SET failed_scans = COALESCE(failed_scans, 0) + 1
        WHERE id = p_team_id;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'INVALID_SEAL',
            'message', 'Invalid seal for your current expedition stage.'
        );
    END IF;

    -- 3. Calculate active session time
    IF v_team.last_clue_start IS NOT NULL AND v_team.current_phase NOT IN ('COVE', 'WAITING') AND v_team.current_sector > 0 THEN
        v_session_seconds := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_team.last_clue_start))::INTEGER);
    END IF;

    v_new_time_bank := COALESCE(v_team.total_time_bank, 0) + v_session_seconds;

    IF v_is_final THEN
        v_target_phase := 'FINISHED';
        v_target_status := 'FINISHED';
    ELSE
        v_target_phase := 'SAILING';
        v_target_status := 'ACTIVE';
    END IF;

    -- 4. Advance team state
    UPDATE public.teams
    SET current_sector = v_target_round,
        last_clue_start = CASE WHEN v_is_final THEN NULL ELSE v_now END,
        current_phase = v_target_phase,
        status = v_target_status,
        total_time_bank = v_new_time_bank,
        total_time_taken = v_new_time_bank
    WHERE id = p_team_id;

    RETURN jsonb_build_object(
        'success', true,
        'target_round', v_target_round,
        'is_final', v_is_final,
        'riddle_text', v_clue.riddle_text,
        'clue_type', v_clue.clue_type,
        'media_path', v_clue.media_path,
        'current_phase', v_target_phase,
        'status', v_target_status
    );
END;
$$;

-- C. SAFE CLUE FETCH (DOES NOT LEAK QR SECRET OR UNUNLOCKED HINTS)
CREATE OR REPLACE FUNCTION public.get_team_current_clue(
    p_team_id UUID,
    p_chamber_number INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_team RECORD;
    v_clue RECORD;
    v_hint TEXT := NULL;
BEGIN
    SELECT * INTO v_team FROM public.teams WHERE id = p_team_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'TEAM_NOT_FOUND');
    END IF;

    -- Fetch riddle
    SELECT id, chamber_number, riddle_text, hint_text, clue_type, media_path, media_mime_type
    INTO v_clue
    FROM public.clue_settings
    WHERE chamber_number = p_chamber_number
      AND (team_id = p_team_id::text OR team_id IS NULL OR team_id = 'ALL')
    ORDER BY (CASE WHEN team_id = p_team_id::text THEN 0 ELSE 1 END) ASC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'CLUE_NOT_FOUND');
    END IF;

    -- Only include hint_text if the team has unlocked it and it's not the final stage
    IF p_chamber_number < 5 AND v_team.hint_used = true AND v_team.hint_used_round = p_chamber_number THEN
        v_hint := v_clue.hint_text;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'chamber_number', v_clue.chamber_number,
        'riddle_text', v_clue.riddle_text,
        'hint_text', v_hint,
        'hint_used', v_team.hint_used,
        'hint_used_round', v_team.hint_used_round,
        'clue_type', v_clue.clue_type,
        'media_path', v_clue.media_path,
        'media_mime_type', v_clue.media_mime_type
    );
END;
$$;

-- ====================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

-- Enable RLS
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clue_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_metrics ENABLE ROW LEVEL SECURITY;

-- TEAMS POLICIES
DROP POLICY IF EXISTS "Public can view teams for leaderboard" ON public.teams;
CREATE POLICY "Public can view teams for leaderboard"
ON public.teams FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Admin full control on teams" ON public.teams;
CREATE POLICY "Admin full control on teams"
ON public.teams FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can update own team progress" ON public.teams;
CREATE POLICY "Anon can update own team progress"
ON public.teams FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

-- CLUE SETTINGS POLICIES
DROP POLICY IF EXISTS "Admin full control on clue_settings" ON public.clue_settings;
CREATE POLICY "Admin full control on clue_settings"
ON public.clue_settings FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can read clues" ON public.clue_settings;
CREATE POLICY "Anon can read clues"
ON public.clue_settings FOR SELECT
TO anon
USING (true);

-- APP METRICS POLICIES
DROP POLICY IF EXISTS "Public can read metrics" ON public.app_metrics;
CREATE POLICY "Public can read metrics"
ON public.app_metrics FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Public can update install count" ON public.app_metrics;
CREATE POLICY "Public can update install count"
ON public.app_metrics FOR UPDATE
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Admin full control on metrics" ON public.app_metrics;
CREATE POLICY "Admin full control on metrics"
ON public.app_metrics FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- ====================================================================
-- 7. STORAGE BUCKET CONFIGURATION ('clue-media')
-- ====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('clue-media', 'clue-media', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Allow authenticated users (admin) to upload, update, delete media
DROP POLICY IF EXISTS "Admin storage all access" ON storage.objects;
CREATE POLICY "Admin storage all access"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'clue-media')
WITH CHECK (bucket_id = 'clue-media');

-- Allow signed URL downloads (handled automatically by Supabase storage)
DROP POLICY IF EXISTS "Allow signed url reading" ON storage.objects;
CREATE POLICY "Allow signed url reading"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'clue-media');

-- ====================================================================
-- 8. REALTIME REPLICATION CONFIGURATION
-- ====================================================================
-- Ensure teams table is part of the realtime publication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'teams'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.teams;
    END IF;
END $$;
