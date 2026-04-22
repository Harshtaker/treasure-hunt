import { useEffect, useState, memo, useMemo } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import QRCode from 'qrcode';
import { supabase } from '../../lib/supabase';
import { useAdminStore } from '../../lib/store';

// ==========================================
// COLORED QR COMPONENT (Optimized for Scanning)
// ==========================================
const QRCard = memo(({ clue, teamColor, teamName, onEdit, onDelete }) => {
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    let isMounted = true;
    if (clue?.qr_secret_key) {
      const delay = clue.chamber_number * 150;
      const timer = setTimeout(() => {
        QRCode.toDataURL(clue.qr_secret_key, {
          margin: 1,
          scale: 8,
          errorCorrectionLevel: 'H',
          color: {
            dark: teamColor,
            light: '#ffffff'
          }
        }).then(url => {
          if (isMounted) setQrUrl(url);
        }).catch(console.error);
      }, delay);

      return () => {
        isMounted = false;
        clearTimeout(timer);
      };
    }
  }, [clue.qr_secret_key, teamColor, clue.chamber_number]);

  return (
    <div className="flex flex-col sm:flex-row gap-4 p-4 border border-white/10 bg-black rounded-sm shadow-xl relative overflow-hidden">
      {/* Visual indicator on the card side */}
      <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: teamColor }} />

      <div className="shrink-0 bg-white p-2 border-2 rounded-sm mx-auto sm:mx-0" style={{ borderColor: teamColor, minWidth: '104px', minHeight: '104px' }}>
        {qrUrl ? (
          <img src={qrUrl} className="w-20 h-20 block" alt="Seal" />
        ) : (
          <div className="w-20 h-20 bg-white flex items-center justify-center text-[8px] f-b text-black animate-pulse">FORGING...</div>
        )}
      </div>

      <div className="overflow-hidden flex flex-col justify-between w-full text-center sm:text-left">
        <div>
          <div className="flex flex-col sm:flex-row justify-between items-center sm:items-start mb-2 sm:mb-1 gap-2 sm:gap-0">
            <p className="f-b text-[10px] font-black uppercase tracking-widest" style={{ color: teamColor }}>Beacon 0{clue.chamber_number}</p>
            <span className="text-[8px] f-b px-2 py-0.5 rounded-sm border uppercase" style={{ borderColor: teamColor, color: teamColor }}>{teamName}</span>
          </div>
          <p className="f-b text-[10px] text-white opacity-40 truncate uppercase mb-1">{clue.qr_secret_key}</p>
          <p className="f-h text-[12px] text-[#f4e4bc] normal-case leading-tight line-clamp-4 italic whitespace-pre-wrap">"{clue.riddle_text}"</p>
        </div>
        <div className="flex justify-center sm:justify-start gap-4 mt-3 sm:mt-2 no-print">
          <button onClick={() => onEdit(clue)} className="text-[10px] f-b text-[#d4af37] underline uppercase font-bold">Edit</button>
          <button onClick={() => onDelete(clue.id)} className="text-[10px] f-b text-red-500 underline uppercase font-bold">Del</button>
          {qrUrl && (
            <a href={qrUrl} download={`QR_${teamName}_B${clue.chamber_number}.png`} className="text-[10px] f-b text-green-500 underline uppercase font-bold">Save PNG</a>
          )}
        </div>
      </div>
    </div>
  );
});

export default function RiddleForge() {
  const [clues, setClues] = useState([]);
  const [teams, setTeams] = useState([]);
  const [expandedTeam, setExpandedTeam] = useState('PUBLIC');
  const [form, setForm] = useState({ id: null, teamId: 'ALL', chamber: 1, key: '', riddle: '' });

  const router = useRouter();
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const logoutAdmin = useAdminStore((s) => s.logoutAdmin);

  useEffect(() => {
    if (!isAdmin) { router.push('/'); return; }
    fetchData();
  }, [isAdmin]);

  const fetchData = async () => {
    const { data: cluesData } = await supabase.from('clue_settings').select('*').order('chamber_number', { ascending: true });
    const { data: teamsData } = await supabase.from('teams').select('id, team_name').order('created_at', { ascending: true });
    setClues(cluesData || []);
    setTeams(teamsData || []);
  };

  const teamColorMap = useMemo(() => {
    const boldPresets = [
      '#0066FF', '#FF0033', '#009900', '#CC00CC', '#FF6600',
      '#003399', '#CC0000', '#006600', '#6600CC', '#993300',
      '#009999', '#FF0099', '#003300', '#330066', '#663300',
      '#006666', '#990000', '#336600', '#9900CC', '#CC6600',
      '#0000FF', '#00CC66', '#FF00FF', '#333333', '#666600'
    ];
    const map = { 'ALL': '#d4af37' };
    teams.forEach((team, index) => {
      map[team.id] = boldPresets[index % boldPresets.length];
    });
    return map;
  }, [teams]);

  // ==========================================
  // ROBUST MULTILINE CSV PARSER
  // ==========================================
  const parseCSV = (text) => {
    const result = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"' && inQuotes && nextChar === '"') {
        cell += '"'; i++;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(cell); cell = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') i++;
        row.push(cell); result.push(row); row = []; cell = '';
      } else {
        cell += char;
      }
    }
    if (cell || row.length > 0) {
      row.push(cell); result.push(row);
    }
    return result;
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const text = event.target.result;
        const allRows = parseCSV(text);

        if (allRows[0][0].toLowerCase().includes('id')) allRows.shift();

        const uploadRows = [];
        for (const cols of allRows) {
          if (cols.length < 2 || !cols[0]) continue;

          const teamId = cols[0].trim();
          const teamName = cols[1].trim();
          const safePrefix = teamName.toUpperCase().replace(/\s/g, '_');

          const sequence = [
            { team_id: teamId, chamber_number: 1, qr_secret_key: `${safePrefix}_START`, riddle_text: cols[2] },
            { team_id: teamId, chamber_number: 2, qr_secret_key: `${safePrefix}_R1`, riddle_text: cols[3] },
            { team_id: teamId, chamber_number: 3, qr_secret_key: `${safePrefix}_PAUSE`, riddle_text: "⚓ CAVE TWO: PAUSE REACHED" },
            { team_id: teamId, chamber_number: 4, qr_secret_key: `${safePrefix}_RESUME`, riddle_text: cols[4] },
            { team_id: teamId, chamber_number: 5, qr_secret_key: `${safePrefix}_R3`, riddle_text: cols[5] }
          ];
          uploadRows.push(...sequence);
        }

        if (uploadRows.length > 0) {
          const { error } = await supabase.from('clue_settings').upsert(uploadRows);
          if (error) throw error;
          fetchData();
          alert("SEALS FORGED SUCCESSFULLY!");
        }
      } catch (err) {
        console.error(err);
        alert("Upload error. Check CSV formatting.");
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  // --- MANUAL FORGE FIX: ENSURE SYNC WITH DASHBOARD QUERY ---
  const handleForge = async (e) => {
    e.preventDefault();

    // Dashboard logic looks for NULL or 'ALL'. We force 'ALL' into null for DB consistency.
    const finalTeamId = form.teamId === 'ALL' ? null : form.teamId;

    const payload = {
      team_id: finalTeamId,
      chamber_number: form.chamber,
      qr_secret_key: form.key.trim().toUpperCase(),
      riddle_text: form.riddle
    };

    const { error } = await supabase.from('clue_settings').upsert([form.id ? { id: form.id, ...payload } : payload]);

    if (error) {
      alert("Forge failed: " + error.message);
    } else {
      setForm({ id: null, teamId: 'ALL', chamber: 1, key: '', riddle: '' });
      fetchData();
    }
  };

  // UI Filter: Display clues with no team_id as Public
  const publicClues = clues.filter(c => c.team_id === 'ALL' || c.team_id === null);

  return (
    <div className="min-h-screen bg-[#050505] text-[#f4e4bc] p-2 md:p-12 relative font-sans uppercase overflow-y-auto custom-scroll selection:bg-[#d4af37] selection:text-black">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&family=Space+Mono:wght@400;700&display=swap');
        .f-h { font-family: 'Cinzel', serif; } .f-b { font-family: 'Space Mono', monospace; }
        .gold-glow { text-shadow: 0 0 20px rgba(212, 175, 55, 0.8); }
        .glass-panel { background: rgba(5, 5, 5, 0.8); backdrop-filter: blur(12px); border: 1px solid rgba(212, 175, 55, 0.2); }
        @keyframes scanline { 0% { bottom: 100%; } 100% { bottom: 0%; } }
        .scanner-line { position: fixed; top: 0; left: 0; right: 0; height: 100px; background: linear-gradient(to bottom, transparent, rgba(212, 175, 55, 0.05), transparent); animation: scanline 8s linear infinite; pointer-events: none; z-index: 60; }
        .fog-bg { position: fixed; inset: 0; background: url('/fog.png') repeat-x; opacity: 0.15; animation: floatFog 60s infinite; pointer-events: none; z-index: 1; mix-blend-mode: screen; }
        @keyframes floatFog { 0% { transform: translateX(-5%); } 50% { transform: translateX(5%); } 100% { transform: translateX(-5%); } }
        @media print { .no-print { display: none !important; } body { background: white !important; } }
        @media (max-width: 768px) {
          .mobile-header-stack { flex-direction: column !important; align-items: center !important; text-align: center !important; }
        }
      `}</style>

      <div className="scanner-line no-print" />
      <div className="fog-bg no-print" />
      <div className="fixed inset-0 z-0 opacity-10 grayscale brightness-50 no-print bg-[url('/cave.webp')] bg-cover" />

      <header className="relative z-10 max-w-7xl mx-auto mb-8 md:mb-12 border-b border-[#d4af37]/20 pb-6 md:pb-8 flex flex-col md:flex-row justify-between items-center md:items-end gap-6 no-print mobile-header-stack">
        <div>
          <h1 className="f-h text-4xl md:text-7xl tracking-tighter text-white uppercase leading-none">Seal <span className="text-[#d4af37] gold-glow">Forge</span></h1>
          <nav className="flex justify-center md:justify-start gap-4 md:gap-6 mt-4 f-b text-[10px] md:text-[11px] font-bold">
            <Link href="/admin/dashboard" className="opacity-50 hover:opacity-100 uppercase">Expeditions</Link>
            <button onClick={logoutAdmin} className="text-red-500/60 hover:text-red-500 uppercase">Logout</button>
            <button onClick={() => window.print()} className="text-[#d4af37] underline uppercase font-black">Print Records</button>
          </nav>
        </div>
        <div className="f-b text-[10px] border border-[#d4af37]/30 bg-black px-4 py-2 text-[#d4af37] uppercase">{clues.length} ACTIVE SEALS</div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-8 md:gap-12 relative z-10 max-w-7xl mx-auto pb-32">
        <section className="lg:col-span-4 no-print space-y-6 md:space-y-8">
          <div className="glass-panel p-6 md:p-8 rounded-sm border-dashed border-2 border-[#d4af37]/30 bg-[#d4af37]/5">
            <h2 className="f-h text-xl mb-4 text-[#d4af37] uppercase tracking-widest">Hard-Link Inscription</h2>
            <input type="file" accept=".csv" onChange={handleFileUpload} className="w-full text-[10px] md:text-xs f-b file:bg-[#d4af37] file:border-0 file:px-3 file:py-2 cursor-pointer font-bold" />
            <p className="mt-2 text-[8px] f-b opacity-50 lowercase tracking-widest">Supports multiline quoted CSV UTF-8</p>
          </div>

          <div className="glass-panel p-6 md:p-8 rounded-sm">
            <h2 className="f-h text-xl md:text-2xl mb-6 md:mb-8 text-white uppercase tracking-widest font-black">{form.id ? "▸ Edit" : "▸ Forge"}</h2>
            <form onSubmit={handleForge} className="space-y-4 md:space-y-6">
              <select className="w-full bg-black border border-[#d4af37]/20 p-3 md:p-4 f-h text-sm md:text-base text-white outline-none cursor-pointer" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
                <option value="ALL">PUBLIC (UNIVERSAL)</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.team_name}</option>)}
              </select>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <select className="bg-black border border-[#d4af37]/20 p-3 md:p-4 f-h text-white text-center" value={form.chamber} onChange={(e) => setForm({ ...form, chamber: parseInt(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>B0{n}</option>)}
                </select>
                <input type="text" placeholder="KEY" className="bg-black border border-[#d4af37]/20 p-3 md:p-4 f-b text-[#d4af37] uppercase outline-none font-bold text-sm" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
              </div>
              <textarea rows="4" placeholder="RIDDLE TEXT" className="w-full bg-black border border-[#d4af37]/20 p-3 md:p-4 f-h text-white italic outline-none resize-none font-bold text-sm" value={form.riddle} onChange={(e) => setForm({ ...form, riddle: e.target.value })} />
              <button type="submit" className="w-full py-4 bg-[#d4af37] text-black font-black f-h tracking-widest active:scale-95 transition-transform shadow-xl uppercase">FORGE SEAL</button>
            </form>
          </div>
        </section>

        <section className="lg:col-span-8 space-y-6">
          <h2 className="f-h text-2xl md:text-3xl text-white tracking-[0.3em] uppercase border-b border-[#d4af37]/20 pb-4 font-black text-center md:text-left">Active_Archive</h2>

          <div className="space-y-4">
            {/* PUBLIC SEALS SECTION */}
            <div className="glass-panel rounded-sm overflow-hidden shadow-2xl border-2 border-[#d4af37]/30">
              <button onClick={() => setExpandedTeam(expandedTeam === 'PUBLIC' ? null : 'PUBLIC')} className="w-full p-4 md:p-6 flex justify-between items-center transition-all bg-[#d4af37]/10">
                <span className="f-h text-xl md:text-3xl text-[#d4af37] uppercase tracking-tighter">PUBLIC SEALS (UNIVERSAL)</span>
                <span className="text-[#d4af37] text-xl md:text-2xl font-black">{expandedTeam === 'PUBLIC' ? "−" : "+"}</span>
              </button>
              <AnimatePresence>
                {expandedTeam === 'PUBLIC' && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="p-3 md:p-6 bg-black/60 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 border-t border-[#d4af37]/20">
                    {publicClues.map(clue => (
                      <QRCard key={clue.id} clue={clue} teamColor="#d4af37" teamName="PUBLIC" onEdit={(clue) => { setForm({ id: clue.id, teamId: 'ALL', chamber: clue.chamber_number, key: clue.qr_secret_key, riddle: clue.riddle_text }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} onDelete={async (id) => { if (confirm('Del?')) { await supabase.from('clue_settings').delete().eq('id', id); fetchData(); } }} />
                    ))}
                    {publicClues.length === 0 && <p className="col-span-full text-center f-b text-[10px] opacity-40 py-4 italic">No public seals forged yet.</p>}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* TEAM SPECIFIC SEALS */}
            {teams.map(team => {
              const teamClues = clues.filter(c => String(c.team_id) === String(team.id));
              const color = teamColorMap[team.id] || '#ffffff';
              return (
                <div key={team.id} className="glass-panel rounded-sm overflow-hidden shadow-2xl">
                  <button onClick={() => setExpandedTeam(expandedTeam === team.id ? null : team.id)} className="w-full p-4 md:p-6 flex justify-between items-center transition-all border-l-[4px] md:border-l-[6px]" style={{ borderLeftColor: color }}>
                    <span className="f-h text-xl md:text-3xl text-white uppercase tracking-tighter truncate pr-4" style={{ color: expandedTeam === team.id ? color : 'white' }}>{team.team_name}</span>
                    <span className="text-[#d4af37] text-xl md:text-2xl font-black">{expandedTeam === team.id ? "−" : "+"}</span>
                  </button>
                  <AnimatePresence>
                    {expandedTeam === team.id && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="p-3 md:p-6 bg-black/40 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 border-t border-white/5">
                        {teamClues.map(clue => (
                          <QRCard key={clue.id} clue={clue} teamColor={color} teamName={team.team_name} onEdit={(clue) => { setForm({ id: clue.id, teamId: clue.team_id, chamber: clue.chamber_number, key: clue.qr_secret_key, riddle: clue.riddle_text }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} onDelete={async (id) => { if (confirm('Del?')) { await supabase.from('clue_settings').delete().eq('id', id); fetchData(); } }} />
                        ))}
                        {teamClues.length === 0 && <p className="col-span-full text-center f-b text-[10px] opacity-40 py-4 italic">No seals forged for this crew.</p>}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </section>
      </main>
      <div className="pointer-events-none fixed inset-0 z-40 shadow-[inset_0_0_300px_rgba(0,0,0,1)] opacity-70 no-print" />
    </div>
  );
}