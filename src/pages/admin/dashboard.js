import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useAdminStore } from '../../lib/store';
import { supabase } from '../../lib/supabase';

export default function AdminDashboard() {
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const teams = useAdminStore((s) => s.teams);
  const stats = useAdminStore((s) => s.stats);
  const lastSync = useAdminStore((s) => s.lastSync);
  const fetchTeams = useAdminStore((s) => s.fetchTeams);
  const subscribeRealtime = useAdminStore((s) => s.subscribeRealtime);
  const logoutAdmin = useAdminStore((s) => s.logoutAdmin);
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [installCount, setInstallCount] = useState(0);

  // Wait for Zustand hydration
  useEffect(() => {
    const unsub = useAdminStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAdminStore.persist.hasHydrated()) setHydrated(true);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!isAdmin) { router.push('/'); return; }

    // Initial fetch
    fetchTeams();

    // Subscribe to Supabase Realtime for instant updates
    const unsubscribe = subscribeRealtime();

    const fetchAnalytics = async () => {
      try {
        const { data } = await supabase.from('app_metrics').select('install_count').single();
        if (data) setInstallCount(data.install_count);
      } catch (_) { }
    };
    fetchAnalytics();

    // Fallback poll every 5s (guarantees updates even if Realtime hiccups)
    const fallbackInterval = setInterval(() => {
      fetchTeams();
      fetchAnalytics();
    }, 5000);

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      clearInterval(fallbackInterval);
    };
  }, [hydrated, isAdmin, router, fetchTeams, subscribeRealtime]);

  const handleLogout = () => {
    logoutAdmin();
    router.push('/');
  };

  const handlePlankTeam = async (teamId) => {
    if (!confirm('Make this team WALK THE PLANK? They will be permanently eliminated.')) return;
    try {
      await supabase
        .from('teams')
        .update({ status: 'ELIMINATED', current_phase: 'PLANKED' })
        .eq('id', teamId);
    } catch (e) {
      console.error(e);
    }
  };

  const handleUnpauseTeams = async () => {
    if (!confirm('UNPAUSE TEAMS? This will resume all resting teams in Cave Two into Round 3!')) return;
    try {
      await supabase
        .from('teams')
        .update({ current_phase: 'RELEASED' })
        .eq('current_phase', 'COVE');
    } catch (e) {
      console.error(e);
    }
  };

  // ==========================================
  // HELPER: Map 6 Beacons to UI display
  // ==========================================
  const getRoundDisplay = (sector) => {
    if (sector === 0) return "0";
    if (sector === 1) return "1";
    if (sector === 2) return "2";
    if (sector === 3) return "⚓"; // Milestone/Pause
    if (sector === 4) return "3";
    if (sector === 5) return "4";
    if (sector >= 6) return "🏆";
    return sector;
  };

  const formatTime = (s) => {
    if (!s || s < 0) return "0m 00s";
    const m = Math.floor(s / 60);
    const sc = Math.floor(s % 60);
    return `${m}m ${sc.toString().padStart(2, '0')}s`;
  };

  if (!hydrated) return null;

  return (
    <div className="min-h-screen bg-[#050505] text-[#f4e4bc] p-4 md:p-12 relative font-sans uppercase overflow-y-auto custom-scroll selection:bg-[#d4af37] selection:text-black">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&family=Space+Mono:wght@400;700&display=swap');
        .f-h { font-family: 'Cinzel', serif; }
        .f-b { font-family: 'Space Mono', monospace; }
        .gold-glow { text-shadow: 0 0 20px rgba(212, 175, 55, 0.8), 0 0 5px rgba(255, 255, 255, 0.4); }
        .cyan-glow { text-shadow: 0 0 20px rgba(34, 211, 238, 0.8), 0 0 5px rgba(255, 255, 255, 0.4); }
        .glass-panel { background: rgba(5, 5, 5, 0.7); backdrop-filter: blur(16px); border: 1px solid rgba(212, 175, 55, 0.2); box-shadow: 0 25px 50px rgba(0,0,0,0.8), inset 0 0 20px rgba(0,0,0,0.5); }
        .glass-btn { background: rgba(5, 5, 5, 0.6); backdrop-filter: blur(8px); border: 1px solid rgba(212, 175, 55, 0.3); color: #d4af37; transition: all 0.3s ease; text-transform: uppercase; letter-spacing: 0.1em; }
        .glass-btn:hover { background: rgba(212, 175, 55, 0.15); border-color: rgba(212, 175, 55, 0.8); box-shadow: 0 0 15px rgba(212, 175, 55, 0.3); }
        @keyframes scanline { 0% { bottom: 100%; } 100% { bottom: 0%; } }
        .scanner-line { position: fixed; top: 0; left: 0; right: 0; height: 100px; background: linear-gradient(to bottom, transparent, rgba(212, 175, 55, 0.05), transparent); animation: scanline 8s linear infinite; pointer-events: none; z-index: 60; }
        .particles { position: fixed; width: 3px; height: 3px; background: rgba(212,175,55,0.6); box-shadow: 0 0 10px rgba(212,175,55,0.8); border-radius: 50%; opacity: 0; animation: rise 15s infinite ease-in; z-index: 2; pointer-events: none; }
        @keyframes rise { 0% { bottom: -10px; transform: translateX(0); opacity: 0; } 50% { opacity: 1; } 100% { bottom: 100vh; transform: translateX(50px); opacity: 0; } }
      `}</style>

      <div className="scanner-line" />
      <div className="particles" style={{ left: '15%', animationDuration: '10s' }} />
      <div className="particles" style={{ left: '45%', animationDuration: '14s' }} />
      <div className="particles" style={{ left: '85%', animationDuration: '12s' }} />

      <div className="fixed inset-0 z-0 opacity-15 pointer-events-none grayscale brightness-50">
        <img src="/cave.webp" className="w-full h-full object-cover" alt="" />
      </div>

      <header className="relative z-10 max-w-7xl mx-auto mb-16 border-b border-[#d4af37]/20 pb-10">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 bg-red-600 animate-pulse rounded-full shadow-[0_0_12px_red]" />
              <p className="f-b text-[10px] tracking-[0.2em] text-red-500 font-bold uppercase">System Live • Sync: {lastSync}</p>
            </div>
            <h1 className="f-h text-6xl md:text-8xl tracking-tighter text-white leading-none"> COMMAND <span className="text-[#d4af37] gold-glow">CENTER</span> </h1>
            <nav className="flex flex-wrap items-center gap-x-6 gap-y-4 pt-4">
              <Link href="#" className="f-b text-[11px] tracking-[0.2em] text-[#d4af37] border-b-2 border-[#d4af37] pb-1 font-bold">LIVE FLEET</Link>
              <Link href="/admin/clues" className="f-b text-[11px] tracking-[0.2em] opacity-50 hover:opacity-100 hover:text-[#d4af37] transition-all pb-1 font-bold">MANAGE CLUES</Link>
              <button onClick={handleUnpauseTeams} className="glass-btn px-4 py-2 f-b text-[10px] font-black border-cyan-500/50 text-cyan-400 ml-2"> UNPAUSE CAVE TEAMS </button>
              <button onClick={handleLogout} className="glass-btn px-4 py-2 f-b text-[10px] font-black border-red-500/50 text-red-500"> LOGOUT </button>
            </nav>
          </div>

          <div className="flex flex-wrap gap-6 p-6 glass-panel rounded-sm shrink-0">
            <div className="text-center px-4">
              <p className="f-b text-[10px] opacity-60 tracking-widest mb-2 uppercase">Teams</p>
              <p className="f-h text-5xl text-white">{teams.length}</p>
            </div>
            <div className="text-center px-4 border-x border-white/10">
              <p className="f-b text-[10px] opacity-60 tracking-widest mb-2 text-green-500 uppercase">Hunting</p>
              <p className="f-h text-5xl text-green-500">{teams.filter(t => t.current_sector > 0 && t.status === 'ACTIVE').length}</p>
            </div>
            <div className="text-center px-4">
              <p className="f-b text-[10px] opacity-60 tracking-widest mb-2 text-red-500 uppercase">Planked</p>
              <p className="f-h text-5xl text-red-600">{teams.filter(t => t.status === 'ELIMINATED').length}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="grid grid-cols-1 gap-6 relative z-10 max-w-7xl mx-auto pb-32">
        <AnimatePresence mode='popLayout'>
          {teams.map((team, index) => (
            <motion.div layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} key={team.id}
              className={`glass-panel px-8 py-10 flex flex-col lg:flex-row items-center justify-between gap-10 rounded-sm relative overflow-hidden ${team.status === 'ELIMINATED' ? 'opacity-40 grayscale' : 'hover:border-[#d4af37]/50'}`}
            >
              {/* Sector Progress Bar */}
              <div className="absolute bottom-0 left-0 h-1 bg-[#d4af37]/5 w-full" />
              <motion.div initial={{ width: 0 }} animate={{ width: `${(team.current_sector / 6) * 100}%` }}
                className={`absolute bottom-0 left-0 h-1 shadow-[0_0_15px] ${team.current_sector === 0 ? 'bg-cyan-500 shadow-cyan-500' : 'bg-[#d4af37] shadow-[#d4af37]'}`}
              />

              <div className="flex flex-col md:flex-row items-center gap-12 w-full lg:w-3/4">
                <div className="relative shrink-0">
                  <div className={`w-24 h-24 border-2 flex flex-col items-center justify-center rounded-full bg-black/40 ${team.status === 'ELIMINATED' ? 'border-red-900/50' : team.current_sector === 0 ? 'border-cyan-500/40' : 'border-[#d4af37]/40'}`}>
                    <span className={`f-h text-4xl leading-none ${team.status === 'ELIMINATED' ? 'text-red-900' : team.current_sector === 0 ? 'text-cyan-400 cyan-glow' : 'text-white gold-glow'}`}>
                      {getRoundDisplay(team.current_sector)}
                    </span>
                    <p className="f-b text-[10px] opacity-70 mt-1 tracking-widest">{team.current_sector === 0 ? "READY" : "BEACON"}</p>
                  </div>
                </div>

                <div className="text-center md:text-left space-y-3">
                  <div className="flex flex-col md:flex-row items-center gap-4">
                    <div className="bg-black/50 border border-[#d4af37]/40 text-[#d4af37] px-4 py-1 rounded-sm f-h text-2xl">#{index + 1}</div>
                    <h3 className="f-h text-4xl md:text-5xl text-white tracking-tight">{team.team_name}</h3>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-x-12 gap-y-6 mt-4 border-t border-[#d4af37]/20 pt-6">
                    <div className="f-b text-[11px] flex flex-col">
                      <span className="opacity-50 tracking-wider text-[#d4af37] uppercase mb-1">Leader</span>
                      <span className="text-[#f4e4bc] font-bold text-sm">{team.leader_name}</span>
                    </div>
                    <div className="f-b text-[11px] flex flex-col">
                      <span className="opacity-50 tracking-wider text-[#d4af37] uppercase mb-1">Position</span>
                      <span className="text-[#f4e4bc] font-bold text-sm">Beacon 0{team.current_sector} / 06</span>
                    </div>
                    <div className="flex flex-col bg-black/60 p-3 rounded-sm border border-[#d4af37]/20 relative min-w-[120px]">
                      <span className="f-b text-[10px] opacity-70 text-[#d4af37] uppercase">HUNTING TIME</span>
                      <span className="text-white font-black text-lg mt-1 tracking-widest tabular-nums">
                        {/* FIX: Time logic synchronized with Sector 1 scan */}
                        {team.current_sector === 0 ? "0m 00s" : formatTime(team.total_time_taken)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="w-full lg:w-auto text-center lg:text-right flex flex-col items-center lg:items-end gap-4">
                <div className={`inline-block min-w-[200px] px-8 py-4 border text-[14px] font-black tracking-[0.2em] shadow-2xl backdrop-blur-md uppercase f-h ${team.status === 'ELIMINATED' ? 'border-red-900 text-red-600 bg-red-950/40' :
                    team.status === 'FINISHED' ? 'border-green-700 text-green-500 bg-green-950/40' :
                      team.current_sector === 0 ? 'border-cyan-600 text-cyan-400 bg-cyan-950/40 animate-pulse' :
                        team.current_phase === 'COVE' ? 'border-cyan-700 text-cyan-400 bg-cyan-950/40' :
                          'border-[#d4af37]/80 text-[#d4af37] bg-black/60'
                  }`}>
                  {team.status === 'ELIMINATED' ? 'ELIMINATED' : team.status === 'FINISHED' ? 'COMPLETED' : team.current_sector === 0 ? 'WAITING' : team.current_phase === 'COVE' ? 'AT COVE' : 'ACTIVE'}
                </div>

                {team.status === 'ACTIVE' && (
                  <button onClick={() => handlePlankTeam(team.id)} className="f-b text-[9px] font-bold uppercase tracking-widest text-red-400/80 hover:text-white hover:bg-red-800 px-3 py-1 border border-red-500/50 transition-all rounded-sm"> Walk the Plank </button>
                )}
                <p className="f-b text-[10px] opacity-40 mt-1 lowercase">ID: {team.id.toString().substring(0, 8)}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {teams.length === 0 && (
          <div className="text-center py-40 border-2 border-dashed border-[#d4af37]/30 rounded-lg glass-panel mt-10 f-h text-2xl opacity-50 tracking-[0.2em]"> WAITING FOR TEAMS... </div>
        )}
      </main>

      <div className="pointer-events-none fixed inset-0 z-40 shadow-[inset_0_0_300px_rgba(0,0,0,1)] opacity-90" />
    </div>
  );
}