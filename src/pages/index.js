import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { usePlayerStore, useAdminStore } from '../lib/store';
import { playSound } from '../lib/sound';
const AUDIO = {
  ambience: '/audio/ambience.mp3',
  click: '/audio/ui-click.mp3',
  success: '/audio/scan-success.mp3',
  error: '/audio/wrong-scan.mp3',
};
const CAPTAIN_MESSAGES = [
  {
    title: 'Arrr, adventurer!',
    text: 'A sharp eye, a steady crew, and a little courage. That is how legends find their treasure!',
  },
  {
    title: 'The sea is calling!',
    text: 'Read the map, solve the riddles, and trust your crew. Fortune favours the bold, matey!',
  },
  {
    title: 'Keep your wits sharp!',
    text: 'The cleverest pirate knows that every little clue could lead to a great treasure.',
  },
];
const WELCOME_MESSAGES = {
  first: {
    eyebrow: 'A NEW VOYAGE BEGINS',
    title: 'Welcome aboard, matey!',
    message:
      'A new voyage begins! Read the map, outsmart the riddles, trust your crew, and remember: fortune favours the bold.',
  },
  returning: {
    eyebrow: 'THE SEA REMEMBERS',
    title: 'Back on deck, matey!',
    message:
      'The tide has brought you back. Keep your wits sharp, trust your crew, and let us see what treasure awaits.',
  },
};
function CompassEmblem({ size = 64, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      role="img"
      aria-label="Treasure Hunt compass"
    >
      <circle cx="50" cy="50" r="46" stroke="#D9B46E" strokeWidth="2" />
      <circle cx="50" cy="50" r="37" stroke="#9D7B43" />
      <circle cx="50" cy="50" r="29" stroke="#6E5938" strokeDasharray="2 5" />
      <path
        d="M50 7 L59 41 L93 50 L59 59 L50 93 L41 59 L7 50 L41 41 Z"
        fill="#172D2D"
        stroke="#E6C787"
        strokeWidth="1.5"
      />
      <path d="M50 14 L56 44 L50 50 L44 44 Z" fill="#F5D58D" />
      <path d="M50 86 L44 56 L50 50 L56 56 Z" fill="#8D3829" />
      <path d="M14 50 L44 44 L50 50 L44 56 Z" fill="#B89A63" />
      <path d="M86 50 L56 56 L50 50 L56 44 Z" fill="#E5D4B2" />
      <circle cx="50" cy="50" r="6" fill="#E9C778" stroke="#4B3620" />
    </svg>
  );
}
function BrandLogo({ className = '', alt = 'Treasure Hunt 2K26' }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={`brand-fallback ${className}`} role="img" aria-label={alt}>
        <CompassEmblem size={64} />
      </div>
    );
  }
  return (
    <img
      src="/treasure-hunt-logo.png"
      alt={alt}
      className={className}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
function HorizontalBrandLogo({ className = '' }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={`horizontal-fallback ${className}`}>
        <CompassEmblem size={32} />
        <span>
          TREASURE HUNT
          <small>EXPEDITION 2K26</small>
        </span>
      </div>
    );
  }
  return (
    <img
      src="/treasure-hunt-horizontal.png"
      alt="Treasure Hunt 2K26"
      className={className}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
function SoundToggle({ enabled, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="sound-toggle"
      aria-pressed={enabled}
      aria-label={enabled ? 'Turn sound off' : 'Turn sound on'}
    >
      <span aria-hidden="true">{enabled ? '♫' : '♪'}</span>
      {enabled ? 'SOUND ON' : 'SOUND OFF'}
    </button>
  );
}
function CaptainCorner({ reducedMotion }) {
  const [messageIndex, setMessageIndex] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => {
      setMessageIndex((current) => (current + 1) % CAPTAIN_MESSAGES.length);
    }, 6500);
    return () => window.clearInterval(interval);
  }, []);
  const message = CAPTAIN_MESSAGES[messageIndex];
  return (
    <div className="captain-hero">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={messageIndex}
          className="captain-message"
          initial={reducedMotion ? false : { opacity: 0, x: 8, y: 3 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={reducedMotion ? undefined : { opacity: 0, x: -5 }}
          transition={{ duration: 0.4 }}
          aria-live="polite"
        >
          <span className="captain-message-kicker">A WORD FROM THE CAPTAIN</span>
          <h3>{message.title}</h3>
          <p>{message.text}</p>
          <div className="captain-message-footer">
            <span>✦</span>
            <span>THE TREASURE AWAITS</span>
            <span>✦</span>
          </div>
        </motion.div>
      </AnimatePresence>
      <motion.div
        className="captain-character-wrap"
        animate={
          reducedMotion
            ? undefined
            : { y: [0, -10, 0, -5, 0], rotate: [0, 0.8, 0, -0.8, 0] }
        }
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div className="captain-aura" />
        <img
          src="/jack-sparrow.png"
          alt="Pirate captain"
          className="captain-character"
          draggable={false}
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      </motion.div>
    </div>
  );
}
function PortalCard({ type, onClick, reducedMotion }) {
  const isTeam = type === 'TEAM';
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={reducedMotion ? undefined : { y: -5 }}
      whileTap={reducedMotion ? undefined : { scale: 0.985 }}
      className={`portal-card ${isTeam ? 'team-card' : 'admin-card'}`}
      aria-label={`Open ${isTeam ? 'Team' : 'Admin'} Portal`}
    >
      <div className="card-topline" />
      <div className="portal-card-top">
        <div className="portal-icon" aria-hidden="true">
          {isTeam ? '⚓' : '✦'}
        </div>
        <span className="portal-arrow" aria-hidden="true">↗</span>
      </div>
      <div className="portal-copy">
        <p className="portal-kicker">
          {isTeam ? 'FOR THE CREW' : 'FOR THE ORGANIZERS'}
        </p>
        <h2 className="portal-title">
          {isTeam ? 'Team Portal' : 'Admin Portal'}
        </h2>
        <p className="portal-description">
          {isTeam
            ? 'Follow the trail, solve the riddles and claim the treasure.'
            : 'Manage expeditions, forge clues and control the game.'}
        </p>
      </div>
      <div className="portal-footer">
        <span>{isTeam ? 'ENTER THE HUNT' : 'OPEN CONTROL ROOM'}</span>
        <span aria-hidden="true">→</span>
      </div>
    </motion.button>
  );
}
function PasswordField({
  id,
  label,
  value,
  onChange,
  visible,
  onToggle,
  admin = false,
}) {
  return (
    <label className={`field-label-wrap ${admin ? 'admin-form' : ''}`} htmlFor={id}>
      <span className="field-label">{label}</span>
      <span className="password-wrap">
        <input
          id={id}
          className="hunt-input password-input"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder="Enter your password"
          autoComplete="current-password"
          maxLength={256}
          required
        />
        <button
          type="button"
          onClick={onToggle}
          className="password-toggle"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? 'HIDE' : 'SHOW'}
        </button>
      </span>
    </label>
  );
}
export default function Index() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const ambienceRef = useRef(null);
  const clickRef = useRef(null);
  const successRef = useRef(null);
  const errorRef = useRef(null);
  const welcomeTimerRef = useRef(null);
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState('IDLE');
  const [loading, setLoading] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [welcomeMessage, setWelcomeMessage] = useState(null);
  const [teamError, setTeamError] = useState('');
  const [adminError, setAdminError] = useState('');
  const [teamForm, setTeamForm] = useState({ teamName: '', password: '' });
  const [adminForm, setAdminForm] = useState({ username: '', password: '' });
  const playerLogin = usePlayerStore((state) => state.login);
  const adminLogin = useAdminStore((state) => state.loginAdmin);
  useEffect(() => {
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated || !router.isReady) return;
    if (usePlayerStore.getState().team) {
      router.replace('/dashboard');
    } else if (useAdminStore.getState().isAdmin) {
      let active = true;
      supabase.auth.getUser().then(({ data, error }) => {
        if (!active) return;
        if (!error && data?.user?.id === process.env.NEXT_PUBLIC_ADMIN_USER_ID) {
          router.replace('/admin/dashboard');
        } else {
          useAdminStore.getState().logoutAdmin();
        }
      });
      return () => {
        active = false;
      };
    }
  }, [hydrated, router]);
  useEffect(() => {
    const createAudio = (src, loop = false, volume = 0.35) => {
      const audio = new Audio(src);
      audio.loop = loop;
      audio.volume = volume;
      audio.preload = 'none';
      return audio;
    };
    ambienceRef.current = createAudio(AUDIO.ambience, true, 0.18);
    clickRef.current = createAudio(AUDIO.click);
    successRef.current = createAudio(AUDIO.success, false, 0.45);
    errorRef.current = createAudio(AUDIO.error, false, 0.4);
    return () => {
      clearTimeout(welcomeTimerRef.current);
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
  const playEffect = useCallback(
    (type = 'click') => {
      if (!soundEnabled) return;
      playSound(type, soundEnabled);
      const audioMap = {
        click: clickRef.current,
        success: successRef.current,
        error: errorRef.current,
      };
      const audio = audioMap[type];
      if (!audio) return;
      try {
        audio.currentTime = 0;
        audio.play().catch(() => { });
      } catch {
        // Audio effects are optional.
      }
    },
    [soundEnabled]
  );
  const openPortal = (nextMode) => {
    if (loading) return;
    playEffect('click');
    setTeamError('');
    setAdminError('');
    setShowPassword(false);
    setMode(nextMode);
  };
  const prepareCaptainWelcome = (identity, role) => {
    const key =
      `treasure-hunt-2k26-welcomed-${role}-` +
      String(identity).trim().toLowerCase();
    let returning = false;
    try {
      returning = window.localStorage.getItem(key) === 'true';
      window.localStorage.setItem(key, 'true');
    } catch {
      // Continue if browser storage is unavailable.
    }
    setWelcomeMessage(
      returning ? WELCOME_MESSAGES.returning : WELCOME_MESSAGES.first
    );
    clearTimeout(welcomeTimerRef.current);
    welcomeTimerRef.current = setTimeout(() => setWelcomeMessage(null), 2350);
  };
  const handleTeamLogin = async (event) => {
    event.preventDefault();
    if (loading) return;
    const teamName = teamForm.teamName.trim();
    const password = teamForm.password;
    if (!teamName || !password) {
      setTeamError('Enter your registered team name and password.');
      return;
    }
    setLoading(true);
    setTeamError('');
    try {
      const { data, error } = await supabase
        .from('teams')
        .select('*')
        .eq('team_name', teamName)
        .eq('password', password)
        .maybeSingle();
      if (error) {
        console.error('Team login error:', error);
        setTeamError('Unable to verify your details. Please try again.');
        playEffect('error');
        return;
      }
      if (!data) {
        setTeamError('Incorrect team name or password.');
        playEffect('error');
        return;
      }
      playerLogin(data);
      playEffect('success');
      prepareCaptainWelcome(data.team_name || teamName, 'team');
      await new Promise((resolve) => setTimeout(resolve, 2350));
      await router.push('/dashboard');
    } catch (error) {
      console.error('Team login failed:', error);
      setTeamError('Something went wrong. Please try again.');
      playEffect('error');
    } finally {
      setLoading(false);
    }
  };
  // Admin login now uses Supabase Auth instead of the admins table.
  const handleAdminLogin = async (event) => {
    event.preventDefault();
    if (loading) return;
    const email = adminForm.username.trim().toLowerCase();
    const password = adminForm.password;
    if (!email || !password) {
      setAdminError('Enter your admin email and password.');
      return;
    }
    setLoading(true);
    setAdminError('');
    try {
      const adminUserId = process.env.NEXT_PUBLIC_ADMIN_USER_ID;
      if (!adminUserId) {
        setAdminError(
          'Admin authentication is not configured. Set NEXT_PUBLIC_ADMIN_USER_ID.'
        );
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error || !data?.user) {
        setAdminError('Incorrect admin email or password.');
        playEffect('error');
        return;
      }
      if (data.user.id !== adminUserId) {
        await supabase.auth.signOut();
        setAdminError('This account is not authorized for admin access.');
        playEffect('error');
        return;
      }
      adminLogin();
      playEffect('success');
      prepareCaptainWelcome(email, 'admin');
      await new Promise((resolve) => setTimeout(resolve, 2350));
      await router.push('/admin/dashboard');
    } catch (error) {
      console.error('Admin login failed:', error);
      setAdminError('Something went wrong. Please try again.');
      playEffect('error');
    } finally {
      setLoading(false);
    }
  };
  if (!hydrated) {
    return (
      <div
        className="min-h-[100svh] bg-[#080b0c]"
        aria-label="Loading Treasure Hunt"
      />
    );
  }
  return (
    <div className="hunt-page relative isolate min-h-[100svh] overflow-hidden bg-[#080b0c] text-[#f4e8cf]">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap');
        :root {
          color-scheme: dark;
          --gold: #e0bb76;
          --gold-bright: #f5dba5;
          --parchment: #f4e8cf;
        }
        html, body, #__next {
          min-height: 100%;
          margin: 0;
          background: #080b0c;
        }
        body, button, input {
          font-family: 'DM Sans', sans-serif;
        }
        button { -webkit-tap-highlight-color: transparent; }
        button:focus-visible, input:focus-visible {
          outline: 2px solid var(--gold-bright);
          outline-offset: 3px;
        }
        .hunt-title, .portal-title, .welcome-title {
          font-family: 'Cinzel', Georgia, serif;
        }
        .hunt-backdrop {
          position: fixed;
          inset: 0;
          z-index: -2;
          overflow: hidden;
          background: #080b0c;
        }
        .hunt-backdrop-image {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
          opacity: .48;
        }
        .hunt-backdrop-overlay {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse at 50% 25%, rgba(17,46,48,.04), transparent 50%),
            linear-gradient(180deg, rgba(3,6,7,.35), rgba(5,8,9,.55) 44%, #080b0c 100%);
        }
        .hunt-grid {
          position: absolute;
          inset: 0;
          opacity: .06;
          background-image:
            linear-gradient(rgba(224,187,118,.22) 1px, transparent 1px),
            linear-gradient(90deg, rgba(224,187,118,.22) 1px, transparent 1px);
          background-size: 72px 72px;
          mask-image: linear-gradient(to bottom, black, transparent 75%);
          pointer-events: none;
        }
        .hunt-header {
          position: relative;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          border-bottom: 1px solid rgba(217,180,110,.23);
          padding-bottom: 18px;
        }
        .sound-toggle {
          display: inline-flex;
          min-height: 39px;
          align-items: center;
          justify-content: center;
          gap: 9px;
          border: 1px solid rgba(224,187,118,.25);
          border-radius: 999px;
          padding: 8px 13px;
          background: rgba(0,0,0,.3);
          color: #dfc48e;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: .13em;
          white-space: nowrap;
        }
        .sound-toggle span { font-size: 17px; line-height: 1; }
        .sound-toggle:hover {
          border-color: rgba(224,187,118,.6);
          background: rgba(224,187,118,.06);
        }
        /* Hero title and emblem */
        .hero-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(340px, 430px);
          align-items: center;
          gap: clamp(20px, 3vw, 48px);
          width: 100%;
          margin: 0 auto;
        }
        .hero-main {
          min-width: 0;
          text-align: center;
        }
        .hero-emblem {
          display: flex;
          justify-content: center;
          margin-bottom: 18px;
        }
        .hero-emblem img {
          width: min(100%, 340px);
          max-height: 190px;
          object-fit: contain;
          filter: drop-shadow(0 8px 26px rgba(224,187,118,.16));
        }
        .hero-eyebrow {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 13px;
          margin-bottom: 20px;
          color: #e0bb7d;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: .38em;
          text-transform: uppercase;
        }
        .hero-eyebrow::before, .hero-eyebrow::after {
          content: '';
          width: clamp(24px, 5vw, 66px);
          height: 1px;
          background: rgba(215,173,102,.7);
        }
        .hero-title {
          margin: 0;
          font-family: 'Cinzel', Georgia, serif;
          font-size: clamp(48px, 5.7vw, 86px);
          font-weight: 900;
          line-height: 1.02;
          letter-spacing: -.055em;
          text-transform: uppercase;
          color: #f9e8c5;
          text-wrap: balance;
        }
        .hero-title span {
          display: block;
          margin-top: 8px;
          background: linear-gradient(180deg, #f6d99b 0%, #d9ad61 65%, #9c6b2c 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .hero-description {
          max-width: 580px;
          margin: 24px auto 0;
          color: rgba(233,222,201,.78);
          font-size: 15px;
          line-height: 1.9;
        }
        .hero-steps {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 10px 20px;
          margin-top: 26px;
          color: rgba(214,189,139,.8);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: .2em;
          text-transform: uppercase;
        }
        .hero-steps .star { color: #d9b46e; }
        /* Captain layout */
        .captain-hero {
          display: flex;
          min-width: 0;
          align-items: center;
          justify-content: center;
          gap: 0;
        }
        .captain-character-wrap {
          position: relative;
          z-index: 1;
          flex: 0 0 230px;
          width: 230px;
          height: 380px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .captain-aura {
          position: absolute;
          inset: 12%;
          z-index: -1;
          border-radius: 50%;
          background: rgba(221,151,53,.22);
          filter: blur(42px);
        }
        .captain-character {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
          object-position: center bottom;
          filter:
            drop-shadow(0 12px 24px rgba(0,0,0,.72))
            drop-shadow(0 0 14px rgba(224,187,118,.18));
          pointer-events: none;
          user-select: none;
        }
        .captain-message {
          position: relative;
          z-index: 2;
          flex: 0 1 220px;
          width: 220px;
          max-width: 220px;
          min-width: 0;
          padding: 17px 16px 13px;
          border: 1px solid rgba(224,187,118,.48);
          border-radius: 12px 12px 3px 12px;
          background:
            radial-gradient(ellipse at top left, rgba(116,77,35,.25), transparent 75%),
            linear-gradient(145deg, rgba(27,24,19,.96), rgba(7,12,13,.98));
          box-shadow: 0 16px 40px rgba(0,0,0,.38), inset 0 1px rgba(255,255,255,.04);
          backdrop-filter: blur(12px);
        }
        /* UPDATED: speech pointer protrudes from the RIGHT side */
        .captain-message::after {
          position: absolute;
          top: 35px;
          right: -7px;
          left: auto;
          width: 12px;
          height: 12px;
          content: '';
          transform: rotate(45deg);
          border-top: 1px solid rgba(224,187,118,.48);
          border-right: 1px solid rgba(224,187,118,.48);
          border-bottom: none;
          border-left: none;
          background: #171611;
        }
        .captain-message-kicker {
          display: block;
          margin-bottom: 9px;
          color: #d9b46e;
          font-size: 8px;
          font-weight: 800;
          letter-spacing: .12em;
        }
        .captain-message h3 {
          margin: 0;
          color: #f4dba7;
          font-family: 'Cinzel', Georgia, serif;
          font-size: 14px;
          font-weight: 800;
          line-height: 1.5;
        }
        .captain-message p {
          margin: 9px 0 0;
          color: rgba(244,232,207,.83);
          font-size: 11px;
          line-height: 1.7;
        }
        .captain-message-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-top: 12px;
          padding-top: 9px;
          border-top: 1px solid rgba(224,187,118,.17);
          color: rgba(224,187,118,.85);
          font-size: 6px;
          font-weight: 800;
          letter-spacing: .1em;
          white-space: nowrap;
        }
        .captain-message-footer span { color: #f0cb80; }
        /* Portal cards */
        .portal-card {
          position: relative;
          display: flex;
          min-width: 0;
          min-height: 260px;
          flex-direction: column;
          overflow: hidden;
          border: 1px solid rgba(224,187,118,.37);
          border-radius: 12px;
          padding: 25px;
          text-align: left;
          color: var(--parchment);
          background:
            radial-gradient(ellipse at 100% 0%, rgba(147,96,40,.13), transparent 50%),
            linear-gradient(145deg, rgba(39,30,20,.94), rgba(12,15,15,.97));
          box-shadow: 0 22px 65px rgba(0,0,0,.34), inset 0 1px rgba(255,255,255,.05);
          transition: border-color .25s, box-shadow .25s;
          cursor: pointer;
        }
        .portal-card:hover {
          border-color: rgba(245,219,165,.78);
          box-shadow: 0 25px 75px rgba(0,0,0,.44), 0 0 30px rgba(224,187,118,.07);
        }
        .portal-card.admin-card {
          border-color: rgba(144,187,192,.35);
          background:
            radial-gradient(ellipse at 100% 0%, rgba(54,105,113,.17), transparent 50%),
            linear-gradient(145deg, rgba(21,40,43,.97), rgba(10,15,17,.98));
        }
        .portal-card.admin-card:hover { border-color: rgba(174,216,220,.75); }
        .card-topline {
          position: absolute;
          top: 0;
          right: 8%;
          left: 8%;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--gold), transparent);
        }
        .admin-card .card-topline {
          background: linear-gradient(90deg, transparent, #9dc7cc, transparent);
        }
        .portal-card-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }
        .portal-icon {
          display: flex;
          width: 58px;
          height: 58px;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(224,187,118,.35);
          border-radius: 10px;
          background: rgba(0,0,0,.22);
          color: var(--gold-bright);
          font-size: 29px;
        }
        .admin-card .portal-icon {
          border-color: rgba(157,199,204,.35);
          color: #b6d5d7;
        }
        .portal-arrow {
          color: rgba(224,187,118,.65);
          font-size: 25px;
          transition: transform .2s;
        }
        .portal-card:hover .portal-arrow { transform: translate(3px, -3px); }
        .portal-copy { margin-top: 26px; }
        .portal-kicker {
          color: var(--gold);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .19em;
        }
        .admin-card .portal-kicker { color: #b6d5d7; }
        .portal-title {
          margin-top: 9px;
          font-size: clamp(23px, 3vw, 31px);
          font-weight: 800;
          line-height: 1.2;
          color: #f4dfb2;
        }
        .admin-card .portal-title { color: #d0e5e5; }
        .portal-description {
          margin-top: 11px;
          max-width: 320px;
          color: rgba(244,232,207,.72);
          font-size: 14px;
          line-height: 1.75;
        }
        .admin-card .portal-description { color: rgba(210,229,229,.75); }
        .portal-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: auto;
          padding-top: 22px;
          color: #e8cb91;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .15em;
        }
        .portal-footer span:last-child { font-size: 19px; letter-spacing: 0; }
        .admin-card .portal-footer { color: #c2dfe1; }
        /* Login panel and fields */
        .hunt-panel {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(224,187,118,.33);
          background: linear-gradient(145deg, rgba(39,31,21,.94), rgba(12,15,15,.97));
          box-shadow: 0 24px 80px rgba(0,0,0,.4), inset 0 1px rgba(255,255,255,.04);
          backdrop-filter: blur(18px);
        }
        .hunt-panel.admin {
          border-color: rgba(139,177,181,.35);
          background: linear-gradient(145deg, rgba(23,39,42,.96), rgba(10,15,17,.98));
        }
        .hunt-input {
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
          min-height: 52px;
          border: 1px solid rgba(224,192,133,.3);
          border-radius: 7px;
          outline: none;
          padding: 14px 15px;
          color: #fff4dd;
          background: rgba(0,0,0,.28);
          font-size: 16px;
          transition: border-color .2s, background .2s, box-shadow .2s;
        }
        .hunt-input:focus {
          border-color: #e5bc72;
          background: rgba(0,0,0,.45);
          box-shadow: 0 0 0 3px rgba(224,187,118,.08);
        }
        .hunt-input::placeholder { color: rgba(247,237,218,.45); }
        .admin-form .hunt-input:focus {
          border-color: #a4cbd0;
          box-shadow: 0 0 0 3px rgba(164,203,208,.08);
        }
        .field-label-wrap { display: block; }
        .field-label {
          display: block;
          margin-bottom: 8px;
          color: #e9d8b9;
          font-size: 13px;
          font-weight: 500;
        }
        .admin-form .field-label { color: #d2e0df; }
        .password-wrap { position: relative; display: block; }
        .password-input { padding-right: 76px; }
        .password-toggle {
          position: absolute;
          top: 0;
          right: 8px;
          bottom: 0;
          padding: 0 8px;
          color: #d8bd88;
          font-size: 11px;
          font-weight: 700;
        }
        .admin-form .password-toggle { color: #c3dadd; }
        .hunt-action { min-height: 50px; transition: filter .2s, transform .2s; }
        .hunt-action:hover:not(:disabled) { filter: brightness(1.1); }
        .hunt-action:active:not(:disabled) { transform: scale(.985); }
        .hunt-action:disabled { cursor: not-allowed; opacity: .55; }
        .form-submit {
          display: flex;
          width: 100%;
          align-items: center;
          justify-content: center;
          gap: 12px;
          border: 1px solid rgba(255,220,162,.5);
          border-radius: 7px;
          padding: 15px;
          color: #fff7e8;
          background: linear-gradient(100deg, #7e291e, #ad3d2b);
          box-shadow: 0 8px 25px rgba(0,0,0,.2);
          font-weight: 700;
        }
        .form-submit.admin-submit {
          border-color: rgba(180,219,221,.35);
          background: linear-gradient(100deg, #25444a, #3b656c);
        }
        .form-submit:disabled { opacity: .6; }
        .error-box {
          border: 1px solid rgba(248,113,113,.3);
          border-radius: 7px;
          padding: 12px;
          color: #fecaca;
          background: rgba(127,29,29,.24);
          font-size: 13px;
          line-height: 1.6;
        }
        .form-back { color: rgba(244,232,207,.75); font-size: 13px; }
        .form-back:hover { color: #f4e8cf; }
        .divider-label {
          display: flex;
          align-items: center;
          gap: 12px;
          color: rgba(224,187,118,.65);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: .18em;
        }
        .divider-label::before, .divider-label::after {
          height: 1px;
          flex: 1;
          background: rgba(224,187,118,.18);
          content: '';
        }
        .brand-fallback { display: flex; align-items: center; justify-content: center; }
        .horizontal-fallback {
          display: flex;
          align-items: center;
          gap: 9px;
          color: #f2dfb7;
          font-family: 'Cinzel', Georgia, serif;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .08em;
        }
        .horizontal-fallback span { display: flex; flex-direction: column; gap: 3px; }
        .horizontal-fallback small {
          color: #d7ae68;
          font-family: 'DM Sans', sans-serif;
          font-size: 9px;
          letter-spacing: .2em;
        }
        /* Login welcome message */
        .welcome-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: grid;
          place-items: center;
          padding: 20px;
          background: rgba(2,5,6,.78);
          backdrop-filter: blur(8px);
        }
        .welcome-card {
          width: min(480px, 100%);
          border: 1px solid rgba(224,187,118,.6);
          border-radius: 14px;
          padding: 30px 26px;
          text-align: center;
          background:
            radial-gradient(ellipse at top, rgba(120,77,31,.26), transparent 65%),
            linear-gradient(145deg, #211a12, #080d0e);
          box-shadow: 0 25px 90px rgba(0,0,0,.6), inset 0 1px rgba(255,255,255,.06);
        }
        .welcome-kicker {
          color: #e0bb76;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: .24em;
        }
        .welcome-title {
          margin-top: 12px;
          color: #f7dfad;
          font-size: clamp(25px, 5vw, 34px);
          font-weight: 800;
          line-height: 1.2;
        }
        .welcome-copy {
          margin: 14px auto 0;
          max-width: 360px;
          color: rgba(244,232,207,.8);
          font-size: 14px;
          line-height: 1.8;
        }
        .welcome-loading {
          margin-top: 22px;
          color: #d4b477;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: .2em;
        }
        /* Medium laptop */
        @media (min-width: 701px) and (max-width: 1100px) {
          .hero-layout {
            grid-template-columns: minmax(0, 1fr) minmax(270px, 340px);
            gap: 18px;
          }
          .hero-title { font-size: clamp(46px, 5.6vw, 66px); }
          .hero-emblem img {
            width: min(100%, 290px);
            max-height: 165px;
          }
          .captain-character-wrap {
            flex-basis: 175px;
            width: 175px;
            height: 310px;
          }
          .captain-message {
            flex-basis: 165px;
            width: 165px;
            max-width: 165px;
            padding: 13px 11px 10px;
          }
          .captain-message h3 { font-size: 11px; }
          .captain-message p { font-size: 9px; line-height: 1.6; }
          .captain-message-kicker { font-size: 6px; }
          .captain-message-footer { font-size: 5px; gap: 4px; }
        }
        /* Mobile */
        @media (max-width: 700px) {
          .hero-layout {
            grid-template-columns: minmax(0, 1fr);
            gap: 24px;
          }
          .hero-main { width: 100%; }
          .hero-emblem { margin-bottom: 14px; }
          .hero-emblem img {
            width: min(75%, 260px);
            max-height: 155px;
          }
          .hero-title {
            font-size: clamp(43px, 11vw, 68px);
            line-height: 1.03;
          }
          .hero-description {
            margin-top: 16px;
            font-size: 13px;
            line-height: 1.8;
          }
          .captain-hero {
            width: min(100%, 430px);
            margin: 0 auto;
            gap: 8px;
          }
          .captain-character-wrap {
            flex: 0 0 125px;
            width: 125px;
            height: 175px;
          }
          .captain-message {
            flex: 1 1 auto;
            width: auto;
            max-width: none;
            padding: 13px 12px 10px;
          }
          /* UPDATED: right-side pointer on mobile too */
          .captain-message::after {
            top: 26px;
            right: -6px;
            left: auto;
            width: 10px;
            height: 10px;
            transform: rotate(45deg);
            border-top: 1px solid rgba(224,187,118,.48);
            border-right: 1px solid rgba(224,187,118,.48);
            border-bottom: none;
            border-left: none;
            background: #171611;
          }
          .captain-message-kicker {
            margin-bottom: 6px;
            font-size: 6px;
            letter-spacing: .08em;
          }
          .captain-message h3 { font-size: 12px; }
          .captain-message p {
            margin-top: 6px;
            font-size: 10px;
            line-height: 1.6;
          }
          .captain-message-footer {
            gap: 4px;
            margin-top: 8px;
            padding-top: 7px;
            font-size: 6px;
          }
          .portal-card { min-height: 235px; padding: 21px; }
          .portal-icon { width: 50px; height: 50px; }
        }
        @media (max-width: 380px) {
          .captain-character-wrap {
            flex-basis: 100px;
            width: 100px;
            height: 150px;
          }
          .captain-message { padding: 11px 9px; }
          .captain-message-kicker { font-size: 5px; letter-spacing: .06em; }
          .captain-message h3 { font-size: 10px; }
          .captain-message p { font-size: 9px; }
          .captain-message-footer { gap: 3px; font-size: 5px; }
          .hero-title { font-size: 41px; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>
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
        <div className="pointer-events-none absolute bottom-[-100px] left-[-100px] h-80 w-80 rounded-full bg-amber-700/5 blur-3xl" />
        <div className="pointer-events-none absolute right-[-100px] top-[35%] h-80 w-80 rounded-full bg-teal-500/5 blur-3xl" />
      </div>
      <main className="relative mx-auto flex min-h-[100svh] w-full max-w-[1450px] flex-col px-4 py-5 sm:px-8 sm:py-7 lg:px-14">
        <header className="hunt-header">
          <div className="flex min-w-0 items-center gap-3">
            <HorizontalBrandLogo className="h-auto max-h-14 w-full max-w-[250px] object-contain object-left" />
          </div>
          <SoundToggle
            enabled={soundEnabled}
            onToggle={() => setSoundEnabled((current) => !current)}
          />
        </header>
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center py-8 sm:py-10 lg:py-12">
          <AnimatePresence mode="wait" initial={false}>
            {mode === 'IDLE' ? (
              <motion.div
                key="portals"
                initial={reducedMotion ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, y: -12 }}
                transition={{ duration: 0.4 }}
              >
                <section className="hero-layout mb-10 sm:mb-12">
                  <div className="hero-main">
                    <motion.div
                      className="hero-emblem"
                      initial={reducedMotion ? false : { opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.65 }}
                    >
                      <BrandLogo alt="Treasure Hunt 2K26 emblem" />
                    </motion.div>
                    <div className="hero-eyebrow">The legend begins</div>
                    <h1 className="hero-title">
                      Treasure
                      <span>Hunt 2K26</span>
                    </h1>
                    <p className="hero-description">
                      Follow the map. Decipher the clues. Trust your crew.
                      The treasure belongs to those who find it first.
                    </p>
                    <div className="hero-steps">
                      <span>Explore</span>
                      <span className="star">✦</span>
                      <span>Solve</span>
                      <span className="star">✦</span>
                      <span>Survive</span>
                      <span className="star">✦</span>
                      <span>Win</span>
                    </div>
                  </div>
                  <CaptainCorner reducedMotion={reducedMotion} />
                </section>
                <section
                  className="grid w-full grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2"
                  aria-label="Choose your portal"
                >
                  <PortalCard
                    type="TEAM"
                    onClick={() => openPortal('TEAM')}
                    reducedMotion={reducedMotion}
                  />
                  <PortalCard
                    type="ADMIN"
                    onClick={() => openPortal('ADMIN')}
                    reducedMotion={reducedMotion}
                  />
                </section>
                <div className="divider-label mx-auto mt-9 max-w-xs sm:mt-12">
                  CHOOSE YOUR EXPEDITION
                </div>
              </motion.div>
            ) : (
              <motion.section
                key={mode}
                initial={reducedMotion ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className={`hunt-panel mx-auto w-full max-w-lg rounded-xl p-5 sm:rounded-2xl sm:p-8 md:p-10 ${mode === 'ADMIN' ? 'admin' : ''
                  }`}
              >
                <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[#e7bd70] to-transparent" />
                <button
                  type="button"
                  onClick={() => {
                    if (loading) return;
                    playEffect('click');
                    setTeamError('');
                    setAdminError('');
                    setShowPassword(false);
                    setMode('IDLE');
                  }}
                  disabled={loading}
                  className="form-back hunt-action mb-6 inline-flex items-center gap-2"
                >
                  <span aria-hidden="true">←</span>
                  Back to portals
                </button>
                <div className="mb-7 flex items-center gap-4 sm:mb-9">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#d9b46e]/30 bg-black/25 p-1">
                    <BrandLogo
                      className="h-full w-full object-contain"
                      alt="Treasure Hunt emblem"
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-[9px] font-bold uppercase tracking-[.2em] text-[#d6b16f]">
                      {mode === 'TEAM' ? 'Crew identification' : 'Expedition authority'}
                    </p>
                    <h2
                      className={`hunt-title text-xl font-bold sm:text-2xl ${mode === 'ADMIN' ? 'text-[#d0e5e5]' : 'text-[#f4dfb2]'
                        }`}
                    >
                      {mode === 'TEAM' ? 'Team Login' : 'Admin Login'}
                    </h2>
                  </div>
                </div>
                {mode === 'TEAM' ? (
                  <form onSubmit={handleTeamLogin} className="space-y-5">
                    <label className="field-label-wrap">
                      <span className="field-label">Registered team name</span>
                      <input
                        className="hunt-input"
                        type="text"
                        value={teamForm.teamName}
                        onChange={(event) =>
                          setTeamForm((current) => ({
                            ...current,
                            teamName: event.target.value,
                          }))
                        }
                        placeholder="Enter your team name"
                        autoComplete="username"
                        maxLength={100}
                        required
                      />
                    </label>
                    <PasswordField
                      id="team-password"
                      label="Team password"
                      value={teamForm.password}
                      onChange={(event) =>
                        setTeamForm((current) => ({
                          ...current,
                          password: event.target.value,
                        }))
                      }
                      visible={showPassword}
                      onToggle={() => setShowPassword((current) => !current)}
                    />
                    {teamError && (
                      <div className="error-box" role="alert">
                        {teamError}
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={loading}
                      className="form-submit hunt-action"
                    >
                      {loading ? 'VERIFYING CREW…' : 'ENTER THE HUNT'}
                      <span aria-hidden="true">→</span>
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleAdminLogin} className="space-y-5">
                    <label className="field-label-wrap admin-form">
                      <span className="field-label">Admin email</span>
                      <input
                        className="hunt-input"
                        type="email"
                        value={adminForm.username}
                        onChange={(event) =>
                          setAdminForm((current) => ({
                            ...current,
                            username: event.target.value,
                          }))
                        }
                        placeholder="Enter your admin email"
                        autoComplete="username"
                        maxLength={254}
                        required
                      />
                    </label>
                    <PasswordField
                      id="admin-password"
                      label="Admin password"
                      value={adminForm.password}
                      onChange={(event) =>
                        setAdminForm((current) => ({
                          ...current,
                          password: event.target.value,
                        }))
                      }
                      visible={showPassword}
                      onToggle={() => setShowPassword((current) => !current)}
                      admin
                    />
                    {adminError && (
                      <div className="error-box" role="alert">
                        {adminError}
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={loading}
                      className="form-submit admin-submit hunt-action"
                    >
                      {loading ? 'VERIFYING AUTHORITY…' : 'ACCESS COMMAND DECK'}
                      <span aria-hidden="true">→</span>
                    </button>
                  </form>
                )}
              </motion.section>
            )}
          </AnimatePresence>
        </div>
        <footer className="py-4 text-center text-[9px] font-bold tracking-[.2em] text-[#d9b46e]/50">
          TREASURE HUNT 2K26 · FOLLOW THE LEGEND
        </footer>
      </main>
      <AnimatePresence>
        {welcomeMessage && (
          <motion.div
            className="welcome-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="welcome-card"
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.35 }}
            >
              <p className="welcome-kicker">{welcomeMessage.eyebrow}</p>
              <h2 className="welcome-title">{welcomeMessage.title}</h2>
              <p className="welcome-copy">{welcomeMessage.message}</p>
              <p className="welcome-loading">PREPARING YOUR VOYAGE…</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}