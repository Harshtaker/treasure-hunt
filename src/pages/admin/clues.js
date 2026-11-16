import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import QRCode from 'qrcode';
import { supabase } from '../../lib/supabase';
import { useAdminStore } from '../../lib/store';
import { playSound } from '../../lib/sound';
const BUCKET = 'clue-media';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const LAST_TEAM_ROUND = 5;
const FINAL_ROUND = 6;
const AUDIO = {
  ambience: '/audio/ambience.mp3',
  click: '/audio/ui-click.mp3',
  success: '/audio/scan-success.mp3',
  error: '/audio/wrong-scan.mp3',
};
const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
];
const EMPTY_FORM = {
  id: null,
  teamId: '',
  chamber: 1,
  key: '',
  riddle: '',
  hint: '',
  clueType: 'text',
  mediaPath: '',
  mediaMimeType: '',
  mediaSizeBytes: 0,
};
function hslToHex(h, s = 78, l = 52) {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hue = ((h % 360) + 360) % 360;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  let rgb;
  if (hue < 60) rgb = [chroma, x, 0];
  else if (hue < 120) rgb = [x, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, x];
  else if (hue < 240) rgb = [0, x, chroma];
  else if (hue < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  return `#${rgb.map((value) =>
    Math.round((value + m) * 255).toString(16).padStart(2, '0')
  ).join('').toUpperCase()}`;
}
// One colour per team. All five QR codes of a team use the same colour.
function buildTeamColorMap(teamList) {
  const map = {};
  const goldenAngle = 137.508;
  teamList.forEach((team, index) => {
    map[team.id] = hslToHex((index * goldenAngle + 205) % 360);
  });
  return map;
}
function makeSecret(prefix = 'SEAL') {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`.toUpperCase();
}
function getExtension(file) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext || '') ? ext : 'bin';
}
function MediaPreview({ clue, compact = false }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    if (!clue?.media_path || clue?.clue_type === 'text') {
      setUrl('');
      return;
    }
    if (/^https?:\/\//i.test(clue.media_path)) {
      setUrl(clue.media_path);
      return;
    }
    setLoading(true);
    setError(false);
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(clue.media_path, 3600)
      .then(({ data, error: err }) => {
        if (!active) return;
        if (err || !data?.signedUrl) {
          setError(true);
          setUrl('');
        } else {
          setUrl(data.signedUrl);
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clue?.media_path, clue?.clue_type]);
  if (!clue?.media_path || clue?.clue_type === 'text') {
    return null;
  }
  if (loading) {
    return <p className="text-[10px] text-[#d4af37]/70">Loading signed media preview…</p>;
  }
  if (error) {
    return <p className="text-[10px] text-red-400">Preview unavailable (private bucket access required).</p>;
  }
  if (!url) return null;
  if (clue.clue_type === 'image') {
    return (
      <img
        src={url}
        alt="Clue attachment"
        loading="lazy"
        className={`rounded border border-white/15 object-contain bg-black ${
          compact ? 'max-h-32 max-w-full' : 'max-h-64 w-full'
        }`}
      />
    );
  }
  if (clue.clue_type === 'audio') {
    return (
      <audio controls preload="metadata" src={url} className="w-full">
        Your browser does not support audio playback.
      </audio>
    );
  }
  return null;
}
function QRCard({ clue, team, color, onEdit, onDelete }) {
  const [qrUrl, setQrUrl] = useState('');
  const isFinal = Number(clue.chamber_number) === FINAL_ROUND;
  useEffect(() => {
    let active = true;
    if (!clue?.qr_secret_key) {
      setQrUrl('');
      return undefined;
    }
    QRCode.toDataURL(clue.qr_secret_key, {
      margin: 2,
      scale: 9,
      errorCorrectionLevel: 'H',
      color: {
        dark: color,
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setQrUrl(url);
      })
      .catch((error) => {
        console.error('QR generation failed:', error);
      });
    return () => {
      active = false;
    };
  }, [clue?.qr_secret_key, color]);
  const roundLabel = isFinal
    ? 'FINAL TREASURE'
    : `ROUND ${clue.chamber_number}`;
  const ownerLabel = isFinal
    ? 'SHARED FINAL QR'
    : (team?.team_name || 'Unknown team');
  return (
    <article className="relative flex flex-col gap-4 overflow-hidden forge-panel rounded-xl p-4 shadow-xl sm:flex-row">
      <div
        className="absolute left-0 top-0 h-full w-1"
        style={{ backgroundColor: color }}
      />
      <div
        className="mx-auto flex h-[132px] w-[132px] shrink-0 items-center justify-center rounded-lg border-2 bg-white p-2 sm:mx-0"
        style={{ borderColor: color }}
      >
        {qrUrl ? (
          <img
            src={qrUrl}
            className="block h-full w-full"
            alt={`${roundLabel} QR`}
          />
        ) : (
          <span className="text-[9px] font-bold text-black">
            GENERATING…
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between text-center sm:text-left">
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-center gap-2 sm:justify-between">
            <p
              className="font-mono text-[10px] font-black uppercase tracking-[.18em]"
              style={{ color }}
            >
              {roundLabel}
            </p>
            <span
              className="rounded-full border px-3 py-1 text-[9px] font-bold uppercase tracking-wider"
              style={{
                borderColor: color,
                color,
              }}
            >
              {ownerLabel}
            </span>
          </div>
          <p className="mb-2 break-all font-mono text-[9px] text-white/35">
            {clue.qr_secret_key}
          </p>
          <span className="mb-2 inline-block rounded border border-white/15 px-2 py-1 text-[9px] uppercase text-[#d4af37]">
            {clue.clue_type || 'text'} clue
          </span>
          {clue.riddle_text ? (
            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[#f4e4bc]">
              {clue.riddle_text}
            </p>
          ) : (
            <p className="text-xs italic text-white/40">
              Media-only clue
            </p>
          )}
          {clue.hint_text && (
            <div className="mt-3 rounded-lg border border-cyan-300/20 bg-cyan-950/20 p-3">
              <p className="mb-1 font-mono text-[9px] font-bold tracking-widest text-cyan-200">
                TEAM HINT
              </p>
              <p className="whitespace-pre-wrap text-xs text-cyan-50/80">
                {clue.hint_text}
              </p>
            </div>
          )}
          {clue.clue_type !== 'text' && (
            <div className="mt-3">
              <MediaPreview clue={clue} compact />
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-4 sm:justify-start">
          <button
            type="button"
            onClick={() => onEdit(clue)}
            className="text-[10px] font-bold uppercase text-[#d4af37] underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(clue)}
            className="text-[10px] font-bold uppercase text-red-400 underline"
          >
            Delete
          </button>
          {qrUrl && (
            <a
              href={qrUrl}
              download={`TREASURE_HUNT_${isFinal ? 'FINAL_SHARED' : `${(team?.team_name || 'TEAM').replace(/[^a-z0-9]/gi, '_')}_R${clue.chamber_number}`}.png`}
              className="text-[10px] font-bold uppercase text-emerald-400 underline"
            >
              Download QR PNG
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
export default function RiddleForge() {
  const [clues, setClues] = useState([]);
  const [teams, setTeams] = useState([]);
  const [expandedTeam, setExpandedTeam] = useState('FINAL');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [selectedFile, setSelectedFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [csvBusy, setCsvBusy] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const ambienceRef = useRef(null);
  const clickRef = useRef(null);
  const successRef = useRef(null);
  const errorRef = useRef(null);
  // Audio initialization
  useEffect(() => {
    const createAudio = (src, loop = false, volume = 0.35) => {
      const audio = new Audio(src);
      audio.loop = loop;
      audio.volume = volume;
      audio.preload = 'auto';
      return audio;
    };
    ambienceRef.current = createAudio(AUDIO.ambience, true, 0.18);
    clickRef.current = createAudio(AUDIO.click, false, 0.35);
    successRef.current = createAudio(AUDIO.success, false, 0.45);
    errorRef.current = createAudio(AUDIO.error, false, 0.4);
    return () => {
      [
        ambienceRef.current,
        clickRef.current,
        successRef.current,
        errorRef.current,
      ].forEach((audio) => {
        if (!audio) return;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      });
      ambienceRef.current = null;
      clickRef.current = null;
      successRef.current = null;
      errorRef.current = null;
    };
  }, []);
  // Background ambience control
  useEffect(() => {
    const audio = ambienceRef.current;
    if (!audio) return;
    if (soundEnabled) {
      audio.play().catch(() => { });
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [soundEnabled]);
  const playEffect = useCallback((type = 'click') => {
    if (!soundEnabled) return;
    playSound(type, soundEnabled);
  }, [soundEnabled]);
  const router = useRouter();
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const logoutAdmin = useAdminStore((s) => s.logoutAdmin);
  const fetchData = useCallback(async () => {
    const [clueResult, teamResult] = await Promise.all([
      supabase
        .from('clue_settings')
        .select('*')
        .order('chamber_number', { ascending: true }),
      supabase
        .from('teams')
        .select('id, team_name')
        .order('created_at', { ascending: true }),
    ]);
    if (clueResult.error || teamResult.error) {
      console.error(clueResult.error || teamResult.error);
      setNotice(
        `Could not load records: ${(clueResult.error || teamResult.error).message
        }`
      );
      return;
    }
    setClues(clueResult.data || []);
    setTeams(teamResult.data || []);
  }, []);
  useEffect(() => {
    if (!isAdmin) {
      router.replace('/');
      return;
    }
    void fetchData();
  }, [isAdmin, router, fetchData]);
  const finalClues = useMemo(
    () =>
      clues.filter(
        (clue) =>
          Number(clue.chamber_number) === FINAL_ROUND &&
          (clue.team_id == null || clue.team_id === 'ALL')
      ),
    [clues]
  );
  const finalClue = finalClues[0] || null;
  const teamColorMap = useMemo(
    () => buildTeamColorMap(teams),
    [teams]
  );
  const cluesByTeam = useMemo(() => {
    const grouped = {};
    teams.forEach((team) => {
      grouped[team.id] = clues
        .filter(
          (clue) =>
            String(clue.team_id) === String(team.id) &&
            Number(clue.chamber_number) <= LAST_TEAM_ROUND
        )
        .sort(
          (a, b) =>
            Number(a.chamber_number) - Number(b.chamber_number)
        );
    });
    return grouped;
  }, [clues, teams]);
  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    setSelectedFile(null);
  };
  const startNewTeamClue = (teamId, round) => {
    setForm({
      ...EMPTY_FORM,
      teamId,
      chamber: round,
      key: makeSecret(`TEAM_R${round}`),
    });
    setSelectedFile(null);
    setNotice('');
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };
  const startFinalClue = () => {
    setForm({
      ...EMPTY_FORM,
      teamId: 'ALL',
      chamber: FINAL_ROUND,
      key: finalClue?.qr_secret_key || makeSecret('FINAL_TREASURE'),
      id: finalClue?.id || null,
      riddle: finalClue?.riddle_text || '',
      hint: finalClue?.hint_text || '',
      clueType: finalClue?.clue_type || 'text',
      mediaPath: finalClue?.media_path || '',
      mediaMimeType: finalClue?.media_mime_type || '',
      mediaSizeBytes: finalClue?.media_size_bytes || 0,
    });
    setSelectedFile(null);
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };
  const handleEdit = (clue) => {
    setForm({
      id: clue.id,
      teamId: clue.team_id || 'ALL',
      chamber: Number(clue.chamber_number),
      key: clue.qr_secret_key || '',
      riddle: clue.riddle_text || '',
      hint: clue.hint_text || '',
      clueType: clue.clue_type || 'text',
      mediaPath: clue.media_path || '',
      mediaMimeType: clue.media_mime_type || '',
      mediaSizeBytes: clue.media_size_bytes || 0,
    });
    setSelectedFile(null);
    setNotice('Editing existing clue.');
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };
  const parseCSV = (text) => {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"' && quoted && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === ',' && !quoted) {
        row.push(cell);
        cell = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') i += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  };
  // CSV columns:
  // team_id,team_name,r1_clue,r1_hint,...,r5_clue,r5_hint
  const handleCSVImport = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsvBusy(true);
    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const rows = parseCSV(
          String(loadEvent.target.result || '')
        );
        if (rows[0]?.[0]?.toLowerCase().includes('team')) {
          rows.shift();
        }
        const records = [];
        for (const cols of rows) {
          const teamId = String(cols[0] || '').trim();
          if (!teamId) continue;
          for (let round = 1; round <= LAST_TEAM_ROUND; round += 1) {
            const clueText = String(
              cols[2 + (round - 1) * 2] || ''
            ).trim();
            const hintText = String(
              cols[3 + (round - 1) * 2] || ''
            ).trim();
            if (!clueText && !hintText) continue;
            records.push({
              team_id: teamId,
              chamber_number: round,
              qr_secret_key: makeSecret(`TEAM_R${round}`),
              riddle_text: clueText,
              hint_text: hintText,
              clue_type: 'text',
              media_path: null,
              media_mime_type: null,
              media_size_bytes: null,
            });
          }
        }
        if (!records.length) {
          throw new Error('No valid clue rows found in CSV.');
        }
        const { error } = await supabase
          .from('clue_settings')
          .upsert(records, {
            onConflict: 'team_id,chamber_number',
          });
        if (error) throw error;
        await fetchData();
        setNotice(
          `Imported ${records.length} team-round clue records. Final QR was not changed.`
        );
      } catch (error) {
        console.error(error);
        setNotice(`CSV import failed: ${error.message}`);
      } finally {
        setCsvBusy(false);
        event.target.value = '';
      }
    };
    reader.onerror = () => {
      setNotice('Could not read the CSV file.');
      setCsvBusy(false);
      event.target.value = '';
    };
    reader.readAsText(file, 'UTF-8');
  };
  const handleSave = async (event) => {
    event.preventDefault();
    setNotice('');
    const isFinal = Number(form.chamber) === FINAL_ROUND;
    if (isFinal && form.teamId !== 'ALL') {
      setNotice(
        'Final round must be shared. It cannot belong to one team.'
      );
      return;
    }
    if (!isFinal && (!form.teamId || form.teamId === 'ALL')) {
      setNotice(
        'Rounds 1–5 must be assigned to one specific team.'
      );
      return;
    }
    if (!form.key.trim()) {
      setNotice('QR secret key is required.');
      return;
    }
    if (form.clueType === 'text' && !form.riddle.trim()) {
      setNotice(
        'Enter clue text or choose an image/audio clue.'
      );
      return;
    }
    if (
      form.clueType !== 'text' &&
      !selectedFile &&
      !form.mediaPath
    ) {
      setNotice('Choose a media file for this clue.');
      return;
    }
    if (selectedFile) {
      if (!ACCEPTED_TYPES.includes(selectedFile.type)) {
        setNotice(
          'Unsupported file type. Choose a supported image or audio file.'
        );
        return;
      }
      if (selectedFile.size > MAX_FILE_SIZE) {
        setNotice('File is too large. Maximum size is 10 MB.');
        return;
      }
      if (
        form.clueType === 'image' &&
        !selectedFile.type.startsWith('image/')
      ) {
        setNotice('For an image clue, choose an image file.');
        return;
      }
      if (
        form.clueType === 'audio' &&
        !selectedFile.type.startsWith('audio/')
      ) {
        setNotice('For an audio clue, choose an audio file.');
        return;
      }
    }
    setBusy(true);
    let uploadedPath = form.mediaPath || null;
    try {
      if (selectedFile) {
        const owner = isFinal ? 'final' : form.teamId;
        const uniqueName =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        uploadedPath =
          `${owner}/round-${form.chamber}/${uniqueName}.${getExtension(selectedFile)}`;
        const { error: uploadError } = await supabase
          .storage
          .from(BUCKET)
          .upload(uploadedPath, selectedFile, {
            cacheControl: '3600',
            contentType: selectedFile.type,
            upsert: false,
          });
        if (uploadError) throw uploadError;
      }
      const payload = {
        team_id: isFinal ? null : form.teamId,
        chamber_number: Number(form.chamber),
        qr_secret_key: form.key.trim().toUpperCase(),
        riddle_text: form.riddle.trim(),
        hint_text: form.hint.trim(),
        clue_type: form.clueType,
        media_path: form.clueType === 'text' ? null : uploadedPath,
        media_mime_type:
          form.clueType === 'text'
            ? null
            : (selectedFile?.type || form.mediaMimeType || null),
        media_size_bytes:
          form.clueType === 'text'
            ? null
            : (selectedFile?.size || form.mediaSizeBytes || null),
      };
      // Keep only one shared final QR.
      let query;
      if (isFinal && finalClue && !form.id) {
        query = supabase
          .from('clue_settings')
          .update(payload)
          .eq('id', finalClue.id);
      } else if (form.id) {
        query = supabase
          .from('clue_settings')
          .update(payload)
          .eq('id', form.id);
      } else {
        query = supabase
          .from('clue_settings')
          .insert(payload);
      }
      const { error: saveError } = await query;
      if (saveError) throw saveError;
      if (
        form.mediaPath &&
        uploadedPath !== form.mediaPath &&
        form.clueType !== 'text'
      ) {
        const { error: cleanupError } = await supabase
          .storage
          .from(BUCKET)
          .remove([form.mediaPath]);
        if (cleanupError) {
          console.warn('Old media cleanup failed:', cleanupError);
        }
      }
      resetForm();
      await fetchData();
      setNotice(
        isFinal
          ? 'The single shared final QR has been saved.'
          : 'Team clue, QR and hint saved successfully.'
      );
      playEffect('success');
    } catch (error) {
      console.error(error);
      setNotice(
        `Save failed: ${error.message || 'Unknown error'}`
      );
      playEffect('error');
      if (
        selectedFile &&
        uploadedPath &&
        uploadedPath !== form.mediaPath
      ) {
        await supabase.storage
          .from(BUCKET)
          .remove([uploadedPath]);
      }
    } finally {
      setBusy(false);
    }
  };
  const handleDelete = async (clue) => {
    const isFinal =
      Number(clue.chamber_number) === FINAL_ROUND;
    const label = isFinal
      ? 'the shared FINAL QR'
      : `Round ${clue.chamber_number}`;
    if (
      !window.confirm(
        `Delete ${label}? This also removes its saved clue and hint.`
      )
    ) {
      return;
    }
    const { error } = await supabase
      .from('clue_settings')
      .delete()
      .eq('id', clue.id);
    if (error) {
      setNotice(`Delete failed: ${error.message}`);
      playEffect('error');
      return;
    }
    if (clue.media_path) {
      const { error: storageError } = await supabase
        .storage
        .from(BUCKET)
        .remove([clue.media_path]);
      if (storageError) {
        console.warn('Storage cleanup failed:', storageError);
      }
    }
    if (form.id === clue.id) resetForm();
    await fetchData();
    setNotice(`${label} deleted.`);
    playEffect('success');
  };
  const publicClues = clues.filter(
    (clue) => clue.team_id == null || clue.team_id === 'ALL'
  );
  if (!isAdmin) return null;
  return (
    <div className="hunt-page relative isolate min-h-screen overflow-hidden bg-[#080b0c] text-[#f4e8cf]">
      {/* CINEMATIC BACKGROUND */}
      <div className="hunt-backdrop" aria-hidden="true">
        <img
          src="/login-bg.png"
          alt=""
          className="hunt-backdrop-image"
          onError={(event) => {
            const image = event.currentTarget;
            if (image.dataset.fallbackApplied === 'true') {
              image.style.display = 'none';
              return;
            }
            image.dataset.fallbackApplied = 'true';
            image.src = '/cave.png';
          }}
        />
        <div className="hunt-backdrop-overlay" />
        <div className="hunt-grid" />
      </div>
      <div className="relative z-10 min-h-screen p-3 md:p-8">
        <style jsx global>{`
          @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&family=Space+Mono:wght@400;700&display=swap');
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
          :root {
            color-scheme: dark;
          }
          html,
          body {
            background: #080b0c;
          }
          .hunt-page {
            isolation: isolate;
            background: #080b0c;
          }
          .hunt-backdrop {
            position: fixed;
            inset: 0;
            z-index: -1;
            overflow: hidden;
            pointer-events: none;
          }
          .hunt-backdrop-image {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            object-position: center;
            filter: brightness(.48) saturate(.82);
            transform: scale(1.025);
          }
          .hunt-backdrop-overlay {
            position: absolute;
            inset: 0;
            background:
              linear-gradient(
                180deg,
                rgba(3,7,8,.48),
                rgba(3,7,8,.78)
              ),
              linear-gradient(
                90deg,
                rgba(5,8,8,.48),
                transparent 55%,
                rgba(5,8,8,.35)
              );
          }
          .hunt-grid {
            position: absolute;
            inset: 0;
            opacity: .12;
            background-image:
              linear-gradient(
                rgba(212,175,55,.08) 1px,
                transparent 1px
              ),
              linear-gradient(
                90deg,
                rgba(212,175,55,.08) 1px,
                transparent 1px
              );
            background-size: 65px 65px;
          }
          .forge-heading {
            font-family: 'Cinzel', serif;
          }
          .forge-mono {
            font-family: 'Space Mono', monospace;
          }
          .sound-toggle {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            border: 1px solid rgba(212,175,55,.35);
            border-radius: 999px;
            padding: 12px 20px;
            background: rgba(5,8,8,.65);
            color: #e6c787;
            font-family: 'Space Mono', monospace;
            font-size: 10px;
            letter-spacing: .12em;
            transition: all .25s ease;
          }
          .sound-toggle:hover {
            background: rgba(212,175,55,.13);
            border-color: #d4af37;
            box-shadow: 0 0 20px rgba(212,175,55,.12);
          }
          .forge-panel {
            background:
              linear-gradient(
                145deg,
                rgba(38,29,19,.91),
                rgba(7,12,13,.88)
              );
            border: 1px solid rgba(212,175,55,.28);
            box-shadow: 0 18px 60px rgba(0,0,0,.28);
            backdrop-filter: blur(14px);
          }
          .forge-card {
            background:
              linear-gradient(
                145deg,
                rgba(15,32,34,.92),
                rgba(5,12,14,.92)
              );
            border: 1px solid rgba(130,190,190,.22);
            box-shadow: 0 18px 55px rgba(0,0,0,.24);
            backdrop-filter: blur(12px);
          }
          .forge-input {
            width: 100%;
            background: rgba(5,7,7,.85);
            border: 1px solid rgba(212,175,55,.25);
            padding: 12px;
            color: #f4e4bc;
            border-radius: 7px;
            outline: none;
          }
          .forge-input:focus {
            border-color: #d4af37;
            box-shadow: 0 0 0 2px rgba(212,175,55,.1);
          }
          .forge-input option {
            background: #080b0c;
          }
          @media (prefers-reduced-motion: reduce) {
            *,
            *::before,
            *::after {
              animation-duration: .01ms !important;
              transition-duration: .01ms !important;
            }
          }
        `}</style>
        {/* HEADER */}
        <header className="relative z-10 mx-auto mb-8 flex max-w-7xl flex-col items-center justify-between gap-5 border-b border-[#d4af37]/20 pb-7 md:flex-row md:items-end">
          <div>
            <img
              src="/treasure-hunt-horizontal.png"
              alt="Treasure Hunt 2K26"
              className="mb-4 h-auto max-h-14 w-full max-w-[250px] object-contain object-left"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
            <p className="forge-mono mb-2 text-[9px] tracking-[.25em] text-[#d4af37]/70">
              TREASURE HUNT 2K26 · ADMIN CONTROL
            </p>
            <h1 className="forge-heading text-4xl font-black tracking-tight text-white md:text-6xl">
              SEAL <span className="text-[#d4af37]">FORGE</span>
            </h1>
            <nav className="forge-mono mt-4 flex flex-wrap justify-center gap-5 text-[10px] md:justify-start">
              <Link
                href="/admin/dashboard"
                className="text-white/65 hover:text-white"
              >
                Command Deck
              </Link>
              <button
                type="button"
                onClick={() => logoutAdmin()}
                className="text-red-400"
              >
                Logout
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="text-[#d4af37] underline"
              >
                Print Records
              </button>
            </nav>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setSoundEnabled((value) => !value);
                playEffect('click');
              }}
              aria-pressed={soundEnabled}
              className="sound-toggle"
            >
              <span>{soundEnabled ? '♫' : '♪'}</span>
              {soundEnabled ? 'SOUND ON' : 'SOUND OFF'}
            </button>
            <div className="forge-mono border border-[#d4af37]/30 px-4 py-3 text-center text-xs text-[#d4af37]">
              {clues.length} SAVED CLUES / QR
            </div>
          </div>
        </header>
        {/* NOTIFICATION */}
        {notice && (
          <div
            role="status"
            className="mx-auto mb-6 max-w-7xl rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10 p-3 text-sm text-[#f4e4bc]"
          >
            {notice}
          </div>
        )}
        <main className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-8 pb-24 lg:grid-cols-12">
          {/* LEFT SIDE: CLUE CREATION */}
          <section className="space-y-6 lg:col-span-4">
            {/* CSV IMPORT */}
            <div className="forge-panel rounded-xl border-dashed border-[#d4af37]/40 p-5">
              <h2 className="forge-heading mb-2 text-xl text-[#d4af37]">
                Bulk Team Import
              </h2>
              <p className="mb-3 text-[10px] leading-5 text-white/50">
                CSV columns: team_id, team_name, r1_clue, r1_hint,
                r2_clue, r2_hint … r5_clue, r5_hint.
                Import creates team-specific rounds 1–5.
                It never creates or overwrites the shared final QR.
              </p>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleCSVImport}
                disabled={csvBusy}
                className="forge-mono w-full text-xs file:mr-3 file:border-0 file:bg-[#d4af37] file:px-3 file:py-2 file:font-bold file:text-black"
              />
              {csvBusy && (
                <p className="mt-2 text-xs text-[#d4af37]">
                  IMPORTING…
                </p>
              )}
            </div>
            {/* CLUE FORM */}
            <div className="forge-panel rounded-xl p-5 md:p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="forge-mono text-[9px] tracking-[.2em] text-[#d4af37]">
                    {Number(form.chamber) === FINAL_ROUND
                      ? 'ONE SHARED QR'
                      : 'TEAM-SPECIFIC QR'}
                  </p>
                  <h2 className="forge-heading mt-1 text-xl text-white">
                    {form.id
                      ? 'Edit Clue & Hint'
                      : 'Forge Clue & Hint'}
                  </h2>
                </div>
                {form.id && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="text-[9px] text-white/50 underline"
                  >
                    NEW
                  </button>
                )}
              </div>
              <form onSubmit={handleSave} className="space-y-4">
                {/* TEAM */}
                <div>
                  <label className="mb-2 block text-xs text-white/60">
                    QR owner
                  </label>
                  <select
                    className="forge-input text-sm"
                    value={form.teamId}
                    onChange={(event) =>
                      setForm((old) => ({
                        ...old,
                        teamId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select a team</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.team_name}
                      </option>
                    ))}
                    <option value="ALL">
                      SHARED FINAL QR (ALL TEAMS)
                    </option>
                  </select>
                </div>
                {/* ROUND AND TYPE */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-2 block text-xs text-white/60">
                      Round
                    </label>
                    <select
                      className="forge-input text-sm"
                      value={form.chamber}
                      onChange={(event) => {
                        const chamber = Number(event.target.value);
                        setForm((old) => ({
                          ...old,
                          chamber,
                          teamId:
                            chamber === FINAL_ROUND
                              ? 'ALL'
                              : (old.teamId === 'ALL' ? '' : old.teamId),
                          key: old.id
                            ? old.key
                            : makeSecret(
                              chamber === FINAL_ROUND
                                ? 'FINAL_TREASURE'
                                : `TEAM_R${chamber}`
                            ),
                        }));
                      }}
                    >
                      {[1, 2, 3, 4, 5, 6].map((round) => (
                        <option key={round} value={round}>
                          {round === FINAL_ROUND
                            ? 'FINAL · SHARED'
                            : `ROUND ${round}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-xs text-white/60">
                      Clue type
                    </label>
                    <select
                      className="forge-input text-sm"
                      value={form.clueType}
                      onChange={(event) => {
                        setForm((old) => ({
                          ...old,
                          clueType: event.target.value,
                        }));
                        setSelectedFile(null);
                      }}
                    >
                      <option value="text">Text</option>
                      <option value="image">Image</option>
                      <option value="audio">Audio</option>
                    </select>
                  </div>
                </div>
                {/* ROUND INFORMATION */}
                {Number(form.chamber) === FINAL_ROUND ? (
                  <div className="rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10 p-3 text-xs leading-5 text-[#f4e4bc]/80">
                    This is the only shared final QR.
                    Every team scans the same code.
                    The first successful scan must finish the entire hunt;
                    the player-side scan flow and global game-state lock
                    must be enabled for that rule.
                  </div>
                ) : (
                  <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs leading-5 text-white/55">
                    Rounds 1–5 require a specific team.
                    Each team gets its own secret QR and its own clue
                    and hint for every round.
                  </div>
                )}
                {/* QR KEY */}
                <div>
                  <label className="mb-2 block text-xs text-white/60">
                    QR secret key
                  </label>
                  <div className="flex gap-2">
                    <input
                      required
                      className="forge-input forge-mono min-w-0 flex-1 text-xs uppercase text-[#d4af37]"
                      value={form.key}
                      onChange={(event) =>
                        setForm((old) => ({
                          ...old,
                          key: event.target.value,
                        }))
                      }
                      placeholder="GENERATED SECRET KEY"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setForm((old) => ({
                          ...old,
                          key: makeSecret(
                            Number(old.chamber) === FINAL_ROUND
                              ? 'FINAL_TREASURE'
                              : `TEAM_R${old.chamber}`
                          ),
                        }));
                        playEffect('click');
                      }}
                      className="shrink-0 rounded border border-[#d4af37]/30 px-3 text-[9px] text-[#d4af37]"
                    >
                      REGEN
                    </button>
                  </div>
                </div>
                {/* RIDDLE */}
                <div>
                  <label className="mb-2 block text-xs text-white/60">
                    Clue / Riddle text
                  </label>
                  <textarea
                    rows={4}
                    className="forge-input resize-y text-sm"
                    value={form.riddle}
                    onChange={(event) =>
                      setForm((old) => ({
                        ...old,
                        riddle: event.target.value,
                      }))
                    }
                    placeholder="Write the clue that appears after scanning this QR…"
                  />
                </div>
                {/* HINT */}
                <div>
                  <label className="mb-2 block text-xs text-cyan-200">
                    Hint shown on team dashboard
                  </label>
                  <textarea
                    rows={3}
                    className="forge-input resize-y border-cyan-300/20 text-sm focus:border-cyan-300"
                    value={form.hint}
                    onChange={(event) =>
                      setForm((old) => ({
                        ...old,
                        hint: event.target.value,
                      }))
                    }
                    placeholder="Write this round's hint. The team can choose to reveal it once…"
                  />
                  <p className="mt-1 text-[9px] text-white/40">
                    Hint is saved against this exact team and round.
                  </p>
                </div>
                {/* MEDIA UPLOAD */}
                {form.clueType !== 'text' && (
                  <div className="space-y-3 rounded-lg border border-[#d4af37]/20 p-4">
                    <label className="block text-xs text-[#d4af37]">
                      {form.clueType === 'image'
                        ? 'Choose image'
                        : 'Choose audio file'}
                    </label>
                    <input
                      type="file"
                      accept={
                        form.clueType === 'image'
                          ? 'image/jpeg,image/png,image/webp'
                          : 'audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav'
                      }
                      onChange={(event) =>
                        setSelectedFile(event.target.files?.[0] || null)
                      }
                      className="w-full text-xs text-white file:mr-3 file:border-0 file:bg-[#d4af37] file:px-3 file:py-2 file:font-bold file:text-black"
                    />
                    <p className="text-[10px] text-white/45">
                      Maximum 10 MB. Leave empty to keep the current attachment.
                    </p>
                    {selectedFile && (
                      <p className="break-all text-xs text-emerald-300">
                        Selected: {selectedFile.name} (
                        {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                      </p>
                    )}
                    {!selectedFile && form.mediaPath && (
                      <MediaPreview
                        clue={{
                          clue_type: form.clueType,
                          media_path: form.mediaPath,
                        }}
                      />
                    )}
                  </div>
                )}
                {/* SAVE */}
                <button
                  type="submit"
                  disabled={busy}
                  className="forge-heading w-full rounded-lg bg-[#d4af37] py-4 font-black tracking-widest text-black transition hover:bg-[#f4e4bc] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy
                    ? 'SAVING…'
                    : form.id
                      ? 'UPDATE CLUE + HINT'
                      : 'SAVE CLUE + GENERATE QR'}
                </button>
              </form>
            </div>
          </section>
          {/* RIGHT SIDE: QR ARCHIVE */}
          <section className="space-y-6 lg:col-span-8">
            {/* FINAL QR */}
            <div className="forge-panel overflow-hidden rounded-xl border border-[#d4af37]/40">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d4af37]/20 p-4 md:p-5">
                <div>
                  <p className="forge-mono text-[9px] tracking-[.2em] text-[#d4af37]">
                    ONE QR FOR EVERY CREW
                  </p>
                  <h2 className="forge-heading mt-1 text-xl text-white md:text-2xl">
                    FINAL TREASURE SEAL
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    startFinalClue();
                    playEffect('click');
                  }}
                  className="rounded-lg border border-[#d4af37]/50 bg-[#d4af37]/15 px-4 py-2 text-[9px] font-bold tracking-wider text-[#e8c76f]"
                >
                  {finalClue ? 'EDIT FINAL QR' : 'CREATE FINAL QR'}
                </button>
              </div>
              <div className="p-3 md:p-5">
                {finalClue ? (
                  <QRCard
                    clue={finalClue}
                    team={null}
                    color="#D4AF37"
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                ) : (
                  <p className="py-8 text-center text-xs text-white/45">
                    No final QR created yet. Create one shared QR for all teams.
                  </p>
                )}
                {finalClues.length > 1 && (
                  <p className="mt-3 rounded border border-red-400/30 bg-red-950/20 p-3 text-xs text-red-200">
                    Warning: multiple shared final rows already exist in the database.
                    Keep only one final row before the live game.
                  </p>
                )}
              </div>
            </div>
            {/* TEAM QR ARCHIVE */}
            <div className="flex items-end justify-between border-b border-[#d4af37]/20 pb-4">
              <div>
                <p className="forge-mono text-[9px] tracking-[.2em] text-[#d4af37]/70">
                  INDIVIDUAL CREW SEALS
                </p>
                <h2 className="forge-heading mt-1 text-2xl font-black tracking-widest text-white md:text-3xl">
                  TEAM QR ARCHIVE
                </h2>
              </div>
              <span className="forge-mono text-[9px] text-white/40">
                {teams.length} TEAMS
              </span>
            </div>
            <div className="space-y-4">
              {teams.map((team) => {
                const color =
                  teamColorMap[team.id] || '#D4AF37';
                const teamClues =
                  cluesByTeam[team.id] || [];
                const isExpanded =
                  expandedTeam === team.id;
                return (
                  <div
                    key={team.id}
                    className="overflow-hidden forge-card rounded-xl"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedTeam(
                          isExpanded ? null : team.id
                        );
                        playEffect('click');
                      }}
                      className="flex w-full items-center justify-between gap-3 border-l-4 p-4 text-left md:p-5"
                      style={{
                        borderLeftColor: color,
                      }}
                    >
                      <span className="min-w-0">
                        <span className="forge-heading block truncate text-lg text-white md:text-xl">
                          {team.team_name}
                        </span>
                        <span
                          className="forge-mono mt-1 block text-[9px]"
                          style={{ color }}
                        >
                          {teamClues.length}/5 TEAM ROUNDS FORGED
                        </span>
                      </span>
                      <span
                        className="text-2xl"
                        style={{ color }}
                      >
                        {isExpanded ? '−' : '+'}
                      </span>
                    </button>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{
                            opacity: 0,
                            height: 0,
                          }}
                          animate={{
                            opacity: 1,
                            height: 'auto',
                          }}
                          exit={{
                            opacity: 0,
                            height: 0,
                          }}
                          className="border-t border-white/10 p-3 md:p-5"
                        >
                          {/* ROUND BUTTONS */}
                          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                            {[1, 2, 3, 4, 5].map((round) => {
                              const existing = teamClues.find(
                                (clue) =>
                                  Number(clue.chamber_number) === round
                              );
                              return (
                                <button
                                  key={round}
                                  type="button"
                                  onClick={() => {
                                    if (existing) {
                                      handleEdit(existing);
                                    } else {
                                      startNewTeamClue(team.id, round);
                                    }
                                    playEffect('click');
                                  }}
                                  className="rounded-lg border px-3 py-3 text-left transition hover:bg-white/5"
                                  style={{
                                    borderColor: `${color}66`,
                                  }}
                                >
                                  <span
                                    className="forge-mono block text-[9px]"
                                    style={{ color }}
                                  >
                                    ROUND {round}
                                  </span>
                                  <span className="mt-1 block text-[10px] text-white/70">
                                    {existing
                                      ? 'Edit clue'
                                      : '+ Create clue'}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          {/* QR CARDS */}
                          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                            {teamClues.map((clue) => (
                              <QRCard
                                key={clue.id}
                                clue={clue}
                                team={team}
                                color={color}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                              />
                            ))}
                          </div>
                          {!teamClues.length && (
                            <p className="py-5 text-center text-xs text-white/40">
                              No team rounds saved yet.
                              Choose a round above to create its clue and hint.
                            </p>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}