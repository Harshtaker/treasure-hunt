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
              total_time_bank: localTeam.total_time_bank,
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
            current_phase: dbData.current_phase || 'WAITING',
            total_time_bank: dbData.total_time_bank || 0,
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
       * 1. Calculates round duration and updates total_time_bank
       * 2. Handles the 6-QR sequence flow
       * 3. Syncs immediately to Supabase
       */
      advanceRound: async (targetRound, clueData) => {
        const { team } = get();
        if (!team) return null;

        const now = new Date();
        const nowISO = now.toISOString();

        // FIXED: 6 QR Flow logic
        const isFinal = targetRound === 6;
        const isCove = targetRound === 3;
        const isResume = targetRound === 4;

        let sessionSeconds = 0;

        // Calculate time spent in the current round only if clock is running
        if (team.last_clue_start && team.current_phase !== 'COVE' && team.current_sector > 0) {
          const startTime = new Date(team.last_clue_start).getTime();
          sessionSeconds = Math.floor((now.getTime() - startTime) / 1000);
        }

        // Update the accumulated time bank
        const newTimeBank = (team.total_time_bank || 0) + sessionSeconds;

        let targetPhase = 'SAILING';
        if (isFinal) targetPhase = 'FINISHED';
        if (isCove) targetPhase = 'COVE';

        const nextTeam = {
          ...team,
          current_sector: targetRound,
          last_clue_start: isCove ? null : nowISO, // Pause clock at Cove
          current_phase: targetPhase,
          status: isFinal ? 'FINISHED' : 'ACTIVE',
          total_time_bank: newTimeBank,
          total_time_taken: newTimeBank // Backup for UI sorting
        };

        // UI Clue Logic
        const nextClue = (isFinal || isCove) ? null : clueData.riddle_text;

        // ========== STEP 1: INSTANT LOCAL SAVE ==========
        set({
          team: nextTeam,
          revealedClue: nextClue,
          isFinished: isFinal,
        });

        // ========== STEP 2: DIRECT DB UPDATE ==========
        try {
          const { error } = await supabase
            .from('teams')
            .update({
              current_sector: targetRound,
              last_clue_start: isCove ? null : nowISO,
              current_phase: targetPhase,
              status: isFinal ? 'FINISHED' : 'ACTIVE',
              total_time_bank: newTimeBank,
              total_time_taken: newTimeBank
            })
            .eq('id', team.id);

          if (error) {
            console.error('DB update failed, will retry:', error);
            setTimeout(async () => {
              const retryState = get().team;
              if (retryState && retryState.id === team.id) {
                await supabase
                  .from('teams')
                  .update({
                    current_sector: retryState.current_sector,
                    last_clue_start: retryState.last_clue_start,
                    current_phase: retryState.current_phase,
                    status: retryState.status,
                    total_time_bank: retryState.total_time_bank,
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
              timestamp: nowISO,
            },
          });
        } catch (_) { }

        return nextTeam;
      },

      /**
       * Called after a failed QR scan.
       */
      recordFailedScan: async () => {
        const { team } = get();
        if (!team) return;

        try {
          const { data } = await supabase.from('teams').select('failed_scans').eq('id', team.id).single();
          if (data) {
            await supabase.from('teams').update({ failed_scans: (data.failed_scans || 0) + 1 }).eq('id', team.id);
          }
        } catch (e) {
          console.error(e);
        }
      },

      /**
       * Reconciles localStorage vs DB on page load.
       */
      syncFromDB: async () => {
        const { team } = get();
        if (!team) return;

        try {
          const { data: db } = await supabase
            .from('teams')
            .select('*')
            .eq('id', team.id)
            .single();

          if (!db) return;

          if (db.status === 'ELIMINATED') {
            set({ isEliminated: true, team: { ...team, status: 'ELIMINATED' } });
            return;
          }
          if (db.status === 'FINISHED') {
            set({ isFinished: true, team: { ...team, status: 'FINISHED' } });
            return;
          }

          if (db.current_sector > team.current_sector || db.current_phase !== team.current_phase) {
            set({ team: { ...db } });

            if (db.current_sector > 0 && db.current_phase === 'SAILING') {
              const { data: clue } = await supabase
                .from('clue_settings')
                .select('riddle_text')
                .eq('chamber_number', db.current_sector)
                .maybeSingle();
              if (clue) set({ revealedClue: clue.riddle_text });
            }
          } else if (team.current_sector > (db.current_sector || 0)) {
            await supabase
              .from('teams')
              .update({
                current_sector: team.current_sector,
                last_clue_start: team.last_clue_start,
                status: team.status,
                total_time_bank: team.total_time_bank
              })
              .eq('id', team.id);
          }

          const currentClue = get().revealedClue;
          const currentSector = get().team?.current_sector;
          if (currentSector > 0 && !currentClue && db.current_phase === 'SAILING') {
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
      name: 'maze-player-session',
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
            .order('total_time_bank', { ascending: true });

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

      subscribeRealtime: () => {
        const fetchFn = get().fetchTeams;

        const pgChannel = supabase
          .channel('admin-pg-changes')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'teams' }, () => fetchFn())
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'teams' }, () => fetchFn())
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'teams' }, () => fetchFn())
          .subscribe();

        const broadcastChannel = supabase
          .channel('live_monitoring')
          .on('broadcast', { event: 'scan_event' }, (payload) => {
            setTimeout(() => fetchFn(), 500);
          })
          .subscribe();

        const cleanup = () => {
          supabase.removeChannel(pgChannel);
          supabase.removeChannel(broadcastChannel);
        };

        set({ _realtimeCleanup: cleanup });
        return cleanup;
      },
    }),
    {
      name: 'maze-admin-session',
      partialize: (state) => ({
        isAdmin: state.isAdmin,
      }),
    }
  )
);