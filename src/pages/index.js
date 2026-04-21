import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { usePlayerStore, useAdminStore } from '../lib/store';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [initialDelay, setInitialDelay] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [mode, setMode] = useState('IDLE'); // 'IDLE', 'TEAM', 'ADMIN'
  const [showInstallGate, setShowInstallGate] = useState(false);
  const [adminData, setAdminData] = useState({ username: '', password: '' });
  const router = useRouter();

  const playerLogin = usePlayerStore((s) => s.login);
  const existingTeam = usePlayerStore((s) => s.team);
  const adminLogin = useAdminStore((s) => s.loginAdmin);
  const isAdmin = useAdminStore((s) => s.isAdmin);

  const [formData, setFormData] = useState({
    teamName: '',
    password: '',
    leaderName: '',
    leaderPhone: '',
    member2: '',
    member3: '',
    member4: '',
  });

  // Wait for hydration before showing resume options
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
    
    // Check if app is not running in standalone (PWA) mode AND hasn't been dismissed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone || document.referrer.includes('android-app://');
    const dismissed = localStorage.getItem('maze_install_dismissed');
    
    if (!isStandalone && !dismissed) {
      setShowInstallGate(true);
    }

    // Initial 0.5s connection delay
    const timer = setTimeout(() => setInitialDelay(false), 500);

    // Auto-Routing Core
    if (usePlayerStore.getState().team) {
      router.push('/dashboard');
    } else if (useAdminStore.getState().isAdmin) {
      router.push('/admin/dashboard');
    }

    // --- ANALYTICS: Catch App Install ---
    const handleInstall = async () => {
      console.log('App was successfully installed!');
      try {
        await supabase.rpc('increment_install');
      } catch (e) {}
    };
    window.addEventListener('appinstalled', handleInstall);
    
    return () => {
      window.removeEventListener('appinstalled', handleInstall);
      clearTimeout(timer);
    };
  }, [router]);

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase
      .from('admins')
      .select('*')
      .eq('username', adminData.username)
      .eq('password', adminData.password)
      .single();

    if (error || !data) {
      alert('Staff access denied. Check your password.');
    } else {
      adminLogin();
      router.push('/admin/dashboard');
    }
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    // Fetch ALL columns to get actual progress from DB
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .eq('team_name', formData.teamName)
      .eq('password', formData.password)
      .single();

    if (error || !data) {
      setErrorMsg('Wrong Pirate ID or Secret Code!');
    } else {
      // playerLogin() intelligently merges DB + local state
      playerLogin(data);
      router.push('/dashboard');
    }
    setLoading(false);
  };

  if (!hydrated) return null; // Avoid hydration mismatch

  if (showInstallGate) {
    return (
      <div className="relative w-screen h-screen flex flex-col items-center justify-center bg-[#050505] p-6 text-center select-none">
        <style jsx global>{`
          @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Space+Mono:wght@400;700&display=swap');
          .hunt-title { font-family: 'Cinzel', serif; }
          .hunt-text { font-family: 'Space Mono', monospace; }
        `}</style>
        
        <div className="absolute inset-0 z-0 bg-[url('/cave.webp')] bg-cover opacity-20 grayscale brightness-50 pointer-events-none" />
        
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }} 
          animate={{ scale: 1, opacity: 1 }} 
          className="z-10 bg-black/80 border border-[#d4af37]/30 p-8 md:p-12 max-w-md w-full backdrop-blur-md rounded-lg shadow-[0_0_40px_rgba(212,175,55,0.15)]"
        >
          <img src="/icon.png" alt="App Icon" className="w-24 h-24 mx-auto mb-6 rounded-2xl shadow-[0_0_20px_rgba(212,175,55,0.4)] border border-[#d4af37]/40 p-1" />
          
          <h2 className="hunt-title text-2xl md:text-3xl text-white mb-2 uppercase drop-shadow-[0_0_15px_rgba(212,175,55,0.5)]">Install App</h2>
          <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-[#d4af37]/50 to-transparent my-4" />
          
          <p className="text-[#f4e4bc] text-sm md:text-base opacity-80 mb-8 leading-relaxed">
            For maximum stability and fullscreen mode, you must install The Maze on your device before starting.
          </p>

          <div className="space-y-4 text-left hunt-text text-[11px] text-[#d4af37] opacity-90 tracking-widest bg-black/60 p-5 border border-white/10 rounded-md mb-8 shadow-inner">
            <p className="leading-relaxed">
              <strong className="text-white">iOS (Safari):</strong><br/>Tap the Share icon <span className="text-white border border-white/30 px-1 rounded mx-1 pb-1">[↑]</span> at the bottom, then scroll down and tap &quot;Add to Home Screen&quot; <span className="text-white border border-white/30 px-1 rounded mx-1 pb-1">[+]</span>.
            </p>
            <div className="h-[1px] bg-white/10 w-full" />
            <p className="leading-relaxed">
              <strong className="text-white">Android (Chrome):</strong><br/>Tap the Menu icon <span className="text-white border border-white/30 px-1 rounded mx-1 pb-1">[⋮]</span> at the top right, then tap &quot;Install app&quot; or &quot;Add to Home screen&quot;.
            </p>
          </div>

          <button 
            onClick={() => {
              localStorage.setItem('maze_install_dismissed', 'true');
              setShowInstallGate(false);
            }}
            className="w-full bg-[#d4af37] text-black py-4 font-black text-sm tracking-[0.2em] uppercase rounded-sm hover:scale-[1.02] transition-all shadow-[0_0_20px_rgba(212,175,55,0.3)]"
          >
            I&apos;ve Installed It
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen flex flex-col items-center justify-center overflow-hidden bg-[#050505] text-[#f4e4bc]">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&family=Space+Mono:wght@400;700&display=swap');
        .f-h { font-family: 'Cinzel', serif; }
        .f-b { font-family: 'Space Mono', monospace; }
        
        .gold-glow { text-shadow: 0 0 25px rgba(212, 175, 55, 0.9), 0 0 10px rgba(255, 255, 255, 0.4); }
        .red-glow { text-shadow: 0 0 20px rgba(255, 0, 0, 0.8), 0 0 5px rgba(255, 255, 255, 0.4); }
        .ambient-vignette { background: radial-gradient(circle, transparent 20%, rgba(5,5,5,0.98) 120%); }

        .portal-input-adv { background: rgba(0,0,0,0.4); border: 1px solid rgba(212,175,55,0.2); color: #f4e4bc; font-family: 'Cinzel', serif; transition: all 0.4s ease; outline: none; border-radius: 4px; box-shadow: inset 0 2px 10px rgba(0,0,0,0.8); }
        .portal-input-adv:focus { border-color: #d4af37; background: rgba(212,175,55,0.05); box-shadow: 0 0 15px rgba(212,175,55,0.2), inset 0 2px 10px rgba(0,0,0,0.8); }
        .portal-input-adv::placeholder { color: rgba(244,228,188,0.3); }

        .glass-panel { background: rgba(5, 5, 5, 0.75); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-top: 2px solid rgba(212, 175, 55, 0.5); border-bottom: 2px solid rgba(212, 175, 55, 0.5); box-shadow: 0 25px 50px rgba(0,0,0,0.8), inset 0 0 20px rgba(0,0,0,0.5); }
      `}</style>

      {/* AMBIENT EFFECTS & DECORATIONS */}
      <div className="absolute inset-0 bg-[url('/cave.webp')] bg-cover bg-center opacity-30 grayscale pointer-events-none z-0" />
      <div className="absolute inset-0 ambient-vignette pointer-events-none z-0" />
      <div className="absolute inset-0 z-0 bg-[url('/fog.png')] bg-cover opacity-20 animate-pulse pointer-events-none mix-blend-screen" />
      
      {/* LANTERN (Top Right) */}
      <motion.img
        animate={{ y: [0, -15, 0], rotate: [0, -2, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        src="/lantern.webp"
        className="absolute top-[5%] right-[2%] md:right-[15%] w-32 md:w-48 z-10 opacity-90 pointer-events-none drop-shadow-[0_0_50px_rgba(212,175,55,0.7)]"
      />

      {/* TREASURE CHEST (Bottom Left) */}
      <motion.img
        initial={{ x: -50, opacity: 0 }}
        animate={{ x: 0, opacity: 0.8 }}
        transition={{ duration: 1.5, ease: 'easeOut' }}
        src="/chest.webp"
        className="absolute -bottom-[20px] md:-bottom-[50px] -left-[20px] md:-left-[50px] w-64 md:w-[450px] z-10 pointer-events-none drop-shadow-[0_20px_40px_rgba(0,0,0,1)] brightness-75 contrast-125"
      />

      {/* THE DOCK CONTAINER */}
      <main className="relative z-20 w-full max-w-[92%] md:max-w-md px-2 sm:px-6 flex justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="w-full glass-panel min-h-[450px] p-8 md:p-10 flex flex-col items-center rounded-lg relative overflow-hidden"
        >
          {/* Subtle gold top gleam */}
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#d4af37] to-transparent opacity-50" />

          {/* HEADER */}
          <div className="text-center mb-8 w-full pt-2">
            <h1 className="f-h font-black text-[40px] sm:text-5xl leading-[1.1] text-white gold-glow tracking-tighter drop-shadow-[0_5px_15px_rgba(212,175,55,0.4)]">
              DEAD MAN'S CODE
            </h1>
            <div className="flex items-center justify-center gap-3 mt-4 opacity-70">
              <div className="h-[1px] w-8 bg-[#d4af37]/60" />
              <p className="f-b text-[9px] uppercase font-bold text-[#d4af37] tracking-[0.2em] leading-none">Ambedkar Nagar ◓ 2026</p>
              <div className="h-[1px] w-8 bg-[#d4af37]/60" />
            </div>
          </div>

          <AnimatePresence mode="wait">
            {mode === 'IDLE' && (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="w-full flex-grow flex flex-col justify-center gap-5 sm:gap-6 mt-4"
              >
                {/* TEAM GATE */}
                <button
                  disabled={initialDelay}
                  onClick={() => setMode('TEAM')}
                  className="w-full bg-gradient-to-b from-[#003d33] to-[#00251a] text-[#ffd54f] border-2 border-[#d4af37] py-6 rounded-sm font-black uppercase text-2xl shadow-[inset_0_2px_10px_rgba(255,255,255,0.1),0_10px_25px_rgba(0,0,0,0.7)] hover:brightness-125 transition-all disabled:opacity-50 disabled:grayscale f-h group relative overflow-hidden"
                >
                  <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-[#ffd54f]/10 to-transparent transform -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                  <span className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">Board the Ship</span>
                  <span className="block text-xs f-b tracking-widest mt-2 opacity-80 text-[#b2dfdb] drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">(Team Login)</span>
                </button>

                {/* ADMIN GATE */}
                <button
                  disabled={initialDelay}
                  onClick={() => setMode('ADMIN')}
                  className="w-full bg-gradient-to-b from-[#b71c1c] to-[#7f0000] text-[#ffcdd2] border border-[#d4af37]/60 py-4 rounded-sm font-black uppercase text-sm shadow-[inset_0_2px_10px_rgba(255,255,255,0.05),0_10px_20px_rgba(0,0,0,0.6)] hover:brightness-125 transition-all disabled:opacity-50 disabled:grayscale mt-2 f-h relative overflow-hidden"
                >
                  <span className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">Commodore's Quarters</span>
                  <span className="block text-[9px] f-b tracking-widest mt-1 opacity-70 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">(Admin Access)</span>
                </button>
              </motion.div>
            )}

            {mode === 'TEAM' && (
              <motion.form key="team-form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onSubmit={handleSubmit} className="w-full space-y-6 mt-2">
                <div className="text-center mb-6">
                  <h2 className="f-h text-xl sm:text-2xl text-[#d4af37] font-black uppercase tracking-widest drop-shadow-[0_0_10px_rgba(212,175,55,0.4)]">Identify Your Crew</h2>
                </div>
                
                <AnimatePresence mode="wait">
                  {errorMsg && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="text-[#ffcdd2] text-[10px] sm:text-[11px] text-center font-bold uppercase tracking-widest bg-red-900/40 py-3 border border-red-500/30 rounded-sm mb-4 block shadow-[0_0_15px_rgba(255,0,0,0.3)]">
                      {errorMsg}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="space-y-4 px-2 sm:px-4">
                  <input
                    required
                    type="text"
                    placeholder="Pirate ID (Team Name)"
                    className="portal-input-adv w-full py-4 text-center text-lg sm:text-xl font-bold uppercase f-h"
                    onChange={(e) => setFormData({ ...formData, teamName: e.target.value.trim() })}
                  />
                  <input
                    required
                    type="password"
                    placeholder="Secret Code (Password)"
                    className="portal-input-adv w-full py-4 text-center text-lg sm:text-xl font-bold f-b"
                    onChange={(e) => setFormData({ ...formData, password: e.target.value.trim() })}
                  />
                </div>

                <div className="pt-6 px-2 sm:px-4">
                  <button
                    disabled={loading}
                    className="w-full bg-[#d4af37] text-black py-4 rounded-sm font-black text-lg sm:text-xl uppercase transition-all shadow-[0_5px_20px_rgba(212,175,55,0.4)] hover:bg-[#ffe57f] disabled:opacity-50 f-h"
                  >
                    <span className="drop-shadow-[0_1px_2px_rgba(255,255,255,0.5)]">{loading ? 'Verifying...' : 'Set Sail ⚓'}</span>
                  </button>
                </div>
                
                <button type="button" onClick={() => setMode('IDLE')} className="w-full text-white/50 f-b text-[10px] sm:text-xs uppercase hover:text-white transition-colors mt-6 font-bold pt-4">
                  ← Return to Dock
                </button>
              </motion.form>
            )}

            {mode === 'ADMIN' && (
              <motion.form key="admin-form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onSubmit={handleAdminLogin} className="w-full space-y-6 mt-2">
                <div className="text-center mb-6">
                  <h2 className="f-h text-xl sm:text-2xl text-red-500 font-black uppercase tracking-widest red-glow">Commodore Access</h2>
                </div>

                <div className="space-y-4 px-2 sm:px-4">
                  <input
                    required
                    type="text"
                    placeholder="Username"
                    className="portal-input-adv w-full py-4 text-center text-lg sm:text-xl font-bold"
                    onChange={(e) => setAdminData({ ...adminData, username: e.target.value })}
                  />
                  <input
                    required
                    type="password"
                    placeholder="Passphrase"
                    className="portal-input-adv w-full py-4 text-center text-lg sm:text-xl font-bold"
                    onChange={(e) => setAdminData({ ...adminData, password: e.target.value })}
                  />
                </div>

                <div className="pt-6 px-2 sm:px-4">
                  <button
                    disabled={loading}
                    className="w-full bg-[#8e0000] text-white border border-[#ff5252] py-4 rounded-sm font-black uppercase text-base sm:text-lg tracking-[0.2em] f-h shadow-[0_5px_20px_rgba(255,0,0,0.4)] hover:bg-[#d50000] disabled:opacity-50"
                  >
                    <span className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">{loading ? 'Decrypting...' : 'Take Command 🏴‍☠️'}</span>
                  </button>
                </div>

                <button type="button" onClick={() => setMode('IDLE')} className="w-full text-white/50 f-b text-[10px] sm:text-xs uppercase hover:text-white transition-colors mt-6 font-bold pt-4">
                  ← Return to Dock
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </motion.div>
      </main>
    </div>
  );
}