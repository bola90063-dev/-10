import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, type Variants } from 'motion/react';
import { 
  Sparkles, 
  Volume2, 
  Play, 
  RotateCcw, 
  Check, 
  Award, 
  BookOpen, 
  Flame, 
  HelpCircle, 
  ChevronDown, 
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Search,
  BookMarked
} from 'lucide-react';
import { 
  QALQALAH_LETTERS, 
  QALQALAH_WORDS_BANK, 
  QALQALAH_SURAHS, 
  QalqalahLetterInfo 
} from '../data/qalqalahData';

interface QalqalahSectionProps {
  activeTab: 'explain' | 'letters' | 'words' | 'apply';
  tabDirection: 1 | -1;
  onTabChange?: (tab: 'explain' | 'letters' | 'words' | 'apply') => void;
  playChime: (success?: boolean) => void;
  triggerConfetti: () => void;
  toArabicDigits: (n: number | string) => string;
}

const panelVariants: Variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 24 : -24,
    opacity: 0,
    scale: 0.992,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.28,
      ease: [0.22, 1, 0.36, 1] as const,
      staggerChildren: 0.035,
      delayChildren: 0.015,
    },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -18 : 18,
    opacity: 0,
    scale: 0.992,
    transition: {
      duration: 0.16,
      ease: [0.4, 0, 1, 1] as const,
    },
  }),
};

const staggerItemVariants: Variants = {
  enter: { opacity: 0, y: 10 },
  center: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const },
  },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12, ease: 'easeIn' as const } },
};

// Play realistic acoustic bounce/rebound impulse for Qalqalah
function playQalqalahSound(isKubra: boolean, letter: string) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain = ctx.createGain();

    const baseFreq = (letter === 'ق' || letter === 'ط') ? 170 : 250;
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(baseFreq, now);
    osc1.frequency.exponentialRampToValueAtTime(baseFreq * 1.55, now + 0.04);
    osc1.frequency.exponentialRampToValueAtTime(baseFreq * 0.85, now + 0.15);

    const initialGain = isKubra ? 0.09 : 0.05;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(initialGain, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (isKubra ? 0.28 : 0.14));

    osc1.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + (isKubra ? 0.3 : 0.16));
  } catch {
    // Audio context fallback
  }
}

export const QalqalahSection: React.FC<QalqalahSectionProps> = ({
  activeTab,
  tabDirection,
  playChime,
  triggerConfetti,
  toArabicDigits,
}) => {
  // Tab 1 state: active letter for detail card
  const [selectedLetter, setSelectedLetter] = useState<'ق' | 'ط' | 'ب' | 'ج' | 'د'>('ق');
  const [activeDegreeDemo, setActiveDegreeDemo] = useState<'كبرى' | 'صغرى'>('كبرى');
  const [isDemoBouncing, setIsDemoBouncing] = useState(false);

  // Tab 2: Letter Catch Game state
  const LETTER_GAME_POOL = ['ق', 'س', 'ط', 'ف', 'ب', 'ح', 'ج', 'ع', 'د', 'م', 'ر', 'ل', 'ك', 'هـ', 'ق', 'ط', 'ب'];
  const [gameLetters, setGameLetters] = useState<string[]>([]);
  const [caughtIndices, setCaughtIndices] = useState<Set<number>>(new Set());
  const [wrongIndex, setWrongIndex] = useState<number | null>(null);
  const [gameTimer, setGameTimer] = useState(0);
  const [gameTimerStatus, setGameTimerStatus] = useState<'idle' | 'running' | 'paused' | 'finished'>('idle');
  const [gameStatusMsg, setGameStatusMsg] = useState<{ msg: string; kind: 'ok' | 'bad' | null }>({ msg: '', kind: null });

  const startCatchGame = () => {
    const pool = [...LETTER_GAME_POOL].sort(() => Math.random() - 0.5);
    setGameLetters(pool);
    setCaughtIndices(new Set());
    setWrongIndex(null);
    setGameTimer(0);
    setGameTimerStatus('idle');
    setGameStatusMsg({ msg: '', kind: null });
  };

  const handleStartOrPauseTimer = () => {
    if (gameTimerStatus === 'idle') {
      setGameTimerStatus('running');
      setGameStatusMsg({ msg: 'بدأ حساب الوقت ⏱ استخرج حروف القلقلة الخمسة (ق - ط - ب - ج - د)', kind: 'ok' });
      setTimeout(() => {
        setGameStatusMsg(prev => prev.msg.includes('بدأ حساب الوقت') ? { msg: '', kind: null } : prev);
      }, 1800);
    } else if (gameTimerStatus === 'running') {
      setGameTimerStatus('paused');
      setGameStatusMsg({ msg: 'تم إيقاف العداد مؤقتاً ⏸', kind: null });
    } else if (gameTimerStatus === 'paused') {
      setGameTimerStatus('running');
      setGameStatusMsg({ msg: 'تم استئناف العداد ▶', kind: 'ok' });
      setTimeout(() => {
        setGameStatusMsg(prev => prev.msg.includes('تم استئناف') ? { msg: '', kind: null } : prev);
      }, 1500);
    } else if (gameTimerStatus === 'finished') {
      startCatchGame();
    }
  };

  const handleResetTimer = () => {
    setGameTimer(0);
    setCaughtIndices(new Set());
    setWrongIndex(null);
    setGameTimerStatus('idle');
    setGameStatusMsg({ msg: 'تمت إعادة ضبط العداد للصفر ⏱', kind: 'ok' });
    setTimeout(() => {
      setGameStatusMsg(prev => prev.msg.includes('إعادة ضبط') ? { msg: '', kind: null } : prev);
    }, 1500);
  };

  useEffect(() => {
    if (activeTab === 'letters' && gameLetters.length === 0) {
      startCatchGame();
    }
  }, [activeTab]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activeTab === 'letters' && gameTimerStatus === 'running') {
      interval = setInterval(() => {
        setGameTimer(t => t + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeTab, gameTimerStatus]);

  const handleCatchLetter = (ch: string, index: number) => {
    if (gameTimerStatus === 'finished' || caughtIndices.has(index)) return;

    if (gameTimerStatus === 'idle') {
      setGameTimerStatus('running');
    }

    const isQalqalah = ['ق', 'ط', 'ب', 'ج', 'د'].includes(ch);
    if (isQalqalah) {
      playQalqalahSound(true, ch);
      playChime(true);
      const next = new Set(caughtIndices);
      next.add(index);
      setCaughtIndices(next);
      setGameStatusMsg({ msg: `أحسنت! «${ch}» من حروف القلقلة (قُطْبُ جَدّ) ✓`, kind: 'ok' });

      const totalQalqalahInPool = gameLetters.filter(l => ['ق', 'ط', 'ب', 'ج', 'د'].includes(l)).length;
      if (next.size >= totalQalqalahInPool && totalQalqalahInPool > 0) {
        setGameTimerStatus('finished');
        setGameStatusMsg({
          msg: `مبارك! اكتمل التحدي في ${toArabicDigits(gameTimer)} ثانية 🎉 استخرجت جميع حروف القلقلة بنجاح`,
          kind: 'ok',
        });
        triggerConfetti();
      }
    } else {
      playChime(false);
      setWrongIndex(index);
      setGameStatusMsg({ msg: `حاول مرة أخرى، «${ch}» ليس من حروف القلقلة`, kind: 'bad' });
      setTimeout(() => setWrongIndex(null), 500);
    }
  };

  // Tab 3: Words Practice State
  const [wordQuizIdx, setWordQuizIdx] = useState(0);
  const [selectedWordDegree, setSelectedWordDegree] = useState<'كبرى' | 'صغرى' | null>(null);
  const [wordFeedback, setWordFeedback] = useState<{ isCorrect: boolean; text: string } | null>(null);

  const currentQuizItem = QALQALAH_WORDS_BANK[wordQuizIdx % QALQALAH_WORDS_BANK.length];

  const handleAnswerDegree = (degree: 'كبرى' | 'صغرى') => {
    setSelectedWordDegree(degree);
    const isCorrect = degree === currentQuizItem.degree;
    if (isCorrect) {
      playChime(true);
      playQalqalahSound(degree === 'كبرى', currentQuizItem.letter);
      setWordFeedback({
        isCorrect: true,
        text: `إجابة صحيحة! قلقلة ${degree} لأن الحرف «${currentQuizItem.letter}» ${degree === 'كبرى' ? 'موقوف عليه في نهاية الكلمة' : 'ساكن في وسط الكلمة'}.`,
      });
    } else {
      playChime(false);
      setWordFeedback({
        isCorrect: false,
        text: `ليست قلقلة ${degree}؛ بل هي قلقلة ${currentQuizItem.degree} لأن الحرف ${currentQuizItem.degree === 'كبرى' ? 'موقوف عليه' : 'ساكن في وسط الكلمة'}.`,
      });
    }
  };

  const handleNextQuizWord = () => {
    setSelectedWordDegree(null);
    setWordFeedback(null);
    setWordQuizIdx(idx => (idx + 1) % QALQALAH_WORDS_BANK.length);
  };

  // Tab 4: Quran Application State
  const [selectedSurah, setSelectedSurah] = useState('الفلق');
  const [surahFoundSet, setSurahFoundSet] = useState<Set<string>>(new Set());
  const [showSolution, setShowSolution] = useState(false);

  const isQalqalahChar = (ch: string) => ['ق', 'ط', 'ب', 'ج', 'د'].includes(ch);

  const handleSurahCharClick = (ayahIdx: number, charIdx: number, ch: string) => {
    const key = `${ayahIdx}-${charIdx}`;
    if (isQalqalahChar(ch)) {
      playQalqalahSound(true, ch);
      playChime(true);
      const next = new Set(surahFoundSet);
      next.add(key);
      setSurahFoundSet(next);
    } else {
      playChime(false);
    }
  };

  const surahAyahs = QALQALAH_SURAHS[selectedSurah] || QALQALAH_SURAHS['الفلق'];

  // Letter card click handler with 3D ripple identical to first two lessons
  const handleLetterCardClick = (letter: 'ق' | 'ط' | 'ب' | 'ج' | 'د', name: string, e: React.MouseEvent<HTMLDivElement>) => {
    const cardEl = e.currentTarget;
    cardEl.classList.remove('tapped', 'card-active');
    void cardEl.offsetWidth;
    cardEl.classList.add('tapped', 'card-active');

    const rect = cardEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const size = Math.max(rect.width, rect.height) * 1.7;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${x - size / 2}px`;
    ripple.style.top = `${y - size / 2}px`;
    cardEl.appendChild(ripple);
    setTimeout(() => ripple.remove(), 650);

    setSelectedLetter(letter);
    playQalqalahSound(activeDegreeDemo === 'كبرى', letter);
    playChime(true);
  };

  return (
    <AnimatePresence mode="wait" custom={tabDirection}>
      {/* Tab 1: Explanation & Interactive Visualizer */}
      {activeTab === 'explain' && (
        <motion.section
          key="explain-qalqalah"
          className="panel active"
          id="panel-explain-qalqalah"
          custom={tabDirection}
          variants={panelVariants}
          initial="enter"
          animate="center"
          exit="exit"
        >
          <div className="card explain-card" id="card-explain-overview">
            <div className="explain-grid" id="explain-main-grid">
              {/* Column 1: Five Qalqalah Letters Cards & Definition */}
              <motion.div variants={staggerItemVariants} className="explain-col-letters" id="explain-col-letters">
                <header className="explain-col-header" id="col-header-letters">
                  <h2 className="intro-subheading subheading-prominent theme-emerald">
                    <span className="subheading-accent-bar" aria-hidden="true" />
                    <span className="subheading-text">حروف القلقلة الخمسة (قُطْبُ جَدّ)</span>
                  </h2>
                </header>

                {/* 5 Showcase Cards for Qalqalah Letters matching Lathawiya & Noon-Meem visual identity */}
                <div className="letters-five-showcase" id="letters-five-showcase">
                  {(['ق', 'ط', 'ب', 'ج', 'د'] as const).map((letter, idx) => {
                    const item = QALQALAH_LETTERS[letter];
                    const isSelected = selectedLetter === letter;
                    const colorClass = `c${idx + 1}`; // c1: Emerald, c2: Amber, c3: Sapphire, c4: Purple, c5: Crimson
                    return (
                      <div key={letter} className="card-glow-wrap">
                        <div
                          className={`letter-card ${colorClass} ${isSelected ? 'card-active card-selected-letter' : ''}`}
                          id={`letter-card-${letter}`}
                          onClick={e => {
                            handleLetterCardClick(letter, item.name, e);
                          }}
                          onMouseMove={e => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const x = e.clientX - rect.left;
                            const y = e.clientY - rect.top;
                            const centerX = rect.width / 2;
                            const centerY = rect.height / 2;
                            const rotateX = ((y - centerY) / centerY) * -5;
                            const rotateY = ((x - centerX) / centerX) * 5;
                            e.currentTarget.style.setProperty('--mouse-x', `${(x / rect.width) * 100}%`);
                            e.currentTarget.style.setProperty('--mouse-y', `${(y / rect.height) * 100}%`);
                            e.currentTarget.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px) scale(1.015)`;
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.transform = '';
                            e.currentTarget.style.removeProperty('--mouse-x');
                            e.currentTarget.style.removeProperty('--mouse-y');
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="card-shimmer-highlight" aria-hidden="true" />
                          <svg className="deco-pattern" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <circle cx="100" cy="20" r="52" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />
                            <circle cx="100" cy="20" r="38" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
                            <circle cx="100" cy="20" r="22" stroke="currentColor" strokeWidth="1" opacity="0.5" />
                            <circle cx="100" cy="20" r="8" fill="currentColor" opacity="0.25" />
                            <rect x="76" y="-4" width="48" height="48" rx="6" transform="rotate(45 100 20)" stroke="currentColor" strokeWidth="1" opacity="0.4" />
                            <rect x="76" y="-4" width="48" height="48" rx="6" stroke="currentColor" strokeWidth="1" opacity="0.4" />
                            <path d="M100 -35 V75 M45 20 H155 M61 -19 L139 59 M61 59 L139 -19" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
                          </svg>
                          <div className="glyph">{letter}</div>
                          <div className="glyph-name">
                            {item.name}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Definition Card with Clean Unified Craftsmanship */}
                <div className="letters-definition-card" id="letters-def-card">
                  {/* Primary Rule Callout */}
                  <div className="def-rule-container" id="def-part-intro">
                    <p className="def-rule-text">
                      اضطراب المخرج عند النطق بالحرف ساكناً حتى يُسمع له نبرة صوتية قوية، وتجمعها: «قُطْبُ جَدّ»
                    </p>
                  </div>

                  {/* Refined Minimalist Spec Strip */}
                  <div className="def-spec-strip" id="def-part-makhraj">
                    <div className="def-spec-item">
                      <div className="def-spec-badge">الحروف</div>
                      <div className="def-spec-value">٥ أحرف (قُطْبُ جَدّ)</div>
                    </div>
                    <div className="def-spec-divider" aria-hidden="true" />
                    <div className="def-spec-item">
                      <div className="def-spec-badge">المراتب</div>
                      <div className="def-spec-value">كبرى وصغرى</div>
                    </div>
                    <div className="def-spec-divider" aria-hidden="true" />
                    <div className="def-spec-item">
                      <div className="def-spec-badge">الصفة</div>
                      <div className="def-spec-value">اهتزاز المخرج</div>
                    </div>
                  </div>
                </div>

                {/* Letter Details Inspector Card */}
                {selectedLetter && (
                  <div className="qalqalah-letter-detail-card" id="qalqalah-letter-detail">
                    <div className="qalqalah-detail-header">
                      <div className="qalqalah-letter-pill">
                        <div className={`qalqalah-letter-avatar ${selectedLetter === 'ق' ? 'bg-emerald-600' : selectedLetter === 'ط' ? 'bg-amber-600' : selectedLetter === 'ب' ? 'bg-sky-600' : selectedLetter === 'ج' ? 'bg-purple-600' : 'bg-rose-600'}`}>
                          {selectedLetter}
                        </div>
                        <div>
                          <h4 className="qalqalah-letter-meta-title">
                            <span>حرف {QALQALAH_LETTERS[selectedLetter].name}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${QALQALAH_LETTERS[selectedLetter].isMufakhkham ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-emerald-100 text-emerald-800 border border-emerald-300'}`}>
                              {QALQALAH_LETTERS[selectedLetter].isMufakhkham ? 'مفخّم دائماً' : 'مرقّق دائماً'}
                            </span>
                          </h4>
                          <div className="qalqalah-letter-meta-desc">
                            المخرج: {QALQALAH_LETTERS[selectedLetter].makhraj}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          playQalqalahSound(activeDegreeDemo === 'كبرى', selectedLetter);
                          playChime(true);
                        }}
                        className="qalqalah-listen-btn"
                        title="استمع لصوت القلقلة"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>استمع للنبرة</span>
                      </button>
                    </div>

                    <div className="qalqalah-examples-grid">
                      <div className="qalqalah-example-box box-kubra">
                        <span className="qalqalah-box-tag">قلقلة كبرى (عند الوقف):</span>
                        <div className="qalqalah-box-word">«{QALQALAH_LETTERS[selectedLetter].examples.kubra.word}»</div>
                        <span className="qalqalah-box-meaning">{QALQALAH_LETTERS[selectedLetter].examples.kubra.meaning}</span>
                      </div>

                      <div className="qalqalah-example-box box-sughra">
                        <span className="qalqalah-box-tag">قلقلة صغرى (في وسط الكلمة / الوصل):</span>
                        <div className="qalqalah-box-word">«{QALQALAH_LETTERS[selectedLetter].examples.sughra.word}»</div>
                        <span className="qalqalah-box-meaning">{QALQALAH_LETTERS[selectedLetter].examples.sughra.meaning}</span>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>

              {/* Column 2: Degrees of Qalqalah Interactive Studio (matching Ghunnah Trainer in Column 2) */}
              <motion.div variants={staggerItemVariants} className="explain-col-makhraj" id="explain-col-makhraj">
                <header className="explain-col-header" id="col-header-makhraj">
                  <h2 className="intro-subheading subheading-prominent theme-amber">
                    <span className="subheading-accent-bar" aria-hidden="true" />
                    <span className="subheading-text">مراتب القلقلة والاهتزاز الصوتي</span>
                  </h2>
                </header>

                <div className="qalqalah-studio-card" id="qalqalahStudioCard">
                  {/* Interactive Degree Switcher */}
                  <div className="qalqalah-degree-switcher-row">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveDegreeDemo('كبرى');
                        playQalqalahSound(true, selectedLetter);
                        setIsDemoBouncing(true);
                        setTimeout(() => setIsDemoBouncing(false), 500);
                      }}
                      className={`qalqalah-degree-switch-btn ${
                        activeDegreeDemo === 'كبرى' ? 'active btn-kubra' : 'inactive'
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>مرتبة كبرى (عند الوقف - أبين وأقوى)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveDegreeDemo('صغرى');
                        playQalqalahSound(false, selectedLetter);
                        setIsDemoBouncing(true);
                        setTimeout(() => setIsDemoBouncing(false), 500);
                      }}
                      className={`qalqalah-degree-switch-btn ${
                        activeDegreeDemo === 'صغرى' ? 'active btn-sughra' : 'inactive'
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>مرتبة صغرى (في الوصل - أخف)</span>
                    </button>
                  </div>

                  {/* Acoustic Vibration Chamber */}
                  <div className="qalqalah-acoustic-chamber">
                    {/* Pulsing concentric rings */}
                    <div className="relative flex items-center justify-center my-2">
                      <div className={`qalqalah-pulse-ring ${isDemoBouncing ? 'vibrating' : ''}`} />
                      
                      <div
                        onClick={() => {
                          playQalqalahSound(activeDegreeDemo === 'كبرى', selectedLetter);
                          setIsDemoBouncing(true);
                          setTimeout(() => setIsDemoBouncing(false), 500);
                        }}
                        className={`qalqalah-pulse-circle ${
                          activeDegreeDemo === 'كبرى' ? 'theme-kubra' : 'theme-sughra'
                        }`}
                        title="انقر لسماع ذبذبة القلقلة"
                      >
                        <span className="text-3xl font-extrabold font-serif">{selectedLetter}ْ</span>
                        <span className="text-[10px] font-sans font-black mt-0.5">
                          {activeDegreeDemo}
                        </span>
                      </div>
                    </div>

                    <div className="text-center mt-2 z-10">
                      <span className="text-xs font-bold text-sky-200 block mb-1">
                        {activeDegreeDemo === 'كبرى'
                          ? 'عند الوقف على الحرف الساكن في آخر الكلمة:'
                          : 'عند النطق بالحرف الساكن في وسط الكلمة أو درج الكلام:'}
                      </span>
                      <span className="text-2xl font-serif font-extrabold text-amber-300">
                        {activeDegreeDemo === 'كبرى'
                          ? `«${QALQALAH_LETTERS[selectedLetter].examples.kubra.word}»`
                          : `«${QALQALAH_LETTERS[selectedLetter].examples.sughra.word}»`}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        playQalqalahSound(activeDegreeDemo === 'كبرى', selectedLetter);
                        setIsDemoBouncing(true);
                        setTimeout(() => setIsDemoBouncing(false), 500);
                      }}
                      className="mt-3 px-4 py-1.5 rounded-full bg-sky-500/20 hover:bg-sky-500/35 border border-sky-400/40 text-xs font-bold text-sky-200 flex items-center gap-1.5 transition-all"
                    >
                      <Volume2 className="w-3.5 h-3.5 text-sky-300" />
                      <span>جرّب النطق والذبذبة الصوتية ▶</span>
                    </button>
                  </div>

                  {/* Common mistake alert pill */}
                  <div className="qalqalah-mistake-pill-box">
                    <ShieldAlert className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold text-rose-200 block mb-0.5">تنبيه تجويدي هام:</strong>
                      لا تخلط صوت القلقلة بحركة كإمالتها إلى الفتح، ولا تختمها بهمزة مسكتة زائدة (مثل: أحدْء ✗ بل أحدْ ✓).
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>

          {/* Bottom Capsule: Matn Quote & Common Mistakes Grid matching Noon-Meem & Lathawiya */}
          <motion.div variants={staggerItemVariants} className="lathawiya-bottom-vowels-bar" id="qalqalah-bottom-bar">
            {/* Header Tag */}
            <div className="vowels-bar-header">
              <span className="vowels-bar-title-tag">
                الشاهد التجويدي من الجزرية والأخطاء الشائعة
              </span>
            </div>

            {/* Matn Quote Box */}
            <div className="matn-quote-banner">
              <span className="matn-quote-text">
                «بَيِّنْ مُقَلْقَلاً إِذَا مَا سَكَنَا ... وَإِنْ يَكُنْ فِي الْوَقْفِ كَانَ أَبْيَنَا»
              </span>
            </div>

            {/* 2-Column Mistakes Grid for Qalqalah */}
            <div className="vowels-compact-grid duo" id="qalqalah-mistakes-grid">
              {/* Col 1: Mistake 1 - الحركة */}
              <div className="vowels-letter-col theme-amber">
                <div className="mistake-letter-tag">
                  الخلط بالحركات
                </div>

                <div className="mistake-two-cols-box">
                  <div className="mistake-side-col correct-side">
                    <div className="mistake-side-header correct">سكون نقي صافٍ</div>
                    <div className="mistake-words-stack">
                      <span className="mistake-word-item correct" title="سكون سليم">
                        «يَطْمَعُ»
                      </span>
                      <span className="mistake-word-item correct" title="سكون سليم">
                        «الْفَلَقْ»
                      </span>
                    </div>
                  </div>

                  <div className="mistake-side-divider" aria-hidden="true">≠</div>

                  <div className="mistake-side-col wrong-side">
                    <div className="mistake-side-header wrong">إمالة إلى الفتح</div>
                    <div className="mistake-words-stack">
                      <span className="mistake-word-item wrong" title="خطأ فتح الطاء">
                        «يَطَمَعُ» ✗
                      </span>
                      <span className="mistake-word-item wrong" title="خطأ فتح القاف">
                        «الْفَلَقَ» ✗
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="vowels-col-divider" aria-hidden="true" />

              {/* Col 2: Mistake 2 - الوقف بهمزة */}
              <div className="vowels-letter-col theme-emerald">
                <div className="mistake-letter-tag">
                  الوقف بهمزة
                </div>

                <div className="mistake-two-cols-box">
                  <div className="mistake-side-col correct-side">
                    <div className="mistake-side-header correct">ارتعاد دون همز</div>
                    <div className="mistake-words-stack">
                      <span className="mistake-word-item correct" title="قلقلة دال صافية">
                        «أَحَدْ»
                      </span>
                      <span className="mistake-word-item correct" title="قلقلة باء صافية">
                        «كَسَبْ»
                      </span>
                    </div>
                  </div>

                  <div className="mistake-side-divider" aria-hidden="true">≠</div>

                  <div className="mistake-side-col wrong-side">
                    <div className="mistake-side-header wrong">زيادة همزة ساكتة</div>
                    <div className="mistake-words-stack">
                      <span className="mistake-word-item wrong" title="خطأ همز الدال">
                        «أَحَدْء» ✗
                      </span>
                      <span className="mistake-word-item wrong" title="خطأ همز الباء">
                        «كَسَبْء» ✗
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.section>
      )}

      {/* Tab 2: Letter Catch Mini-Game (صيد حروف قطب جد) */}
      {activeTab === 'letters' && (
        <motion.section
          key="letters-qalqalah"
          className="panel active"
          id="panel-letters-qalqalah"
          custom={tabDirection}
          variants={panelVariants}
          initial="enter"
          animate="center"
          exit="exit"
        >
          <div className="card" id="card-level1-game">
            <motion.h2 variants={staggerItemVariants} className="intro-heading">
              <span className="ih-row">
                <span className="ih-line"></span>
                <span className="ih-diamond"></span>
                <span className="ih-badge badge-search" aria-hidden="true">
                  <Search className="ih-badge-icon" />
                </span>
                <span className="ih-text">ابحث عن حروف القلقلة (قُطْبُ جَدّ)</span>
                <span className="ih-diamond"></span>
                <span className="ih-line ih-line-r"></span>
              </span>
            </motion.h2>

            <motion.div variants={staggerItemVariants} className="instruction">
              اضغط على حروف القلقلة الخمسة (ق - ط - ب - ج - د) فقط من بين الحروف الآتية بأسرع وقت.
            </motion.div>

            {/* Apple iOS Style Stopwatch matching Noon-Meem */}
            <motion.div variants={staggerItemVariants} className="ios-stopwatch-row" id="letters-stats-row">
              <div className={`ios-stopwatch-dock ${gameTimerStatus}`} id="letters-pro-timer-dock">
                <button
                  type="button"
                  className={`ios-action-btn ios-toggle-btn ${gameTimerStatus}`}
                  onClick={handleStartOrPauseTimer}
                  title={
                    gameTimerStatus === 'idle'
                      ? 'بدء العداد'
                      : gameTimerStatus === 'running'
                      ? 'إيقاف مؤقت'
                      : 'استئناف'
                  }
                  aria-label={gameTimerStatus === 'running' ? 'إيقاف' : 'بدء'}
                >
                  <span className="ios-btn-label">
                    {gameTimerStatus === 'running' ? 'إيقاف' : gameTimerStatus === 'paused' ? 'استئناف' : 'بدء'}
                  </span>
                </button>

                <div
                  className="ios-digital-readout"
                  title="الزمن المنقضي (ثوانٍ)"
                  aria-label={`الزمن: ${toArabicDigits(gameTimer)} ثانية`}
                >
                  <span className="ios-digit-time">{toArabicDigits(gameTimer)}</span>
                  <span className="ios-digit-unit">ثانية</span>
                </div>

                <button
                  type="button"
                  className="ios-action-btn ios-reset-btn"
                  onClick={handleResetTimer}
                  title="إعادة ضبط العداد للصفر"
                  aria-label="تصفير"
                >
                  <span className="ios-btn-label">تصفير</span>
                </button>
              </div>

              {/* Status Message */}
              {gameStatusMsg.msg && (
                <div className={`level1-status-bubble ${gameStatusMsg.kind || ''}`} role="status">
                  {gameStatusMsg.msg}
                </div>
              )}
            </motion.div>

            {/* Letters Grid */}
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-3 max-w-3xl mx-auto my-6">
              {gameLetters.map((ch, idx) => {
                const isCaught = caughtIndices.has(idx);
                const isWrong = wrongIndex === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleCatchLetter(ch, idx)}
                    className={`h-16 rounded-2xl flex items-center justify-center text-3xl font-serif font-extrabold transition-all duration-200 border ${
                      isCaught
                        ? 'bg-emerald-600/30 border-emerald-400 text-emerald-300 scale-95 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                        : isWrong
                        ? 'bg-rose-600/30 border-rose-500 text-rose-300 scale-95 animate-shake'
                        : 'bg-white border-slate-200 text-slate-800 hover:border-emerald-500 hover:bg-emerald-50 hover:scale-105 active:scale-95 shadow-sm'
                    }`}
                  >
                    {ch}
                  </button>
                );
              })}
            </div>

            {gameTimerStatus === 'finished' && (
              <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-4 text-center max-w-md mx-auto animate-fade-in shadow-md">
                <Sparkles className="w-8 h-8 text-amber-500 mx-auto mb-1 animate-bounce" />
                <h3 className="text-base font-extrabold text-emerald-900">مبارك! اصطدت جميع حروف القلقلة بنجاح 🎉</h3>
                <p className="text-xs text-slate-600 mt-1">
                  أنهيت التحدي في {toArabicDigits(gameTimer)} ثانية فقط.
                </p>
                <button
                  type="button"
                  onClick={startCatchGame}
                  className="mt-3 px-5 py-2 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md"
                >
                  العب جولة أخرى
                </button>
              </div>
            )}
          </div>
        </motion.section>
      )}

      {/* Tab 3: Word Practice & Degree Quiz (تدرّب في كلمات) */}
      {activeTab === 'words' && (
        <motion.section
          key="words-qalqalah"
          className="panel active"
          id="panel-words-qalqalah"
          custom={tabDirection}
          variants={panelVariants}
          initial="enter"
          animate="center"
          exit="exit"
        >
          <div className="card max-w-2xl mx-auto" id="card-words-trainer">
            <motion.h2 variants={staggerItemVariants} className="intro-heading">
              <span className="ih-row">
                <span className="ih-line"></span>
                <span className="ih-diamond"></span>
                <span className="ih-badge badge-book" aria-hidden="true">
                  <BookOpen className="ih-badge-icon" />
                </span>
                <span className="ih-text">اكتشف مرتبة القلقلة في الكلمة</span>
                <span className="ih-diamond"></span>
                <span className="ih-line ih-line-r"></span>
              </span>
            </motion.h2>

            <motion.div variants={staggerItemVariants} className="instruction">
              اقرأ الكلمة القرآنية وحدد نوع قلقلتها: كبرى (عند الوقف) أم صغرى (في الوصل / وسط الكلمة).
            </motion.div>

            {/* Word Stage Card */}
            <div className="bg-white border border-slate-200 rounded-3xl p-6 text-center my-4 shadow-sm">
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 inline-block mb-3">
                {currentQuizItem.surah}
              </span>

              <div className="text-5xl font-extrabold text-slate-900 font-serif my-3 tracking-wide">
                «{currentQuizItem.word}»
              </div>

              <div className="text-xs text-slate-500 mb-5">
                الآية: {currentQuizItem.ayah}
              </div>

              {/* Action Buttons: Kubra vs Sughra */}
              <div className="flex gap-4 max-w-md mx-auto">
                <button
                  type="button"
                  onClick={() => handleAnswerDegree('كبرى')}
                  disabled={selectedWordDegree !== null}
                  className={`flex-1 py-3 px-4 rounded-2xl font-extrabold text-sm transition-all duration-200 border flex items-center justify-center gap-2 ${
                    selectedWordDegree === 'كبرى'
                      ? currentQuizItem.degree === 'كبرى'
                        ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg'
                        : 'bg-rose-600 border-rose-500 text-white'
                      : 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100'
                  }`}
                >
                  قلقلة كبرى (وقف)
                </button>
                <button
                  type="button"
                  onClick={() => handleAnswerDegree('صغرى')}
                  disabled={selectedWordDegree !== null}
                  className={`flex-1 py-3 px-4 rounded-2xl font-extrabold text-sm transition-all duration-200 border flex items-center justify-center gap-2 ${
                    selectedWordDegree === 'صغرى'
                      ? currentQuizItem.degree === 'صغرى'
                        ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg'
                        : 'bg-rose-600 border-rose-500 text-white'
                      : 'bg-sky-50 border-sky-200 text-sky-900 hover:bg-sky-100'
                  }`}
                >
                  قلقلة صغرى (وصل)
                </button>
              </div>

              {/* Feedback box */}
              {wordFeedback && (
                <div className={`mt-5 p-3 rounded-2xl border text-xs leading-relaxed animate-fade-in ${
                  wordFeedback.isCorrect
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : 'bg-rose-50 border-rose-300 text-rose-800'
                }`}>
                  {wordFeedback.text}
                </div>
              )}

              {selectedWordDegree !== null && (
                <button
                  type="button"
                  onClick={handleNextQuizWord}
                  className="mt-5 px-6 py-2 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md"
                >
                  الكلمة التالية ←
                </button>
              )}
            </div>
          </div>
        </motion.section>
      )}

      {/* Tab 4: Application in Quran (طبّق في القرآن) */}
      {activeTab === 'apply' && (
        <motion.section
          key="apply-qalqalah"
          className="panel active"
          id="panel-apply-qalqalah"
          custom={tabDirection}
          variants={panelVariants}
          initial="enter"
          animate="center"
          exit="exit"
        >
          <div className="card max-w-3xl mx-auto" id="card-quran-apply">
            <motion.h2 variants={staggerItemVariants} className="intro-heading">
              <span className="ih-row">
                <span className="ih-line"></span>
                <span className="ih-diamond"></span>
                <span className="ih-badge badge-quran" aria-hidden="true">
                  <BookMarked className="ih-badge-icon" />
                </span>
                <span className="ih-text">استخراج حروف القلقلة من السور الكريمة</span>
                <span className="ih-diamond"></span>
                <span className="ih-line ih-line-r"></span>
              </span>
            </motion.h2>

            <motion.div variants={staggerItemVariants} className="instruction">
              اضغط على أي حرف قلقلة ساكن (ق - ط - ب - ج - د) في الآيات الشريفة أدناه.
            </motion.div>

            {/* Surah Selector Tabs */}
            <div className="flex gap-2 justify-center mb-4 flex-wrap">
              {Object.keys(QALQALAH_SURAHS).map(sName => (
                <button
                  key={sName}
                  type="button"
                  onClick={() => {
                    setSelectedSurah(sName);
                    setSurahFoundSet(new Set());
                    setShowSolution(false);
                  }}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all border ${
                    selectedSurah === sName
                      ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  سورة {sName}
                </button>
              ))}
            </div>

            {/* Ayahs Display */}
            <div className="bg-amber-50/40 border border-amber-200/80 rounded-3xl p-6 text-center leading-loose shadow-inner">
              {surahAyahs.map((ayah, aIdx) => (
                <div key={aIdx} className="text-2xl sm:text-3xl font-serif text-slate-800 my-3 leading-relaxed">
                  {ayah.split('').map((char, cIdx) => {
                    const isTarget = isQalqalahChar(char);
                    const key = `${aIdx}-${cIdx}`;
                    const isFound = surahFoundSet.has(key);
                    const isHighlighted = showSolution && isTarget;

                    if (!isTarget) {
                      return <span key={cIdx}>{char}</span>;
                    }

                    return (
                      <span
                        key={cIdx}
                        onClick={() => handleSurahCharClick(aIdx, cIdx, char)}
                        className={`inline-block px-1 rounded-md cursor-pointer transition-all duration-200 font-extrabold ${
                          isFound
                            ? 'bg-emerald-500/20 text-emerald-700 ring-2 ring-emerald-500 scale-110'
                            : isHighlighted
                            ? 'bg-amber-500/20 text-amber-700 ring-1 ring-amber-500'
                            : 'hover:bg-amber-100 hover:text-emerald-700 text-amber-900'
                        }`}
                        title="انقر لفحص حرف القلقلة"
                      >
                        {char}
                      </span>
                    );
                  })}
                  <span className="text-sm font-sans text-amber-600 mx-2 font-bold">
                    ﴿{toArabicDigits(aIdx + 1)}﴾
                  </span>
                </div>
              ))}
            </div>

            {/* Footer controls */}
            <div className="flex items-center justify-between mt-4 px-2">
              <span className="text-xs font-bold text-slate-700">
                الحروف المكتشفة: <strong className="text-emerald-600">{toArabicDigits(surahFoundSet.size)}</strong>
              </span>
              <button
                type="button"
                onClick={() => setShowSolution(!showSolution)}
                className="px-4 py-1.5 rounded-full bg-white hover:bg-slate-50 border border-slate-300 text-xs font-bold text-slate-700 transition-all shadow-sm"
              >
                {showSolution ? 'إخفاء الحل' : 'إظهار حل القلقلة'}
              </button>
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
};
