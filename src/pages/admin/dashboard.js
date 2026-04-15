import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useAdminStore } from '../../lib/store';

export default function AdminDashboard() {
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const teams = useAdminStore((s) => s.teams);
  const stats = useAdminStore((s) => s.stats);
  const lastSync = useAdminStore((s) => s.lastSync);
  const fetchTeams = useAdminStore((s) => s.fetchTeams);
  const subscribeRealtime = useAdminStore((s) => s.subscribeRealtime);
  const logoutAdmin = useAdminStore((s) => s.logoutAdmin);
  const router = useRouter();

  useEffect(() => {
    if (!isAdmin) {
      router.push('/');
      return;
    }

    // Initial fetch
    fetchTeams();

    // Subscribe to Supabase Realtime for instant updates
    const unsubscribe = subscribeRealtime();

    // Also keep a fallback poll every 10s in case Realtime hiccups
    const fallbackInterval = setInterval(fetchTeams, 10000);

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      clearInterval(fallbackInterval);
    };
  }, [isAdmin, router, fetchTeams, subscribeRealtime]);

  const handleLogout = () => {
    logoutAdmin();
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-[#050505] text-[#f4e4bc] p-4 md:p-12 relative font-sans uppercase overflow-y-auto custom-scroll selection:bg-[#d4af37] selection:text-black">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Space+Mono:wght@400;700&display=swap');
        .legend-font { font-family: 'Cinzel', serif; }
        .data-font { font-family: 'Space Mono', monospace; }
        .chamber-glow { text-shadow: 0 0 15px rgba(212, 175, 55, 0.6); }
        .glass-tablet { background: rgba(10, 10, 10, 0.8); border: 1px solid rgba(212, 175, 55, 0.15); backdrop-filter: blur(20px); }
        .custom-scroll::-webkit-scrollbar { width: 4px; }
        .custom-scroll::-webkit-scrollbar-track { background: #050505; }
        .custom-scroll::-webkit-scrollbar-thumb { background: #d4af37; border-radius: 10px; }
        
        @keyframes scanline {
          0% { bottom: 100%; }
          100% { bottom: 0%; }
        }
        .scanner-line {
          position: fixed;
          top: 0; left: 0; right: 0; height: 100px;
          background: linear-gradient(to bottom, transparent, rgba(212, 175, 55, 0.05), transparent);
          animation: scanline 8s linear infinite;
          pointer-events: none;
          z-index: 60;
        }
      `}</style>

      <div className="scanner-line" />

      {/* BACKGROUND IMAGE */}
      <div className="fixed inset-0 z-0 opacity-15 pointer-events-none grayscale brightness-50">
        <img src="/cave.webp" className="w-full h-full object-cover" alt="" />
      </div>

      {/* HEADER SECTION */}
      <header className="relative z-10 max-w-7xl mx-auto mb-16 border-b border-[#d4af37]/20 pb-10">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
               <div className="w-2 h-2 bg-red-600 animate-pulse rounded-full shadow-[0_0_12px_red]" />
               <p className="data-font text-[10px] tracking-[0.5em] text-red-500 font-black">Oracle_System_Online // Sync: {lastSync}</p>
            </div>
            <h1 className="legend-font text-6xl md:text-8xl tracking-tighter text-white leading-none">
              ELDER'S <span className="text-[#d4af37] chamber-glow">WATCH</span>
            </h1>
            <nav className="flex flex-wrap gap-x-10 gap-y-4 pt-4">
              <Link href="#" className="data-font text-[11px] tracking-[0.4em] text-[#d4af37] border-b-2 border-[#d4af37] pb-1 font-bold">EXPEDITIONS</Link>
              <Link href="/admin/clues" className="data-font text-[11px] tracking-[0.4em] opacity-30 hover:opacity-100 hover:text-[#d4af37] transition-all pb-1 font-bold">FORGE_CLUES</Link>
              <button onClick={handleLogout} className="data-font text-[11px] tracking-[0.4em] text-red-500/60 hover:text-red-500 transition-all font-bold">BYPASS_LOGOUT</button>
            </nav>
          </div>

          <div className="flex gap-16 p-6 glass-tablet rounded-sm">
            <div className="text-center">
              <p className="data-font text-[10px] opacity-40 tracking-widest mb-2">Soul_Count</p>
              <p className="legend-font text-5xl text-white">{teams.length}</p>
            </div>
            <div className="text-center">
              <p className="data-font text-[10px] opacity-40 tracking-widest mb-2 text-green-500/60">Exploring</p>
              <p className="legend-font text-5xl text-green-500">{stats.active}</p>
            </div>
            <div className="text-center">
              <p className="data-font text-[10px] opacity-40 tracking-widest mb-2 text-red-500/60">Perished</p>
              <p className="legend-font text-5xl text-red-600">{stats.eliminated}</p>
            </div>
          </div>
        </div>
      </header>

      {/* TEAM GRID */}
      <main className="grid grid-cols-1 gap-6 relative z-10 max-w-7xl mx-auto pb-32">
        <AnimatePresence mode='popLayout'>
          {teams.map((team, index) => (
            <motion.div
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              key={team.id}
              className={`glass-tablet px-8 py-10 flex flex-col lg:flex-row items-center justify-between gap-10 group transition-all duration-700 rounded-sm relative overflow-hidden ${team.status === 'ELIMINATED' ? 'opacity-40 grayscale' : 'hover:border-[#d4af37]/50'}`}
            >
              {/* Progress Bar Underlay */}
              <div className="absolute bottom-0 left-0 h-1 bg-[#d4af37]/5 w-full" />
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(team.current_sector / 5) * 100}%` }}
                className="absolute bottom-0 left-0 h-1 bg-[#d4af37] shadow-[0_0_15px_#d4af37]"
              />

              <div className="flex flex-col md:flex-row items-center gap-12 w-full lg:w-3/4">
                {/* Sector Badge */}
                <div className="relative shrink-0">
                  <div className="absolute inset-0 bg-[#d4af37]/10 blur-xl rounded-full scale-150" />
                  <div className={`w-24 h-24 border-2 flex flex-col items-center justify-center relative z-10 rounded-full ${team.status === 'ELIMINATED' ? 'border-red-900/50' : 'border-[#d4af37]/40'}`}>
                    <span className={`legend-font text-4xl leading-none ${team.status === 'ELIMINATED' ? 'text-red-900' : 'text-white chamber-glow'}`}>
                      {team.current_sector}
                    </span>
                    <p className="data-font text-[8px] opacity-50 mt-1 tracking-tighter">SEC</p>
                  </div>
                </div>

                <div className="text-center md:text-left space-y-3">
                  <div className="flex flex-col md:flex-row items-center gap-4">
                    <h3 className="legend-font text-4xl md:text-5xl text-white tracking-tight group-hover:text-[#d4af37] transition-colors duration-500">
                      {team.team_name}
                    </h3>
                  </div>

                  <div className="grid grid-cols-2 gap-x-8 gap-y-2 max-w-md">
                    <div className="data-font text-[10px] flex flex-col">
                      <span className="opacity-30">Commander</span>
                      <span className="text-[#f4e4bc]">{team.leader_name}</span>
                    </div>
                    <div className="data-font text-[10px] flex flex-col">
                      <span className="opacity-30">Signal</span>
                      <span className="text-[#f4e4bc]">{team.leader_phone}</span>
                    </div>
                  </div>
                </div>

                {/* Mini Map Visualization */}
                <div className="hidden xl:flex gap-2 ml-auto">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <div
                      key={s}
                      className={`w-6 h-10 border transition-all duration-700 ${
                        team.current_sector >= s
                          ? 'bg-[#d4af37] border-[#d4af37] shadow-[0_0_10px_#d4af37]'
                          : 'bg-white/5 border-white/10'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="w-full lg:w-auto text-center lg:text-right">
                <div className={`inline-block min-w-[200px] px-8 py-4 border-2 text-[12px] font-black tracking-[0.5em] shadow-2xl ${
                  team.status === 'ELIMINATED'
                    ? 'border-red-900 text-red-600 bg-red-950/20'
                    : 'border-[#d4af37] text-[#d4af37] bg-white/5'
                }`}>
                  {team.status === 'ELIMINATED' ? 'EXPEDITION_FAILED' : 'SIGNAL_ACTIVE'}
                </div>
                <p className="data-font text-[8px] opacity-30 mt-3 tracking-widest">
                   UID: {team.id.toString().substring(0,8)}...
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {teams.length === 0 && (
          <div className="text-center py-40 border-2 border-dashed border-[#d4af37]/10 rounded-sm">
            <p className="legend-font text-2xl opacity-20 tracking-[1em] animate-pulse">Scanning for souls...</p>
          </div>
        )}
      </main>

      {/* OVERLAY EFFECTS */}
      <div className="fixed inset-0 pointer-events-none z-50 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(212,175,55,0.01),rgba(0,255,0,0.005),rgba(0,0,255,0.01))] bg-[length:100%_3px,3px_100%]" />
      <div className="pointer-events-none fixed inset-0 z-40 shadow-[inset_0_0_300px_rgba(0,0,0,1)] opacity-90" />
    </div>
  );
}