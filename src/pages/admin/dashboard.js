import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useAdminStore } from '../../lib/store';
import { supabase } from '../../lib/supabase';
import { playSound } from '../../lib/sound';
const AMBIENCE_AUDIO = '/audio/ambience.mp3';
const ROUND_SECONDS = 40 * 60;
const FINAL_SECTOR = 6;
function SoundToggle({ enabled, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="admin-btn inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[9px] font-bold tracking-[.16em]"
      aria-pressed={enabled}
      aria-label={enabled ? 'Turn sound off' : 'Turn sound on'}
    >
      <span aria-hidden="true" className="text-base">
        {enabled ? '♫' : '♪'}
      </span>
      {enabled ? 'SOUND ON' : 'SOUND OFF'}
    </button>
  );
}
const GLOBAL_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800;900&family=DM+Sans:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap');
  :root { color-scheme: dark; }
  .admin-page {
    min-height:100vh;
    color:#f4e8cf;
    background:#080b0c;
    font-family:'DM Sans',sans-serif;
    isolation:isolate;
  }
  .admin-page:before {
    content:"";
    position:fixed;
    inset:0;
    z-index:-2;
    background:
      linear-gradient(180deg,rgba(3,7,8,.70),rgba(3,7,8,.88)),
      url('/login-bg.png') center/cover no-repeat;
  }
  .admin-page:after {
    content:"";
    position:fixed;
    inset:0;
    z-index:-1;
    pointer-events:none;
    background:
      radial-gradient(ellipse at 50% 10%,rgba(23,65,66,.20),transparent 55%),
      radial-gradient(ellipse at 10% 90%,rgba(145,91,35,.10),transparent 45%);
  }
  .admin-heading {
    font-family:'Cinzel',Georgia,serif;
  }
  .admin-mono {
    font-family:'Space Mono',monospace;
  }
  .admin-glass {
    background:linear-gradient(
      145deg,
      rgba(31,29,22,.88),
      rgba(6,14,14,.92)
    );
    border:1px solid rgba(224,187,118,.24);
    box-shadow:
      0 20px 60px rgba(0,0,0,.30),
      inset 0 1px 0 rgba(255,238,194,.045);
    backdrop-filter:blur(16px);
  }
  .admin-glass-teal {
    background:linear-gradient(
      145deg,
      rgba(18,39,40,.91),
      rgba(5,14,15,.94)
    );
    border:1px solid rgba(126,180,181,.30);
    box-shadow:
      0 20px 60px rgba(0,0,0,.30),
      inset 0 1px 0 rgba(210,245,245,.04);
    backdrop-filter:blur(16px);
  }
  .admin-btn {
    border:1px solid rgba(224,187,118,.36);
    background:rgba(8,12,12,.72);
    color:#f0d39a;
    transition:.2s ease;
  }
  .admin-btn:hover {
    border-color:rgba(245,219,165,.85);
    background:rgba(112,81,39,.22);
    transform:translateY(-1px);
  }
  .admin-btn:disabled {
    opacity:.45;
    cursor:not-allowed;
    transform:none;
  }
  .admin-input {
    width:100%;
    background:rgba(0,0,0,.38);
    border:1px solid rgba(224,187,118,.25);
    color:#f4e8cf;
    border-radius:8px;
    padding:12px 14px;
    outline:none;
  }
  .admin-input:focus {
    border-color:#e0bb76;
    box-shadow:0 0 0 3px rgba(224,187,118,.10);
  }
  .admin-input option {
    background:#101716;
  }
  .admin-kicker {
    color:#d8b777;
    font:700 10px 'Space Mono',monospace;
    letter-spacing:.20em;
    text-transform:uppercase;
  }
  .admin-scroll::-webkit-scrollbar {
    width:7px;
    height:7px;
  }
  .admin-scroll::-webkit-scrollbar-thumb {
    background:rgba(224,187,118,.35);
    border-radius:20px;
  }
  @keyframes livePulse {
    50% { opacity:.45; }
  }
  .live-dot {
    animation:livePulse 1.6s infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration:.01ms!important;
      transition-duration:.01ms!important;
    }
  }
`;
function getPhase(team) {
  return team.current_phase ||
    (team.current_sector > 0 ? 'SAILING' : 'WAITING');
}
function getStatus(team) {
  if (
    team.status === 'ELIMINATED' ||
    getPhase(team) === 'PLANKED'
  ) return 'ELIMINATED';
  if (
    team.status === 'FINISHED' ||
    getPhase(team) === 'FINISHED'
  ) return 'FINISHED';
  if (getPhase(team) === 'COVE') return 'COVE';
  if (getPhase(team) === 'RELEASED') return 'RELEASED';
  if (!Number(team.current_sector)) return 'WAITING';
  return 'ACTIVE';
}
function getRemainingSeconds(team, now) {
  const phase = getPhase(team);
  if (
    !team.last_clue_start ||
    !Number(team.current_sector) ||
    ['WAITING', 'COVE', 'RELEASED', 'FINISHED', 'PLANKED'].includes(phase) ||
    team.status === 'ELIMINATED' ||
    team.status === 'FINISHED'
  ) {
    return null;
  }
  const started = new Date(team.last_clue_start).getTime();
  if (!Number.isFinite(started)) return ROUND_SECONDS;
  return Math.max(
    0,
    ROUND_SECONDS - Math.floor((now - started) / 1000)
  );
}
function formatClock(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(
    safe % 60
  ).padStart(2, '0')}`;
}
function formatHuntTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}m ${String(
    value % 60
  ).padStart(2, '0')}s`;
}
function StatusPill({ status }) {
  const styles = {
    ACTIVE: 'border-emerald-400/35 bg-emerald-950/45 text-emerald-300',
    WAITING: 'border-sky-400/30 bg-sky-950/40 text-sky-300',
    COVE: 'border-cyan-300/35 bg-cyan-950/45 text-cyan-200',
    RELEASED: 'border-amber-300/35 bg-amber-950/40 text-amber-200',
    ELIMINATED: 'border-red-400/35 bg-red-950/45 text-red-300',
    FINISHED: 'border-yellow-300/35 bg-yellow-950/40 text-yellow-200',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1.5 text-[9px] font-bold tracking-[.12em] ${styles[status] || styles.WAITING
        }`}
    >
      {status}
    </span>
  );
}
function CompassMark() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d9b46e]/45 bg-black/30 text-[#e5c27f]">
      <svg
        viewBox="0 0 40 40"
        className="h-7 w-7"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="20"
          cy="20"
          r="17"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path
          d="M20 4 24 17 36 20 24 23 20 36 16 23 4 20 16 17 20 4Z"
          fill="#d9b46e"
        />
        <circle
          cx="20"
          cy="20"
          r="3"
          fill="#172d2d"
          stroke="#f5dba5"
        />
      </svg>
    </div>
  );
}
export default function AdminDashboard() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const teams = useAdminStore((s) => s.teams);
  const stats = useAdminStore((s) => s.stats);
  const lastSync = useAdminStore((s) => s.lastSync);
  const fetchTeams = useAdminStore((s) => s.fetchTeams);
  const subscribeRealtime = useAdminStore((s) => s.subscribeRealtime);
  const logoutAdmin = useAdminStore((s) => s.logoutAdmin);
  const ambienceRef = useRef(null);
  const [hydrated, setHydrated] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [installCount, setInstallCount] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortMode, setSortMode] = useState('RANK');
  const [busyTeam, setBusyTeam] = useState('');
  const [notice, setNotice] = useState({ type: '', text: '' });
  const [timeModal, setTimeModal] = useState(null);
  const [minutes, setMinutes] = useState('5');
  // Zustand hydration
  useEffect(() => {
    const unsub = useAdminStore.persist?.onFinishHydration?.(
      () => setHydrated(true)
    );
    if (useAdminStore.persist?.hasHydrated?.()) {
      setHydrated(true);
    }
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);
  // Only ambience.mp3 is used. No click, success or error sound effects.
  useEffect(() => {
    const audio = new Audio(AMBIENCE_AUDIO);
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
  // Background music control
  const toggleSound = () => {
    playSound('click', true);
    const audio = ambienceRef.current;
    if (!audio) return;
    if (soundEnabled) {
      audio.pause();
      audio.currentTime = 0;
      setSoundEnabled(false);
      return;
    }
    audio.currentTime = 0;
    audio.play()
      .then(() => setSoundEnabled(true))
      .catch((error) => {
        console.warn('Background ambience could not be started:', error);
        setSoundEnabled(false);
      });
  };
  const fetchAnalytics = useCallback(async () => {
    const { data, error } = await supabase
      .from('app_metrics')
      .select('install_count')
      .single();
    if (!error && data) {
      setInstallCount(Number(data.install_count) || 0);
    }
  }, []);
  // Realtime + polling
  useEffect(() => {
    if (!hydrated) return;
    if (!isAdmin) {
      router.replace('/');
      return;
    }
    fetchTeams();
    fetchAnalytics();
    const unsubscribe = subscribeRealtime();
    const poll = setInterval(() => {
      fetchTeams();
      fetchAnalytics();
    }, 5000);
    const clock = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [
    hydrated,
    isAdmin,
    router,
    fetchTeams,
    fetchAnalytics,
    subscribeRealtime,
  ]);
  const showNotice = (type, text) => {
    setNotice({ type, text });
    window.setTimeout(() => {
      setNotice({ type: '', text: '' });
    }, 4200);
  };
  // Common Supabase update handler
  const updateTeam = async (teamId, updates, successMessage) => {
    setBusyTeam(teamId);
    setNotice({ type: '', text: '' });
    try {
      const { data, error } = await supabase
        .from('teams')
        .update(updates)
        .eq('id', teamId)
        .select('id');
      if (error) throw error;
      if (!data?.length) {
        throw new Error(
          'No team row was updated. Check the Supabase RLS UPDATE policy.'
        );
      }
      await fetchTeams();
      showNotice('success', successMessage);
      return true;
    } catch (error) {
      console.error('Admin team action failed:', error);
      showNotice(
        'error',
        error.message || 'Action failed. Please try again.'
      );
      return false;
    } finally {
      setBusyTeam('');
    }
  };
  // Extra time
  // Always read the latest database row before changing the timer.
  // The conditional update prevents a stale admin screen from
  // overwriting a concurrent timer change, pause, revive, or expiry.
  const handleExtraTime = async () => {
    if (!timeModal) return;
    const amount = Number(minutes);
    if (!Number.isInteger(amount) || amount < 1 || amount > 120) {
      showNotice(
        'error',
        'Enter a whole number between 1 and 120 minutes.'
      );
      return;
    }
    const teamId = timeModal.id;
    setBusyTeam(teamId);
    setNotice({ type: '', text: '' });
    try {
      const { data: latestTeam, error: fetchError } = await supabase
        .from('teams')
        .select('id,team_name,status,current_phase,current_sector,last_clue_start')
        .eq('id', teamId)
        .single();
      if (fetchError) throw fetchError;
      if (!latestTeam) throw new Error('Team record could not be found.');
      const latestPhase = latestTeam.current_phase ||
        (Number(latestTeam.current_sector) > 0 ? 'SAILING' : 'WAITING');
      if (latestTeam.status !== 'ACTIVE' || latestPhase !== 'SAILING') {
        await fetchTeams();
        throw new Error(
          'Extra time can only be granted to a team currently sailing. The team status has changed.'
        );
      }
      const oldStart = latestTeam.last_clue_start
        ? new Date(latestTeam.last_clue_start).getTime()
        : NaN;
      if (!Number.isFinite(oldStart)) {
        throw new Error('This team has no running timer to extend.');
      }
      // Countdown = 40 minutes - elapsed time. Moving the start
      // timestamp backward adds time without changing hunt statistics.
      const newStart = new Date(
        oldStart + amount * 60 * 1000
      ).toISOString();
      const { data: updatedRows, error: updateError } = await supabase
        .from('teams')
        .update({ last_clue_start: newStart })
        .eq('id', teamId)
        .eq('status', latestTeam.status)
        .eq('current_phase', latestTeam.current_phase)
        .eq('current_sector', latestTeam.current_sector)
        .eq('last_clue_start', latestTeam.last_clue_start)
        .select('id');
      if (updateError) throw updateError;
      if (!updatedRows?.length) {
        await fetchTeams();
        throw new Error(
          'The team timer changed while you were granting extra time. Refresh and try again.'
        );
      }
      await fetchTeams();
      showNotice(
        'success',
        `${latestTeam.team_name} received ${amount} extra minute${amount === 1 ? '' : 's'}.`
      );
      setTimeModal(null);
    } catch (error) {
      console.error('Extra-time update failed:', error);
      showNotice(
        'error',
        error.message || 'Could not grant extra time. Please try again.'
      );
    } finally {
      setBusyTeam('');
    }
  };
  // Eliminate team
  const handleEliminate = async (team) => {
    if (
      !window.confirm(
        `Eliminate ${team.team_name}? Their hunt timer will stop.`
      )
    ) return;
    await updateTeam(
      team.id,
      {
        status: 'ELIMINATED',
        current_phase: 'PLANKED',
      },
      `${team.team_name} has been eliminated.`
    );
  };
  // Revive team
  const handleRevive = async (team) => {
    if (
      !window.confirm(
        `Revive ${team.team_name}? A fresh 40-minute timer will start.`
      )
    ) return;
    const updates = {
      status: 'ACTIVE',
      current_phase:
        Number(team.current_sector) > 0
          ? 'SAILING'
          : 'WAITING',
      last_clue_start:
        Number(team.current_sector) > 0
          ? new Date().toISOString()
          : null,
    };
    await updateTeam(
      team.id,
      updates,
      `${team.team_name} is back in the hunt.`
    );
  };
  // Release team from Cove
  const handleCoveRelease = async (team) => {
    if (
      !window.confirm(
        `Release ${team.team_name} from the Cove? Their next valid scan will begin the next round.`
      )
    ) return;
    await updateTeam(
      team.id,
      { current_phase: 'RELEASED' },
      `${team.team_name} has been released from the Cove.`
    );
  };
  // Move active team to Cove
  const handlePauseTeam = async (team) => {
    if (
      !window.confirm(
        `Move ${team.team_name} to the Safe Cove?`
      )
    ) return;
    await updateTeam(
      team.id,
      {
        current_phase: 'COVE',
        last_clue_start: null,
      },
      `${team.team_name} is now in the Safe Cove.`
    );
  };
  const handleLogout = () => {
    logoutAdmin();
    router.push('/');
  };
  // Leaderboard ranking
  const rankedTeams = useMemo(() => {
    const list = [...teams].sort((a, b) => {
      const sectorDiff =
        (Number(b.current_sector) || 0) -
        (Number(a.current_sector) || 0);
      if (sectorDiff) return sectorDiff;
      const timeDiff =
        (Number(a.total_time_taken) || 0) -
        (Number(b.total_time_taken) || 0);
      return (
        timeDiff ||
        String(a.team_name || '').localeCompare(
          String(b.team_name || '')
        )
      );
    });
    return list;
  }, [teams]);
  // Search and filters
  const filteredTeams = useMemo(() => {
    let list = [...rankedTeams];
    if (statusFilter !== 'ALL') {
      list = list.filter(
        (team) => getStatus(team) === statusFilter
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (team) =>
          String(team.team_name || '')
            .toLowerCase()
            .includes(q) ||
          String(team.leader_name || '')
            .toLowerCase()
            .includes(q)
      );
    }
    if (sortMode === 'TIME') {
      list.sort(
        (a, b) =>
          (getRemainingSeconds(a, now) ?? 99999) -
          (getRemainingSeconds(b, now) ?? 99999)
      );
    }
    if (sortMode === 'SECTOR') {
      list.sort(
        (a, b) =>
          (Number(b.current_sector) || 0) -
          (Number(a.current_sector) || 0)
      );
    }
    return list;
  }, [
    rankedTeams,
    statusFilter,
    search,
    sortMode,
    now,
  ]);
  const activeCount = teams.filter(
    (t) => getStatus(t) === 'ACTIVE'
  ).length;
  const coveCount = teams.filter(
    (t) =>
      getStatus(t) === 'COVE' ||
      getStatus(t) === 'RELEASED'
  ).length;
  const eliminatedCount = teams.filter(
    (t) => getStatus(t) === 'ELIMINATED'
  ).length;
  const finishedCount = teams.filter(
    (t) => getStatus(t) === 'FINISHED'
  ).length;
  if (!hydrated) {
    return (
      <div className="min-h-screen bg-[#080b0c] flex items-center justify-center text-[#e0bb76] admin-mono text-xs tracking-[.2em]">
        PREPARING THE COMMAND DECK…
      </div>
    );
  }
  return (
    <div className="admin-page relative min-h-screen overflow-x-hidden">
      <style jsx global>{GLOBAL_STYLES}</style>
      <div className="pointer-events-none fixed inset-0 z-0 opacity-[.10]">
        <div className="absolute -left-24 top-1/4 h-80 w-80 rounded-full bg-amber-500 blur-[120px]" />
        <div className="absolute -right-20 bottom-0 h-96 w-96 rounded-full bg-teal-400 blur-[140px]" />
      </div>
      <div className="relative z-10 mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-7 lg:px-10">
        {/* HEADER */}
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4 border-b border-[#d9b46e]/20 pb-5">
          <div className="flex min-w-0 items-center gap-3">
            <CompassMark />
            <div>
              <p className="admin-kicker text-[8px] sm:text-[9px]">
                Expedition authority · 2K26
              </p>
              <h1 className="admin-heading text-xl font-black tracking-wide text-[#f4e8cf] sm:text-2xl">
                TREASURE HUNT{' '}
                <span className="text-[#e0bb76]">
                  COMMAND
                </span>
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="admin-mono flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-950/30 px-3 py-2 text-[9px] text-emerald-300">
              <span className="live-dot h-2 w-2 rounded-full bg-emerald-400" />
              LIVE
            </span>
            <SoundToggle
              enabled={soundEnabled}
              onToggle={toggleSound}
            />
            <Link
              href="/admin/clues"
              className="admin-btn rounded-lg px-3 py-2.5 text-[9px] font-bold tracking-wider sm:px-4"
            >
              ✦ CLUE FORGE
            </Link>
            <button
              onClick={handleLogout}
              className="admin-btn rounded-lg border-red-400/25 px-3 py-2.5 text-[9px] font-bold tracking-wider text-red-300"
            >
              LOG OUT
            </button>
          </div>
        </header>
        {/* STATISTICS */}
        <section className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            {
              label: 'Registered crews',
              value: teams.length,
              icon: '⚓',
              tone: 'text-[#f4e8cf]',
            },
            {
              label: 'Out on the hunt',
              value: activeCount,
              icon: '✦',
              tone: 'text-emerald-300',
            },
            {
              label: 'Safe Cove',
              value: coveCount,
              icon: '◈',
              tone: 'text-cyan-200',
            },
            {
              label: 'Eliminated',
              value: eliminatedCount,
              icon: '☠',
              tone: 'text-red-300',
            },
            {
              label: 'Treasure claimed',
              value: finishedCount,
              icon: '♛',
              tone: 'text-amber-200',
            },
          ].map((item) => (
            <div
              key={item.label}
              className="admin-glass rounded-xl p-4 sm:p-5"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="admin-kicker text-[8px]">
                  {item.label}
                </span>
                <span className="text-lg text-[#d9b46e]">
                  {item.icon}
                </span>
              </div>
              <p className={`admin-heading text-3xl font-bold ${item.tone}`}>
                {item.value}
              </p>
            </div>
          ))}
        </section>
        {/* HERO */}
        <section className="admin-glass mb-7 overflow-hidden rounded-2xl">
          <div className="grid gap-5 p-5 md:grid-cols-[1.3fr_.7fr] md:items-center md:p-7">
            <div>
              <p className="admin-kicker mb-3">
                The expedition at a glance
              </p>
              <h2 className="admin-heading text-3xl font-black leading-tight text-[#f4e8cf] sm:text-4xl">
                LIVE FLEET{' '}
                <span className="text-[#e0bb76]">
                  STATUS
                </span>
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#d9d0bd]/70">
                Track every crew, watch their progress across six seals,
                and manage the hunt without leaving the command deck.
              </p>
              <div className="mt-4 flex flex-wrap gap-4 admin-mono text-[9px] text-[#d9b46e]/75">
                <span>
                  LAST SYNC: {lastSync || 'CONNECTING…'}
                </span>
                <span>
                  APP INSTALLS: {installCount}
                </span>
              </div>
            </div>
            <div className="admin-glass-teal rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="admin-kicker">
                    Leaderboard logic
                  </p>
                  <p className="admin-heading mt-2 text-xl text-[#d8eeee]">
                    Highest seal first
                  </p>
                </div>
                <span className="text-3xl">🧭</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#c1d3d1]/65">
                Teams are ranked by seals cleared, then by lower
                recorded hunting time.
              </p>
            </div>
          </div>
        </section>
        {/* LEADERBOARD CONTROLS */}
        <section className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="admin-kicker mb-2">
              Crew manifest · real-time monitoring
            </p>
            <h2 className="admin-heading text-2xl font-bold text-[#f4e8cf] sm:text-3xl">
              LIVE{' '}
              <span className="text-[#e0bb76]">
                LEADERBOARD
              </span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:min-w-[620px]">
            <input
              className="admin-input text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search team or captain…"
              aria-label="Search teams"
            />
            <select
              className="admin-input text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active / Sailing</option>
              <option value="WAITING">Waiting</option>
              <option value="COVE">In Safe Cove</option>
              <option value="RELEASED">Released</option>
              <option value="ELIMINATED">Eliminated</option>
              <option value="FINISHED">Finished</option>
            </select>
            <select
              className="admin-input text-xs"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
              aria-label="Sort teams"
            >
              <option value="RANK">Sort: leaderboard</option>
              <option value="SECTOR">Sort: seals cleared</option>
              <option value="TIME">Sort: time remaining</option>
            </select>
          </div>
        </section>
        <div className="mb-3 flex items-center justify-between admin-mono text-[9px] text-[#d9b46e]/60">
          <span>
            SHOWING {filteredTeams.length} OF {teams.length} CREWS
          </span>
          <span>6 SEALS IN THE EXPEDITION</span>
        </div>
        {/* TEAM CARDS */}
        <section className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filteredTeams.map((team) => {
              const rank =
                rankedTeams.findIndex((t) => t.id === team.id) + 1;
              const status = getStatus(team);
              const remaining = getRemainingSeconds(team, now);
              const sector = Math.min(
                FINAL_SECTOR,
                Math.max(0, Number(team.current_sector) || 0)
              );
              const isBusy = busyTeam === team.id;
              const progress = (sector / FINAL_SECTOR) * 100;
              return (
                <motion.article
                  key={team.id}
                  layout
                  initial={
                    reducedMotion
                      ? false
                      : { opacity: 0, y: 12 }
                  }
                  animate={{
                    opacity: status === 'ELIMINATED' ? .72 : 1,
                    y: 0,
                  }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: .22 }}
                  className={`admin-glass relative overflow-hidden rounded-xl p-4 sm:p-5 ${status === 'ELIMINATED'
                    ? 'grayscale-[.45]'
                    : ''
                    }`}
                >
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-white/5">
                    <div
                      className="h-full bg-gradient-to-r from-[#8e642e] via-[#e0bb76] to-[#f4d99c] transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                    <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
                      <div className="flex shrink-0 items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#d9b46e]/30 bg-black/30">
                          <span className="admin-heading text-xl font-bold text-[#e0bb76]">
                            #{rank}
                          </span>
                        </div>
                        <div className="flex h-14 w-14 flex-col items-center justify-center rounded-full border border-[#d9b46e]/35 bg-black/35">
                          <span className="admin-heading text-xl font-bold text-[#f4e8cf]">
                            {sector}/6
                          </span>
                          <span className="admin-mono text-[7px] text-[#d9b46e]/70">
                            SEALS
                          </span>
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="admin-heading max-w-full break-words text-xl font-bold text-[#f4e8cf] sm:text-2xl">
                            {team.team_name || 'Unnamed crew'}
                          </h3>
                          <StatusPill status={status} />
                        </div>
                        <p className="mt-1 text-xs text-[#d9d0bd]/55">
                          Captain: {team.leader_name || '—'}
                          <span className="mx-2 text-[#d9b46e]/35">✦</span>
                          Beacon {String(sector).padStart(2, '0')} / 06
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 admin-mono text-[9px] text-[#d9b46e]/75">
                          <span>
                            HUNT TIME:{' '}
                            <b className="text-[#f4e8cf]">
                              {formatHuntTime(team.total_time_taken)}
                            </b>
                          </span>
                          <span>
                            FAILED SCANS:{' '}
                            <b className="text-[#f4e8cf]">
                              {Number(team.failed_scans) || 0}
                            </b>
                          </span>
                          <span>
                            PROGRESS:{' '}
                            <b className="text-[#f4e8cf]">
                              {Math.round(progress)}%
                            </b>
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* TIMER AND ACTIONS */}
                    <div className="flex flex-col gap-3 xl:min-w-[370px]">
                      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-4 py-3">
                        <div>
                          <p className="admin-kicker text-[8px]">
                            Time remaining
                          </p>
                          <p
                            className={`admin-mono mt-1 text-2xl font-bold tabular-nums ${remaining !== null && remaining <= 300
                              ? 'text-red-300'
                              : 'text-[#f4e8cf]'
                              }`}
                          >
                            {formatClock(remaining)}
                          </p>
                        </div>
                        <span className="text-2xl text-[#d9b46e]">
                          ⌛
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {status === 'ACTIVE' && (
                          <>
                            <button
                              disabled={isBusy}
                              onClick={() => {
                                setTimeModal(team);
                                setMinutes('5');
                              }}
                              className="admin-btn rounded-lg px-2 py-2.5 text-[8px] font-bold tracking-wide"
                            >
                              ＋ TIME
                            </button>
                            <button
                              disabled={isBusy}
                              onClick={() => handlePauseTeam(team)}
                              className="admin-btn rounded-lg border-cyan-300/30 px-2 py-2.5 text-[8px] font-bold tracking-wide text-cyan-200"
                            >
                              ⚓ PAUSE
                            </button>
                            <button
                              disabled={isBusy}
                              onClick={() => handleEliminate(team)}
                              className="admin-btn rounded-lg border-red-400/30 px-2 py-2.5 text-[8px] font-bold tracking-wide text-red-300"
                            >
                              ☠ ELIMINATE
                            </button>
                          </>
                        )}
                        {status === 'COVE' && (
                          <button
                            disabled={isBusy}
                            onClick={() => handleCoveRelease(team)}
                            className="admin-btn col-span-2 rounded-lg border-cyan-300/30 px-2 py-2.5 text-[8px] font-bold tracking-wide text-cyan-200 sm:col-span-2"
                          >
                            ⚓ RELEASE FROM COVE
                          </button>
                        )}
                        {status === 'ELIMINATED' && (
                          <button
                            disabled={isBusy}
                            onClick={() => handleRevive(team)}
                            className="admin-btn col-span-2 rounded-lg border-emerald-300/30 px-2 py-2.5 text-[8px] font-bold tracking-wide text-emerald-200 sm:col-span-2"
                          >
                            ↻ REVIVE TEAM
                          </button>
                        )}
                        {status === 'RELEASED' && (
                          <span className="col-span-2 flex items-center justify-center rounded-lg border border-amber-300/20 bg-amber-950/20 px-2 py-2 text-center admin-mono text-[8px] text-amber-200 sm:col-span-2">
                            RELEASED · WAITING FOR NEXT SEAL
                          </span>
                        )}
                        {status === 'WAITING' && (
                          <span className="col-span-2 flex items-center justify-center rounded-lg border border-sky-300/20 bg-sky-950/20 px-2 py-2 text-center admin-mono text-[8px] text-sky-200 sm:col-span-2">
                            AWAITING FIRST SEAL
                          </span>
                        )}
                        {status === 'FINISHED' && (
                          <span className="col-span-2 flex items-center justify-center rounded-lg border border-yellow-300/20 bg-yellow-950/20 px-2 py-2 text-center admin-mono text-[8px] text-yellow-200 sm:col-span-2">
                            TREASURE CLAIMED
                          </span>
                        )}
                        {isBusy && (
                          <span className="col-span-2 text-center admin-mono text-[8px] text-[#e0bb76]">
                            UPDATING CREW…
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
          {filteredTeams.length === 0 && (
            <div className="admin-glass rounded-2xl border-dashed p-12 text-center">
              <div className="mb-3 text-4xl">🧭</div>
              <h3 className="admin-heading text-xl text-[#e0bb76]">
                No crews found
              </h3>
              <p className="mt-2 text-xs text-[#d9d0bd]/55">
                Try changing the search term or status filter.
              </p>
            </div>
          )}
        </section>
        {/* FOOTER */}
        <footer className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-[#d9b46e]/15 py-6 text-center sm:flex-row sm:text-left">
          <div className="flex items-center gap-3">
            <CompassMark />
            <span className="admin-mono text-[9px] font-bold tracking-[.16em] text-[#e0bb76]/75">
              TREASURE HUNT 2K26 · COMMAND DECK
            </span>
          </div>
          <p className="text-[10px] text-[#e6dac0]/45">
            Every clue leads somewhere. Every choice matters.
          </p>
        </footer>
      </div>
      {/* NOTIFICATION */}
      <AnimatePresence>
        {notice.text && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className={`fixed bottom-5 left-1/2 z-[80] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-xl border px-4 py-3 text-xs shadow-2xl ${notice.type === 'error'
              ? 'border-red-400/35 bg-[#260e0e] text-red-200'
              : 'border-emerald-300/30 bg-[#0b211a] text-emerald-200'
              }`}
            role="status"
          >
            {notice.type === 'error' ? '⚠ ' : '✦ '}
            {notice.text}
          </motion.div>
        )}
      </AnimatePresence>
      {/* EXTRA TIME MODAL */}
      <AnimatePresence>
        {timeModal && (
          <motion.div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setTimeModal(null);
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: .97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: .98 }}
              className="admin-glass w-full max-w-md rounded-2xl p-6 sm:p-7"
            >
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <p className="admin-kicker">
                    Captain's privilege
                  </p>
                  <h3 className="admin-heading mt-2 text-2xl font-bold text-[#f4e8cf]">
                    Grant extra time
                  </h3>
                  <p className="mt-2 text-xs text-[#d9d0bd]/60">
                    Add minutes to{' '}
                    <b className="text-[#e0bb76]">
                      {timeModal.team_name}
                    </b>
                    's live countdown.
                  </p>
                </div>
                <button
                  onClick={() => setTimeModal(null)}
                  className="admin-btn rounded-lg px-3 py-2 text-sm"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <label className="admin-kicker mb-2 block">
                Extra minutes (1–120)
              </label>
              <input
                className="admin-input admin-mono text-lg"
                type="number"
                min="1"
                max="120"
                step="1"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {[5, 10, 15, 20, 30].map((value) => (
                  <button
                    key={value}
                    onClick={() => setMinutes(String(value))}
                    className={`admin-btn rounded-lg px-3 py-2 admin-mono text-[9px] ${Number(minutes) === value
                      ? 'border-[#f5dba5] bg-[#72532b]/30'
                      : ''
                      }`}
                  >
                    +{value} MIN
                  </button>
                ))}
              </div>
              <p className="mt-4 rounded-lg border border-[#d9b46e]/15 bg-black/25 p-3 text-[10px] leading-5 text-[#d9d0bd]/60">
                This updates the team's{' '}
                <code>last_clue_start</code> timestamp so the
                player dashboard receives the same extra time
                through Supabase Realtime. Hunting-time statistics
                remain unchanged.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setTimeModal(null)}
                  className="admin-btn rounded-lg px-4 py-3 text-[9px] font-bold tracking-wider"
                >
                  CANCEL
                </button>
                <button
                  disabled={!!busyTeam}
                  onClick={handleExtraTime}
                  className="rounded-lg border border-[#e0bb76]/60 bg-gradient-to-r from-[#8d642f] to-[#b58a4c] px-4 py-3 text-[9px] font-black tracking-wider text-[#100e09] disabled:opacity-50"
                >
                  {busyTeam ? 'UPDATING…' : 'CONFIRM TIME +'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}