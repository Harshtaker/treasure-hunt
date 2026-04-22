import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import { Html5Qrcode } from 'html5-qrcode';
import { supabase } from '../lib/supabase';
import { usePlayerStore } from '../lib/store';

export default function Dashboard() {
  // --- Zustand (persisted) state ---
  const team = usePlayerStore((s) => s.team);
  const revealedClue = usePlayerStore((s) => s.revealedClue);
  const isEliminated = usePlayerStore((s) => s.isEliminated);
  const isFinished = usePlayerStore((s) => s.isFinished);
  const setRevealedClue = usePlayerStore((s) => s.setRevealedClue);
  const setEliminated = usePlayerStore((s) => s.setEliminated);
  const advanceRound = usePlayerStore((s) => s.advanceRound);
  const recordFailedScan = usePlayerStore((s) => s.recordFailedScan);
  const syncFromDB = usePlayerStore((s) => s.syncFromDB);
  const logout = usePlayerStore((s) => s.logout);

  // --- Local UI state ---
  const [timeLeft, setTimeLeft] = useState(2400);
  const [isScanning, setIsScanning] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [isProcessing, setIsProcessing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState([]);

  const [timeOffset, setTimeOffset] = useState(0);
  const [currentPhase, setCurrentPhase] = useState('WAITING');

  const router = useRouter();
  const scannerRef = useRef(null);
  const teamRef = useRef(null);
  const revealedClueRef = useRef(null);
  const isProcessingRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { teamRef.current = team; }, [team]);
  useEffect(() => { revealedClueRef.current = revealedClue; }, [revealedClue]);
  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);

  // =========================
  // 0. TIME SYNC
  // =========================
  useEffect(() => {
    fetch('/api/time')
      .then((res) => res.json())
      .then((data) => {
        setTimeOffset(data.serverTime - Date.now());
      })
      .catch((err) => console.error('Time sync failed', err));
  }, []);

  // =========================
  // 1. HYDRATION + RECOVERY
  // =========================
  useEffect(() => {
    const unsub = usePlayerStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    if (usePlayerStore.persist.hasHydrated()) {
      setHydrated(true);
    }
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  // Sync Logic to fetch clue text on load or realtime update
  const fetchClueDirectly = useCallback(async (currentSector) => {
    if (!teamRef.current || currentSector === 0) return;
    const { data } = await supabase
      .from('clue_settings')
      .select('riddle_text')
      .eq('team_id', teamRef.current.id)
      .eq('chamber_number', currentSector)
      .maybeSingle();
    if (data?.riddle_text) setRevealedClue(data.riddle_text);
  }, [setRevealedClue]);

  useEffect(() => {
    if (!hydrated) return;
    const currentTeam = usePlayerStore.getState().team;
    if (!currentTeam) {
      router.push('/');
      return;
    }

    syncFromDB();
    fetchClueDirectly(currentTeam.current_sector);

    const playerChannel = supabase
      .channel(`player-${currentTeam.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'teams', filter: `id=eq.${currentTeam.id}` },
        (payload) => {
          usePlayerStore.getState().login(payload.new);
          syncFromDB();
          fetchClueDirectly(payload.new.current_sector);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(playerChannel);
    };
  }, [hydrated, router, syncFromDB, fetchClueDirectly]);

  useEffect(() => {
    if (team) {
      let phase = team.current_phase || 'SAILING';
      if (team.status === 'ELIMINATED' || team.current_phase === 'PLANKED') phase = 'PLANKED';
      else if (team.current_phase === 'COVE') phase = 'COVE';
      else if (team.status === 'FINISHED') phase = 'FINISHED';
      else if (team.current_phase === 'RELEASED') phase = 'RELEASED';
      else if (team.current_sector === 0) phase = 'WAITING';

      setCurrentPhase((prevPhase) => {
        if (prevPhase === 'COVE' && phase === 'SAILING') {
          if (window.navigator?.vibrate) {
            window.navigator.vibrate([300, 100, 300, 100, 300, 200, 500, 200, 500]);
          }
        }
        return phase;
      });
    }
  }, [team]);

  // =========================
  // 2. LOGOUT
  // =========================
  const handleLogout = () => {
    if (confirm('Logout?')) {
      logout();
      router.push('/');
    }
  };

  // =========================
  // 3. SCAN LOGIC (STRICT 6 QR FLOW)
  // =========================
  const onScanSuccess = useCallback(async (decodedText) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);

    if (scannerRef.current) {
      try { await scannerRef.current.pause(true); } catch (_) { }
    }

    const code = decodedText.trim().toUpperCase();
    const currentTeam = teamRef.current;

    try {
      const { data: dbTeam } = await supabase.from('teams').select('current_sector').eq('id', currentTeam.id).single();
      const actualSector = dbTeam ? dbTeam.current_sector : currentTeam.current_sector;
      const targetBeacon = actualSector + 1;

      // 1. First Check: Is it a Team-Specific QR?
      let { data: clueData } = await supabase
        .from('clue_settings')
        .select('*')
        .eq('team_id', currentTeam.id)
        .eq('chamber_number', targetBeacon)
        .eq('qr_secret_key', code)
        .maybeSingle();

      // 2. Fallback Check: Is it a PUBLIC QR for the target beacon? (Specially for Final QR-6)
      if (!clueData) {
        const { data: publicClue } = await supabase
          .from('clue_settings')
          .select('*')
          .in('team_id', ['ALL', null]) // Look for public keys
          .eq('chamber_number', targetBeacon)
          .eq('qr_secret_key', code)
          .maybeSingle();

        if (publicClue) clueData = publicClue;
      }

      if (!clueData) {
        setMsg({ type: 'error', text: 'INVALID SEAL' });
        recordFailedScan();
        setTimeout(() => {
          setMsg({ type: '', text: '' });
          setIsProcessing(false);
          isProcessingRef.current = false;
          if (scannerRef.current) scannerRef.current.resume();
        }, 1200);
        return;
      }

      // Advance State (QR-1 starts clock, QR-3 pauses/cove, QR-6 wins)
      await advanceRound(targetBeacon, clueData);

      // Update local clue immediately for the UI
      setRevealedClue(clueData.riddle_text);

      let successMsg = 'DECRYPTED';
      if (targetBeacon === 1) successMsg = 'HUNT STARTED!';
      if (targetBeacon === 3) successMsg = 'MILESTONE REACHED';
      if (targetBeacon === 6) successMsg = 'VICTORY';

      setMsg({ type: 'success', text: successMsg });

      setTimeout(() => {
        setIsScanning(false);
        setIsProcessing(false);
        isProcessingRef.current = false;
        setMsg({ type: '', text: '' });
      }, 1500);

      if (window.navigator.vibrate) window.navigator.vibrate(100);
    } catch (e) {
      console.error('Scan error:', e);
      setIsProcessing(false);
      isProcessingRef.current = false;
      if (scannerRef.current) {
        try { await scannerRef.current.resume(); } catch (_) { }
      }
    }
  }, [advanceRound, recordFailedScan, setRevealedClue]);

  // =========================
  // 4. TIMER LOGIC (START ON SCAN 1)
  // =========================
  useEffect(() => {
    if (!team?.last_clue_start || team?.current_sector === 0 || currentPhase === 'WAITING' || currentPhase === 'COVE' || currentPhase === 'RELEASED') {
      setTimeLeft(2400);
      return;
    }

    const calcTimer = () => {
      const now = Date.now() + timeOffset;
      const start = new Date(team.last_clue_start).getTime();
      const elapsed = Math.floor((now - start) / 1000);
      return Math.max(0, 2400 - elapsed);
    };

    const initialRemaining = calcTimer();
    if (initialRemaining <= 0) {
      if (currentPhase === 'SAILING' && team.current_sector > 0) setEliminated();
      return;
    }
    setTimeLeft(initialRemaining);

    const timer = setInterval(() => {
      const remaining = calcTimer();
      if (remaining <= 0) {
        if (currentPhase === 'SAILING' && team.current_sector > 0) setEliminated();
        clearInterval(timer);
      } else {
        setTimeLeft(remaining);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [team?.last_clue_start, currentPhase, team?.current_sector, setEliminated, timeOffset]);

  // =========================
  // 5. CAMERA LOGIC
  // =========================
  const handleInitiateScan = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      stream.getTracks().forEach(track => track.stop());
      setCameraError(null);
      setIsScanning(true);
    } catch (err) {
      setCameraError("SENSORS OFFLINE");
    }
  };

  useEffect(() => {
    let isMounted = true;
    if (isScanning && !isEliminated && !isFinished) {
      const start = async () => {
        try {
          await new Promise((res) => setTimeout(res, 200));
          if (!isMounted) return;
          scannerRef.current = new Html5Qrcode('reader');
          await scannerRef.current.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            onScanSuccess
          );
        } catch (err) {
          if (isMounted) {
            setIsScanning(false);
            setCameraError("SENSORS OFFLINE");
          }
        }
      };
      start();
    }
    return () => {
      isMounted = false;
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(() => { });
      }
    };
  }, [isScanning, onScanSuccess, isEliminated, isFinished]);

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sc = s % 60;
    return `${m}:${sc < 10 ? '0' : ''}${sc}`;
  };

  const fetchLeaderboard = async () => {
    try {
      const { data } = await supabase
        .from('teams')
        .select('team_name, total_time_taken, current_sector')
        .order('current_sector', { ascending: false })
        .order('total_time_taken', { ascending: true });
      if (data) setLeaderboardData(data);
      setShowLeaderboard(true);
    } catch (_) { }
  };

  if (!hydrated || !team) return null;

  // VIEWS (Full Page Overlays)
  if (currentPhase === 'FINISHED') return (
    <div className="h-screen bg-[#050505] flex flex-col items-center justify-center text-white text-center p-4 relative overflow-hidden">
      <style jsx global>{` @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&display=swap'); .f-h { font-family: 'Cinzel', serif; } .gold-glow { text-shadow: 0 0 15px rgba(212, 175, 55, 0.5); } .glass-btn { background: rgba(5, 5, 5, 0.5); backdrop-filter: blur(8px); border: 1px solid rgba(212, 175, 55, 0.3); color: #d4af37; transition: all 0.3s ease; text-transform: uppercase; letter-spacing: 0.1em; } `}</style>
      <div className="absolute top-6 w-full flex justify-between px-6 z-20 max-w-lg">
        <button onClick={() => router.push('/')} className="glass-btn px-4 py-2 f-b text-[10px] font-bold rounded-sm">[←] HOME</button>
        <button onClick={handleLogout} className="glass-btn px-4 py-2 f-b text-[10px] font-bold rounded-sm border-red-500/30 text-red-400">[✖] LOGOUT</button>
      </div>
      <motion.h1 initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-5xl md:text-7xl f-h gold-glow">MISSION COMPLETE</motion.h1>
      <p className="mt-8 f-h text-xl text-[#d4af37] tracking-[0.3em]">YOU FOUND THE TREASURE</p>
    </div>
  );

  if (currentPhase === 'PLANKED') return (
    <div className="h-screen bg-red-950 flex flex-col items-center justify-center text-white text-center p-4 relative">
      <style jsx global>{` @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&display=swap'); .f-h { font-family: 'Cinzel', serif; } .glass-btn { background: rgba(5, 5, 5, 0.5); backdrop-filter: blur(8px); border: 1px solid rgba(212, 175, 55, 0.3); color: #d4af37; transition: all 0.3s ease; text-transform: uppercase; letter-spacing: 0.1em; } `}</style>
      <div className="absolute top-6 w-full flex justify-between px-6 z-20 max-w-lg">
        <button onClick={() => router.push('/')} className="glass-btn px-4 py-2 f-b text-[10px] font-bold rounded-sm text-white">[←] HOME</button>
        <button onClick={handleLogout} className="glass-btn px-4 py-2 f-b text-[10px] font-bold rounded-sm border-white/30 text-white">[✖] LOGOUT</button>
      </div>
      <h1 className="text-6xl f-h drop-shadow-[0_0_20px_rgba(255,0,0,0.8)]">GAME OVER</h1>
      <p className="mt-4 text-xl tracking-widest uppercase opacity-80 f-h">You walked the plank</p>
    </div>
  );

  if (currentPhase === 'COVE') return (
    <div className="h-screen bg-[#050505] flex flex-col items-center justify-center text-[#f4e4bc] text-center p-6 relative overflow-hidden">
      <style jsx global>{` @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&display=swap'); .f-h { font-family: 'Cinzel', serif; } .cove-bg { background-image: radial-gradient(circle at center, rgba(15, 30, 45, 0.8) 0%, #050505 100%); } .glass-btn { background: rgba(5, 5, 5, 0.5); backdrop-filter: blur(8px); border: 1px solid rgba(212, 175, 55, 0.3); color: #d4af37; transition: all 0.3s ease; text-transform: uppercase; letter-spacing: 0.1em; } `}</style>
      <div className="absolute inset-0 cove-bg z-0" />
      <div className="absolute top-6 w-full flex justify-between px-6 z-20 max-w-lg">
        <button onClick={() => router.push('/')} className="glass-btn px-4 py-2 f-b text-[10px] font-bold rounded-sm">[←] HOME</button>
        <button onClick={handleLogout} className="glass-btn px-4 py-2 f-b text-[10px] font-bold rounded-sm border-red-500/30 text-red-400">[✖] LOGOUT</button>
      </div>
      <div className="z-10 bg-black/60 border border-[#d4af37]/30 p-12 rounded-sm backdrop-blur-md shadow-2xl">
        <motion.div animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 4, repeat: Infinity }}>
          <span className="text-6xl mb-6 block">⚓</span>
        </motion.div>
        <h2 className="f-h text-4xl text-[#d4af37] mb-4 uppercase font-black">CAVE TWO UNLOCKED</h2>
        <p className="font-mono text-sm tracking-widest text-white uppercase mt-4">Progress Saved. Clock Stopped.</p>
        <p className="font-mono text-xs tracking-widest opacity-60 mt-2 text-white uppercase leading-relaxed max-w-xs mx-auto">Wait for release and scan QR-4 beacon to re-ignite the hunt.</p>
      </div>
    </div>
  );

  // MAIN ACTIVE DASHBOARD
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-2 sm:p-4 relative overflow-hidden bg-[#050505]">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&family=Space+Mono:wght@400;700&display=swap');
        .f-h { font-family: 'Cinzel', serif; } .f-b { font-family: 'Space Mono', monospace; }
        .gold-glow { text-shadow: 0 0 20px rgba(212, 175, 55, 0.8), 0 0 5px rgba(255, 255, 255, 0.4); }
        .ambient-vignette { background: radial-gradient(circle, transparent 20%, rgba(5,5,5,0.98) 120%); }
        .glass-panel { background: rgba(5, 5, 5, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(212, 175, 55, 0.2); box-shadow: 0 25px 50px rgba(0,0,0,0.8), inset 0 0 20px rgba(0,0,0,0.5); }
        .glass-btn { background: rgba(5, 5, 5, 0.5); backdrop-filter: blur(8px); border: 1px solid rgba(212, 175, 55, 0.3); color: #d4af37; transition: all 0.3s ease; text-transform: uppercase; letter-spacing: 0.1em; }
        .rope-line { position: absolute; top: 50%; left: 10%; right: 10%; height: 2px; background: rgba(212, 175, 55, 0.2); z-index: 0; transform: translateY(-50%); }
        
        .clue-text-pre {
          white-space: pre-wrap;
          word-break: break-word;
          font-family: 'Space Mono', monospace !important;
          text-align: left !important;
          display: block;
          width: 100%;
        }

        /* Mobile Specific Overrides */
        @media (max-width: 640px) {
          .mobile-stack-fix { flex-direction: row !important; gap: 8px !important; }
          .bubble-small { width: 40px !important; height: 40px !important; font-size: 16px !important; }
          .main-card-padding { padding: 20px 15px !important; }
          .inscription-box { min-height: 120px !important; padding: 20px !important; }
        }
      `}</style>

      {/* AMBIENT EFFECTS */}
      <div className="absolute inset-0 bg-[url('/cave.webp')] bg-cover bg-center opacity-30 grayscale pointer-events-none z-0" />
      <div className="absolute inset-0 ambient-vignette pointer-events-none z-0" />
      <div className="absolute inset-0 z-0 bg-[url('/fog.png')] bg-cover opacity-20 animate-pulse pointer-events-none mix-blend-screen" />

      {/* TOP UTIL BAR */}
      <header className="absolute top-4 w-full flex justify-between items-start pt-2 z-20 max-w-[95%] md:max-w-lg px-2">
        <button onClick={handleLogout} className="glass-btn px-3 py-2 f-b text-[10px] font-bold rounded-sm border border-[#d4af37]/30 text-[#d4af37] bg-black/50"> [✖] Abandon </button>
        <button onClick={fetchLeaderboard} className="glass-btn px-3 py-2 f-b text-[10px] font-bold rounded-sm flex items-center gap-2 border border-[#d4af37]/30 text-[#d4af37] bg-black/50"> Leaderboard <span className="text-[#d4af37] animate-pulse">●</span> </button>
      </header>

      {/* MAIN CONTAINER */}
      <main className="w-full max-w-[95%] md:max-w-md mt-16 relative z-10 flex flex-col items-center main-card-padding glass-panel rounded-lg min-h-[500px]">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/60 to-transparent" />
        <h2 className="f-h text-xl md:text-3xl text-white mt-2 uppercase gold-glow tracking-widest text-center font-bold"> Team: {team.team_name} </h2>

        {/* PROGRESS TRACKER - SIDE BY SIDE ON MOBILE */}
        <div className="w-full flex flex-row gap-2 sm:gap-6 my-6 px-1 justify-center items-center mobile-stack-fix">
          {/* Phase I Progress */}
          <div className="glass-panel p-2 sm:p-4 rounded-sm relative flex-1 flex flex-col items-center">
            <span className="text-[#d4af37] text-[8px] sm:text-[10px] f-b mb-3 font-bold opacity-80 uppercase tracking-widest text-center">Phase I</span>
            <div className="rope-line" />
            <div className="flex justify-between w-full px-2 sm:px-6 relative z-10 gap-2">
              {[1, 2].map((n) => (
                <div key={n} className={`w-8 h-8 sm:w-10 sm:h-10 bubble-small rounded-full flex items-center justify-center f-h text-sm sm:text-xl shadow-xl transition-all duration-700 ${team.current_sector >= n ? 'bg-[#d4af37] text-black border-2 border-white font-black' : 'bg-black/80 text-white/40 border border-white/20'}`}>{n}</div>
              ))}
            </div>
          </div>

          {/* Phase II Progress */}
          <div className="glass-panel p-2 sm:p-4 rounded-sm relative flex-1 flex flex-col items-center">
            <span className="text-[#d4af37] text-[8px] sm:text-[10px] f-b mb-3 font-bold opacity-80 uppercase tracking-widest text-center">Phase II</span>
            <div className="rope-line" />
            <div className="flex justify-between w-full px-2 sm:px-6 relative z-10 gap-2">
              {[4, 6].map((n, i) => (
                <div key={n} className={`w-8 h-8 sm:w-10 sm:h-10 bubble-small rounded-full flex items-center justify-center f-h text-sm sm:text-xl shadow-xl transition-all duration-700 ${team.current_sector >= n ? 'bg-[#d4af37] text-black border-2 border-white font-black' : 'bg-black/80 text-white/40 border border-white/20'}`}>{n === 6 ? '🏆' : '3'}</div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex w-full items-stretch gap-3 mb-6 flex-col sm:flex-row">
          {/* CLUE DISPLAY */}
          <div className="flex-1 glass-panel p-5 sm:p-8 inscription-box flex flex-col items-center justify-center text-center rounded-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/40 to-transparent" />
            <span className="text-[#d4af37] text-[10px] f-b mb-3 font-bold opacity-70 tracking-widest uppercase">Decrypted Inscription</span>
            <AnimatePresence mode="wait">
              {(revealedClue && currentPhase === 'SAILING') ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} key={team.current_sector} className="w-full">
                  <div className="clue-text-pre text-xs sm:text-sm text-white leading-relaxed font-bold uppercase drop-shadow-xl">
                    {revealedClue}
                  </div>
                </motion.div>
              ) : (
                <div className="opacity-60 text-white flex flex-col items-center">
                  <div className="w-8 h-8 sm:w-12 sm:h-12 border border-dashed border-[#d4af37]/50 rounded-full mb-2 flex items-center justify-center animate-pulse text-[#d4af37] f-b font-black">?</div>
                  <p className="f-b text-[9px] uppercase font-bold text-[#d4af37] text-center px-1">
                    {team.current_sector === 0 ? "Scan START Beacon (QR-1)" :
                      currentPhase === 'RELEASED' ? "Scan Resume Seal (QR-4)" :
                        `Locate QR-${team.current_sector + 1}`}
                  </p>
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* TIME BANK */}
          <div className="sm:w-[130px] w-full shrink-0 flex flex-col items-center justify-center relative glass-panel rounded-sm py-3 sm:py-4">
            <span className="text-[#d4af37] text-[8px] sm:text-[9px] f-b opacity-70 absolute top-2 sm:top-4 uppercase tracking-[0.2em]">Time Bank</span>
            <span className={`text-3xl sm:text-4xl f-h font-black tabular-nums mt-3 sm:mt-0 ${timeLeft < 300 && currentPhase === 'SAILING' ? 'text-red-500 animate-pulse' : 'text-white'}`}>{formatTime(timeLeft)}</span>
          </div>
        </div>

        <button onClick={handleInitiateScan} className="w-full mt-auto py-4 sm:py-5 bg-gradient-to-b from-[#003d33] to-[#00251a] text-[#ffd54f] border-2 border-[#d4af37] shadow-xl hover:brightness-125 f-h text-lg font-black uppercase rounded-sm active:scale-95 transition-all group overflow-hidden relative">
          <span className="relative z-10 flex items-center justify-center gap-3">Scan Ancient Seal <span className="text-2xl">⨁</span></span>
          <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
        </button>
      </main>

      {/* ERROR OVERLAY */}
      <AnimatePresence>{cameraError && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col items-center justify-center p-6 backdrop-blur-md text-center">
          <div className="border border-red-500/30 bg-red-950/20 p-10 max-w-sm shadow-2xl">
            <h2 className="f-h text-2xl text-red-500 mb-6 uppercase font-bold">{cameraError}</h2>
            <p className="f-b text-[#f4e4bc] text-sm mb-8 opacity-90 uppercase leading-relaxed">Permission Denied. Re-enable Camera in Browser Settings.</p>
            <button onClick={() => setCameraError(null)} className="w-full py-4 bg-[#d4af37] text-black uppercase f-b text-xs font-black tracking-widest">Acknowledge</button>
          </div>
        </div>
      )}</AnimatePresence>

      {/* SCANNER OVERLAY */}
      <AnimatePresence>{isScanning && (
        <div className="fixed inset-0 z-[100] bg-black/98 flex flex-col items-center justify-center p-4 sm:p-8 backdrop-blur-xl">
          <div className="w-full max-w-sm aspect-square relative rounded-sm border-2 border-[#d4af37]/30 bg-black overflow-hidden shadow-2xl">
            <div id="reader" className="w-full h-full scale-110"></div>
            {msg.text && <div className={`absolute inset-0 flex items-center justify-center z-[110] backdrop-blur-md ${msg.type === 'error' ? 'bg-red-600/80' : 'bg-[#d4af37]/90'}`}><p className="f-h text-2xl sm:text-3xl text-white text-center uppercase px-6 font-bold">{msg.text}</p></div>}
          </div>
          <button onClick={() => setIsScanning(false)} className="mt-8 sm:mt-12 text-white/40 f-b uppercase text-sm border-b border-white/10 pb-1">Cancel Scan</button>
        </div>
      )}</AnimatePresence>

      {/* LEADERBOARD OVERLAY */}
      <AnimatePresence>{showLeaderboard && (
        <div className="fixed inset-0 z-[150] bg-black/95 flex flex-col items-center p-4 sm:p-6 backdrop-blur-xl overflow-y-auto">
          <div className="w-full max-w-md py-6 sm:py-10 flex flex-col items-center">
            <h2 className="f-h text-2xl sm:text-3xl text-[#d4af37] mb-6 sm:mb-8 text-center uppercase tracking-widest font-black">Rankings</h2>
            <div className="w-full flex flex-col gap-3 sm:gap-4 pb-20">
              {leaderboardData.map((t, idx) => {
                const displayTime = t.current_sector === 0 ? "0:00" : formatTime(t.total_time_taken || 0);
                return (
                  <div key={idx} className={`w-full glass-panel flex items-center justify-between p-3 sm:p-4 ${t.team_name === team.team_name ? 'border-[#d4af37]/80 bg-[#d4af37]/10' : 'border-white/5'}`}>
                    <div className="flex items-center gap-3 sm:gap-4 text-white"><span>{idx + 1}</span><span className="uppercase f-h font-bold text-sm sm:text-base truncate max-w-[120px]">{t.team_name}</span></div>
                    <span className="f-h text-white font-bold text-sm sm:text-base">{displayTime}</span>
                  </div>
                );
              })}
            </div>
            <button onClick={() => setShowLeaderboard(false)} className="fixed bottom-6 px-10 py-3 glass-btn f-b text-xs uppercase font-black rounded-sm bg-black/80">Exit</button>
          </div>
        </div>
      )}</AnimatePresence>
    </div>
  );
}