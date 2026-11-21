import React, { useState, useEffect, useRef } from 'react';
import { Volume2, Sparkles, Wind, Activity } from 'lucide-react';
import { LATHAWIYA_DETAILS, playArticulatoryPhoneme, speakTajweedLetter } from '../utils/tajweedAudio';

interface MakhrajVisualizerProps {
  activeLetter: 'ث' | 'ذ' | 'ظ';
  onLetterSelect?: (letter: 'ث' | 'ذ' | 'ظ') => void;
}

// SVG Tongue Path Definitions
// 1. Resting state
const PATH_REST = 'M 88 150 C 72 168 74 196 108 200 C 155 212 200 192 218 178 C 236 164 228 158 210 148 C 197 134 176 126 153 125 C 131 124 106 132 88 150 Z';

// 2. Active contact for 'ث' and 'ذ' (Istifal - tip at incisors, flat/lowered back)
const PATH_CONTACT_ISTIFAL = 'M 88 156 C 66 168 76 202 105 206 C 150 214 180 198 200 176 C 220 160 236 144 248 130 C 256 122 262 118 266 114 C 268 112 218 126 153 125 C 120 125 100 135 88 156 Z';

// 3. Active contact for 'ظ' (Isti'laa & Itbaaq - tip at incisors, rear elevated to y=104 WITHOUT touching the palate at y=74)
const PATH_CONTACT_ISTILAA = 'M 88 154 C 66 168 76 202 105 206 C 145 212 175 196 195 174 C 215 158 234 140 248 128 C 258 120 264 116 266 114 C 255 120 218 136 182 134 C 150 120 128 104 106 106 C 92 112 88 135 88 154 Z';

export const InteractiveMakhrajVisualizer: React.FC<MakhrajVisualizerProps> = ({
  activeLetter,
  onLetterSelect,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [animPhase, setAnimPhase] = useState<'rest' | 'contact' | 'steady' | 'release'>('rest');
  const [activeTabLetter, setActiveTabLetter] = useState<'ث' | 'ذ' | 'ظ'>(activeLetter);
  const timeoutRef = useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    setActiveTabLetter(activeLetter);
  }, [activeLetter]);

  const clearTimers = () => {
    timeoutRef.current.forEach(t => clearTimeout(t));
    timeoutRef.current = [];
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

  const triggerArticulation = (targetLetter: 'ث' | 'ذ' | 'ظ') => {
    clearTimers();
    setIsPlaying(true);
    setActiveTabLetter(targetLetter);
    if (onLetterSelect) onLetterSelect(targetLetter);

    // Play synchronized acoustic phonetics & voice
    playArticulatoryPhoneme(targetLetter, (phase) => {
      if (phase === 'contact') setAnimPhase('contact');
      else if (phase === 'steady') setAnimPhase('steady');
      else if (phase === 'release') setAnimPhase('release');
      else if (phase === 'done') {
        setAnimPhase('rest');
        setIsPlaying(false);
      }
    });

    // Also speak Tajweed Letter with clean native accent
    speakTajweedLetter(targetLetter, 'makhraj');

    // Fallback safety timeout
    const t = setTimeout(() => {
      setAnimPhase('rest');
      setIsPlaying(false);
    }, 2200);
    timeoutRef.current.push(t);
  };

  const currentInfo = LATHAWIYA_DETAILS[activeTabLetter];

  // Determine current SVG path based on animation phase and letter
  let currentTonguePath = PATH_REST;
  if (animPhase === 'contact' || animPhase === 'steady') {
    currentTonguePath = activeTabLetter === 'ظ' ? PATH_CONTACT_ISTILAA : PATH_CONTACT_ISTIFAL;
  } else if (animPhase === 'release') {
    currentTonguePath = PATH_REST;
  }

  return (
    <div className="makhraj-frame interactive-makhraj-box" id="interactiveMakhrajFrame">
      {/* Letter Quick Switcher & Trait Banner */}
      <div className="makhraj-top-controls">
        <div className="makhraj-letters-pills" role="tablist">
          {(['ث', 'ذ', 'ظ'] as const).map((letKey) => (
            <button
              key={letKey}
              type="button"
              className={`makhraj-pill-btn ${activeTabLetter === letKey ? 'active' : ''}`}
              onClick={() => triggerArticulation(letKey)}
              aria-label={`نطق ومحاكاة مخرج حرف ${letKey}`}
            >
              <span className="pill-letter">{letKey}</span>
              <span className="pill-name">{LATHAWIYA_DETAILS[letKey].name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Anatomical SVG Stage */}
      <div className="makhraj-svg-stage">
        <svg viewBox="0 0 340 260" xmlns="http://www.w3.org/2000/svg" className="makhraj-anatomy-svg">
          <defs>
            {/* Dynamic Tongue Gradient */}
            <radialGradient id="tongueGradInteractive" cx="30%" cy="22%" r="95%">
              <stop offset="0%" stopColor="#FFC9AE" />
              <stop offset="25%" stopColor="#FF9A72" />
              <stop offset="55%" stopColor="#F0623A" />
              <stop offset="85%" stopColor="#D9502A" />
              <stop offset="100%" stopColor="#A6371A" />
            </radialGradient>

            <radialGradient id="floorGradInteractive" cx="38%" cy="20%" r="90%">
              <stop offset="0%" stopColor="#F2B3A6"/>
              <stop offset="45%" stopColor="#D98C82"/>
              <stop offset="80%" stopColor="#C17C6E"/>
              <stop offset="100%" stopColor="#A85E52"/>
            </radialGradient>

            {/* Pharyngeal Cavity Tafkheem Resonance Glow */}
            <radialGradient id="tafkheemGlow" cx="40%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.45" />
              <stop offset="60%" stopColor="#D97706" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#B45309" stopOpacity="0" />
            </radialGradient>

            {/* Airflow / Hams Blur */}
            <filter id="hamsBlur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.5" />
            </filter>
          </defs>

          {/* 1. Mouth Palate Cavity (Hard/Soft Palate at y=74-96) */}
          <path
            d="M 246,96 C 200,60 185,88 168,74 C 140,52 95,60 72,92 C 50,124 50,168 74,198 C 100,230 150,238 190,222 C 220,210 238,192 250,166"
            fill="none"
            stroke="#E7C766"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Pharyngeal / Vocal tract resonance glow for 'ظ' during articulation */}
          {activeTabLetter === 'ظ' && (animPhase === 'contact' || animPhase === 'steady') && (
            <ellipse
              cx="135"
              cy="95"
              rx="42"
              ry="24"
              fill="url(#tafkheemGlow)"
              className="animate-pulse"
            />
          )}

          {/* Lips Outline */}
          <path d="M 262,112 C 280,124 280,146 262,158" fill="none" stroke="#9CA8A3" strokeWidth="1.5"/>

          {/* Upper Teeth (أطراف الثنايا العليا) */}
          <g id="upperTeethInteractive">
            <rect x="252" y="86" width="14" height="26" rx="4" fill="#F3E8D0" stroke="#E7C766" strokeWidth="2"/>
            <rect x="270" y="86" width="14" height="26" rx="4" fill="#F3E8D0" stroke="#E7C766" strokeWidth="2"/>
          </g>

          {/* Lower Teeth */}
          <g id="lowerTeethInteractive">
            <rect x="252" y="150" width="14" height="26" rx="4" fill="#F3E8D0" stroke="#E7C766" strokeWidth="2"/>
            <rect x="270" y="150" width="14" height="26" rx="4" fill="#F3E8D0" stroke="#E7C766" strokeWidth="2"/>
          </g>

          {/* Mouth Floor */}
          <path
            d="M 74,198 C 100,230 150,238 190,222 C 220,210 238,192 250,166 C 246,172 200,182 150,192 C 110,200 90,196 74,198 Z"
            fill="url(#floorGradInteractive)"
            stroke="#A85E52"
            strokeWidth="1.2"
          />

          {/* Dynamic Interactive Tongue */}
          <g id="interactiveTongueGroup">
            <path
              d={currentTonguePath}
              fill="url(#tongueGradInteractive)"
              stroke="#C4431F"
              strokeWidth="2.2"
              style={{
                transition: 'd 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
            {/* Muscle Fibers Sublayer */}
            <path
              d={currentTonguePath}
              fill="none"
              stroke="#7A2410"
              strokeWidth="1.2"
              opacity="0.25"
              style={{
                transition: 'd 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
          </g>

          {/* Makhraj Contact Point Sparkle Aura */}
          {(animPhase === 'contact' || animPhase === 'steady') && (
            <g transform="translate(262, 114)" className="contact-sparkle-group">
              <circle r="9" fill="#FDE047" opacity="0.45" className="animate-ping" />
              <circle r="5" fill="#F59E0B" />
              <line x1="-8" y1="0" x2="8" y2="0" stroke="#FFF" strokeWidth="1.5" />
              <line x1="0" y1="-8" x2="0" y2="8" stroke="#FFF" strokeWidth="1.5" />
            </g>
          )}

          {/* Airflow / Hams Whispering Stream for 'ث' */}
          {activeTabLetter === 'ث' && (animPhase === 'contact' || animPhase === 'steady') && (
            <g className="hams-whisper-stream" filter="url(#hamsBlur)">
              <ellipse cx="282" cy="120" rx="10" ry="3" fill="#E0F2FE" opacity="0.8" />
              <ellipse cx="304" cy="112" rx="14" ry="4" fill="#BAE6FD" opacity="0.7" />
              <ellipse cx="326" cy="104" rx="16" ry="5" fill="#7DD3FC" opacity="0.5" />
            </g>
          )}

          {/* Vocal Chord Waves in Throat for Voiced Letters (ذ, ظ) */}
          {(activeTabLetter === 'ذ' || activeTabLetter === 'ظ') && (animPhase === 'contact' || animPhase === 'steady') && (
            <g className="jahr-vocal-waves" stroke="#38BDF8" strokeWidth="1.5" fill="none" opacity="0.8">
              <path d="M 68 152 Q 62 165 68 178" className="animate-pulse" />
              <path d="M 60 148 Q 54 165 60 182" opacity="0.5" />
            </g>
          )}

          {/* Anatomical Pointer Labels */}
          <line x1="270" y1="56" x2="270" y2="82" stroke="#CFE3DD" strokeWidth="1.5"/>
          <text x="270" y="48" textAnchor="middle" fill="#F7F1E1" fontFamily="Cairo, sans-serif" fontSize="12.5" fontWeight="700">
            أطراف الثنايا العليا
          </text>

          <text x="100" y="246" textAnchor="middle" fill="#F7F1E1" fontFamily="Cairo, sans-serif" fontSize="12.5" fontWeight="700">
            {activeTabLetter === 'ظ' ? 'اللسان (استعلاء بدون ملامسة الحلق)' : 'اللسان (مستفل)'}
          </text>
          <line x1="100" y1="234" x2="100" y2="192" stroke="#CFE3DD" strokeWidth="1.5"/>
        </svg>
      </div>

      {/* Dynamic Tajweed Traits Pill */}
      <div className="makhraj-traits-bar">
        <div className="trait-item">
          <span className="trait-dot gold" />
          <span className="trait-name">المخرج:</span>
          <span className="trait-val">طرف اللسان + أطراف الثنايا العليا</span>
        </div>
        <div className="trait-item">
          {activeTabLetter === 'ث' ? (
            <>
              <Wind className="w-3.5 h-3.5 text-sky-300 inline mr-1" />
              <span className="trait-name">الصوت:</span>
              <span className="trait-val">مهموس (جريان النفس) • رخو</span>
            </>
          ) : activeTabLetter === 'ذ' ? (
            <>
              <Activity className="w-3.5 h-3.5 text-emerald-300 inline mr-1" />
              <span className="trait-name">الصوت:</span>
              <span className="trait-val">مجهور (اهتزاز صوتي) • رخو • مستفل</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-amber-300 inline mr-1" />
              <span className="trait-name">الصوت:</span>
              <span className="trait-val">مجهور • مستعلٍ ومطبق (تفخيم وقوة)</span>
            </>
          )}
        </div>
      </div>

      {/* Main Pronunciation Trigger Button */}
      <button
        type="button"
        id="mkPlayBtn"
        className={`mk-play-btn ${isPlaying ? 'playing' : ''}`}
        onClick={() => triggerArticulation(activeTabLetter)}
        disabled={isPlaying}
        aria-label={`استمع وانطق حرف ${activeTabLetter} في المخرج`}
      >
        {isPlaying ? (
          <Volume2 className="w-7 h-7 text-white animate-pulse" />
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>
      <span className="mk-btn-hint">
        {isPlaying ? `جارٍ نطق ومحاكاة «${currentInfo.phonemeExample}»...` : `اضغط لنطق ومحاكاة «${currentInfo.name} (${activeTabLetter})»`}
      </span>
    </div>
  );
};
