import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, type Variants } from 'motion/react';
import { 
  BookOpen, 
  Search, 
  Layers, 
  Sparkles, 
  Volume2, 
  Check, 
  ArrowLeft, 
  RotateCcw, 
  HelpCircle,
  Award,
  ShieldAlert,
  ChevronDown
} from 'lucide-react';
import { NOON_SAKINAH_RULES, NOON_WORDS_QUIZ_BANK, NOON_SURAHS, TajweedRuleInfo } from '../data/noonSakinahData';

interface NoonSakinahSectionProps {
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

// Acoustic synthesizer for Noon Sakinah & Tanween rules
function playNoonSakinahSound(ruleId: string, subOption?: string) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (ruleId === 'ith-har') {
      // Clear crisp pure tone
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(330, now + 0.18);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.26);
    } else if (subOption === 'without_ghunnah' || ruleId === 'idgham_bighunnah') {
      // Complete insertion without nasal resonance
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(290, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.15);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.07, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
    } else {
      // Rich nasal Ghunnah hum of 2 harakat (approx 0.8s)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.linearRampToValueAtTime(270, now + 0.4);
      osc.frequency.linearRampToValueAtTime(255, now + 0.8);

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(520, now);

      const gain2 = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.065, now + 0.05);
      gain.gain.setValueAtTime(0.065, now + 0.65);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);

      gain2.gain.setValueAtTime(0.025, now);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);

      osc.connect(gain);
      osc2.connect(gain2);
      gain.connect(ctx.destination);
      gain2.connect(ctx.destination);

      osc.start(now);
      osc2.start(now);
      osc.stop(now + 0.86);
      osc2.stop(now + 0.86);
    }
  } catch {
    // Audio context fallback
  }
}

export const NoonSakinahSection: React.FC<NoonSakinahSectionProps> = ({
  activeTab,
  tabDirection,
  playChime,
  triggerConfetti,
  toArabicDigits,
}) => {
  // Tab 1 state: Selected Rule Card
  const [selectedRuleId, setSelectedRuleId] = useState<'ith-har' | 'idgham_ghunnah' | 'iqlab' | 'ikhfa'>('ith-har');
  const [activeSubOption, setActiveSubOption] = useState<string>('with_ghunnah');
  const [isSimulatingGhunnah, setIsSimulatingGhunnah] = useState(false);

  // Tab 2 state: Letter classification game with iOS Stopwatch
  const ALL_LETTERS_TEST = [
    { letter: 'ء', rule: 'ith-har', ruleName: 'الإظهار الحلقي' },
    { letter: 'ي', rule: 'idgham_ghunnah', ruleName: 'الإدغام' },
    { letter: 'ب', rule: 'iqlab', ruleName: 'الإقلاب' },
    { letter: 'ر', rule: 'idgham_ghunnah', ruleName: 'الإدغام' },
    { letter: 'ص', rule: 'ikhfa', ruleName: 'الإخفاء الحقيقي' },
    { letter: 'ح', rule: 'ith-har', ruleName: 'الإظهار الحلقي' },
    { letter: 'م', rule: 'idgham_ghunnah', ruleName: 'الإدغام' },
    { letter: 'ل', rule: 'idgham_ghunnah', ruleName: 'الإدغام' },
    { letter: 'ق', rule: 'ikhfa', ruleName: 'الإخفاء الحقيقي' },
    { letter: 'خ', rule: 'ith-har', ruleName: 'الإظهار الحلقي' },
    { letter: 'و', rule: 'idgham_ghunnah', ruleName: 'الإدغام' },
    { letter: 'ش', rule: 'ikhfa', ruleName: 'الإخفاء الحقيقي' },
    { letter: 'هـ', rule: 'ith-har', ruleName: 'الإظهار الحلقي' },
    { letter: 'ن', rule: 'idgham_ghunnah', ruleName: 'الإدغام' },
    { letter: 'ك', rule: 'ikhfa', ruleName: 'الإخفاء الحقيقي' },
    { letter: 'ع', rule: 'ith-har', ruleName: 'الإظهار الحلقي' },
    { letter: 'ت', rule: 'ikhfa', ruleName: 'الإخفاء الحقيقي' },
    { letter: 'غ', rule: 'ith-har', ruleName: 'الإظهار الحلقي' },
  ];

  const [testLetters, setTestLetters] = useState(() => [...ALL_LETTERS_TEST].sort(() => Math.random() - 0.5));
  const [currentLetterIdx, setCurrentLetterIdx] = useState(0);
  const [letterScore, setLetterScore] = useState(0);
  const [letterStatus, setLetterStatus] = useState<{ msg: string; kind: 'ok' | 'bad' | null }>({ msg: '', kind: null });
  const [gameTimer, setGameTimer] = useState(0);
  const [gameTimerStatus, setGameTimerStatus] = useState<'idle' | 'running' | 'paused' | 'finished'>('idle');

  const startLetterGame = () => {
    setTestLetters([...ALL_LETTERS_TEST].sort(() => Math.random() - 0.5));
    setCurrentLetterIdx(0);
    setLetterScore(0);
    setGameTimer(0);
    setGameTimerStatus('idle');
    setLetterStatus({ msg: '', kind: null });
  };

  const handleStartOrPauseTimer = () => {
    if (gameTimerStatus === 'idle') {
      setGameTimerStatus('running');
      setLetterStatus({ msg: 'بدأ حساب الوقت ⏱ صنّف الحرف المعروض باختيار حكمه الصحيح', kind: 'ok' });
      setTimeout(() => {
        setLetterStatus(prev => prev.msg.includes('بدأ حساب الوقت') ? { msg: '', kind: null } : prev);
      }, 1800);
    } else if (gameTimerStatus === 'running') {
      setGameTimerStatus('paused');
      setLetterStatus({ msg: 'تم إيقاف العداد مؤقتاً ⏸', kind: null });
    } else if (gameTimerStatus === 'paused') {
      setGameTimerStatus('running');
      setLetterStatus({ msg: 'تم استئناف العداد ▶', kind: 'ok' });
      setTimeout(() => {
        setLetterStatus(prev => prev.msg.includes('تم استئناف') ? { msg: '', kind: null } : prev);
      }, 1500);
    } else if (gameTimerStatus === 'finished') {
      startLetterGame();
    }
  };

  const handleResetTimer = () => {
    setGameTimer(0);
    setLetterScore(0);
    setCurrentLetterIdx(0);
    setGameTimerStatus('idle');
    setLetterStatus({ msg: 'تمت إعادة ضبط العداد للصفر ⏱', kind: 'ok' });
    setTimeout(() => {
      setLetterStatus(prev => prev.msg.includes('إعادة ضبط') ? { msg: '', kind: null } : prev);
    }, 1500);
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activeTab === 'letters' && gameTimerStatus === 'running') {
      interval = setInterval(() => {
        setGameTimer(t => t + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeTab, gameTimerStatus]);

  // Tab 3 state: Words Bank Quiz
  const [wordIdx, setWordIdx] = useState(0);
  const [selectedWordAnswer, setSelectedWordAnswer] = useState<string | null>(null);
  const [wordScore, setWordScore] = useState(0);
  const [wordStatus, setWordStatus] = useState<{ msg: string; kind: 'ok' | 'bad' | null }>({ msg: '', kind: null });

  // Tab 4 state: Surah and Free text
  const [activeSubTab, setActiveSubTab] = useState<'surah' | 'free'>('surah');
  const [selectedSurahKey, setSelectedSurahKey] = useState('الإخلاص');
  const [revealedAyatCases, setRevealedAyatCases] = useState<Record<number, boolean>>({});
  const [freeText, setFreeText] = useState('');

  const currentLetterItem = testLetters[currentLetterIdx] || testLetters[0];
  const currentWordQuiz = NOON_WORDS_QUIZ_BANK[wordIdx % NOON_WORDS_QUIZ_BANK.length];
  const currentSurah = NOON_SURAHS[selectedSurahKey] || NOON_SURAHS['الإخلاص'];

  // Handle Letter Game Answer
  const handleLetterAnswer = (selectedRule: string) => {
    if (gameTimerStatus === 'finished') return;

    if (gameTimerStatus === 'idle') {
      setGameTimerStatus('running');
    }

    if (selectedRule === currentLetterItem.rule) {
      playChime(true);
      playNoonSakinahSound(selectedRule);
      const newScore = letterScore + 10;
      setLetterScore(newScore);
      setLetterStatus({ msg: `أحسنت! «${currentLetterItem.letter}» يتبع حكم ${currentLetterItem.ruleName} ✓`, kind: 'ok' });

      if (currentLetterIdx + 1 >= testLetters.length) {
        setGameTimerStatus('finished');
        triggerConfetti();
        setLetterStatus({ msg: `رائع جداً! أنهيت جميع الحروف في ${toArabicDigits(gameTimer)} ثانية (${toArabicDigits(newScore)} نقطة) 🎉`, kind: 'ok' });
      } else {
        setTimeout(() => {
          setCurrentLetterIdx(prev => prev + 1);
          setLetterStatus({ msg: '', kind: null });
        }, 550);
      }
    } else {
      playChime(false);
      setLetterStatus({ msg: `حاول ثانية! حرف «${currentLetterItem.letter}» يتبع ${currentLetterItem.ruleName}`, kind: 'bad' });
    }
  };

  // Handle Word Quiz Answer
  const handleWordQuizAnswer = (ruleId: string) => {
    if (selectedWordAnswer) return;
    setSelectedWordAnswer(ruleId);

    const isMatch = ruleId === currentWordQuiz.ruleId || 
      (ruleId === 'idgham_ghunnah' && currentWordQuiz.ruleId.startsWith('idgham'));

    if (isMatch) {
      playChime(true);
      playNoonSakinahSound(ruleId);
      setWordScore(prev => prev + 10);
      setWordStatus({ msg: `أحسنت! الحكم هنا هو «${currentWordQuiz.ruleName}» ✓`, kind: 'ok' });
      if ((wordIdx + 1) % NOON_WORDS_QUIZ_BANK.length === 0) {
        triggerConfetti();
      }
    } else {
      playChime(false);
      setWordStatus({ msg: `الحكم الصحيح هنا هو «${currentWordQuiz.ruleName}»`, kind: 'bad' });
    }
  };

  const nextWordQuiz = () => {
    setSelectedWordAnswer(null);
    setWordStatus({ msg: '', kind: null });
    setWordIdx(prev => (prev + 1) % NOON_WORDS_QUIZ_BANK.length);
  };

  // Interactive 3D Card Click handler for Rules Showcase
  const handleRuleCardClick = (ruleKey: 'ith-har' | 'idgham_ghunnah' | 'iqlab' | 'ikhfa', e: React.MouseEvent<HTMLDivElement>) => {
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

    setSelectedRuleId(ruleKey);
    playNoonSakinahSound(ruleKey);
    playChime(true);
  };

  const currentRuleObj = NOON_SAKINAH_RULES[selectedRuleId] || NOON_SAKINAH_RULES['ith-har'];

  return (
    <div className="noon-sakinah-wrapper" id="noon-sakinah-section-root">
      <AnimatePresence mode="wait" custom={tabDirection}>
        {/* ========================================================
            TAB 1: EXPLANATION & INTERACTIVE RULES
           ======================================================== */}
        {activeTab === 'explain' && (
          <motion.section
            key="noon-explain"
            className="panel active"
            id="panel-noon-explain"
            custom={tabDirection}
            variants={panelVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <div className="card explain-card" id="card-noon-overview">
              <header className="explain-col-header" id="noon-header-rules">
                <h2 className="intro-subheading subheading-prominent theme-emerald">
                  <span className="subheading-accent-bar" aria-hidden="true" />
                  <span className="subheading-text">أحكام النون الساكنة والتنوين الأربعة</span>
                </h2>
              </header>

              {/* 1. 4 Showcase Cards at the Top (Full Width) */}
              <div className="letters-four-showcase" id="noon-rules-showcase">
                {/* Card 1: الإظهار الحلقي (Emerald Theme - c1) */}
                <div className="card-glow-wrap">
                  <div
                    className={`letter-card c1 ${selectedRuleId === 'ith-har' ? 'card-active card-selected-letter' : ''}`}
                    id="rule-card-ith-har"
                    onClick={e => handleRuleCardClick('ith-har', e)}
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
                    </svg>
                    <div className="glyph">إِظْهَار</div>
                    <div className="glyph-name">٦ أحرف حلقية</div>
                  </div>
                </div>

                {/* Card 2: الإدغام (Sky Theme - c3) */}
                <div className="card-glow-wrap">
                  <div
                    className={`letter-card c3 ${selectedRuleId === 'idgham_ghunnah' ? 'card-active card-selected-letter' : ''}`}
                    id="rule-card-idgham"
                    onClick={e => handleRuleCardClick('idgham_ghunnah', e)}
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
                    </svg>
                    <div className="glyph">إِدْغَام</div>
                    <div className="glyph-name">٦ أحرف (يَرْمَلُون)</div>
                  </div>
                </div>

                {/* Card 3: الإقلاب (Amber Theme - c2) */}
                <div className="card-glow-wrap">
                  <div
                    className={`letter-card c2 ${selectedRuleId === 'iqlab' ? 'card-active card-selected-letter' : ''}`}
                    id="rule-card-iqlab"
                    onClick={e => handleRuleCardClick('iqlab', e)}
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
                    </svg>
                    <div className="glyph">إِقْلَاب</div>
                    <div className="glyph-name">حرف واحد (الباء)</div>
                  </div>
                </div>

                {/* Card 4: الإخفاء الحقيقي (Purple Theme - c4) */}
                <div className="card-glow-wrap">
                  <div
                    className={`letter-card c4 ${selectedRuleId === 'ikhfa' ? 'card-active card-selected-letter' : ''}`}
                    id="rule-card-ikhfa"
                    onClick={e => handleRuleCardClick('ikhfa', e)}
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
                    </svg>
                    <div className="glyph">إِخْفَاء</div>
                    <div className="glyph-name">١٥ حرفاً متبقية</div>
                  </div>
                </div>
              </div>

              {/* 2. Directly Underneath: Single Dedicated Explanation Suite for the Selected Rule */}
              <div className="noon-dedicated-container" id="noon-col-rules">
                
                {/* -------------------- SECTION 1: الإظهار الحلقي -------------------- */}
                {selectedRuleId === 'ith-har' && (
                  <motion.div
                    key="panel-rule-ith-har"
                    variants={staggerItemVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    className="noon-dedicated-panel theme-ith-har"
                    id="dedicated-panel-ith-har"
                  >
                    {/* Header */}
                    <div className="noon-dedicated-header">
                      <div className="noon-header-main-meta">
                        <div className="noon-header-badge-avatar bg-emerald-600">
                          ظ
                        </div>
                        <div className="noon-header-text-block">
                          <div className="noon-header-title-row">
                            <h3 className="noon-header-title">حكم الإظهار الحلقي</h3>
                            <span className="noon-header-badge bg-emerald-50 text-emerald-800 border-emerald-300">
                              ٦ أحرف حلقية
                            </span>
                            <span className="noon-header-badge bg-slate-100 text-slate-700 border-slate-300">
                              بدون غنة زائدة
                            </span>
                          </div>
                          <p className="noon-header-summary">
                            نطق النون الساكنة أو التنوين واضحة جلية مظهرة من مخرجها دون سكت ولا قلقلة ولا مد في الغنة.
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          playNoonSakinahSound('ith-har');
                          playChime(true);
                        }}
                        className="noon-listen-hero-btn bg-emerald-600 hover:bg-emerald-700"
                        title="استمع لنطق الإظهار الحلقي"
                      >
                        <Volume2 className="w-4 h-4" />
                        <span>استمع لنطق الإظهار الحلقي</span>
                      </button>
                    </div>

                    {/* Interactive Letters Belt */}
                    <div className="noon-letters-interactive-belt">
                      <span className="noon-letters-belt-label">حروف الإظهار الستة:</span>
                      <div className="noon-letters-chips-list">
                        {NOON_SAKINAH_RULES['ith-har'].letters.map((char, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              playNoonSakinahSound('ith-har');
                              playChime(true);
                            }}
                            className="noon-interactive-char-chip border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                            title={`حرف الإظهار: ${char}`}
                          >
                            {char}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Poetic Matn Quote */}
                    <div className="noon-matn-banner">
                      <BookOpen className="w-5 h-5 text-amber-700 shrink-0 mt-1" />
                      <div>
                        <strong className="text-xs font-bold text-amber-900 block mb-1">
                          ضابط حروف الإظهار من تحفة الأطفال:
                        </strong>
                        <div className="noon-matn-verse-quote">
                          « هَمْزٌ فَهَاءٌ ثُمَّ عَيْنٌ حَاءُ ... مُهْمَلَتَانِ ثُمَّ غَيْنٌ خَاءُ »
                        </div>
                      </div>
                    </div>

                    {/* Essential Student Tajweed Breakdown */}
                    <div className="noon-subsections-grid">
                      <div className="noon-detail-feature-card">
                        <div className="noon-feature-card-header text-emerald-800">
                          <Layers className="w-4 h-4 text-emerald-600" />
                          <span>مراتب الإظهار الحلقي الثلاث:</span>
                        </div>
                        <div className="noon-feature-card-body">
                          <ul className="space-y-1.5 list-disc list-inside">
                            <li><strong className="text-slate-800">أقصى الحلق (العليا):</strong> الهمزة والهاء (ء، هـ) — أبعد نقطة في الحلق.</li>
                            <li><strong className="text-slate-800">وسط الحلق (الوسطى):</strong> العين والحاء (ع، ح).</li>
                            <li><strong className="text-slate-800">أدنى الحلق (الدنيا):</strong> الغين والخاء (غ، خ) — الأقرب للفم.</li>
                          </ul>
                        </div>
                      </div>

                      <div className="noon-detail-feature-card">
                        <div className="noon-feature-card-header text-emerald-800">
                          <Check className="w-4 h-4 text-emerald-600" />
                          <span>علامة الإظهار في ضبط المصحف:</span>
                        </div>
                        <div className="noon-feature-card-body">
                          <p className="mb-2">
                            • وضع <strong className="text-emerald-900 font-bold">رأس خاء صغيرة (سكون أصلي)</strong> فوق النون الساكنة: مثل <span className="font-serif font-bold text-base">«مَنْ آمَنَ»</span>.
                          </p>
                          <p>
                            • تراكب حركتي التنوين فوق بعضهما تماماً (ضمتان إحداهما مقلوبة، أو فتحتان/كسرتان متساويتان).
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Quranic Examples Table */}
                    <div className="noon-examples-table-card">
                      <div className="noon-examples-table-header">
                        <span>أمثلة قرآنية محققة لحكم الإظهار الحلقي:</span>
                        <span className="text-xs text-slate-500 font-normal">انقر على أي مثال للاستماع</span>
                      </div>
                      <div className="noon-examples-three-cols">
                        <div className="noon-example-col-unit">
                          <span className="noon-col-unit-label">في كلمة واحدة</span>
                          <span className="noon-col-unit-word text-emerald-800">
                            يَنْأَوْنَ
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              playNoonSakinahSound('ith-har');
                              playChime(true);
                            }}
                            className="noon-example-listen-btn"
                          >
                            <Volume2 className="w-3 h-3 text-emerald-600" />
                            <span>استمع للنطق</span>
                          </button>
                        </div>

                        <div className="noon-example-col-unit">
                          <span className="noon-col-unit-label">في كلمتين</span>
                          <span className="noon-col-unit-word text-emerald-800">
                            مَنْ آمَنَ
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              playNoonSakinahSound('ith-har');
                              playChime(true);
                            }}
                            className="noon-example-listen-btn"
                          >
                            <Volume2 className="w-3 h-3 text-emerald-600" />
                            <span>استمع للنطق</span>
                          </button>
                        </div>

                        <div className="noon-example-col-unit">
                          <span className="noon-col-unit-label">مع التنوين</span>
                          <span className="noon-col-unit-word text-emerald-800">
                            عَلِيمٌ حَكِيمٌ
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              playNoonSakinahSound('ith-har');
                              playChime(true);
                            }}
                            className="noon-example-listen-btn"
                          >
                            <Volume2 className="w-3 h-3 text-emerald-600" />
                            <span>استمع للنطق</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Pitfall Warning Box */}
                    <div className="noon-alert-pitfall-box">
                      <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <strong className="font-bold text-rose-900 block mb-0.5">احذر هذا الخطأ الشائع:</strong>
                        إياك والسكت على النون عند الإظهار أو قلقلتها كأن تقول (أَنْ - عَمْتَ)، بل أجرِ النون بطبيعتها دون فصل ولا غنة زائدة.
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* -------------------- SECTION 2: الإدغام بقسميه -------------------- */}
                {selectedRuleId === 'idgham_ghunnah' && (
                  <motion.div
                    key="panel-rule-idgham"
                    variants={staggerItemVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    className="noon-dedicated-panel theme-idgham"
                    id="dedicated-panel-idgham"
                  >
                    {/* Header */}
                    <div className="noon-dedicated-header">
                      <div className="noon-header-main-meta">
                        <div className="noon-header-badge-avatar bg-sky-600">
                          د
                        </div>
                        <div className="noon-header-text-block">
                          <div className="noon-header-title-row">
                            <h3 className="noon-header-title">حكم الإدغام بقسميه</h3>
                            <span className="noon-header-badge bg-sky-50 text-sky-800 border-sky-300">
                              ٦ أحرف (يَرْمَلُون)
                            </span>
                            <span className="noon-header-badge bg-blue-50 text-blue-800 border-blue-300">
                              قسمان: بغنة وبغير غنة
                            </span>
                          </div>
                          <p className="noon-header-summary">
                            إدخال النون الساكنة أو التنوين في الحرف التالي بحيث يصيران حرفاً واحداً مشدداً كالثاني.
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          playNoonSakinahSound('idgham_ghunnah', activeSubOption);
                          playChime(true);
                        }}
                        className="noon-listen-hero-btn bg-sky-600 hover:bg-sky-700"
                        title="استمع لنطق الإدغام"
                      >
                        <Volume2 className="w-4 h-4" />
                        <span>استمع لصوت الإدغام</span>
                      </button>
                    </div>

                    {/* Interactive Letters Belt */}
                    <div className="noon-letters-interactive-belt">
                      <span className="noon-letters-belt-label">حروف الإدغام الستة (يَرْمَلُون):</span>
                      <div className="noon-letters-chips-list">
                        {['ي', 'ر', 'م', 'ل', 'و', 'ن'].map((char, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              const isWithGhunnah = ['ي', 'ن', 'م', 'و'].includes(char);
                              setActiveSubOption(isWithGhunnah ? 'with_ghunnah' : 'without_ghunnah');
                              playNoonSakinahSound(isWithGhunnah ? 'idgham_ghunnah' : 'idgham_bighunnah');
                              playChime(true);
                            }}
                            className={`noon-interactive-char-chip ${['ي', 'ن', 'م', 'و'].includes(char) ? 'border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100' : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'}`}
                            title={`حرف إدغام: ${char} (${['ي', 'ن', 'م', 'و'].includes(char) ? 'بغنة' : 'بغير غنة'})`}
                          >
                            {char}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Poetic Matn Quote */}
                    <div className="noon-matn-banner">
                      <BookOpen className="w-5 h-5 text-amber-700 shrink-0 mt-1" />
                      <div>
                        <strong className="text-xs font-bold text-amber-900 block mb-1">
                          ضابط الإدغام وقسميه من تحفة الأطفال:
                        </strong>
                        <div className="noon-matn-verse-quote">
                          « وَالثَّانِ إِدْغَامٌ بِسِتَّةٍ أَتَتْ ... فِي (يَرْمَلُونَ) عِنْدَهُمْ قَدْ ثَبَتَتْ »
                          <br />
                          « لَكِنَّهَا قِسْمَانِ: قِسْمٌ يُدْغَمَا ... فِيهِ بِغُنَّةٍ بِـ (يَنْمُو) عُلِمَا »
                          <br />
                          « وَالثَّانِ إِدْغَامٌ بِغَيْرِ غُنَّهْ ... فِي اللَّامِ وَالرَّا ثُمَّ كَرِّرَنَّهْ »
                        </div>
                      </div>
                    </div>

                    {/* Two Clear Divisions & Golden Rule of Two Words */}
                    <div className="noon-subsections-grid">
                      {/* Division 1: With Ghunnah */}
                      <div className="noon-detail-feature-card border-sky-200">
                        <div className="noon-feature-card-header text-sky-800">
                          <Sparkles className="w-4 h-4 text-sky-600" />
                          <span>١. إدغام بغنة (ناقص):</span>
                        </div>
                        <div className="noon-feature-card-body">
                          <p className="mb-1.5 font-bold text-sky-900">
                            • حروفه ٤ مجموعة في لفظ: (يَنْمُو)
                          </p>
                          <p>
                            تندمج النون في الحرف التالي مع إخراج غنة رنانة من الخيشوم بمقدار حركتين كاملتين.
                          </p>
                        </div>
                      </div>

                      {/* Division 2: Without Ghunnah */}
                      <div className="noon-detail-feature-card border-indigo-200">
                        <div className="noon-feature-card-header text-indigo-800">
                          <Check className="w-4 h-4 text-indigo-600" />
                          <span>٢. إدغام بغير غنة (كامل):</span>
                        </div>
                        <div className="noon-feature-card-body">
                          <p className="mb-1.5 font-bold text-indigo-900">
                            • حرفاه ٢ فقط: (اللام والراء)
                          </p>
                          <p>
                            تندمج النون بالكامل دون أن يبقى أي أثر لصوت الغنة، فيُنطق حرف اللام أو الراء مشدداً خالصاً.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Golden Condition & Absolute Idhar Note */}
                    <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-3.5 text-xs text-blue-900 leading-relaxed">
                      <strong className="font-bold text-blue-800 block mb-1 text-sm">
                        ⭐ فائدة ذهبية للطالب (شرط الإدغام والإظهار المطلق):
                      </strong>
                      يشترط للإدغام أن تقع النون في كلمة وحرف الإدغام في الكلمة التالية؛ فإن اجتمعا في <strong className="underline">كلمة واحدة</strong> وَجَبَ <strong>الإظهار المطلق</strong> منعاً للالتباس، وقد وقع في ٤ كلمات فقط في القرآن كله:
                      <div className="flex items-center gap-3 justify-center font-serif font-extrabold text-base text-blue-950 mt-2">
                        <span className="bg-white px-2.5 py-1 rounded-lg border border-blue-200">الدُّنْيَا</span>
                        <span className="bg-white px-2.5 py-1 rounded-lg border border-blue-200">بُنْيَان</span>
                        <span className="bg-white px-2.5 py-1 rounded-lg border border-blue-200">قِنْوَان</span>
                        <span className="bg-white px-2.5 py-1 rounded-lg border border-blue-200">صِنْوَان</span>
                      </div>
                    </div>

                    {/* Quranic Examples Table */}
                    <div className="noon-examples-table-card">
                      <div className="noon-examples-table-header">
                        <span>أمثلة تطبيقية للإدغام:</span>
                        <span className="text-xs text-slate-500 font-normal">انقر على أي مثال للاستماع</span>
                      </div>
                      <div className="noon-examples-three-cols">
                        <div className="noon-example-col-unit">
                          <span className="noon-col-unit-label">إدغام بغنة (كلمتان)</span>
                          <span className="noon-col-unit-word text-sky-800">
                            مَن يَقُولُ
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              playNoonSakinahSound('idgham_ghunnah', 'with_ghunnah');
                              playChime(true);
                            }}
                            className="noon-example-listen-btn"
                          >
                            <Volume2 className="w-3 h-3 text-sky-600" />
                            <span>استمع للنطق</span>
                          </button>
                        </div>

                        <div className="noon-example-col-unit">
                          <span className="noon-col-unit-label">إدغام بغير غنة (كامل)</span>
                          <span className="noon-col-unit-word text-sky-800">
                            مِن رَّبِّهِمْ
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              playNoonSakinahSound('idgham_bighunnah', 'without_ghunnah');
                              playChime(true);
                            }}
                            className="noon-example-listen-btn"
                          >
                            <Volume2 className="w-3 h-3 text-sky-600" />
                            <span>استمع للنطق</span>
                          </button>
                        </div>

                        <div className="noon-example-col-unit">
                          <span className="noon-col-unit-label">مع التنوين</span>
                          <span className="noon-col-unit-word text-sky-800">
                            وُجُوهٌ يَوْمَئِذٍ
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              playNoonSakinahSound('idgham_ghunnah', 'with_ghunnah');
                              playChime(true);
                            }}
                            className="noon-example-listen-btn"
                          >
                            <Volume2 className="w-3 h-3 text-sky-600" />
                            <span>استمع للنطق</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Pitfall Warning Box */}
                    <div className="noon-alert-pitfall-box">
                      <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <strong className="font-bold text-rose-900 block mb-0.5">احذر هذا الخطأ الشائع:</strong>
                        احذر من إخراج غنة مع اللام والراء عند قوله (مِن رَّبِّهِمْ)؛ فالإدغام فيهما تام وكامل بغير غنة، كما يجب الانتباه لعدم إدغام كلمات الإظهار المطلق (دنيا، بنيان).
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* -------------------- SECTION 3: الإقلاب -------------------- */}
                {selectedRuleId === 'iqlab' && (
                  <motion.div
                    key="panel-rule-iqlab"
                    variants={staggerItemVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    className="noon-dedicated-panel theme-iqlab"
                    id="dedicated-panel-iqlab"
                  >
                    {/* Header */}
                    <div className="noon-dedicated-header">
                      <div className="noon-header-main-meta">
                        <div className="noon-header-badge-avatar bg-amber-600">
                          ق
                        </div>
                        <div className="noon-header-text-block">
                          <div className="noon-header-title-row">
                            <h3 className="noon-header-title">حكم الإقلاب (القلب)</h3>
                            <span className="noon-header-badge bg-amber-50 text-amber-800 border-amber-300">
                              حرف واحد فقط (الباء)
                            </span>
                            <span className="noon-header-badge bg-orange-50 text-orange-800 border-orange-300">
                              غنة حركتان مع الميم
                            </span>
                          </div>
                          <p className="noon-header-summary">
                            قلب النون الساكنة أو التنوين ميماً مخفاة بغنة حركتين عند ملاقاة حرف الباء.
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          playNoonSakinahSound('iqlab');
                          playChime(true);
                        }}
                        className="noon-listen-hero-btn bg-amber-600 hover:bg-amber-700"
                        title="استمع لنطق الإقلاب"
                      >
                        <Volume2 className="w-4 h-4" />
                        <span>استمع لصوت الإقلاب</span>
                      </button>
                    </div>

                    {/* Interactive Letters Belt */}
                    <div className="noon-letters-interactive-belt">
                      <span className="noon-letters-belt-label">حرف الإقلاب الوحيد:</span>
                      <div className="noon-letters-chips-list">
                        <button
                          type="button"
                          onClick={() => {
                            playNoonSakinahSound('iqlab');
                            playChime(true);
                          }}
                          className="noon-interactive-char-chip border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 font-extrabold text-xl"
                          title="حرف الإقلاب: الباء (ب)"
                        >
                          ب
                        </button>
                        <span className="text-xs text-slate-500 font-bold mr-2">
                          (وعلامته ميم صغيرة قائمة ۘ أو ۢ)
                        </span>
                      </div>
                    </div>

                    {/* Poetic Matn Quote */}
                    <div className="noon-matn-banner">
                      <BookOpen className="w-5 h-5 text-amber-700 shrink-0 mt-1" />
                      <div>
                        <strong className="text-xs font-bold text-amber-900 block mb-1">
                          ضابط الإقلاب من تحفة الأطفال:
                        </strong>
                        <div className="noon-matn-verse-quote">
                          « وَالثَّالِثُ الإِقْلَابُ عِنْدَ الْبَاءِ ... مِيمًا بِغُنَّةٍ مَعَ الإِخْفَاءِ »
                        </div>
                      </div>
                    </div>

                    {/* 3 Step Practical Pronunciation & Mushaf Sign */}
                    <div className="noon-subsections-grid">
                      <div className="noon-detail-feature-card">
                        <div className="noon-feature-card-header text-amber-900">
                          <Layers className="w-4 h-4 text-amber-600" />
                          <span>الخطوات العملية الثلاث لنطق الإقلاب:</span>
                        </div>
                        <div className="noon-feature-card-body">
                          <ol className="space-y-1.5 list-decimal list-inside text-slate-700">
                            <li><strong className="text-amber-950">قلب النون أو التنوين ميماً خالصة</strong> لفظاً لا خطاً.</li>
                            <li><strong className="text-amber-950">إخفاء هذه الميم</strong> بتلامس الشفتين برفق واعتدال بدون كزّ.</li>
                            <li><strong className="text-amber-950">إظهار الغنة الرنانة</strong> من الخيشوم بمقدار حركتين.</li>
                          </ol>
                        </div>
                      </div>

                      <div className="noon-detail-feature-card">
                        <div className="noon-feature-card-header text-amber-900">
                          <Check className="w-4 h-4 text-amber-600" />
                          <span>علامة الإقلاب في ضبط المصحف:</span>
                        </div>
                        <div className="noon-feature-card-body">
                          <p className="mb-2">
                            • وضع <strong className="text-amber-900 font-bold">ميم صغيرة قائمة (ۘ / ۢ)</strong> فوق النون الساكنة بدلاً من السكون: <span className="font-serif font-bold text-base">«مِنۢ بَعْدِ»</span>.
                          </p>
                          <p>
                            • وضع الميم الصغيرة بدل الحركة الثانية في التنوين: <span className="font-serif font-bold text-base">«عَلِيمٌۢ بِذَاتِ»</span>.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Quranic Examples Table */}
                    <div className="noon-examples-table-card">
                      <div className="noon-examples-table-header">
                        <span>أمثلة تطبيقية للإقلاب:</span>
                        <span className="text-xs text-slate-500 font-normal">انقر على أي مثال للاستماع</span>
                      </div>
                      <div className="noon-examples-three-cols">
                        <div className="noon-example-col-unit">
                          <span className="noon-col-unit-label">في كلمة واحدة</span>
                          <span className="noon-col-unit-word text-amber-900">
                            أَنۢبِئْهُم
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              playNoonSakinahSound('iqlab');
                              playChime(true);
                            }}
                            className="noon-example-listen-btn"
                          >
                            <Volume2 className="w-3 h-3 text-amber-600" />
                            <span>استمع للنطق</span>
                          </button>
                        </div>

                        <div className="noon-example-col-unit">
                          <span className="noon-col-unit-label">في كلمتين</span>
                          <span className="noon-col-unit-word text-amber-900">
                            مِنۢ بَعْدِ
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              playNoonSakinahSound('iqlab');
                              playChime(true);
                            }}
                            className="noon-example-listen-btn"
                          >
                            <Volume2 className="w-3 h-3 text-amber-600" />
                            <span>استمع للنطق</span>
                          </button>
                        </div>

                        <div className="noon-example-col-unit">
                          <span className="noon-col-unit-label">مع التنوين</span>
                          <span className="noon-col-unit-word text-amber-900">
                            سَمِيعٌۢ بَصِيرٌ
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              playNoonSakinahSound('iqlab');
                              playChime(true);
                            }}
                            className="noon-example-listen-btn"
                          >
                            <Volume2 className="w-3 h-3 text-amber-600" />
                            <span>استمع للنطق</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Pitfall Warning Box */}
                    <div className="noon-alert-pitfall-box">
                      <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <strong className="font-bold text-rose-900 block mb-0.5">احذر هذا الخطأ الشائع:</strong>
                        احذر من كزّ الشفتين وإطباقهما بقوة مبالغ فيها عند نطق الميم المقلوبة حتى لا يخرج الصوت مكتوماً أو مشدداً؛ بل اجعل الشفتين تتلامسان برفق وسلاسة.
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* -------------------- SECTION 4: الإخفاء الحقيقي -------------------- */}
                {selectedRuleId === 'ikhfa' && (
                  <motion.div
                    key="panel-rule-ikhfa"
                    variants={staggerItemVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    className="noon-dedicated-panel theme-ikhfa"
                    id="dedicated-panel-ikhfa"
                  >
                    {/* Header */}
                    <div className="noon-dedicated-header">
                      <div className="noon-header-main-meta">
                        <div className="noon-header-badge-avatar bg-purple-600">
                          خ
                        </div>
                        <div className="noon-header-text-block">
                          <div className="noon-header-title-row">
                            <h3 className="noon-header-title">حكم الإخفاء الحقيقي</h3>
                            <span className="noon-header-badge bg-purple-50 text-purple-800 border-purple-300">
                              ١٥ حرفاً متبقية
                            </span>
                            <span className="noon-header-badge bg-fuchsia-50 text-fuchsia-800 border-fuchsia-300">
                              غنة حركتان مفخمة أو مرققة
                            </span>
                          </div>
                          <p className="noon-header-summary">
                            نطق النون الساكنة أو التنوين بحالة متوسطة بين الإظهار والإدغام عارية عن التشديد مع غنة حركتين تتبع ما بعدها.
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          playNoonSakinahSound('ikhfa', activeSubOption);
                          playChime(true);
                        }}
                        className="noon-listen-hero-btn bg-purple-600 hover:bg-purple-700"
                        title="استمع لنطق الإخفاء الحقيقي"
                      >
                        <Volume2 className="w-4 h-4" />
                        <span>استمع لصوت الإخفاء</span>
                      </button>
                    </div>

                    {/* Interactive Letters Belt */}
                    <div className="noon-letters-interactive-belt">
                      <span className="noon-letters-belt-label">حروف الإخفاء الـ ١٥:</span>
                      <div className="noon-letters-chips-list">
                        {NOON_SAKINAH_RULES['ikhfa'].letters.map((char, idx) => {
                          const isMufakham = ['ص', 'ض', 'ط', 'ظ', 'ق'].includes(char);
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setActiveSubOption(isMufakham ? 'tafkheem' : 'tarqeeq');
                                playNoonSakinahSound('ikhfa', isMufakham ? 'tafkheem' : 'tarqeeq');
                                playChime(true);
                              }}
                              className={`noon-interactive-char-chip ${isMufakham ? 'border-amber-400 bg-amber-50 text-amber-900 font-black' : 'border-purple-300 bg-purple-50 text-purple-900'}`}
                              title={`حرف إخفاء: ${char} (${isMufakham ? 'غنة مفخمة' : 'غنة مرققة'})`}
                            >
                              {char}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Poetic Matn Quote */}
                    <div className="noon-matn-banner">
                      <BookOpen className="w-5 h-5 text-amber-700 shrink-0 mt-1" />
                      <div>
                        <strong className="text-xs font-bold text-amber-900 block mb-1">
                          ضابط حروف الإخفاء من تحفة الأطفال (أوائل كلمات هذا البيت):
                        </strong>
                        <div className="noon-matn-verse-quote">
                          « صِفْ ذَا ثَنَا كَمْ جَادَ شَخْصٌ قَدْ سَمَا ... دُمْ طَيِّبًا زِدْ فِي تُقًى ضَعْ ظَالِمَا »
                        </div>
                      </div>
                    </div>

                    {/* Pronunciation Method & Tafkheem/Tarqeeq Rule */}
                    <div className="noon-subsections-grid">
                      <div className="noon-detail-feature-card">
                        <div className="noon-feature-card-header text-purple-900">
                          <Sparkles className="w-4 h-4 text-purple-600" />
                          <span>كيفية النطق الصحيحة:</span>
                        </div>
                        <div className="noon-feature-card-body">
                          <p className="mb-2">
                            • تهيئة اللسان والفم عند مخرج الحرف الآتي دون إلصاق اللسان بالحنك الأعلى.
                          </p>
                          <p>
                            • إخراج صوت الغنة الرنانة بمقدار حركتين كاملتين من الخيشوم (التجويف الأنفي).
                          </p>
                        </div>
                      </div>

                      <div className="noon-detail-feature-card">
                        <div className="noon-feature-card-header text-purple-900">
                          <Check className="w-4 h-4 text-purple-600" />
                          <span>ضابط تفخيم وترقيق غنة الإخفاء:</span>
                        </div>
                        <div className="noon-feature-card-body">
                          <p className="mb-1.5">
                            • <strong className="text-amber-900">غنة مفخمة:</strong> إذا جاء بعدها أحد حروف الاستعلاء الـ ٥ (ص، ض، ط، ظ، ق) مثل: <span className="font-serif font-bold">«مِن قَبْلُ»</span>.
                          </p>
                          <p>
                            • <strong className="text-purple-900">غنة مرققة:</strong> إذا جاء بعدها أحد حروف الاستفال الـ ١٠ الباقية مثل: <span className="font-serif font-bold">«مَن كَانَ»</span>.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Quranic Examples Table */}
                    <div className="noon-examples-table-card">
                      <div className="noon-examples-table-header">
                        <span>أمثلة تطبيقية للإخفاء الحقيقي:</span>
                        <span className="text-xs text-slate-500 font-normal">انقر على أي مثال للاستماع</span>
                      </div>
                      <div className="noon-examples-three-cols">
                        <div className="noon-example-col-unit">
                          <span className="noon-col-unit-label">في كلمة واحدة</span>
                          <span className="noon-col-unit-word text-purple-900">
                            مَنثُورًا
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              playNoonSakinahSound('ikhfa', 'tarqeeq');
                              playChime(true);
                            }}
                            className="noon-example-listen-btn"
                          >
                            <Volume2 className="w-3 h-3 text-purple-600" />
                            <span>استمع للنطق</span>
                          </button>
                        </div>

                        <div className="noon-example-col-unit">
                          <span className="noon-col-unit-label">في كلمتين (مفخمة)</span>
                          <span className="noon-col-unit-word text-purple-900">
                            مِن قَبْلُ
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              playNoonSakinahSound('ikhfa', 'tafkheem');
                              playChime(true);
                            }}
                            className="noon-example-listen-btn"
                          >
                            <Volume2 className="w-3 h-3 text-purple-600" />
                            <span>استمع للنطق</span>
                          </button>
                        </div>

                        <div className="noon-example-col-unit">
                          <span className="noon-col-unit-label">مع التنوين</span>
                          <span className="noon-col-unit-word text-purple-900">
                            قَوْلًا سَدِيدًا
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              playNoonSakinahSound('ikhfa', 'tarqeeq');
                              playChime(true);
                            }}
                            className="noon-example-listen-btn"
                          >
                            <Volume2 className="w-3 h-3 text-purple-600" />
                            <span>استمع للنطق</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Pitfall Warning Box */}
                    <div className="noon-alert-pitfall-box">
                      <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <strong className="font-bold text-rose-900 block mb-0.5">احذر هذا الخطأ الشائع:</strong>
                        احذر من إلصاق طرف اللسان بالحنك الأعلى عند الإخفاء كأنك تظهر النون؛ بل علق لسانك في الفم قريباً من مخرج الحرف التالي، واحذر كذلك من ترقيق الغنة قبل الحروف المفخمة (ص ض ط ظ ق).
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          </motion.section>
        )}

        {/* ========================================================
            TAB 2: RECOGNIZE LETTERS & RULES WITH IOS STOPWATCH
           ======================================================== */}
        {activeTab === 'letters' && (
          <motion.section
            key="noon-letters"
            className="panel active"
            id="panel-noon-letters"
            custom={tabDirection}
            variants={panelVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <div className="card" id="card-noon-letters-game">
              <motion.h2 variants={staggerItemVariants} className="intro-heading">
                <span className="ih-row">
                  <span className="ih-line"></span>
                  <span className="ih-diamond"></span>
                  <span className="ih-badge badge-search" aria-hidden="true">
                    <Search className="ih-badge-icon" />
                  </span>
                  <span className="ih-text">صنّف حرف النون الساكنة والتنوين</span>
                  <span className="ih-diamond"></span>
                  <span className="ih-line ih-line-r"></span>
                </span>
              </motion.h2>

              <motion.div variants={staggerItemVariants} className="instruction">
                انظر للحرف المعروض بالأسفل، واضغط على الحكم التجويدي الصحيح الذي ينتمي إليه بأسرع وقت.
              </motion.div>

              {/* Apple iOS Style Stopwatch matching All Chapters */}
              <motion.div variants={staggerItemVariants} className="ios-stopwatch-row" id="noon-letters-stats-row">
                <div className={`ios-stopwatch-dock ${gameTimerStatus}`} id="noon-pro-timer-dock">
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
              </motion.div>

              {/* Score & Counter Pills */}
              <motion.div variants={staggerItemVariants} className="flex items-center justify-center gap-3 my-2">
                <div className="stat-pill score-pill" id="noon-score-pill">
                  <span className="stat-icon">⭐</span>
                  <span>{toArabicDigits(letterScore)} نقطة</span>
                </div>
                <div className="counter-pill" id="noon-letters-counter">
                  الحرف {toArabicDigits(currentLetterIdx + 1)} من {toArabicDigits(testLetters.length)}
                </div>
              </motion.div>

              {/* Target Letter Spotlight */}
              <motion.div variants={staggerItemVariants} className="noon-target-letter-spotlight">
                <div className="noon-spotlight-glyph">{currentLetterItem.letter}</div>
                <div className="noon-spotlight-hint">ما هو حكم النون الساكنة أو التنوين إذا جاء بعدها حرف ({currentLetterItem.letter})؟</div>
              </motion.div>

              {/* Rule Choice Buttons */}
              <motion.div variants={staggerItemVariants} className="noon-rule-choices-grid">
                {[
                  { id: 'ith-har', name: 'الإظهار الحلقي', sub: '٦ حروف' },
                  { id: 'idgham_ghunnah', name: 'الإدغام', sub: '٦ حروف (يرملون)' },
                  { id: 'iqlab', name: 'الإقلاب', sub: 'حرف واحد (الباء)' },
                  { id: 'ikhfa', name: 'الإخفاء الحقيقي', sub: '١٥ حرفاً' },
                ].map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="noon-choice-btn"
                    id={`noon-choice-${r.id}`}
                    onClick={() => handleLetterAnswer(r.id)}
                  >
                    <span className="noon-choice-title">{r.name}</span>
                    <span className="noon-choice-sub">{r.sub}</span>
                  </button>
                ))}
              </motion.div>

              {/* Feedback status */}
              {letterStatus.msg && (
                <motion.div variants={staggerItemVariants} className={`level1-status-bubble ${letterStatus.kind || ''}`} role="status">
                  {letterStatus.msg}
                </motion.div>
              )}
            </div>
          </motion.section>
        )}

        {/* ========================================================
            TAB 3: TRAIN ON WORDS
           ======================================================== */}
        {activeTab === 'words' && (
          <motion.section
            key="noon-words"
            className="panel active"
            id="panel-noon-words"
            custom={tabDirection}
            variants={panelVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <div className="card max-w-2xl mx-auto" id="card-noon-words-game">
              <motion.h2 variants={staggerItemVariants} className="intro-heading">
                <span className="ih-row">
                  <span className="ih-line"></span>
                  <span className="ih-diamond"></span>
                  <span className="ih-badge badge-words" aria-hidden="true">
                    <Layers className="ih-badge-icon" />
                  </span>
                  <span className="ih-text">استخرج الحكم التجويدي من الكلمة</span>
                  <span className="ih-diamond"></span>
                  <span className="ih-line ih-line-r"></span>
                </span>
              </motion.h2>

              <motion.div variants={staggerItemVariants} className="instruction">
                اقرأ المثال القرآني الآتي بتركيز، وحدد الحكم التجويدي الصحيح للنون الساكنة أو التنوين.
              </motion.div>

              {/* Word counter */}
              <motion.div variants={staggerItemVariants} className="counter-pill" id="noon-words-counter">
                المثال {toArabicDigits((wordIdx % NOON_WORDS_QUIZ_BANK.length) + 1)} من {toArabicDigits(NOON_WORDS_QUIZ_BANK.length)} ({currentWordQuiz.type})
              </motion.div>

              {/* Quranic Word Frame */}
              <motion.div variants={staggerItemVariants} className="bg-white border border-slate-200 rounded-3xl p-6 text-center my-4 shadow-sm" id="noon-word-display-frame">
                <div className="text-4xl sm:text-5xl font-extrabold text-slate-900 font-serif my-3 tracking-wide">
                  «{currentWordQuiz.word}»
                </div>

                {/* Choices */}
                <div className="grid grid-cols-2 gap-3 mt-5 max-w-md mx-auto">
                  {[
                    { id: 'ith-har', name: 'إظهار حلقي' },
                    { id: 'idgham_ghunnah', name: 'إدغام' },
                    { id: 'iqlab', name: 'إقلاب' },
                    { id: 'ikhfa', name: 'إخفاء حقيقي' },
                  ].map((r) => {
                    const isSelected = selectedWordAnswer === r.id;
                    const isCorrect = r.id === currentWordQuiz.ruleId || (r.id === 'idgham_ghunnah' && currentWordQuiz.ruleId.startsWith('idgham'));
                    let btnClass = 'py-3 px-4 rounded-2xl font-extrabold text-sm transition-all border ';
                    if (selectedWordAnswer) {
                      if (isCorrect) btnClass += 'bg-emerald-600 border-emerald-500 text-white shadow-md';
                      else if (isSelected) btnClass += 'bg-rose-600 border-rose-500 text-white';
                      else btnClass += 'bg-slate-100 text-slate-400 border-slate-200';
                    } else {
                      btnClass += 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-emerald-50 hover:border-emerald-300';
                    }

                    return (
                      <button
                        key={r.id}
                        type="button"
                        disabled={selectedWordAnswer !== null}
                        className={btnClass}
                        onClick={() => handleWordQuizAnswer(r.id)}
                      >
                        {r.name}
                      </button>
                    );
                  })}
                </div>

                {/* Explanation note if answered */}
                {selectedWordAnswer && (
                  <motion.div variants={staggerItemVariants} className="mt-4 p-3 rounded-2xl border text-xs leading-relaxed bg-emerald-50 border-emerald-300 text-emerald-800 animate-fade-in text-right">
                    <strong>التعليل والتوضيح: </strong> {currentWordQuiz.explanation}
                  </motion.div>
                )}

                {/* Controls */}
                {selectedWordAnswer && (
                  <button
                    type="button"
                    className="mt-5 px-6 py-2 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md"
                    id="noon-words-next"
                    onClick={nextWordQuiz}
                  >
                    المثال التالي ←
                  </button>
                )}
              </motion.div>
            </div>
          </motion.section>
        )}

        {/* ========================================================
            TAB 4: APPLY IN THE HOLY QURAN
           ======================================================== */}
        {activeTab === 'apply' && (
          <motion.section
            key="noon-apply"
            className="panel active"
            id="panel-noon-apply"
            custom={tabDirection}
            variants={panelVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <div className="card max-w-3xl mx-auto" id="card-noon-apply">
              <motion.h2 variants={staggerItemVariants} className="intro-heading">
                <span className="ih-row">
                  <span className="ih-line"></span>
                  <span className="ih-diamond"></span>
                  <span className="ih-badge badge-quran" aria-hidden="true">
                    <BookOpen className="ih-badge-icon" />
                  </span>
                  <span className="ih-text">طبّق أحكام النون والتنوين في القرآن</span>
                  <span className="ih-diamond"></span>
                  <span className="ih-line ih-line-r"></span>
                </span>
              </motion.h2>

              <motion.div variants={staggerItemVariants} className="sub-tabs justify-center" id="noon-apply-sub-tabs">
                <button
                  type="button"
                  className={`sub-tab-btn ${activeSubTab === 'surah' ? 'active' : ''}`}
                  onClick={() => setActiveSubTab('surah')}
                >
                  سورة قرآنية
                </button>
                <button
                  type="button"
                  className={`sub-tab-btn ${activeSubTab === 'free' ? 'active' : ''}`}
                  onClick={() => setActiveSubTab('free')}
                >
                  آية من اختيارك
                </button>
              </motion.div>

              {/* Subtab: Surah Mode */}
              {activeSubTab === 'surah' && (
                <div className="noon-surah-view" id="noon-surah-view">
                  {/* Surah selector pills */}
                  <div className="flex gap-2 justify-center mb-4 flex-wrap" id="noon-surah-pills">
                    {Object.keys(NOON_SURAHS).map((sKey) => (
                      <button
                        key={sKey}
                        type="button"
                        className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all border ${
                          selectedSurahKey === sKey
                            ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                        onClick={() => {
                          setSelectedSurahKey(sKey);
                          setRevealedAyatCases({});
                          playChime(true);
                        }}
                      >
                        سورة {sKey}
                      </button>
                    ))}
                  </div>

                  {/* Surah Text with Highlightable cases */}
                  <div className="bg-amber-50/40 border border-amber-200/80 rounded-3xl p-6 text-center leading-loose shadow-inner" id="noon-verses-container">
                    {currentSurah.ayat.map((ayah, aIdx) => {
                      const cases = currentSurah.cases[aIdx] || [];

                      return (
                        <div key={aIdx} className="my-4 pb-3 border-b border-amber-200/40 last:border-b-0" id={`noon-ayah-${aIdx}`}>
                          <div className="text-2xl sm:text-3xl font-serif text-slate-800 my-2 leading-relaxed">
                            {ayah}
                            <span className="text-sm font-sans text-amber-600 mx-2 font-bold">
                              ﴿{toArabicDigits(aIdx + 1)}﴾
                            </span>
                          </div>

                          {cases.length > 0 && (
                            <div className="flex items-center justify-center gap-2 flex-wrap mt-2">
                              {cases.map((c, cIdx) => (
                                <span
                                  key={cIdx}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-white border border-amber-300 text-amber-900 shadow-sm"
                                >
                                  <span className="font-serif font-extrabold text-amber-800">«{c.textSnippet}»</span>
                                  <span className="text-[10.5px] text-emerald-700">← {c.ruleName}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Subtab: Free Ayah Mode */}
              {activeSubTab === 'free' && (
                <div className="noon-free-view" id="noon-free-view">
                  <div className="text-sm font-bold text-slate-700 mb-2 text-center">
                    اكتب أو الصق أي آية قرآنية كريمة بالتشكيل لتحليل أحكام النون الساكنة والتنوين فيها:
                  </div>
                  <textarea
                    className="w-full p-4 rounded-2xl border-2 border-emerald-200 font-serif text-xl text-center focus:border-emerald-500 outline-none"
                    rows={3}
                    placeholder="مثال: فَمَن يَعْمَلْ مِثْقَالَ ذَرَّةٍ خَيْرًا يَرَهُ"
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                  />
                  <div className="controls-row">
                    <button
                      type="button"
                      className="px-6 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all shadow-md"
                      onClick={() => {
                        if (!freeText.trim()) return;
                        playChime(true);
                        triggerConfetti();
                      }}
                    >
                      تحليل أحكام الآية
                    </button>
                  </div>
                  {freeText.trim() && (
                    <div className="mt-4 p-5 rounded-2xl bg-emerald-50 border border-emerald-300 text-center font-serif text-2xl text-emerald-950">
                      «{freeText}»
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
};
