import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { useRouter } from 'next/router';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { usePlayerStore } from '../lib/store';
import { QRScannerModal } from '../components/QRScannerModal';
import { playSound } from '../lib/sound';
const ROUND_SECONDS = 40 * 60;
const FINAL_SECTOR = 6;
// Cache signed URLs to prevent constant re-fetching and audio/image reloading
const signedUrlCache = new Map();
function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}
function resolvePhase(team) {
  if (!team) return 'WAITING';
  if (team.status === 'ELIMINATED' || team.current_phase === 'PLANKED') return 'PLANKED';
  if (team.status === 'FINISHED' || team.current_phase === 'FINISHED') return 'FINISHED';
  if (team.current_phase === 'COVE') return 'COVE';
  if (team.current_phase === 'RELEASED') return 'RELEASED';
  if (!Number(team.current_sector)) return 'WAITING';
  return team.current_phase || 'SAILING';
}
async function getMedia(clue) {
  if (!clue) return { image: '', audio: '' };
  const type = String(clue.clue_type || clue.media_type || '').toLowerCase();
  const storedPath = clue.media_path || '';
  let storedUrl = clue.media_url || '';
  if (storedPath) {
    if (/^https?:\/\//i.test(storedPath)) {
      storedUrl = storedPath;
    } else {
      // Check in-memory cache first (valid for 50 minutes)
      const cached = signedUrlCache.get(storedPath);
      const now = Date.now();
      if (cached && cached.expiresAt > now) {
        storedUrl = cached.url;
      } else {
        try {
          const { data, error } = await supabase.storage
            .from('clue-media')
            .createSignedUrl(storedPath, 60 * 60);
          if (!error && data?.signedUrl) {
            storedUrl = data.signedUrl;
            signedUrlCache.set(storedPath, {
              url: data.signedUrl,
              expiresAt: now + 50 * 60 * 1000,
            });
          }
        } catch (err) {
          console.warn('Media signed URL creation failed:', err);
        }
      }
    }
  }
  return {
    image: clue.image_url || clue.clue_image_url || (type === 'image' ? storedUrl : ''),
    audio: clue.audio_url || clue.clue_audio_url || (type === 'audio' ? storedUrl : ''),
  };
}
/**
 * Isolated Countdown Timer Component.
 * Runs its own 1-second interval so the parent Dashboard (clue card, audio player, image)
 * NEVER re-renders on timer ticks!
 */
const RoundTimer = memo(function RoundTimer({ lastClueStart, currentSector, currentPhase, timeOffset, onExpire }) {
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const onExpireRef = useRef(onExpire);
  const expiredTimerKeyRef = useRef(null);
  onExpireRef.current = onExpire;
  useEffect(() => {
    if (
      !lastClueStart ||
      !Number(currentSector) ||
      ['WAITING', 'COVE', 'RELEASED', 'FINISHED', 'PLANKED'].includes(currentPhase)
    ) {
      setTimeLeft(ROUND_SECONDS);
      return;
    }
    const calculateRemaining = () => {
      const startedAt = new Date(lastClueStart).getTime();
      if (!Number.isFinite(startedAt)) return ROUND_SECONDS;
      const elapsed = Math.floor((Date.now() + timeOffset - startedAt) / 1000);
      return Math.max(0, ROUND_SECONDS - elapsed);
    };
    const updateTimer = () => {
      const remaining = calculateRemaining();
      setTimeLeft(remaining);
      if (remaining <= 0 && currentPhase === 'SAILING' && Number(currentSector) > 0) {
        const timerKey = `${lastClueStart}:${currentSector}`;
        if (expiredTimerKeyRef.current !== timerKey) {
          expiredTimerKeyRef.current = timerKey;
          onExpireRef.current?.();
        }
      }
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [lastClueStart, currentSector, currentPhase, timeOffset]);
  const isLowTime = timeLeft <= 300 && currentPhase === 'SAILING';
  return (
    <p
      className={`hunt-timer mt-3 text-4xl font-black sm:text-5xl transition-colors ${
        isLowTime ? 'animate-pulse text-red-400' : 'text-[#f9e8c5]'
      }`}
    >
      {formatTime(timeLeft)}
    </p>
  );
});
export default function Dashboard() {
  const team = usePlayerStore((state) => state.team);
  const revealedClue = usePlayerStore((state) => state.revealedClue);
  const isEliminated = usePlayerStore((state) => state.isEliminated);
  const isFinished = usePlayerStore((state) => state.isFinished);
  const setRevealedClue = usePlayerStore((state) => state.setRevealedClue);
  const setEliminated = usePlayerStore((state) => state.setEliminated);
  const advanceRound = usePlayerStore((state) => state.advanceRound);
  const recordFailedScan = usePlayerStore((state) => state.recordFailedScan);
  const syncFromDB = usePlayerStore((state) => state.syncFromDB);
  const updateTeamFromRemote = usePlayerStore((state) => state.updateTeamFromRemote);
  const consumeHintLocally = usePlayerStore((state) => state.consumeHintLocally);
  const logout = usePlayerStore((state) => state.logout);
  const router = useRouter();
  const teamRef = useRef(team);
  teamRef.current = team;
  const [hydrated, setHydrated] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [timeOffset, setTimeOffset] = useState(0);
  // Sound preference
  const [soundEnabled, setSoundEnabled] = useState(false);
  const ambienceRef = useRef(null);
  // Leaderboard modal
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [leaderboardError, setLeaderboardError] = useState('');
  // Clue Media
  const [currentMedia, setCurrentMedia] = useState({ image: '', audio: '' });
  // Hint System States
  const [currentHint, setCurrentHint] = useState('');
  const [showHintConfirm, setShowHintConfirm] = useState(false);
  const [showHintModal, setShowHintModal] = useState(false);
  const [hintLoading, setHintLoading] = useState(false);
  const [hintError, setHintError] = useState('');
  // Hydration sync
  useEffect(() => {
    const unsub = usePlayerStore.persist?.onFinishHydration?.(() => setHydrated(true));
    if (usePlayerStore.persist?.hasHydrated?.()) setHydrated(true);
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);
  // Sound preference initialization
  useEffect(() => {
    try {
      const saved = localStorage.getItem('treasure-hunt-sound-enabled') === 'true';
      setSoundEnabled(saved);
    } catch {}
    const audio = new Audio('/audio/ambience.mp3');
    audio.loop = true;
    audio.volume = 0.18;
    audio.preload = 'none';
    ambienceRef.current = audio;
    return () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      ambienceRef.current = null;
    };
  }, []);
  // Ambience audio handling
  useEffect(() => {
    const audio = ambienceRef.current;
    if (!audio) return;
    if (soundEnabled) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [soundEnabled]);
  const toggleSound = useCallback(() => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    try {
      localStorage.setItem('treasure-hunt-sound-enabled', String(next));
    } catch {}
    if (next && ambienceRef.current) {
      ambienceRef.current.play().catch(() => {});
    } else if (ambienceRef.current) {
      ambienceRef.current.pause();
      ambienceRef.current.currentTime = 0;
    }
    playSound('click', next);
  }, [soundEnabled]);
  // Server time sync
  useEffect(() => {
    let active = true;
    fetch('/api/time')
      .then((res) => res.json())
      .then((data) => {
        if (active && Number.isFinite(data?.serverTime)) {
          setTimeOffset(data.serverTime - Date.now());
        }
      })
      .catch(() => setTimeOffset(0));
    return () => {
      active = false;
    };
  }, []);
  // Fetch Clue Content (memoized & guarded against redundant updates)
  const lastFetchedSectorRef = useRef(null);
  const fetchClueDirectly = useCallback(async (sector, teamId) => {
    if (!teamId || !Number(sector) || sector >= 6) {
      setCurrentMedia({ image: '', audio: '' });
      lastFetchedSectorRef.current = null;
      return;
    }
    try {
      // Team-specific clue first, then universal
      let { data: clue } = await supabase
        .from('clue_settings')
        .select('*')
        .eq('team_id', teamId)
        .eq('chamber_number', sector)
        .maybeSingle();
      if (!clue) {
        const { data: shared } = await supabase
          .from('clue_settings')
          .select('*')
          .or('team_id.is.null,team_id.eq.ALL')
          .eq('chamber_number', sector)
          .maybeSingle();
        clue = shared;
      }
      if (clue?.riddle_text) {
        setRevealedClue(clue.riddle_text);
      }
      const media = await getMedia(clue);
      setCurrentMedia((prev) => {
        if (prev.image === media.image && prev.audio === media.audio) return prev;
        return media;
      });
      // Hint text handling:
      const curTeam = teamRef.current;
      if (curTeam?.hint_used && curTeam?.hint_used_round === sector && sector < 5) {
        setCurrentHint(clue?.hint_text || '');
      } else {
        setCurrentHint('');
      }
      lastFetchedSectorRef.current = sector;
    } catch (err) {
      console.warn('Clue fetch error:', err);
    }
  }, [setRevealedClue]);
  // Realtime subscription & session guard
  useEffect(() => {
    if (!hydrated) return;
    const currentTeam = usePlayerStore.getState().team;
    if (!currentTeam?.id) {
      router.replace('/');
      return;
    }
    let active = true;
    void syncFromDB();
    void fetchClueDirectly(currentTeam.current_sector, currentTeam.id);
    // Subscribe to DB changes without wiping revealedClue on updates
    const channel = supabase
      .channel(`player-dashboard-${currentTeam.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'teams',
          filter: `id=eq.${currentTeam.id}`,
        },
        (payload) => {
          if (!active || !payload?.new) return;
          const prevSector = teamRef.current?.current_sector;
          updateTeamFromRemote(payload.new);
          if (payload.new.current_sector !== prevSector) {
            void fetchClueDirectly(payload.new.current_sector, currentTeam.id);
          }
        }
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [hydrated, router, syncFromDB, fetchClueDirectly, updateTeamFromRemote]);
  // STRICT HINT SYSTEM LOGIC
  const currentSector = Number(team?.current_sector) || 0;
  const isFinalClueStage = currentSector >= 5; // Clue 5 or Final QR
  const hintAlreadyUsedThisRound = Boolean(team?.hint_used && team?.hint_used_round === currentSector);
  const hintUsedOtherRound = Boolean(team?.hint_used && team?.hint_used_round !== currentSector);
  const isHintAvailableToConsume = !team?.hint_used && currentSector >= 1 && currentSector <= 4;
  const handleOpenHint = () => {
    playSound('click', soundEnabled);
    if (isFinalClueStage) return; // Final clue has no hint
    if (hintAlreadyUsedThisRound) {
      setShowHintModal(true);
    } else if (isHintAvailableToConsume) {
      setShowHintConfirm(true);
    }
  };
  const handleConfirmConsumeHint = async () => {
    if (!team?.id || isFinalClueStage || team?.hint_used) {
      setShowHintConfirm(false);
      return;
    }
    setHintLoading(true);
    setHintError('');
    // Immediately mark hint used locally in Zustand so the button flips to "VIEW UNLOCKED HINT" without delay
    consumeHintLocally(currentSector);
    try {
      // 1. Try atomic database RPC first
      const { data, error } = await supabase.rpc('consume_hint_token', {
        p_team_id: team.id,
        p_chamber_number: currentSector,
      });
      if (!error && data?.success) {
        setCurrentHint(data.hint_text);
        setShowHintConfirm(false);
        setShowHintModal(true);
        playSound('hint-reveal', soundEnabled);
        return;
      }
      // 2. Fallback query if RPC is not yet created in Supabase
      const { data: clueRow } = await supabase
        .from('clue_settings')
        .select('hint_text')
        .eq('chamber_number', currentSector)
        .or(`team_id.eq.${team.id},team_id.is.null,team_id.eq.ALL`)
        .order('team_id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (clueRow?.hint_text) {
        setCurrentHint(clueRow.hint_text);
        setShowHintConfirm(false);
        setShowHintModal(true);
        playSound('hint-reveal', soundEnabled);
        // Persistently record hint usage in database
        await supabase
          .from('teams')
          .update({
            hint_used: true,
            hint_used_round: currentSector,
            hint_used_at: new Date().toISOString(),
          })
          .eq('id', team.id);
      } else {
        setHintError('No hint text configured for this stage.');
      }
    } catch (err) {
      console.warn('Hint unlock notice:', err);
    } finally {
      setHintLoading(false);
    }
  };
  // QR Scan Handling (passed into isolated QRScannerModal)
  const handleQRScan = useCallback(
    async (decodedText) => {
      const curTeam = teamRef.current;
      if (!curTeam?.id) {
        return { success: false, message: 'SESSION EXPIRED — LOG IN AGAIN' };
      }
      const code = String(decodedText || '').trim().toUpperCase();
      // Check latest DB state to prevent stale scan advancement
      const { data: dbTeam, error: teamErr } = await supabase
        .from('teams')
        .select('current_sector,status,current_phase')
        .eq('id', curTeam.id)
        .single();
      if (teamErr) {
        return { success: false, message: 'NETWORK ERROR — TRY AGAIN' };
      }
      if (dbTeam.status === 'FINISHED' || dbTeam.current_phase === 'FINISHED') {
        return { success: false, message: 'HUNT ALREADY COMPLETED' };
      }
      if (dbTeam.status === 'ELIMINATED' || dbTeam.current_phase === 'PLANKED') {
        return { success: false, message: 'CREW ELIMINATED' };
      }
      const actualSector = Number(dbTeam.current_sector) || 0;
      const targetBeacon = actualSector + 1;
      // Try atomic database RPC
      const rpcRes = await supabase.rpc('validate_and_advance_scan', {
        p_team_id: curTeam.id,
        p_scanned_key: code,
      });
      if (!rpcRes.error && rpcRes.data?.success) {
        const nextClueData = {
          riddle_text: rpcRes.data.riddle_text,
          clue_type: rpcRes.data.clue_type,
          media_path: rpcRes.data.media_path,
        };
        await advanceRound(targetBeacon, nextClueData);
        void fetchClueDirectly(targetBeacon, curTeam.id);
        return { success: true, isFinal: targetBeacon >= FINAL_SECTOR };
      }
      // Fallback client-side matching if RPC is pending
      let clueData = null;
      const { data: teamClue } = await supabase
        .from('clue_settings')
        .select('*')
        .eq('team_id', curTeam.id)
        .eq('chamber_number', targetBeacon)
        .eq('qr_secret_key', code)
        .maybeSingle();
      clueData = teamClue;
      if (!clueData) {
        const { data: sharedClue } = await supabase
          .from('clue_settings')
          .select('*')
          .or('team_id.is.null,team_id.eq.ALL')
          .eq('chamber_number', targetBeacon)
          .eq('qr_secret_key', code)
          .maybeSingle();
        clueData = sharedClue;
      }
      if (!clueData) {
        void recordFailedScan();
        return { success: false, message: 'INVALID SEAL — TRY AGAIN' };
      }
      await advanceRound(targetBeacon, clueData);
      void fetchClueDirectly(targetBeacon, curTeam.id);
      return { success: true, isFinal: targetBeacon >= FINAL_SECTOR };
    },
    [advanceRound, fetchClueDirectly, recordFailedScan]
  );
  // Leaderboard fetch
  const fetchLeaderboard = useCallback(async () => {
    playSound('click', soundEnabled);
    setLeaderboardError('');
    const { data, error } = await supabase
      .from('teams')
      .select('team_name,total_time_taken,current_sector,status')
      .order('current_sector', { ascending: false })
      .order('total_time_taken', { ascending: true });
    if (error) {
      setLeaderboardError('Leaderboard is currently unavailable.');
      setLeaderboardData([]);
    } else {
      setLeaderboardData(data || []);
    }
    setShowLeaderboard(true);
  }, [soundEnabled]);
  const handleLogout = useCallback(() => {
    if (typeof window !== 'undefined' && window.confirm('Exit the expedition and log out?')) {
      playSound('click', soundEnabled);
      logout();
      router.push('/');
    }
  }, [logout, router, soundEnabled]);
  if (!hydrated || !team) {
    return (
      <div className="treasure-bg flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <img src="/treasure-hunt-logo.png" alt="Treasure Hunt 2K26" className="mx-auto mb-8 w-48" />
          <p className="f-b text-xs tracking-[.2em] text-[#d9b46e]">LOADING YOUR EXPEDITION…</p>
        </div>
      </div>
    );
  }
  const phase = resolvePhase(team);
  const progress = Math.min(Number(team.current_sector) || 0, FINAL_SECTOR);
  const media = currentMedia;
  return (
    <div className="treasure-bg flex min-h-screen flex-col p-4 sm:px-8 sm:py-5">
      {/* Top Bar Header */}
      <header className="hunt-topbar relative z-10 w-full">
        <img
          src="/treasure-hunt-horizontal.png"
          alt="Treasure Hunt 2K26"
          className="hunt-brand"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = '/treasure-hunt-logo.png';
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleSound}
            className="sound-toggle"
            aria-pressed={soundEnabled}
            aria-label={soundEnabled ? 'Turn sound off' : 'Turn sound on'}
          >
            <span aria-hidden="true">{soundEnabled ? '♫' : '♪'}</span>
            {soundEnabled ? 'SOUND ON' : 'SOUND OFF'}
          </button>
          <button
            onClick={handleLogout}
            className="glass-btn px-3 py-3 text-[9px] sm:px-4 sm:text-xs f-b"
          >
            Exit Hunt
          </button>
        </div>
      </header>
      {/* Main Content Area */}
      {phase === 'FINISHED' ? (
        <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-12 text-center">
          <div className="glass-panel w-full p-7 sm:p-12">
            <div className="mb-7 text-6xl">🏆</div>
            <p className="hunt-eyebrow mb-4">The legend is yours</p>
            <h1 className="f-h gold-glow text-4xl font-black text-[#f9e8c5] sm:text-6xl">
              EXPEDITION <span className="block text-[#d9b46e]">CONQUERED</span>
            </h1>
            <p className="f-h mt-7 text-sm tracking-[.15em] text-[#f9e8c5]/75">
              THE FINAL TREASURE IS CLAIMED
            </p>
            <p className="f-b mt-5 text-sm text-[#d9b46e]">{team.team_name}</p>
            <div className="mt-8">
              <button onClick={fetchLeaderboard} className="glass-btn px-6 py-4 text-xs f-b">
                View Official Standings ↗
              </button>
            </div>
          </div>
        </main>
      ) : phase === 'PLANKED' ? (
        <main className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center py-12 text-center">
          <div className="glass-panel w-full p-7 sm:p-12">
            <div className="mb-5 text-6xl">☠</div>
            <p className="hunt-eyebrow mb-4">Expedition terminated</p>
            <h1 className="f-h text-4xl font-black text-red-300 sm:text-6xl">GAME OVER</h1>
            <p className="f-h mt-6 text-sm tracking-[.12em] text-[#f9e8c5]/80">
              YOUR CREW WALKED THE PLANK
            </p>
            <p className="f-b mx-auto mt-5 max-w-sm text-xs leading-6 text-white/55">
              Your 40-minute round timer expired. Contact event command if you believe this is an error.
            </p>
          </div>
        </main>
      ) : phase === 'COVE' ? (
        <main className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center py-12 text-center">
          <div className="glass-panel w-full p-7 sm:p-12">
            <div className="mb-6 text-6xl animate-bounce">⚓</div>
            <p className="hunt-eyebrow mb-4">Safe harbour</p>
            <h1 className="f-h text-4xl font-black text-[#d9b46e] sm:text-5xl">SAFE COVE</h1>
            <div className="hunt-divider my-6" />
            <p className="f-b text-xs tracking-[.12em] text-[#f9e8c5]/80">
              PROGRESS PRESERVED · TIMER PAUSED
            </p>
            <p className="f-b mt-5 text-xs leading-6 text-white/55">
              Your crew is resting in safe waters. The event administrator will release your crew when the next leg begins.
            </p>
          </div>
        </main>
      ) : (
        <main className="dashboard-shell relative z-10 mx-auto w-full max-w-5xl flex-1 pb-8">
          {/* Top Header: Team Name & Live 40-Min Countdown (Isolated from clue re-renders) */}
          <section className="mb-7 grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_.7fr] lg:items-end">
            <div className="py-3">
              <p className="hunt-eyebrow mb-4">The legend unfolds</p>
              <h1 className="f-h hunt-title gold-glow break-words text-3xl font-black uppercase sm:text-5xl lg:text-6xl">
                {team.team_name}
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-7 text-[#f9e8c5]/65">
                Decipher the clues. Trust your crew. Each scanned seal brings you closer to the ancient treasure.
              </p>
            </div>
            <section className="glass-panel p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="hunt-section-label">Round Countdown</p>
                  <RoundTimer
                    lastClueStart={team?.last_clue_start}
                    currentSector={team?.current_sector}
                    currentPhase={phase}
                    timeOffset={timeOffset}
                    onExpire={setEliminated}
                  />
                </div>
                <div className="text-right">
                  <span className="text-3xl text-[#d9b46e]">⌛</span>
                  <p className="f-b mt-2 text-[9px] text-white/40">40 MIN LIMIT</p>
                </div>
              </div>
              <div className="hunt-divider mt-5" />
              <p className="f-b mt-4 text-[9px] text-white/40">
                Scanning a valid seal unlocks the next clue and resets the 40-minute timer.
              </p>
            </section>
          </section>
          {/* 6-Stage Progression Bar */}
          <section className="glass-panel mb-5 p-5 sm:p-7">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="hunt-eyebrow">Expedition Map</p>
                <h2 className="f-h mt-2 text-xl font-bold text-[#f9e8c5] sm:text-2xl">
                  Seals Conquered
                </h2>
              </div>
              <span className="f-b text-xs text-[#d9b46e]">
                {progress}/{FINAL_SECTOR} SEALS
              </span>
            </div>
            <div className="grid grid-cols-6 gap-2 sm:gap-3">
              {[1, 2, 3, 4, 5, 6].map((number) => (
                <div
                  key={number}
                  className={`hunt-progress-seal ${
                    progress >= number ? 'is-collected' : ''
                  } ${progress + 1 === number ? 'is-current' : ''}`}
                >
                  {progress >= number ? '✦' : number}
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="f-b text-[9px] text-white/40">
                {progress === FINAL_SECTOR
                  ? 'FINAL TREASURE SEAL CLEARED'
                  : progress === 5
                  ? 'OBJECTIVE: FINAL SEAL 6'
                  : `NEXT OBJECTIVE: SEAL ${progress + 1}`}
              </p>
              <p className="f-b text-[9px] text-[#d9b46e]/80">{phase}</p>
            </div>
          </section>
          {/* Released Notice */}
          {phase === 'RELEASED' && (
            <div className="mb-5 border border-emerald-700/50 bg-emerald-950/40 p-4 text-center rounded">
              <p className="f-h text-sm text-emerald-300">YOUR CREW HAS BEEN RELEASED</p>
              <p className="f-b mt-2 text-[10px] text-white/65">Scan the next seal to resume sailing.</p>
            </div>
          )}
          {/* Main Columns: Clue Card + Scanner Card */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_.7fr]">
            {/* Captain's Journal / Decoded Clue Card */}
            <section className="glass-panel p-5 sm:p-7">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="hunt-eyebrow">Captain's Journal</p>
                  <h2 className="f-h mt-2 text-xl font-bold text-[#f9e8c5] sm:text-2xl">
                    {revealedClue && phase === 'SAILING'
                      ? progress === 5
                        ? 'The Final Clue'
                        : `Decoded Clue ${progress}`
                      : 'Next Objective'}
                  </h2>
                </div>
                {/* Strict Hint Button:*
*&#xA0;                   - Stages 1-4 only.*
*&#xA0;                   - NEVER on Clue 5 (Final Clue) or Stage 6.*
*&#xA0;               */}
                {!isFinalClueStage && revealedClue && phase === 'SAILING' && (
                  <div>
                    {hintAlreadyUsedThisRound ? (
                      <button
                        type="button"
                        onClick={handleOpenHint}
                        className="glass-btn inline-flex items-center gap-2 px-3 py-2 text-[9px] font-bold f-b sm:px-4 sm:py-3 sm:text-[10px] border-emerald-400/50 text-emerald-300 shadow-[0_0_15px_rgba(52,211,153,0.15)]"
                      >
                        <span aria-hidden="true">💡</span>
                        <span>VIEW UNLOCKED HINT</span>
                      </button>
                    ) : isHintAvailableToConsume ? (
                      <button
                        type="button"
                        onClick={handleOpenHint}
                        className="glass-btn inline-flex items-center gap-2 px-3 py-2 text-[9px] font-bold f-b sm:px-4 sm:py-3 sm:text-[10px] border-[#d9b46e] text-[#f5dba5] hover:border-amber-300"
                      >
                        <span aria-hidden="true">💡</span>
                        <span>HINT TOKEN: AVAILABLE</span>
                      </button>
                    ) : hintUsedOtherRound ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-2 text-[9px] f-b text-white/40 border border-white/10 rounded">
                        <span>💡</span>
                        <span>HINT USED IN STAGE {team.hint_used_round}</span>
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="hunt-divider mb-5" />
              {/* Clue Content: Stable container that does not flash */}
              {revealedClue && phase === 'SAILING' ? (
                <div className="text-sm leading-7 text-[#f9e8c5] sm:text-base">
                  <div className="clue-text-pre font-serif text-base sm:text-lg leading-relaxed text-[#f4e8cf]">
                    {revealedClue}
                  </div>
                  {media.image && (
                    <img src={media.image} alt="Visual clue" className="clue-media" />
                  )}
                  {media.audio && (
                    <div className="mt-5 p-3 rounded border border-[#d9b46e]/30 bg-black/40">
                      <p className="f-b text-[10px] mb-2 text-[#d9b46e]">AUDIO RECORDING</p>
                      <audio controls preload="metadata" src={media.audio} className="w-full">
                        Your browser does not support audio playback.
                      </audio>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <div className="mb-4 text-4xl text-[#d9b46e]">
                    {phase === 'WAITING' ? '⚑' : '⌖'}
                  </div>
                  <p className="f-b text-xs leading-6 text-white/70">
                    {phase === 'WAITING'
                      ? 'Scan Ancient Seal 1 when the expedition begins.'
                      : `Search for Ancient Seal ${progress + 1} to unlock your next clue.`}
                  </p>
                </div>
              )}
            </section>
            {/* Scanner Activation Card */}
            <section className="glass-panel flex flex-col justify-between p-5 sm:p-7">
              <div>
                <p className="hunt-eyebrow">Vigilance Required</p>
                <h2 className="f-h mt-3 text-2xl font-bold text-[#f9e8c5]">Scan Ancient Seal</h2>
                <p className="mt-3 text-sm leading-6 text-white/55">
                  Align your smartphone camera with the physical QR seal placed at the location.
                </p>
              </div>
              <div className="my-6 flex items-center justify-center">
                <div className="flex h-28 w-28 items-center justify-center rounded-full border border-[#d9b46e]/40 bg-black/30 text-5xl text-[#d9b46e] shadow-[0_0_25px_rgba(217,180,110,0.15)]">
                  ⌖
                </div>
              </div>
              <button
                onClick={() => {
                  playSound('click', soundEnabled);
                  setIsScannerOpen(true);
                }}
                disabled={isEliminated || isFinished}
                className="hunt-scan-button f-h w-full rounded-sm px-4 py-4 text-sm font-black uppercase sm:py-5 sm:text-base cursor-pointer"
              >
                Open Expedition Lens
              </button>
              <p className="f-b mt-3 text-center text-[9px] leading-5 text-white/40">
                Camera access required · Safe & private
              </p>
            </section>
          </div>
          {/* Fleet Leaderboard Link */}
          <div className="mt-5 flex justify-end">
            <button onClick={fetchLeaderboard} className="glass-btn px-5 py-3 text-[10px] f-b sm:text-xs">
              View Fleet Leaderboard ↗
            </button>
          </div>
        </main>
      )}
      {/* Footer */}
      <footer className="mx-auto mt-auto flex w-full max-w-6xl items-center justify-between gap-3 border-t border-[#d9b46e]/20 py-5 text-[9px] text-[#d9b46e]/65">
        <span className="f-b tracking-[.15em]">TREASURE HUNT 2K26</span>
        <span className="text-right">Every clue leads somewhere.</span>
      </footer>
      {/* ISOLATED QR SCANNER MODAL */}
      <QRScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleQRScan}
        soundEnabled={soundEnabled}
      />
      {/* HINT CONFIRMATION MODAL */}
      <AnimatePresence>
        {showHintConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[180] flex items-center justify-center bg-black/90 p-5 backdrop-blur-sm"
          >
            <div className="glass-panel w-full max-w-sm p-6 text-center sm:p-8 border-[#d9b46e]/60">
              <div className="mb-4 text-4xl">💡</div>
              <h2 className="f-h text-xl font-black text-[#d9b46e] sm:text-2xl">
                CONSUME YOUR HINT TOKEN?
              </h2>
              <div className="hunt-divider my-4" />
              <p className="f-b text-xs leading-6 text-white/80">
                You have strictly <b className="text-[#f5dba5]">ONE hint token</b> for the entire game.
              </p>
              <p className="f-b mt-2 text-[10px] leading-5 text-amber-200/70">
                If consumed now on Stage {currentSector}, you will NOT have any hint available for remaining stages.
                Hints expire permanently upon reaching the Final Clue.
              </p>
              {hintError && (
                <p className="mt-3 text-xs text-red-300 f-b bg-red-950/40 p-2 rounded border border-red-500/30">
                  {hintError}
                </p>
              )}
              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    playSound('click', soundEnabled);
                    setShowHintConfirm(false);
                    setHintError('');
                  }}
                  className="glass-btn py-3 text-[10px] f-b"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmConsumeHint}
                  disabled={hintLoading}
                  className="rounded bg-[#d9b46e] text-black font-black py-3 text-[10px] f-b tracking-wider hover:bg-[#f9e8c5] disabled:opacity-50"
                >
                  {hintLoading ? 'Unlocking…' : 'Confirm & Unlock'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* UNLOCKED HINT DISPLAY MODAL */}
      <AnimatePresence>
        {showHintModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[185] flex items-center justify-center bg-black/90 p-5 backdrop-blur-sm"
          >
            <div className="glass-panel w-full max-w-md p-6 text-center sm:p-8 border-[#d9b46e]/60">
              <div className="mb-3 text-4xl">💡</div>
              <p className="hunt-eyebrow mb-2">Captain's Council</p>
              <h2 className="f-h mb-4 text-2xl font-black text-[#d9b46e]">
                STAGE {currentSector} HINT
              </h2>
              <div className="hunt-divider mb-5" />
              <p className="clue-text-pre text-sm leading-7 text-[#f4e8cf] sm:text-base bg-black/30 p-4 rounded border border-white/10">
                {currentHint || 'No hint text available for this stage.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  playSound('click', soundEnabled);
                  setShowHintModal(false);
                }}
                className="glass-btn mt-7 w-full py-3.5 text-xs f-b font-bold"
              >
                Return to Expedition
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* LEADERBOARD OVERLAY */}
      <AnimatePresence>
        {showLeaderboard && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] flex flex-col overflow-hidden bg-black/95 backdrop-blur-xl"
          >
            <div className="shrink-0 border-b border-[#d9b46e]/25 bg-[#080b0a]/95 px-4 py-5 sm:px-8">
              <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
                <div>
                  <p className="hunt-eyebrow mb-2">Fleet Manifest</p>
                  <h2 className="f-h text-2xl font-black uppercase text-[#d9b46e] sm:text-4xl">
                    Leaderboard
                  </h2>
                </div>
                <span className="f-b shrink-0 text-[10px] text-white/45 sm:text-xs">
                  {leaderboardData.length} CREWS REGISTERED
                </span>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-8">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 pb-4">
                {leaderboardError && (
                  <p className="f-b mb-2 text-center text-xs text-red-300">{leaderboardError}</p>
                )}
                {leaderboardData.map((entry, index) => {
                  const time = entry.current_sector === 0 ? '—' : formatTime(entry.total_time_taken || 0);
                  const ownTeam = entry.team_name === team.team_name;
                  return (
                    <div
                      key={`${entry.team_name}-${index}`}
                      className={`glass-panel flex w-full shrink-0 items-center justify-between gap-3 p-4 sm:p-5 ${
                        ownTeam ? 'border-[#d9b46e]/80 bg-[#d9b46e]/10' : 'border-white/10'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3 sm:gap-5">
                        <span className="f-h w-8 shrink-0 text-lg text-[#d9b46e] sm:text-xl">
                          #{index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="f-h truncate text-sm font-bold text-[#f9e8c5] sm:text-lg">
                            {entry.team_name} {ownTeam && '(Your Crew)'}
                          </p>
                          <p className="f-b mt-2 text-[9px] text-white/45 sm:text-[10px]">
                            {entry.status || 'ACTIVE'} · {entry.current_sector || 0}/{FINAL_SECTOR} SEALS
                          </p>
                        </div>
                      </div>
                      <span className="f-h shrink-0 text-base font-bold text-white sm:text-xl">{time}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div
              className="z-10 shrink-0 border-t border-[#d9b46e]/25 bg-[#080b0a]/95 px-4 pt-3 sm:px-8"
              style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
            >
              <div className="mx-auto w-full max-w-3xl">
                <button
                  type="button"
                  onClick={() => {
                    playSound('click', soundEnabled);
                    setShowLeaderboard(false);
                  }}
                  className="glass-btn w-full py-4 text-xs font-bold f-b sm:text-sm"
                >
                  ← Close Leaderboard
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
