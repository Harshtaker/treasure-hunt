import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from './supabase';

// ========================================
// PLAYER STORE (persisted to localStorage)
// ========================================
export const usePlayerStore = create(
  persist(
    (set, get) => ({
      // --- State ---
      team: null,
      revealedClue: null,
      isEliminated: false,
      isFinished: false,

      // --- Actions ---

      /**
       * Called on login. Merges DB data with any existing local session.
       * Always takes the HIGHEST sector to prevent progress loss.
       */
      login: (dbData) => {
        const existing = get().team;

        // If we have a local session for the SAME team with higher progress, keep it
        if (
          existing &&
          existing.id === dbData.id &&
          existing.current_sector > (dbData.current_sector || 0)
        ) {
          // Local is ahead of DB — keep local, but silently push local state to DB
          const localTeam = existing;
          supabase
            .from('teams')
            .update({
              current_sector: localTeam.current_sector,
              last_clue_start: localTeam.last_clue_start,
              status: localTeam.status,
            })
            .eq('id', localTeam.id)
            .then(({ error }) => {
              if (error) console.error('Failed to sync local-ahead state to DB:', error);
            });

          // Don't overwrite — keep existing state
          return;
        }

        // DB is equal or ahead — use DB data
        set({
          team: {
            id: dbData.id,
            team_name: dbData.team_name,
            current_sector: dbData.current_sector || 0,
            last_clue_start: dbData.last_clue_start,
            status: dbData.status || 'ACTIVE',
          },
          revealedClue: null,
          isEliminated: dbData.status === 'ELIMINATED',
          isFinished: dbData.status === 'FINISHED',
        });
      },

      logout: () => {
        set({ team: null, revealedClue: null, isEliminated: false, isFinished: false });
      },

      setRevealedClue: (clue) => set({ revealedClue: clue }),

      setEliminated: () => {
        const { team } = get();
        set({ isEliminated: true });
        // Also update DB
        if (team) {
          supabase
            .from('teams')
            .update({ status: 'ELIMINATED' })
            .eq('id', team.id)
            .then();
        }
      },

      setFinished: () => set({ isFinished: true }),

      /**
       * Called after a successful QR scan.
       * 1. IMMEDIATELY updates Zustand (auto-persisted to localStorage)
       * 2. DIRECTLY updates the teams table in Supabase (not an RPC)
       * 3. Broadcasts the event to admin
       */
      advanceRound: async (targetRound, clueData) => {
        const { team } = get();
        if (!team) return null;

        const isFinal = targetRound === 5;
        const now = new Date().toISOString();
        let timeTaken = 0;
        
        if (isFinal && team.created_at) {
           timeTaken = Math.floor((new Date(now).getTime() - new Date(team.created_at).getTime()) / 1000);
        }

        const nextTeam = {
          ...team,
          current_sector: targetRound,
          last_clue_start: now,
          status: isFinal ? 'FINISHED' : 'ACTIVE',
          ...(isFinal && { total_time_taken: timeTaken })
        };

        // ========== STEP 1: INSTANT LOCAL SAVE ==========
        // Zustand persist middleware auto-saves this to localStorage
        set({
          team: nextTeam,
          revealedClue: isFinal ? null : clueData.riddle_text,
          isFinished: isFinal,
        });

        // ========== STEP 2: DIRECT DB UPDATE (NOT RPC) ==========
        // This is the critical fix — we directly update the teams table
        // so the data is in DB for re-login AND triggers Realtime for admin
        try {
          const { error } = await supabase
            .from('teams')
            .update({
              current_sector: targetRound,
              last_clue_start: now,
              status: isFinal ? 'FINISHED' : 'ACTIVE',
              ...(isFinal && { total_time_taken: timeTaken })
            })
            .eq('id', team.id);

          if (error) {
            console.error('DB update failed, will retry:', error);
            // Queue a retry after 3 seconds
            setTimeout(async () => {
              const retryState = get().team;
              if (retryState && retryState.id === team.id) {
                await supabase
                  .from('teams')
                  .update({
                    current_sector: retryState.current_sector,
                    last_clue_start: retryState.last_clue_start,
                    status: retryState.status,
                  })
                  .eq('id', team.id);
              }
            }, 3000);
          }
        } catch (e) {
          console.error('DB update exception:', e);
        }

        // ========== STEP 3: BROADCAST TO ADMIN ==========
        try {
          const channel = supabase.channel('live_monitoring');
          channel.send({
            type: 'broadcast',
            event: 'scan_event',
            payload: {
              team: team.team_name,
              teamId: team.id,
              round: targetRound,
              status: isFinal ? 'FINISHED' : 'ACTIVE',
              timestamp: now,
            },
          });
        } catch (_) {
          /* broadcast is non-critical */
        }

        // ========== STEP 4: ALSO CALL RPC IF IT EXISTS (BELT + SUSPENDERS) ==========
        try {
          supabase
            .rpc('scan_success_trigger', {
              t_id: team.id,
              target_round: targetRound,
              start_time: now,
            })
            .then();
        } catch (_) {
          /* RPC may not exist — that's fine, direct update already handled it */
        }

        return nextTeam;
      },

      /**
       * Called after a failed QR scan (wrong location).
       * Increments failed_scans in the database.
       */
      recordFailedScan: async () => {
        const { team } = get();
        if (!team) return;

        try {
          // Fire and forget increment
          supabase.rpc('increment_failed_scans', { t_id: team.id }).then();
          
          // Fallback if RPC doesn't exist: fetch and increment
          const { data } = await supabase.from('teams').select('failed_scans').eq('id', team.id).single();
          if (data) {
            await supabase.from('teams').update({ failed_scans: (data.failed_scans || 0) + 1 }).eq('id', team.id);
          }
        } catch (e) {
          console.error(e);
        }
      },

      /**
       * Called on page load — reconciles localStorage vs DB.
       * Only updates local if DB is strictly AHEAD.
       * If local is ahead, pushes local state to DB.
       */
      syncFromDB: async () => {
        const { team } = get();
        if (!team) return;

        try {
          // Fetch latest team state from DB
          const { data: db } = await supabase
            .from('teams')
            .select('*')
            .eq('id', team.id)
            .single();

          if (!db) return;

          // Check terminal states first
          if (db.status === 'ELIMINATED') {
            set({ isEliminated: true, team: { ...team, status: 'ELIMINATED' } });
            return;
          }
          if (db.status === 'FINISHED') {
            set({ isFinished: true, team: { ...team, status: 'FINISHED' } });
            return;
          }

          if (db.current_sector > team.current_sector) {
            // DB is ahead — update local
            const updatedTeam = {
              id: db.id,
              team_name: db.team_name,
              current_sector: db.current_sector,
              last_clue_start: db.last_clue_start,
              status: db.status,
            };
            set({ team: updatedTeam });

            // Fetch clue for the new sector
            if (db.current_sector > 0) {
              const { data: clue } = await supabase
                .from('clue_settings')
                .select('riddle_text')
                .eq('chamber_number', db.current_sector)
                .maybeSingle();
              if (clue) set({ revealedClue: clue.riddle_text });
            }
          } else if (team.current_sector > (db.current_sector || 0)) {
            // LOCAL is ahead of DB — push local state to DB (recovery scenario)
            console.log('Local ahead of DB, syncing up. Local:', team.current_sector, 'DB:', db.current_sector);
            await supabase
              .from('teams')
              .update({
                current_sector: team.current_sector,
                last_clue_start: team.last_clue_start,
                status: team.status,
              })
              .eq('id', team.id);
          }

          // Fetch current clue if we have an active sector but no clue text
          const currentClue = get().revealedClue;
          const currentSector = get().team?.current_sector;
          if (currentSector > 0 && !currentClue) {
            const { data: clue } = await supabase
              .from('clue_settings')
              .select('riddle_text')
              .eq('chamber_number', currentSector)
              .maybeSingle();
            if (clue) set({ revealedClue: clue.riddle_text });
          }
        } catch (e) {
          console.error('Background sync failed:', e);
        }
      },
    }),
    {
      name: 'maze-player-session', // localStorage key
      partialize: (state) => ({
        team: state.team,
        revealedClue: state.revealedClue,
        isEliminated: state.isEliminated,
        isFinished: state.isFinished,
      }),
    }
  )
);

// ========================================
// ADMIN STORE (persisted to localStorage)
// ========================================
export const useAdminStore = create(
  persist(
    (set, get) => ({
      // --- State ---
      isAdmin: false,
      teams: [],
      stats: { active: 0, eliminated: 0, finished: 0 },
      lastSync: '',
      _realtimeCleanup: null,

      // --- Actions ---
      loginAdmin: () => set({ isAdmin: true }),

      logoutAdmin: () => {
        // Clean up realtime subscriptions
        const cleanup = get()._realtimeCleanup;
        if (typeof cleanup === 'function') cleanup();
        set({
          isAdmin: false,
          teams: [],
          stats: { active: 0, eliminated: 0, finished: 0 },
          _realtimeCleanup: null,
        });
      },

      fetchTeams: async () => {
        try {
          const { data, error } = await supabase
            .from('teams')
            .select('*')
            .order('current_sector', { ascending: false })
            .order('last_clue_start', { ascending: true });

          if (error) {
            console.error('Failed to fetch teams:', error);
            return;
          }

          if (data) {
            const active = data.filter(
              (t) => t.status !== 'ELIMINATED' && t.status !== 'FINISHED'
            ).length;
            const eliminated = data.filter((t) => t.status === 'ELIMINATED').length;
            const finished = data.filter((t) => t.status === 'FINISHED').length;
            set({
              teams: data,
              lastSync: new Date().toLocaleTimeString(),
              stats: { active, eliminated, finished },
            });
          }
        } catch (e) {
          console.error('Fetch teams exception:', e);
        }
      },

      /**
       * Sets up Supabase Realtime on the teams table.
       * Listens for INSERT, UPDATE, DELETE events and re-fetches.
       * Also listens for broadcast scan events for double coverage.
       */
      subscribeRealtime: () => {
        const fetchFn = get().fetchTeams;

        // Channel 1: Postgres Changes (fires when teams table is updated)
        const pgChannel = supabase
          .channel('admin-pg-changes')
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'teams' },
            () => fetchFn()
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'teams' },
            () => fetchFn()
          )
          .on(
            'postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'teams' },
            () => fetchFn()
          )
          .subscribe((status) => {
            console.log('Realtime PG status:', status);
          });

        // Channel 2: Broadcast (fires when player sends scan_event)
        const broadcastChannel = supabase
          .channel('live_monitoring')
          .on('broadcast', { event: 'scan_event' }, (payload) => {
            console.log('Scan event received:', payload);
            // Small delay to let the DB write complete before fetching
            setTimeout(() => fetchFn(), 500);
          })
          .subscribe((status) => {
            console.log('Realtime Broadcast status:', status);
          });

        const cleanup = () => {
          supabase.removeChannel(pgChannel);
          supabase.removeChannel(broadcastChannel);
        };

        set({ _realtimeCleanup: cleanup });

        return cleanup;
      },
    }),
    {
      name: 'maze-admin-session', // localStorage key
      partialize: (state) => ({
        isAdmin: state.isAdmin,
        // Don't persist teams/stats — always fetch fresh
      }),
    }
  )
);
