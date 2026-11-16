import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from './supabase';
const EMPTY_STATS = {
  active: 0,
  eliminated: 0,
  finished: 0,
};
const TERMINAL_STATUSES = ['ELIMINATED', 'FINISHED'];
function getTeamStatus(status) {
  return status || 'ACTIVE';
}
function normalizeTeam(dbData) {
  if (!dbData) return null;
  let hintUsed = Boolean(dbData.hint_used);
  let hintRound = dbData.hint_used_round
    ? Number(dbData.hint_used_round)
    : null;
  let hintAt = dbData.hint_used_at || null;
  if (!hintUsed && typeof window !== 'undefined' && dbData.id) {
    try {
      const localUsed = window.localStorage.getItem(
        `treasure-hunt-hint-consumed:${dbData.id}`
      );
      if (localUsed) {
        hintUsed = true;
        hintRound = Number(localUsed);
      }
    } catch (error) {
      // Local storage is optional.
    }
  }
  return {
    id: dbData.id,
    team_name: dbData.team_name,
    current_sector: Number(dbData.current_sector) || 0,
    last_clue_start: dbData.last_clue_start || null,
    status: getTeamStatus(dbData.status),
    current_phase:
      dbData.current_phase ||
      (Number(dbData.current_sector) > 0 ? 'SAILING' : 'WAITING'),
    total_time_bank:
      Number(dbData.total_time_bank) ||
      Number(dbData.total_time_taken) ||
      0,
    total_time_taken:
      Number(dbData.total_time_taken) ||
      Number(dbData.total_time_bank) ||
      0,
    failed_scans: Number(dbData.failed_scans) || 0,
    hint_used: hintUsed,
    hint_used_round: hintRound,
    hint_used_at: hintAt,
  };
}
function getStats(teams) {
  return {
    active: teams.filter(
      (team) =>
        !TERMINAL_STATUSES.includes(team.status) &&
        team.current_phase !== 'PLANKED'
    ).length,
    eliminated: teams.filter(
      (team) =>
        team.status === 'ELIMINATED' ||
        team.current_phase === 'PLANKED'
    ).length,
    finished: teams.filter(
      (team) =>
        team.status === 'FINISHED' ||
        team.current_phase === 'FINISHED'
    ).length,
  };
}
async function updateTeamRecord(teamId, updates) {
  const { error } = await supabase
    .from('teams')
    .update(updates)
    .eq('id', teamId);
  if (error) throw error;
}
function broadcastScan(payload) {
  try {
    const channel = supabase.channel('live_monitoring');
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      channel
        .send({
          type: 'broadcast',
          event: 'scan_event',
          payload,
        })
        .finally(() => {
          supabase.removeChannel(channel);
        });
    });
  } catch (error) {
    console.warn('Monitoring broadcast failed:', error);
  }
}
// ========================================
// PLAYER STORE
// ========================================
export const usePlayerStore = create(
  persist(
    (set, get) => ({
      team: null,
      revealedClue: null,
      isEliminated: false,
      isFinished: false,
      login: (dbData) => {
        if (!dbData?.id) {
          throw new Error('Invalid team record.');
        }
        const team = normalizeTeam(dbData);
        set({
          team,
          revealedClue: null,
          isEliminated:
            team.status === 'ELIMINATED' ||
            team.current_phase === 'PLANKED',
          isFinished:
            team.status === 'FINISHED' ||
            team.current_phase === 'FINISHED',
        });
      },
      logout: () => {
        set({
          team: null,
          revealedClue: null,
          isEliminated: false,
          isFinished: false,
        });
      },
      setRevealedClue: (clue) => {
        set({ revealedClue: clue });
      },
      consumeHintLocally: (sector) => {
        const { team } = get();
        if (!team) return;
        const updated = {
          ...team,
          hint_used: true,
          hint_used_round: Number(sector),
          hint_used_at: new Date().toISOString(),
        };
        try {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(
              `treasure-hunt-hint-consumed:${team.id}`,
              String(sector)
            );
          }
        } catch (error) {
          // Local storage is optional.
        }
        set({ team: updated });
      },
      // Update team state from remote Realtime event
      // without wiping revealedClue.
      updateTeamFromRemote: (dbData) => {
        if (!dbData?.id) return;
        const current = get().team;
        if (current && current.id !== dbData.id) return;
        const updated = normalizeTeam(dbData);
        const isEliminated =
          updated.status === 'ELIMINATED' ||
          updated.current_phase === 'PLANKED';
        const isFinished =
          updated.status === 'FINISHED' ||
          updated.current_phase === 'FINISHED';
        set({
          team: updated,
          isEliminated,
          isFinished,
        });
      },
      // Safely eliminate a team only if its latest database
      // state still matches the timer state that expired.
      setEliminated: async () => {
        const { team } = get();
        if (!team?.id) return;
        if (
          team.status === 'FINISHED' ||
          team.current_phase === 'FINISHED'
        ) {
          return;
        }
        try {
          const { data: latestTeam, error: fetchError } = await supabase
            .from('teams')
            .select(
              'id,status,current_phase,last_clue_start,current_sector'
            )
            .eq('id', team.id)
            .single();
          if (fetchError) throw fetchError;
          if (!latestTeam) return;
          // Do not eliminate a team that an admin has already
          // revived, paused, finished, or otherwise changed.
          if (
            latestTeam.status !== 'ACTIVE' ||
            latestTeam.current_phase !== 'SAILING' ||
            !latestTeam.last_clue_start
          ) {
            await get().syncFromDB();
            return;
          }
          const latestStart = new Date(
            latestTeam.last_clue_start
          ).getTime();
          if (!Number.isFinite(latestStart)) {
            await get().syncFromDB();
            return;
          }
          const elapsedSeconds = Math.floor(
            (Date.now() - latestStart) / 1000
          );
          // The standard round duration is 40 minutes.
          if (elapsedSeconds < 40 * 60) {
            await get().syncFromDB();
            return;
          }
          // Conditional update prevents an old timer callback
          // from overwriting a newer admin action.
          const { data: updatedRows, error: updateError } =
            await supabase
              .from('teams')
              .update({
                status: 'ELIMINATED',
                current_phase: 'PLANKED',
              })
              .eq('id', team.id)
              .eq('status', latestTeam.status)
              .eq('current_phase', latestTeam.current_phase)
              .eq('current_sector', latestTeam.current_sector)
              .eq('last_clue_start', latestTeam.last_clue_start)
              .select('id');
          if (updateError) throw updateError;
          if (!updatedRows || updatedRows.length === 0) {
            await get().syncFromDB();
            return;
          }
          const currentTeam = get().team;
          if (currentTeam?.id === team.id) {
            set({
              isEliminated: true,
              isFinished: false,
              team: {
                ...currentTeam,
                status: 'ELIMINATED',
                current_phase: 'PLANKED',
              },
            });
          }
        } catch (error) {
          console.error('Failed to update elimination status:', error);
          await get().syncFromDB();
        }
      },
      setFinished: () => {
        const { team } = get();
        if (!team) return;
        set({
          isFinished: true,
          isEliminated: false,
          team: {
            ...team,
            status: 'FINISHED',
            current_phase: 'FINISHED',
          },
        });
      },
      advanceRound: async (targetRound, clueData) => {
        const { team } = get();
        if (
          !team ||
          !Number.isInteger(targetRound) ||
          targetRound < 1
        ) {
          return null;
        }
        if (
          TERMINAL_STATUSES.includes(team.status) ||
          team.current_phase === 'PLANKED'
        ) {
          return null;
        }
        const now = new Date();
        const nowISO = now.toISOString();
        const isFinal = targetRound === 6;
        let sessionSeconds = 0;
        if (
          team.last_clue_start &&
          team.current_phase !== 'COVE' &&
          team.current_phase !== 'WAITING' &&
          team.current_sector > 0
        ) {
          const start = new Date(team.last_clue_start).getTime();
          if (Number.isFinite(start)) {
            sessionSeconds = Math.max(
              0,
              Math.floor((now.getTime() - start) / 1000)
            );
          }
        }
        const newTimeBank =
          (team.total_time_bank || 0) + sessionSeconds;
        const targetPhase = isFinal ? 'FINISHED' : 'SAILING';
        const targetStatus = isFinal ? 'FINISHED' : 'ACTIVE';
        const nextTeam = {
          ...team,
          current_sector: targetRound,
          last_clue_start: isFinal ? null : nowISO,
          current_phase: targetPhase,
          status: targetStatus,
          total_time_bank: newTimeBank,
          total_time_taken: newTimeBank,
        };
        const nextClue = isFinal
          ? null
          : clueData?.riddle_text ?? null;
        set({
          team: nextTeam,
          revealedClue: nextClue,
          isFinished: isFinal,
          isEliminated: false,
        });
        try {
          await updateTeamRecord(team.id, {
            current_sector: targetRound,
            last_clue_start: nextTeam.last_clue_start,
            current_phase: targetPhase,
            status: nextTeam.status,
            total_time_bank: newTimeBank,
            total_time_taken: newTimeBank,
          });
          broadcastScan({
            team: team.team_name,
            teamId: team.id,
            round: targetRound,
            status: nextTeam.status,
            timestamp: nowISO,
          });
        } catch (error) {
          console.error('Round update failed:', error);
          await get().syncFromDB();
        }
        return nextTeam;
      },
      recordFailedScan: async () => {
        const { team } = get();
        if (!team) return;
        try {
          const { data, error } = await supabase
            .from('teams')
            .select('failed_scans')
            .eq('id', team.id)
            .single();
          if (error) throw error;
          const updatedScans = (data?.failed_scans || 0) + 1;
          await updateTeamRecord(team.id, {
            failed_scans: updatedScans,
          });
          const currentTeam = get().team;
          if (currentTeam?.id === team.id) {
            set({
              team: {
                ...currentTeam,
                failed_scans: updatedScans,
              },
            });
          }
        } catch (error) {
          console.error('Failed to record scan:', error);
        }
      },
      syncFromDB: async () => {
        const { team } = get();
        if (!team?.id) return;
        const teamId = team.id;
        try {
          const { data, error } = await supabase
            .from('teams')
            .select('*')
            .eq('id', teamId)
            .single();
          if (error) throw error;
          if (!data) return;
          // Do not apply a response to a different logged-in team.
          if (get().team?.id !== teamId) return;
          const dbTeam = normalizeTeam(data);
          if (
            dbTeam.status === 'ELIMINATED' ||
            dbTeam.current_phase === 'PLANKED'
          ) {
            set({
              team: dbTeam,
              isEliminated: true,
              isFinished: false,
              revealedClue: null,
            });
            return;
          }
          if (
            dbTeam.status === 'FINISHED' ||
            dbTeam.current_phase === 'FINISHED'
          ) {
            set({
              team: dbTeam,
              isFinished: true,
              isEliminated: false,
              revealedClue: null,
            });
            return;
          }
          let revealedClue = get().revealedClue;
          const shouldReloadClue =
            dbTeam.current_sector > 0 &&
            dbTeam.current_sector < 6 &&
            dbTeam.current_phase === 'SAILING' &&
            (
              dbTeam.current_sector !== team.current_sector ||
              dbTeam.current_phase !== team.current_phase ||
              !revealedClue
            );
          if (shouldReloadClue) {
            // First check team-specific clue, then universal fallback.
            const { data: teamClue } = await supabase
              .from('clue_settings')
              .select('riddle_text')
              .eq('chamber_number', dbTeam.current_sector)
              .eq('team_id', dbTeam.id)
              .maybeSingle();
            if (teamClue?.riddle_text) {
              revealedClue = teamClue.riddle_text;
            } else {
              const { data: sharedClue } = await supabase
                .from('clue_settings')
                .select('riddle_text')
                .eq('chamber_number', dbTeam.current_sector)
                .or('team_id.is.null,team_id.eq.ALL')
                .maybeSingle();
              revealedClue = sharedClue?.riddle_text ?? null;
            }
          }
          if (get().team?.id !== teamId) return;
          set({
            team: dbTeam,
            revealedClue,
            isEliminated: false,
            isFinished: false,
          });
        } catch (error) {
          console.error('Background sync failed:', error);
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
// ADMIN STORE
// ========================================
export const useAdminStore = create(
  persist(
    (set, get) => ({
      isAdmin: false,
      teams: [],
      stats: { ...EMPTY_STATS },
      lastSync: '',
      _realtimeCleanup: null,
      _fetchRequestId: 0,
      loginAdmin: () => {
        set({ isAdmin: true });
      },
      logoutAdmin: () => {
        const cleanup = get()._realtimeCleanup;
        if (typeof cleanup === 'function') {
          cleanup();
        }
        set({
          isAdmin: false,
          teams: [],
          stats: { ...EMPTY_STATS },
          lastSync: '',
          _realtimeCleanup: null,
          _fetchRequestId: get()._fetchRequestId + 1,
        });
      },
      fetchTeams: async () => {
        // Each request gets an ID. Only the newest request
        // is allowed to update the store.
        const requestId = get()._fetchRequestId + 1;
        set({ _fetchRequestId: requestId });
        try {
          const { data, error } = await supabase
            .from('teams')
            .select('*')
            .order('current_sector', { ascending: false })
            .order('total_time_bank', { ascending: true });
          if (error) throw error;
          // Ignore stale responses from earlier requests.
          if (get()._fetchRequestId !== requestId) return;
          const teams = data || [];
          set({
            teams,
            stats: getStats(teams),
            lastSync: new Date().toLocaleTimeString(),
          });
        } catch (error) {
          if (get()._fetchRequestId === requestId) {
            console.error('Failed to fetch teams:', error);
          }
        }
      },
      subscribeRealtime: () => {
        const existingCleanup = get()._realtimeCleanup;
        if (typeof existingCleanup === 'function') {
          existingCleanup();
        }
        let active = true;
        const fetchTeams = () => {
          if (active) {
            get().fetchTeams();
          }
        };
        const pgChannel = supabase
          .channel('admin-pg-changes')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'teams',
            },
            fetchTeams
          )
          .subscribe();
        const broadcastChannel = supabase
          .channel('live_monitoring')
          .on(
            'broadcast',
            { event: 'scan_event' },
            fetchTeams
          )
          .subscribe();
        const cleanup = () => {
          active = false;
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