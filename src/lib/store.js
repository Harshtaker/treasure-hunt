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
      login: (teamData) => {
        set({
          team: {
            id: teamData.id,
            team_name: teamData.team_name,
            current_sector: teamData.current_sector || 0,
            last_clue_start: teamData.last_clue_start,
            status: teamData.status || 'ACTIVE',
          },
          revealedClue: null,
          isEliminated: teamData.status === 'ELIMINATED',
          isFinished: teamData.status === 'FINISHED',
        });
      },

      logout: () => {
        set({ team: null, revealedClue: null, isEliminated: false, isFinished: false });
      },

      setRevealedClue: (clue) => set({ revealedClue: clue }),

      setEliminated: () => set({ isEliminated: true }),

      setFinished: () => set({ isFinished: true }),

      // Called after a successful QR scan — atomically updates local + DB
      advanceRound: async (targetRound, clueData) => {
        const { team } = get();
        if (!team) return null;

        const isFinal = targetRound === 5;
        const now = new Date().toISOString();

        const nextTeam = {
          ...team,
          current_sector: targetRound,
          last_clue_start: now,
          status: isFinal ? 'FINISHED' : 'ACTIVE',
        };

        // 1. Instant local save (Zustand auto-persists to localStorage)
        set({
          team: nextTeam,
          revealedClue: isFinal ? null : clueData.riddle_text,
          isFinished: isFinal,
        });

        // 2. Broadcast to admin
        try {
          const channel = supabase.channel('live_monitoring');
          channel.send({
            type: 'broadcast',
            event: 'scan_event',
            payload: { team: team.team_name, round: targetRound },
          });
        } catch (_) { /* non-critical */ }

        // 3. Background DB sync (fire-and-forget)
        supabase
          .rpc('scan_success_trigger', {
            t_id: team.id,
            target_round: targetRound,
            start_time: now,
          })
          .then();

        return nextTeam;
      },

      // Called on page load — reconciles localStorage vs DB
      syncFromDB: async () => {
        const { team } = get();
        if (!team) return;

        try {
          // Fetch current clue for the active round
          if (team.current_sector > 0 && team.status === 'ACTIVE') {
            const { data: clue } = await supabase
              .from('clue_settings')
              .select('riddle_text')
              .eq('chamber_number', team.current_sector)
              .maybeSingle();
            if (clue) set({ revealedClue: clue.riddle_text });
          }

          // Fetch latest team state from DB
          const { data: db } = await supabase
            .from('teams')
            .select('*')
            .eq('id', team.id)
            .single();

          if (db) {
            if (db.status === 'ELIMINATED') {
              set({ isEliminated: true });
              return;
            }
            if (db.status === 'FINISHED') {
              set({ isFinished: true });
              return;
            }
            // Only sync if DB is AHEAD of local
            if (db.current_sector > team.current_sector) {
              set({
                team: {
                  id: db.id,
                  team_name: db.team_name,
                  current_sector: db.current_sector,
                  last_clue_start: db.last_clue_start,
                  status: db.status,
                },
              });
              // Also fetch the new clue
              if (db.current_sector > 0) {
                const { data: clue } = await supabase
                  .from('clue_settings')
                  .select('riddle_text')
                  .eq('chamber_number', db.current_sector)
                  .maybeSingle();
                if (clue) set({ revealedClue: clue.riddle_text });
              }
            }
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

      // --- Actions ---
      loginAdmin: () => set({ isAdmin: true }),

      logoutAdmin: () => set({ isAdmin: false, teams: [], stats: { active: 0, eliminated: 0, finished: 0 } }),

      fetchTeams: async () => {
        const { data } = await supabase
          .from('teams')
          .select('*')
          .order('current_sector', { ascending: false })
          .order('last_clue_start', { ascending: true });

        if (data) {
          const active = data.filter((t) => t.status !== 'ELIMINATED' && t.status !== 'FINISHED').length;
          const eliminated = data.filter((t) => t.status === 'ELIMINATED').length;
          const finished = data.filter((t) => t.status === 'FINISHED').length;
          set({
            teams: data,
            lastSync: new Date().toLocaleTimeString(),
            stats: { active, eliminated, finished },
          });
        }
      },

      // Set up Supabase Realtime on the teams table
      subscribeRealtime: () => {
        const channel = supabase
          .channel('admin-live-teams')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'teams' },
            () => {
              // Re-fetch all teams on any change
              get().fetchTeams();
            }
          )
          .subscribe();

        // Also listen for broadcast scan events
        const broadcastChannel = supabase
          .channel('live_monitoring')
          .on('broadcast', { event: 'scan_event' }, () => {
            get().fetchTeams();
          })
          .subscribe();

        return () => {
          supabase.removeChannel(channel);
          supabase.removeChannel(broadcastChannel);
        };
      },
    }),
    {
      name: 'maze-admin-session', // localStorage key
      partialize: (state) => ({
        isAdmin: state.isAdmin,
      }),
    }
  )
);
