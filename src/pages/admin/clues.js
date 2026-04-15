import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import QRCode from 'qrcode';
import { supabase } from '../../lib/supabase';
import { useAdminStore } from '../../lib/store';

export default function RiddleForge() {
  const [clues, setClues] = useState([]);
  const [teams, setTeams] = useState([]);
  const [form, setForm] = useState({ id: null, teamId: 'ALL', chamber: 1, key: '', riddle: '' });
  const [qrCache, setQrCache] = useState({});
  const router = useRouter();

  const isAdmin = useAdminStore((s) => s.isAdmin);
  const logoutAdmin = useAdminStore((s) => s.logoutAdmin);

  useEffect(() => {
    if (!isAdmin) { router.push('/'); return; }
    fetchData();
  }, [isAdmin, router]);

  useEffect(() => {
    const generateQRs = async () => {
      const newCache = {};
      for (const clue of clues) {
        try {
          const url = await QRCode.toDataURL(clue.qr_secret_key, {
            margin: 2,
            scale: 10,
            errorCorrectionLevel: 'H',
            color: { dark: '#000000', light: '#ffffff' }
          });
          newCache[clue.id] = url;
        } catch (err) { console.error(err); }
      }
      setQrCache(newCache);
    };
    if (clues.length > 0) generateQRs();
  }, [clues]);

  const fetchData = async () => {
    const { data: cluesData } = await supabase.from('clue_settings').select('*').order('chamber_number', { ascending: true });
    const { data: teamsData } = await supabase.from('teams').select('id, team_name');
    setClues(cluesData || []);
    setTeams(teamsData || []);
  };

  const handleForge = async (e) => {
    e.preventDefault();
    const payload = {
      team_id: form.teamId,
      chamber_number: form.chamber,
      qr_secret_key: form.key.trim().toUpperCase(),
      riddle_text: form.riddle
    };

    const { error } = await supabase.from('clue_settings').upsert([
      form.id ? { id: form.id, ...payload } : payload
    ]);

    if (!error) {
      setForm({ id: null, teamId: 'ALL', chamber: 1, key: '', riddle: '' });
      fetchData();
    } else {
      alert('Error: ' + error.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Banish this seal forever?')) return;
    await supabase.from('clue_settings').delete().eq('id', id);
    fetchData();
  };

  const handleEdit = (clue) => {
    setForm({
      id: clue.id,
      teamId: clue.team_id || 'ALL',
      chamber: clue.chamber_number,
      key: clue.qr_secret_key,
      riddle: clue.riddle_text
    });
  };

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
        .glass-panel { background: rgba(10, 10, 10, 0.8); border: 1px solid rgba(212, 175, 55, 0.15); backdrop-filter: blur(20px); }
        .custom-scroll::-webkit-scrollbar { width: 4px; }
        .custom-scroll::-webkit-scrollbar-track { background: #050505; }
        .custom-scroll::-webkit-scrollbar-thumb { background: #d4af37; border-radius: 10px; }
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .glass-panel { border: 2px solid #333 !important; background: white !important; }
          * { color: black !important; text-shadow: none !important; }
        }
      `}</style>

      {/* BACKGROUND IMAGE */}
      <div className="fixed inset-0 z-0 opacity-10 pointer-events-none grayscale brightness-50 no-print">
        <img src="/cave.webp" className="w-full h-full object-cover" alt="" />
      </div>

      {/* HEADER */}
      <header className="relative z-10 max-w-7xl mx-auto mb-12 border-b border-[#d4af37]/20 pb-8 no-print">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
          <div className="space-y-3">
            <h1 className="legend-font text-5xl md:text-7xl tracking-tighter text-white leading-none">
              SEAL <span className="text-[#d4af37] chamber-glow">FORGE</span>
            </h1>
            <nav className="flex flex-wrap gap-x-10 gap-y-4 pt-4">
              <Link href="/admin/dashboard" className="data-font text-[11px] tracking-[0.4em] opacity-30 hover:opacity-100 hover:text-[#d4af37] transition-all pb-1 font-bold">EXPEDITIONS</Link>
              <Link href="#" className="data-font text-[11px] tracking-[0.4em] text-[#d4af37] border-b-2 border-[#d4af37] pb-1 font-bold">FORGE_CLUES</Link>
              <button onClick={handleLogout} className="data-font text-[11px] tracking-[0.4em] text-red-500/60 hover:text-red-500 transition-all font-bold">BYPASS_LOGOUT</button>
              <button onClick={() => window.print()} className="data-font text-[11px] tracking-[0.4em] opacity-30 hover:opacity-100 hover:text-[#d4af37] transition-all font-bold">PRINT_ALL</button>
            </nav>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-12 relative z-10 max-w-7xl mx-auto pb-32">
        {/* FORM SECTION */}
        <section className="lg:col-span-4 no-print">
          <div className="glass-panel p-8 sticky top-8 rounded-sm border-t-4 border-[#d4af37] shadow-2xl">
            <h2 className="legend-font text-xl mb-8 text-white tracking-[0.2em] border-b border-white/5 pb-4">
              {form.id ? "▸ EDIT SCROLL ◂" : "▸ INSCRIBE CLUE ◂"}
            </h2>
            <form onSubmit={handleForge} className="space-y-6">
              <div className="space-y-2">
                <label className="data-font text-[10px] text-[#d4af37] tracking-[0.3em]">TARGET_SQUAD</label>
                <select className="w-full bg-[#0a0a0a] border border-white/10 p-4 legend-font text-[12px] text-white outline-none appearance-none cursor-pointer focus:border-[#d4af37]/50" value={form.teamId} onChange={(e) => setForm({...form, teamId: e.target.value})}>
                  <option value="ALL">PUBLIC (ALL TEAMS)</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.team_name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="data-font text-[10px] text-[#d4af37] tracking-[0.3em]">CHAMBER</label>
                  <select className="w-full bg-[#0a0a0a] border border-white/10 p-4 legend-font text-[14px] text-white outline-none text-center" value={form.chamber} onChange={(e) => setForm({...form, chamber: parseInt(e.target.value)})}>
                    {[1,2,3,4].map(n => <option key={n} value={n}>ROUND 0{n}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="data-font text-[10px] text-[#d4af37] tracking-[0.3em]">SEAL_KEY</label>
                  <input type="text" required className="w-full bg-[#0a0a0a] border border-white/10 p-4 data-font text-sm text-[#d4af37] outline-none focus:border-[#d4af37]/50 uppercase" placeholder="SECRET" value={form.key} onChange={(e) => setForm({...form, key: e.target.value})} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="data-font text-[10px] text-[#d4af37] tracking-[0.3em]">THE_RIDDLE</label>
                <textarea rows="4" required className="w-full bg-[#0a0a0a] border border-white/10 p-4 legend-font text-[14px] text-white outline-none resize-none leading-relaxed italic focus:border-[#d4af37]/50" placeholder="Type the riddle here..." value={form.riddle} onChange={(e) => setForm({...form, riddle: e.target.value})} />
              </div>

              <div className="pt-4 flex flex-col gap-3">
                <button type="submit" className="w-full py-4 bg-[#d4af37] text-black font-black legend-font hover:brightness-110 transition-all text-[12px] tracking-[0.4em]">
                  {form.id ? "CONFIRM ALTERATION" : "FORGE NEW SEAL"}
                </button>
                {form.id && (
                    <button type="button" onClick={() => setForm({ id: null, teamId: 'ALL', chamber: 1, key: '', riddle: '' })} className="data-font text-[10px] opacity-40 hover:opacity-100 py-2">
                        [ CANCEL_STYLING ]
                    </button>
                )}
              </div>
            </form>
          </div>
        </section>

        {/* LIST SECTION */}
        <section className="lg:col-span-8 space-y-6">
          <div className="flex justify-between items-center border-b border-white/10 pb-4 no-print">
            <h2 className="legend-font text-2xl text-white tracking-[0.3em]">ACTIVE_ARCHIVE</h2>
            <span className="data-font text-[10px] bg-white/5 px-3 py-1 rounded-full opacity-60">{clues.length} SEALS FORGED</span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <AnimatePresence>
              {clues.map((clue) => {
                const teamName = teams.find(t => t.id === clue.team_id)?.team_name || "PUBLIC";
                const qrImage = qrCache[clue.id];

                return (
                  <motion.div layout key={clue.id} className="glass-panel p-6 flex flex-col md:flex-row items-center gap-8 rounded-sm group hover:border-[#d4af37]/40 transition-all overflow-hidden break-inside-avoid">
                    {/* QR Section */}
                    <div className="shrink-0 flex flex-col items-center gap-3">
                      <div className="bg-white p-2 rounded-sm shadow-[0_0_20px_rgba(255,255,255,0.1)]">
                        {qrImage ? (
                          <img src={qrImage} className="w-24 h-24" alt="Seal" />
                        ) : (
                          <div className="w-24 h-24 bg-black flex items-center justify-center text-[8px] animate-pulse">GENERATING...</div>
                        )}
                      </div>
                      <div className="no-print">
                        {qrImage && (
                          <a href={qrImage} download={`SEAL_R${clue.chamber_number}_${teamName}.png`} className="data-font text-[8px] text-[#d4af37] hover:text-white transition-colors tracking-tighter border border-[#d4af37]/20 px-2 py-1">
                            DOWNLOAD_PNG
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Content Section */}
                    <div className="flex-grow space-y-4">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-6">
                          <div className="text-center">
                            <p className="data-font text-[8px] opacity-40 mb-1">ROUND</p>
                            <span className="legend-font text-5xl text-white leading-none">0{clue.chamber_number}</span>
                          </div>
                          <div className="h-10 w-[1px] bg-white/10" />
                          <div>
                            <p className="data-font text-[8px] opacity-40 mb-1">DESTINATION</p>
                            <span className={`data-font text-[10px] font-bold tracking-widest px-3 py-1 border ${clue.team_id === 'ALL' ? 'bg-[#d4af37] text-black border-[#d4af37]' : 'text-[#d4af37] border-[#d4af37]/20'}`}>
                              {teamName}
                            </span>
                          </div>
                        </div>
                        <div className="text-right no-print">
                          <p className="data-font text-[8px] opacity-30 tracking-widest font-bold">PASSKEY</p>
                          <p className="data-font text-xs text-[#d4af37] font-bold tracking-widest">{clue.qr_secret_key}</p>
                        </div>
                      </div>

                      <div className="relative p-4 bg-white/5 rounded-sm">
                        <p className="legend-font text-[15px] italic text-white/90 normal-case leading-relaxed">"{clue.riddle_text}"</p>
                      </div>

                      <div className="flex gap-8 pt-2 no-print">
                        <button onClick={() => handleEdit(clue)} className="data-font text-[10px] text-[#d4af37] hover:text-white tracking-[0.2em] font-bold flex items-center gap-2">
                          <span className="text-[14px]">✎</span> MODIFY_SCROLL
                        </button>
                        <button onClick={() => handleDelete(clue.id)} className="data-font text-[10px] text-red-500/40 hover:text-red-500 tracking-[0.2em] font-bold flex items-center gap-2 transition-all">
                          <span className="text-[14px]">x</span> BANISH_SEAL
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </section>
      </main>

      {/* VIGNETTE */}
      <div className="pointer-events-none fixed inset-0 z-40 shadow-[inset_0_0_200px_rgba(0,0,0,1)] opacity-70 no-print" />
    </div>
  );
}