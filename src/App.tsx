import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, type Variants } from 'motion/react';
import { Activity, Search, BookOpen, Layers, Home, GraduationCap, ChevronDown, ChevronLeft, ChevronRight, Check, X, Play, Pause, RotateCcw, Plus, Minus, Timer, Volume2, Settings2, Infinity as InfinityIcon, Zap, Award, Flame, ArrowLeft } from 'lucide-react';
import { SafaraTypographyLogo } from './components/SafaraTypographyLogo';
import { SilkWaveBackground } from './components/SilkWaveBackground';
import { NoonMeemSection } from './components/NoonMeemSection';
import { QalqalahSection } from './components/QalqalahSection';
import { NoonSakinahSection } from './components/NoonSakinahSection';
import {
  LATHAWIYA_WORD_BANK,
  buildSequentialWordsSession,
  getTargetTokenIndices,
  tokenizeLathawiya,
  type WordBankItem,
} from './utils/lathawiyaChallenge';
import { MushafProgram } from './components/MushafProgram';
import { type MushafLetterUnit } from './components/MushafLineRow';
import {
  AnnotationProvider,
  AnnotationToolCursor,
  FloatingAnnotationPalette,
  GlobalAnnotationLayer,
  OpticalLaserLayer,
  useAnnotationActions,
} from './components/annotation';
import { MUSHAF_SYMBOLS, toArabicDigits, tokenizeMushafText } from './utils/mushafData';

const TARGETS = ['ث', 'ذ', 'ظ'];
type LetterUnit = MushafLetterUnit;
const tokenize = (text: string): LetterUnit[] => tokenizeMushafText(text, TARGETS);

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Sound effects generator with Web Audio API (Single Shared AudioContext)
let sharedAudioCtx: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
  }
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function playTabSwitch() {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(460, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.05);
    gain.gain.setValueAtTime(0.015, now);
    gain.gain.exponentialRampToValueAtTime(0.0003, now + 0.08);
    osc.start(now);
    osc.stop(now + 0.08);
  } catch {
    // Ignore audio error
  }
}

function playChime(success = true) {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;

    if (success) {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
      gain.gain.setValueAtTime(0.038, now);
      gain.gain.exponentialRampToValueAtTime(0.0012, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now); // A3
      osc.frequency.linearRampToValueAtTime(160, now + 0.14);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.0012, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    }
  } catch {
    // Ignore audio error
  }
}

function triggerConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);
  const colors = ['#C9A227', '#E7C766', '#2E9E63', '#FBF3E3', '#D6483F'];
  for (let i = 0; i < 44; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDuration = 1.2 + Math.random() * 1.3 + 's';
    p.style.animationDelay = Math.random() * 0.3 + 's';
    const size = 6 + Math.random() * 8 + 'px';
    p.style.width = size;
    p.style.height = size;
    container.appendChild(p);
  }
  setTimeout(() => container.remove(), 2900);
}

const LETTER_POOL = ['ث', 'ت', 'ط', 'د', 'ذ', 'ز', 'س', 'ظ', 'ص', 'ض', 'ر', 'ل', 'ن', 'هـ'];
const LEVEL1_TIME = 30;

const TAJWEED_TOPICS = [
  { id: 'lathawiya', title: 'الحروف اللثوية', lessonNum: 'الدرس الأول', active: true },
  { id: 'noon_meem', title: 'النون والميم المشددتان', lessonNum: 'الدرس الثاني', active: true },
  { id: 'qalqalah', title: 'حروف القلقلة (قطب جد)', lessonNum: 'الدرس الثالث', active: true },
  { id: 'noon_sakinah', title: 'أحكام النون الساكنة والتنوين', lessonNum: 'الدرس الرابع', active: true },
];

interface PracticeForm {
  vowel: string;
  syllable: string;
  word: string;
  phoneme: string;
  typeBadge: string;
}

interface PracticeLetterData {
  letter: 'ث' | 'ذ' | 'ظ';
  name: string;
  type: string;
  typeBadgeClass: string;
  colorTheme: 'emerald' | 'amber' | 'sky';
  forms: PracticeForm[];
  tip: string;
}

const LATHAWIYA_PRACTICE_DATA: Record<'ث' | 'ذ' | 'ظ', PracticeLetterData> = {
  'ث': {
    letter: 'ث',
    name: 'حرف الثَّاء',
    type: 'مرقّق (خفيف)',
    typeBadgeClass: 'badge-emerald',
    colorTheme: 'emerald',
    forms: [
      { vowel: 'فَتْحَة', syllable: 'ثَـ', word: 'ثَوْب', phoneme: 'ثَ، ثَوْب', typeBadge: 'مفتوح' },
      { vowel: 'كَسْرَة', syllable: 'ثِـ', word: 'ثِمَار', phoneme: 'ثِ، ثِمَار', typeBadge: 'مكسور' },
      { vowel: 'ضَمَّة', syllable: 'ثُـ', word: 'ثُلُث', phoneme: 'ثُ، ثُلُث', typeBadge: 'مضموم' },
      { vowel: 'سُكُون', syllable: 'إِثْ', word: 'إِثْم', phoneme: 'إِثْ، إِثْم', typeBadge: 'ساكن' },
    ],
    tip: 'يُنطق بخروج طرف اللسان برفق مع الثنايا العليا بصوت مرقّق ومهموس يجري معه النَّفَس.',
  },
  'ذ': {
    letter: 'ذ',
    name: 'حرف الذَّال',
    type: 'مرقّق (خفيف)',
    typeBadgeClass: 'badge-amber',
    colorTheme: 'amber',
    forms: [
      { vowel: 'فَتْحَة', syllable: 'ذَ', word: 'ذَهَب', phoneme: 'ذَ، ذَهَب', typeBadge: 'مفتوح' },
      { vowel: 'كَسْرَة', syllable: 'ذِ', word: 'ذِكْر', phoneme: 'ذِ، ذِكْر', typeBadge: 'مكسور' },
      { vowel: 'ضَمَّة', syllable: 'ذُ', word: 'ذُرَّة', phoneme: 'ذُ، ذُرَّة', typeBadge: 'مضموم' },
      { vowel: 'سُكُون', syllable: 'إِذْ', word: 'إِذْهَاب', phoneme: 'إِذْ، إِذْهَاب', typeBadge: 'ساكن' },
    ],
    tip: 'يُنطق بخروج طرف اللسان برفق بصوت مرقّق ومجهور يجري فيه الصوت.',
  },
  'ظ': {
    letter: 'ظ',
    name: 'حرف الظَّاء',
    type: 'مفخّم (قوي ممتلئ)',
    typeBadgeClass: 'badge-sky',
    colorTheme: 'sky',
    forms: [
      { vowel: 'فَتْحَة', syllable: 'ظَـ', word: 'ظَهْر', phoneme: 'ظَ، ظَهْر', typeBadge: 'مفتوح' },
      { vowel: 'كَسْرَة', syllable: 'ظِـ', word: 'ظِلّ', phoneme: 'ظِ، ظِلّ', typeBadge: 'مكسور' },
      { vowel: 'ضَمَّة', syllable: 'ظُـ', word: 'ظُلْم', phoneme: 'ظُ، ظُلْم', typeBadge: 'مضموم' },
      { vowel: 'سُكُون', syllable: 'إِظْ', word: 'إِظْهَار', phoneme: 'إِظْ، إِظْهَار', typeBadge: 'ساكن' },
    ],
    tip: 'يُنطق بخروج طرف اللسان مع امتلاء الفم بصدى الصوت (تفخيم واستعلاء).',
  },
};

const TABS_CONFIG = [
  { id: 'explain', title: 'الشرح', num: '١' },
  { id: 'letters', title: 'تعرّف على الحروف', num: '٢' },
  { id: 'words', title: 'تدرّب في كلمات', num: '٣' },
  { id: 'apply', title: 'طبّق في القرآن', num: '٤' },
] as const;

// Silky-smooth, highly responsive spring transitions with micro-staggering
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
  enter: {
    opacity: 0,
    y: 10,
  },
  center: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.26,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: {
      duration: 0.12,
      ease: 'easeIn' as const,
    },
  },
};

function AppContent() {
  const { setFallbackSurfaceId, setPaletteOpen, setActiveTool } = useAnnotationActions();
  const [appView, setAppView] = useState<'home' | 'tajweed' | 'mushaf'>('home');
  const [currentTopic, setCurrentTopic] = useState('noon_sakinah');
  const [topicDropdownOpen, setTopicDropdownOpen] = useState(false);
  const [mushafPresentationMode, setMushafPresentationMode] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const autoOpenedPaletteRef = useRef(false);

  const navigateView = (nextView: 'home' | 'tajweed' | 'mushaf') => {
    if (nextView === appView) return;
    setTopicDropdownOpen(false);
    if (nextView !== 'mushaf') {
      setMushafPresentationMode(false);
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    }
    playTabSwitch();
    setAppView(nextView);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleMushafPresentation = () => {
    setMushafPresentationMode((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
      return next;
    });
  };

  useEffect(() => {
    if (!mushafPresentationMode) return;
    let enteredNativeFullscreen = !!document.fullscreenElement;
    function onFsChange() {
      if (document.fullscreenElement) {
        enteredNativeFullscreen = true;
      } else if (enteredNativeFullscreen) {
        setMushafPresentationMode(false);
      }
    }
    function onEscPresentation(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMushafPresentationMode(false);
        if (document.fullscreenElement) {
          document.exitFullscreen?.().catch(() => {});
        }
      }
    }
    document.addEventListener('fullscreenchange', onFsChange);
    window.addEventListener('keydown', onEscPresentation);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener('keydown', onEscPresentation);
    };
  }, [mushafPresentationMode]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTopicDropdownOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setTopicDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const [activeTab, setActiveTab] = useState<'explain' | 'letters' | 'words' | 'apply'>('explain');
  const [tabDirection, setTabDirection] = useState<1 | -1>(1);

  const TAB_ORDER = ['explain', 'letters', 'words', 'apply'] as const;

  const handleTabChange = (newTab: 'explain' | 'letters' | 'words' | 'apply') => {
    if (newTab === activeTab) return;
    const oldIdx = TAB_ORDER.indexOf(activeTab);
    const newIdx = TAB_ORDER.indexOf(newTab);
    setTabDirection(newIdx > oldIdx ? 1 : -1);
    playTabSwitch();
    setActiveTab(newTab);
  };

  // Keyboard navigation between tabs (Arrow Left / Arrow Right) inside Tajweed program
  useEffect(() => {
    if (appView !== 'tajweed') return;
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger if user is typing in the textarea
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        return;
      }
      const curIdx = TAB_ORDER.indexOf(activeTab);
      // In RTL: ArrowLeft = next step, ArrowRight = previous step
      if (e.key === 'ArrowLeft' && curIdx < TAB_ORDER.length - 1) {
        handleTabChange(TAB_ORDER[curIdx + 1]);
      } else if (e.key === 'ArrowRight' && curIdx > 0) {
        handleTabChange(TAB_ORDER[curIdx - 1]);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, appView]);

  const [activeSubTab, setActiveSubTab] = useState<'surah' | 'free'>('surah');

  // Keep global annotation system synced to the active program/lesson view
  useEffect(() => {
    const surfaceKey =
      appView === 'tajweed'
        ? `tajweed:${currentTopic}:${activeTab}:${activeTab === 'apply' ? activeSubTab : 'main'}`
        : `view:${appView}`;
    setFallbackSurfaceId(surfaceKey);
  }, [appView, currentTopic, activeTab, activeSubTab, setFallbackSurfaceId]);

  // Open the floating Apple pen dock automatically on first entry into a teaching program
  useEffect(() => {
    if (appView === 'home') {
      setActiveTool('cursor');
    } else if (!autoOpenedPaletteRef.current) {
      autoOpenedPaletteRef.current = true;
      setPaletteOpen(true);
    }
  }, [appView, setActiveTool, setPaletteOpen]);

  // Progress state
  const [progress, setProgress] = useState({
    explain: false,
    level1: false,
    words: false,
    apply: false,
  });

  // Tab 1 state
  const [makhrajPlaying, setMakhrajPlaying] = useState(false);

  // Tab 2: Level 1 State
  const [level1Cards, setLevel1Cards] = useState<string[]>([]);
  const [level1CorrectSet, setLevel1CorrectSet] = useState<Set<number>>(new Set());
  const [level1Revealed, setLevel1Revealed] = useState(false);
  const [level1WrongIndex, setLevel1WrongIndex] = useState<number | null>(null);
  const [level1InitialDuration, setLevel1InitialDuration] = useState(30);
  const [level1TimeLeft, setLevel1TimeLeft] = useState(30);
  const [level1Score, setLevel1Score] = useState(0);
  const [level1Active, setLevel1Active] = useState(true);
  const [level1TimerStatus, setLevel1TimerStatus] = useState<'idle' | 'running' | 'paused' | 'finished'>('idle');
  const [durationPopoverOpen, setDurationPopoverOpen] = useState(false);
  const timerClockWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!durationPopoverOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (timerClockWrapperRef.current && !timerClockWrapperRef.current.contains(e.target as Node)) {
        setDurationPopoverOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDurationPopoverOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [durationPopoverOpen]);

  useEffect(() => {
    if (activeTab !== 'letters') {
      setDurationPopoverOpen(false);
    }
  }, [activeTab]);

  // Tab 3: Level 2 Sequential Single-Word Extraction State (no timer)
  const [wordsSession, setWordsSession] = useState<WordBankItem[]>(() =>
    buildSequentialWordsSession(LATHAWIYA_WORD_BANK, 2, 2)
  );
  const [wordIdx, setWordIdx] = useState(0);
  const [wordsCompletedSet, setWordsCompletedSet] = useState<Set<number>>(new Set());
  const [wordFoundLetters, setWordFoundLetters] = useState<Set<number>>(new Set());
  const [wordWrongLetterIdx, setWordWrongLetterIdx] = useState<number | null>(null);
  const [wordNoneWrong, setWordNoneWrong] = useState(false);
  const [wordNoneCorrect, setWordNoneCorrect] = useState(false);
  const [wordRevealed, setWordRevealed] = useState(false);
  const [wordFeedback, setWordFeedback] = useState<{
    kind: 'correct-letter' | 'correct-none' | 'wrong';
    msg: string;
  } | null>(null);
  const wordWrongTimeoutRef = useRef<number | null>(null);


  // Tab 4: Free Ayat State
  const [freeText, setFreeText] = useState('');
  const [appliedFreeText, setAppliedFreeText] = useState('');
  const [freeCorrectSet, setFreeCorrectSet] = useState<Set<number>>(new Set());
  const [freeRevealed, setFreeRevealed] = useState(false);
  const [freeStatus, setFreeStatus] = useState<{ msg: string; kind: 'ok' | 'bad' | null }>({ msg: '', kind: null });
  const [freeWrongIdx, setFreeWrongIdx] = useState<number | null>(null);

  // Initialize Level 1
  const startLevel1Round = () => {
    const pool = shuffle(LETTER_POOL);
    setLevel1Cards(pool);
    setLevel1CorrectSet(new Set());
    setLevel1Revealed(false);
    setLevel1WrongIndex(null);
    setLevel1TimeLeft(level1InitialDuration);
    setLevel1Active(true);
    setLevel1TimerStatus('idle');
    setDurationPopoverOpen(false);
  };

  const handleStartOrPauseTimer = () => {
    setDurationPopoverOpen(false);
    if (level1TimerStatus === 'idle') {
      setLevel1TimerStatus('running');
    } else if (level1TimerStatus === 'running') {
      setLevel1TimerStatus('paused');
    } else if (level1TimerStatus === 'paused') {
      setLevel1TimerStatus('running');
    } else if (level1TimerStatus === 'finished') {
      startLevel1Round();
    }
  };

  const handleResetTimer = () => {
    setDurationPopoverOpen(false);
    setLevel1TimeLeft(level1InitialDuration);
    setLevel1CorrectSet(new Set());
    setLevel1Revealed(false);
    setLevel1WrongIndex(null);
    setLevel1Active(true);
    setLevel1TimerStatus('idle');
  };

  const handleSelectPresetDuration = (seconds: number) => {
    if (level1TimerStatus === 'finished' || level1Revealed) {
      setLevel1Cards(shuffle(LETTER_POOL));
    }
    setLevel1InitialDuration(seconds);
    setLevel1TimeLeft(seconds);
    setLevel1Active(true);
    setLevel1TimerStatus('idle');
    setLevel1CorrectSet(new Set());
    setLevel1Revealed(false);
    setLevel1WrongIndex(null);
    setDurationPopoverOpen(false);
  };

  // Initialize Level 2 Sequential Words Session
  const resetCurrentWordState = () => {
    if (wordWrongTimeoutRef.current !== null) {
      window.clearTimeout(wordWrongTimeoutRef.current);
      wordWrongTimeoutRef.current = null;
    }
    setWordFoundLetters(new Set());
    setWordWrongLetterIdx(null);
    setWordNoneWrong(false);
    setWordNoneCorrect(false);
    setWordRevealed(false);
    setWordFeedback(null);
  };

  const startWordsSession = () => {
    setWordsSession(buildSequentialWordsSession(LATHAWIYA_WORD_BANK, 2, 2));
    setWordIdx(0);
    setWordsCompletedSet(new Set());
    resetCurrentWordState();
  };

  useEffect(() => {
    startLevel1Round();
  }, []);

  // Countdown Timer for Level 1
  useEffect(() => {
    if (activeTab !== 'letters' || !level1Active || level1TimerStatus !== 'running') return;
    const timer = setInterval(() => {
      setLevel1TimeLeft(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [activeTab, level1Active, level1TimerStatus]);

  useEffect(() => {
    if (activeTab === 'letters' && level1TimerStatus === 'running' && level1TimeLeft <= 0) {
      setLevel1Active(false);
      setLevel1TimerStatus('finished');
      playChime(false);
    }
  }, [activeTab, level1TimeLeft, level1TimerStatus]);

  const currentWordItem = wordsSession[wordIdx] || LATHAWIYA_WORD_BANK[0];
  const currentWordTokens = tokenizeLathawiya(currentWordItem.w);
  const currentWordTargetIndices = getTargetTokenIndices(currentWordTokens);

  // Handler for Level 1 letter click
  const handleLevel1Click = (ch: string, index: number) => {
    if (!level1Active || level1CorrectSet.has(index)) return;

    // Start countdown automatically on first tap
    if (level1TimerStatus === 'idle' || level1TimerStatus === 'paused') {
      setLevel1TimerStatus('running');
    }

    if (TARGETS.includes(ch)) {
      playChime(true);
      const nextSet = new Set(level1CorrectSet);
      nextSet.add(index);
      setLevel1CorrectSet(nextSet);
      const newScore = level1Score + 10;
      setLevel1Score(newScore);

      if (nextSet.size === 3) {
        setLevel1Active(false);
        setLevel1TimerStatus('finished');
        triggerConfetti();
        if (!progress.level1) {
          setProgress(p => ({ ...p, level1: true }));
        }
      }
    } else {
      playChime(false);
      setLevel1WrongIndex(index);
      setTimeout(() => setLevel1WrongIndex(null), 450);
    }
  };

  // Handler for clicking a letter inside the single word example
  const handleWordLetterTap = (isTarget: boolean, idx: number) => {
    if (wordFoundLetters.has(idx) || wordsCompletedSet.has(wordIdx)) return;

    if (wordWrongTimeoutRef.current !== null) {
      window.clearTimeout(wordWrongTimeoutRef.current);
      wordWrongTimeoutRef.current = null;
    }

    if (isTarget) {
      playChime(true);
      setWordWrongLetterIdx(null);
      setWordNoneWrong(false);
      const nextFound = new Set(wordFoundLetters);
      nextFound.add(idx);
      setWordFoundLetters(nextFound);

      if (nextFound.size >= currentWordTargetIndices.length && currentWordTargetIndices.length > 0) {
        const nextCompleted = new Set(wordsCompletedSet);
        nextCompleted.add(wordIdx);
        setWordsCompletedSet(nextCompleted);
        setWordFeedback({ kind: 'correct-letter', msg: 'أحسنت! تم تحديد الحرف اللثوي الصحيح' });

        if (nextCompleted.size === wordsSession.length) {
          triggerConfetti();
          if (!progress.words) {
            setProgress(p => ({ ...p, words: true }));
          }
        }
      }
    } else {
      playChime(false);
      setWordWrongLetterIdx(idx);
      setWordFeedback({ kind: 'wrong', msg: 'إجابة خاطئة — هذا الحرف ليس من الحروف اللثوية' });
      wordWrongTimeoutRef.current = window.setTimeout(() => {
        setWordWrongLetterIdx(null);
        setWordFeedback(prev => (prev?.kind === 'wrong' ? null : prev));
      }, 2200);
    }
  };

  // Handler for "لا يوجد حرف لثوي" button
  const handleWordNoneClick = () => {
    if (wordsCompletedSet.has(wordIdx)) return;

    if (wordWrongTimeoutRef.current !== null) {
      window.clearTimeout(wordWrongTimeoutRef.current);
      wordWrongTimeoutRef.current = null;
    }

    if (!currentWordItem.has) {
      playChime(true);
      setWordWrongLetterIdx(null);
      setWordNoneWrong(false);
      setWordNoneCorrect(true);
      const nextCompleted = new Set(wordsCompletedSet);
      nextCompleted.add(wordIdx);
      setWordsCompletedSet(nextCompleted);
      setWordFeedback({ kind: 'correct-none', msg: 'صحيح! هذه الكلمة خالية من الحروف اللثوية' });

      if (nextCompleted.size === wordsSession.length) {
        triggerConfetti();
        if (!progress.words) {
          setProgress(p => ({ ...p, words: true }));
        }
      }
    } else {
      playChime(false);
      setWordNoneWrong(true);
      setWordFeedback({ kind: 'wrong', msg: 'إجابة خاطئة — الكلمة تحتوي على حرف لثوي' });
      wordWrongTimeoutRef.current = window.setTimeout(() => {
        setWordNoneWrong(false);
        setWordFeedback(prev => (prev?.kind === 'wrong' ? null : prev));
      }, 2200);
    }
  };

  const handleWordsNext = () => {
    if (wordIdx < wordsSession.length - 1) {
      setWordIdx(wordIdx + 1);
      resetCurrentWordState();
    } else {
      startWordsSession();
    }
  };


  // Free Ayat Tokens
  const freeTokens = tokenize(appliedFreeText);
  const freeTotalTargets = freeTokens.filter(t => t.type === 'letter' && t.isTarget).length;

  const handleFreeLetterClick = (unit: LetterUnit, idx: number) => {
    if (freeCorrectSet.has(idx)) {
      const next = new Set(freeCorrectSet);
      next.delete(idx);
      setFreeCorrectSet(next);
      setFreeStatus({ msg: '', kind: null });
      return;
    }

    if (unit.isTarget) {
      playChime(true);
      const next = new Set(freeCorrectSet);
      next.add(idx);
      setFreeCorrectSet(next);
      setFreeStatus({ msg: 'أحسنت! هذا حرف لثوي ✓', kind: 'ok' });
      if (next.size === freeTotalTargets && freeTotalTargets > 0) {
        setFreeStatus({ msg: 'أحسنت! وجدت كل الحروف اللثوية ✓', kind: 'ok' });
        triggerConfetti();
        if (!progress.apply) {
          setProgress(p => ({ ...p, apply: true }));
        }
      }
    } else {
      playChime(false);
      setFreeWrongIdx(idx);
      setFreeStatus({ msg: 'حاول مرة أخرى، هذا ليس حرفًا لثويًا', kind: 'bad' });
      setTimeout(() => setFreeWrongIdx(null), 450);
    }
  };

  // Makhraj Animation runner
  const playMakhraj = () => {
    setMakhrajPlaying(true);
    const ids = ['mkAnim1', 'mkAnim2', 'mkAnim3', 'mkAnim4', 'mkAnim5', 'mkAnim6', 'mkAnim7', 'mkAnim8', 'mkAnim9', 'mkAnimAir'];
    ids.forEach(id => {
      const el = document.getElementById(id) as unknown as { beginElement?: () => void };
      if (el && typeof el.beginElement === 'function') {
        el.beginElement();
      }
    });
    playChime(true);
    setTimeout(() => {
      setMakhrajPlaying(false);
    }, 3800);
    if (!progress.explain) {
      setProgress(p => ({ ...p, explain: true }));
    }
  };

  const handleLetterCardClick = (letter: string, name: string, e: React.MouseEvent<HTMLDivElement>) => {
    const cardEl = e.currentTarget;
    cardEl.classList.remove('tapped', 'card-active');
    void cardEl.offsetWidth;
    cardEl.classList.add('tapped', 'card-active');

    // Create ripple effect
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

    playChime(true);
  };

  return (
    <>
      <SilkWaveBackground />
      <div className={`app ${appView === 'mushaf' && mushafPresentationMode ? 'is-mushaf-presentation' : ''}`}>
        {/* Top Global Row: Standalone Brand Logo on Right (Blue Area) + Program Navigation / Topic Selector on Left */}
        <header id="main-header" className="main-app-header">
          {/* Right Slot: Clickable Brand Logo returning to Home Gateway */}
          <div className="header-standalone-logo" id="header-brand-logo">
            <button
              type="button"
              className="header-logo-home-btn"
              onClick={() => navigateView('home')}
              aria-label="العودة إلى الشاشة الرئيسية"
            >
              <SafaraTypographyLogo size="md" showTagline={false} />
            </button>
          </div>

          {/* Left Slot: Navigation Actions + Topic Switcher Dropdown */}
          <div className="header-topic-slot" id="header-topic-menu">
            {appView !== 'home' && (
              <div className="header-nav-actions">
                <button
                  type="button"
                  id="nav-home-btn"
                  className="header-nav-btn"
                  onClick={() => navigateView('home')}
                >
                  <Home className="w-4 h-4" aria-hidden="true" />
                  <span>الرئيسية</span>
                </button>
                {appView === 'tajweed' ? (
                  <button
                    type="button"
                    id="nav-mushaf-btn"
                    className="header-nav-btn is-switch"
                    onClick={() => navigateView('mushaf')}
                  >
                    <BookOpen className="w-4 h-4" aria-hidden="true" />
                    <span>المصحف الشريف</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    id="nav-tajweed-btn"
                    className="header-nav-btn is-switch"
                    onClick={() => navigateView('tajweed')}
                  >
                    <GraduationCap className="w-4 h-4" aria-hidden="true" />
                    <span>برنامج التجويد</span>
                  </button>
                )}
              </div>
            )}

            {appView === 'tajweed' && (
              <div className="topic-switcher-container" ref={dropdownRef}>
                <button
                  type="button"
                  id="topic-selector-btn"
                  className={`topic-switcher-btn ${topicDropdownOpen ? 'is-open' : ''}`}
                  onClick={() => setTopicDropdownOpen(prev => !prev)}
                  aria-expanded={topicDropdownOpen}
                  aria-haspopup="menu"
                >
                  <span className="topic-switcher-text">أبواب التجويد</span>
                  <ChevronDown
                    className={`topic-switcher-chevron ${topicDropdownOpen ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>

                {/* Dropdown Menu Descending from Button */}
                <AnimatePresence>
                  {topicDropdownOpen && (
                    <motion.div
                      initial="closed"
                      animate="open"
                      exit="closed"
                      variants={{
                        closed: {
                          opacity: 0,
                          y: -12,
                          scale: 0.93,
                          transition: {
                            duration: 0.14,
                            ease: [0.4, 0, 1, 1],
                          },
                        },
                        open: {
                          opacity: 1,
                          y: 0,
                          scale: 1,
                          transition: {
                            type: 'spring',
                            stiffness: 430,
                            damping: 28,
                            mass: 0.78,
                            staggerChildren: 0.025,
                            delayChildren: 0.025,
                          },
                        },
                      }}
                      style={{ transformOrigin: 'top left' }}
                      className="topic-dropdown-wrapper"
                      role="menu"
                      aria-label="فهرس أبواب التجويد"
                    >
                      {/* Attached Popover Caret */}
                      <span className="topic-dropdown-caret" aria-hidden="true" />

                      <div className="topic-dropdown-menu">
                        {/* Radiant Top Gold Rim */}
                        <span className="topic-dropdown-top-rim" aria-hidden="true" />

                        {/* Dropdown Topics List */}
                        <div className="topic-dropdown-list">
                          {TAJWEED_TOPICS.map((topic) => {
                            const isSelected = topic.id === currentTopic;
                            return (
                              <motion.button
                                key={topic.id}
                                type="button"
                                role="menuitem"
                                variants={{
                                  closed: {
                                    opacity: 0,
                                    y: -5,
                                    transition: { duration: 0.09 },
                                  },
                                  open: {
                                    opacity: 1,
                                    y: 0,
                                    transition: {
                                      duration: 0.2,
                                      ease: [0.16, 1, 0.3, 1],
                                    },
                                  },
                                }}
                                onMouseMove={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  e.currentTarget.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
                                  e.currentTarget.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
                                }}
                                className={`topic-dropdown-item ${isSelected ? 'is-active' : ''}`}
                                onClick={() => {
                                  setCurrentTopic(topic.id);
                                  setActiveTab('explain');
                                  setTopicDropdownOpen(false);
                                  playTabSwitch();
                                }}
                              >
                                <div className="topic-dropdown-item-inner">
                                  <span className="topic-dropdown-title truncate">{topic.title}</span>
                                  {isSelected && (
                                    <span className="topic-dropdown-check" aria-label="الدرس الحالي">
                                      <Check className="w-3.5 h-3.5" />
                                    </span>
                                  )}
                                </div>
                              </motion.button>
                            );
                          })}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </header>

        {/* Home Entry Gateway */}
        {appView === 'home' && (
          <main id="platform-home">
            <section className="home-hero">
              <span className="home-hero-kicker">منصة مَعَ السَّفَرَة التعليمية</span>
              <h1 className="home-hero-title">اختر البرنامج الذي تريد البدء به</h1>
              <p className="home-hero-subtitle">
                برنامجان مستقلان ومتكاملان: تصفّح المصحف الشريف برسمه العثماني وأحكامه الملونة، أو تعلّم أحكام التجويد وتدرّب عليها خطوةً بخطوة.
              </p>
            </section>

            <section className="home-programs-grid" aria-label="البرامج المتاحة">
              <button
                type="button"
                id="gateway-mushaf-card"
                className="home-program-card is-mushaf"
                onClick={() => navigateView('mushaf')}
              >
                <div className="home-card-top">
                  <span className="home-card-icon" aria-hidden="true">
                    <BookOpen className="w-7 h-7" strokeWidth={2.1} />
                  </span>
                  <div className="home-card-headings">
                    <span className="home-card-kicker">البرنامج الأول</span>
                    <h2 className="home-card-title">المصحف الشريف</h2>
                  </div>
                </div>

                <p className="home-card-desc">
                  مصحف رقمي متكامل بـ ٦٠٤ صفحات بتوزيع مصحف المدينة المنورة، مع تلوين أحكام التجويد ووضع العرض المكبّر.
                </p>

                <ul className="home-card-highlights">
                  <li>
                    <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
                    <span>تلوين أحكام التجويد (مصحف مجوَّد) مع إمكانية التبديل</span>
                  </li>
                  <li>
                    <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
                    <span>وضع ملء الشاشة المخصّص للبث والشرح المباشر أونلاين</span>
                  </li>
                  <li>
                    <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
                    <span>انتقال فوري بالسورة والجزء ورقم الصفحة</span>
                  </li>
                </ul>

                <div className="home-card-footer">
                  <span className="home-card-cta">
                    <span>افتح المصحف الشريف</span>
                    <ArrowLeft className="w-4 h-4" strokeWidth={2.4} aria-hidden="true" />
                  </span>
                </div>
              </button>

              <button
                type="button"
                id="gateway-tajweed-card"
                className="home-program-card is-tajweed"
                onClick={() => navigateView('tajweed')}
              >
                <div className="home-card-top">
                  <span className="home-card-icon" aria-hidden="true">
                    <GraduationCap className="w-7 h-7" strokeWidth={2.1} />
                  </span>
                  <div className="home-card-headings">
                    <span className="home-card-kicker">البرنامج الثاني</span>
                    <h2 className="home-card-title">برنامج التجويد</h2>
                  </div>
                </div>

                <p className="home-card-desc">
                  منهج تفاعلي لأحكام التجويد يجمع بين الشرح المرئي للمخارج، التعرّف على الحروف، التدرّب في الكلمات، والتطبيق العملي داخل المصحف.
                </p>

                <ul className="home-card-highlights">
                  <li>
                    <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
                    <span>أربعة أبواب شاملة: الحروف اللثوية، الغنة، القلقلة، والنون الساكنة</span>
                  </li>
                  <li>
                    <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
                    <span>تمارين تفاعلية ومنافسات زمنية وتصحيح فوري</span>
                  </li>
                  <li>
                    <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
                    <span>تطبيق مباشر على صفحات المصحف الشريف عند كل درس</span>
                  </li>
                </ul>

                <div className="home-card-footer">
                  <span className="home-card-cta">
                    <span>ادخل إلى برنامج التجويد</span>
                    <ArrowLeft className="w-4 h-4" strokeWidth={2.4} aria-hidden="true" />
                  </span>
                </div>
              </button>
            </section>
          </main>
        )}

        {/* Standalone Mushaf Program */}
        {appView === 'mushaf' && (
          <>
            <div className="unified-hero-pod is-mushaf-pod" id="mushaf-hero-pod">
              <section className="lesson-hero-title-area" id="mushaf-main-heading-area">
                <div className="lesson-title-badge-row">
                  <span className="lesson-badge-category">
                    <span className="badge-ornament-star">✦</span>
                    <span className="badge-text-diacritics">برواية حفص عن عاصم</span>
                    <span className="badge-ornament-star">✦</span>
                  </span>
                </div>

                <h1 className="lesson-primary-heading">المصحف الشريف</h1>

                <div className="lesson-title-deco-line" aria-hidden="true">
                  <span className="deco-line-half"></span>
                  <span className="deco-rosette">✦</span>
                  <span className="deco-line-half deco-line-r"></span>
                </div>
              </section>
            </div>

            <main id="mushaf-standalone-shell" aria-label="المصحف الشريف">
              <MushafProgram
                variant="standalone"
                initialTajweed={true}
                isPresentationMode={mushafPresentationMode}
                onTogglePresentationMode={toggleMushafPresentation}
                onPlayChime={playChime}
                onTriggerConfetti={triggerConfetti}
              />
            </main>
          </>
        )}

        {/* Standalone Tajweed Program (with Embedded Mushaf Practice where needed) */}
        {appView === 'tajweed' && (
          <>
            {/* Unified Glass Hero Pod (Encapsulating Badge, Lesson Title & Navigation Tabs) */}
            <div className="unified-hero-pod" id="unified-hero-pod">
              {/* Lesson Title Section */}
              <section className="lesson-hero-title-area" id="lesson-main-heading-area">
                <div className="lesson-title-badge-row">
                  <span className="lesson-badge-category">
                    <span className="badge-ornament-star">✦</span>
                    <span className="badge-text-diacritics">
                      {TAJWEED_TOPICS.find(t => t.id === currentTopic)?.lessonNum || 'الدرس الأول'}
                    </span>
                    <span className="badge-ornament-star">✦</span>
                  </span>
                </div>

                <h1 className="lesson-primary-heading">
                  {currentTopic === 'noon_sakinah'
                    ? 'باب أحكام النون الساكنة والتنوين'
                    : currentTopic === 'qalqalah'
                    ? 'باب حروف القلقلة (قُطْبُ جَدّ)'
                    : currentTopic === 'noon_meem'
                    ? 'باب النون والميم المشددتان'
                    : 'باب الحروف اللثوية'}
                </h1>

                <div className="lesson-title-deco-line" aria-hidden="true">
                  <span className="deco-line-half"></span>
                  <span className="deco-rosette">✦</span>
                  <span className="deco-line-half deco-line-r"></span>
                </div>
              </section>

              {/* Main Navigation Tabs */}
              <nav className="tabs" id="main-nav-tabs">
                {TABS_CONFIG.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      id={`tab-btn-${tab.id}`}
                      className={`tab-btn ${isActive ? 'active' : ''}`}
                      onClick={() => handleTabChange(tab.id as 'explain' | 'letters' | 'words' | 'apply')}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="activeTabPill"
                          className="active-tab-highlight-pill"
                          transition={{
                            type: 'spring',
                            stiffness: 420,
                            damping: 32,
                          }}
                        />
                      )}
                      <span className="tab-num-relative">
                        <span className="tab-num">{tab.num}</span>
                      </span>
                      <span className="tab-label-text">{tab.title}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

      {currentTopic === 'noon_sakinah' ? (
        <NoonSakinahSection
          activeTab={activeTab}
          tabDirection={tabDirection}
          onTabChange={handleTabChange}
          playChime={playChime}
          triggerConfetti={triggerConfetti}
          toArabicDigits={toArabicDigits}
        />
      ) : currentTopic === 'qalqalah' ? (
        <QalqalahSection
          activeTab={activeTab}
          tabDirection={tabDirection}
          onTabChange={handleTabChange}
          playChime={playChime}
          triggerConfetti={triggerConfetti}
          toArabicDigits={toArabicDigits}
        />
      ) : currentTopic === 'noon_meem' ? (
        <NoonMeemSection
          activeTab={activeTab}
          tabDirection={tabDirection}
          playChime={playChime}
          triggerConfetti={triggerConfetti}
        />
      ) : (
        /* Original Lathawiya Panels */
        <AnimatePresence mode="wait" custom={tabDirection}>
          {activeTab === 'explain' && (
          <motion.section
            key="explain"
            className="panel active"
            id="panel-explain"
            custom={tabDirection}
            variants={panelVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <div className="card explain-card" id="card-explain-overview">
          <div className="explain-grid" id="explain-main-grid">
            {/* Column 1: Letter Cards & Interactive Practice */}
            <motion.div variants={staggerItemVariants} className="explain-col-letters" id="explain-col-letters">
              <header className="explain-col-header" id="col-header-letters">
                <h2 className="intro-subheading subheading-prominent theme-emerald">
                  <span className="subheading-accent-bar" aria-hidden="true" />
                  <span className="subheading-text">ما هي الحروف اللثوية؟</span>
                </h2>
                <div className="letters-definition-card" id="letters-def-card">
                  {/* الجزء الأول: العنوان الرئيسي */}
                  <div className="def-hook-row" id="def-part-intro">
                    <div className="def-hook-pill">
                      <span className="def-hook-statement">
                        هي ثلاثة أحرف فقط:
                      </span>
                    </div>
                  </div>

                  {/* الجزء الثاني: إزاي ننطقها والتوجيه المباشر للأطفال */}
                  <div className="def-makhraj-row" id="def-part-makhraj">
                    <div className="def-makhraj-box">
                      <span className="def-makhraj-tag">
                        إزاي ننطقها صح؟
                      </span>
                      <span className="def-makhraj-instruction">
                        اجعل طرف لسانك يخرج ليُسلّم على أسنانك العلوية
                      </span>
                    </div>
                  </div>
                </div>
              </header>

              <div className="letters-trio" id="letters-trio-showcase">
                <div className="card-glow-wrap">
                  <div
                    className="letter-card c1"
                    id="letter-card-tha"
                    onClick={e => handleLetterCardClick('ث', 'ثاء', e)}
                    onMouseMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      const y = e.clientY - rect.top;
                      const centerX = rect.width / 2;
                      const centerY = rect.height / 2;
                      const rotateX = ((y - centerY) / centerY) * -5;
                      const rotateY = ((x - centerX) / centerX) * 5;
                      e.currentTarget.style.setProperty('--mouse-x', `${(x / rect.width) * 100}%`);
                      e.currentTarget.style.setProperty('--mouse-y', `${(y / rect.height) * 100}%`);
                      e.currentTarget.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px) scale(1.012)`;
                    }}
                    onMouseLeave={(e) => {
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
                    <div className="glyph">ث</div>
                    <div className="glyph-name">ثاء</div>
                  </div>
                </div>
                <div className="card-glow-wrap">
                  <div
                    className="letter-card c2"
                    id="letter-card-thal"
                    onClick={e => handleLetterCardClick('ذ', 'ذال', e)}
                    onMouseMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      const y = e.clientY - rect.top;
                      const centerX = rect.width / 2;
                      const centerY = rect.height / 2;
                      const rotateX = ((y - centerY) / centerY) * -5;
                      const rotateY = ((x - centerX) / centerX) * 5;
                      e.currentTarget.style.setProperty('--mouse-x', `${(x / rect.width) * 100}%`);
                      e.currentTarget.style.setProperty('--mouse-y', `${(y / rect.height) * 100}%`);
                      e.currentTarget.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px) scale(1.012)`;
                    }}
                    onMouseLeave={(e) => {
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
                    <div className="glyph">ذ</div>
                    <div className="glyph-name">ذال</div>
                  </div>
                </div>
                <div className="card-glow-wrap">
                  <div
                    className="letter-card c3"
                    id="letter-card-dha"
                    onClick={e => handleLetterCardClick('ظ', 'ظاء', e)}
                    onMouseMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      const y = e.clientY - rect.top;
                      const centerX = rect.width / 2;
                      const centerY = rect.height / 2;
                      const rotateX = ((y - centerY) / centerY) * -5;
                      const rotateY = ((x - centerX) / centerX) * 5;
                      e.currentTarget.style.setProperty('--mouse-x', `${(x / rect.width) * 100}%`);
                      e.currentTarget.style.setProperty('--mouse-y', `${(y / rect.height) * 100}%`);
                      e.currentTarget.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px) scale(1.012)`;
                    }}
                    onMouseLeave={(e) => {
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
                    <div className="glyph">ظ</div>
                    <div className="glyph-name">ظاء</div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Column 2: Makhraj Visualizer */}
            <motion.div variants={staggerItemVariants} className="explain-col-makhraj" id="explain-col-makhraj">
              <header className="explain-col-header" id="col-header-makhraj">
                <h2 className="intro-subheading subheading-prominent theme-amber">
                  <span className="subheading-accent-bar" aria-hidden="true" />
                  <span className="subheading-text">كيف ننطقها بشكل صحيح؟</span>
                </h2>
              </header>

              {/* SVG Makhraj Visualizer */}
              <div className="makhraj-frame" id="makhrajFrame">
                <svg viewBox="0 0 340 260" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <radialGradient id="tongueGrad" cx="30%" cy="22%" r="95%">
                      <stop offset="0%" stopColor="#FFC9AE">
                        <animate id="mkAnim1" attributeName="stop-color" dur="3.625s" repeatCount="1" keyTimes="0;0.2414;0.3793;0.6552;0.8103;1" values="#FFC9AE;#FFBA9C;#FFB08D;#FFB08D;#FFBA9C;#FFC9AE" begin="indefinite"/>
                      </stop>
                      <stop offset="16%" stopColor="#FF9A72">
                        <animate id="mkAnim2" attributeName="stop-color" dur="3.625s" repeatCount="1" keyTimes="0;0.2414;0.3793;0.6552;0.8103;1" values="#FF9A72;#FF8B62;#FF8256;#FF8256;#FF8B62;#FF9A72" begin="indefinite"/>
                      </stop>
                      <stop offset="45%" stopColor="#F0623A">
                        <animate id="mkAnim3" attributeName="stop-color" dur="3.625s" repeatCount="1" keyTimes="0;0.2414;0.3793;0.6552;0.8103;1" values="#F0623A;#E85A33;#E14E2C;#E14E2C;#E85A33;#F0623A" begin="indefinite"/>
                      </stop>
                      <stop offset="75%" stopColor="#D9502A">
                        <animate id="mkAnim4" attributeName="stop-color" dur="3.625s" repeatCount="1" keyTimes="0;0.2414;0.3793;0.6552;0.8103;1" values="#D9502A;#D04624;#C73E1D;#C73E1D;#D04624;#D9502A" begin="indefinite"/>
                      </stop>
                      <stop offset="100%" stopColor="#A6371A">
                        <animate id="mkAnim5" attributeName="stop-color" dur="3.625s" repeatCount="1" keyTimes="0;0.2414;0.3793;0.6552;0.8103;1" values="#A6371A;#9D3117;#902B12;#902B12;#9D3117;#A6371A" begin="indefinite"/>
                      </stop>
                    </radialGradient>

                    <radialGradient id="floorGrad" cx="38%" cy="20%" r="90%">
                      <stop offset="0%" stopColor="#F2B3A6"/>
                      <stop offset="45%" stopColor="#D98C82"/>
                      <stop offset="80%" stopColor="#C17C6E"/>
                      <stop offset="100%" stopColor="#A85E52"/>
                    </radialGradient>

                    <filter id="steamBlur" x="-100%" y="-100%" width="320%" height="320%">
                      <feGaussianBlur stdDeviation="1.3"/>
                    </filter>
                    <radialGradient id="wispGrad" cx="32%" cy="32%" r="70%">
                      <stop offset="0%" stopColor="#FFFDF6" stopOpacity="0.95"/>
                      <stop offset="55%" stopColor="#F3E3B8" stopOpacity="0.6"/>
                      <stop offset="100%" stopColor="#E7C766" stopOpacity="0"/>
                    </radialGradient>
                  </defs>

                  <g transform="translate(0,0)">
                    <path
                      d="M 246,96 C 200,60 185,88 168,74 C 140,52 95,60 72,92 C 50,124 50,168 74,198 C 100,230 150,238 190,222 C 220,210 238,192 250,166"
                      fill="none"
                      stroke="#E7C766"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    <path d="M 262,112 C 280,124 280,146 262,158" fill="none" stroke="#9CA8A3" strokeWidth="1.5"/>

                    <g id="upperTeeth">
                      <rect x="252" y="86" width="14" height="26" rx="4" fill="#F3E8D0" stroke="#E7C766" strokeWidth="2"/>
                      <rect x="270" y="86" width="14" height="26" rx="4" fill="#F3E8D0" stroke="#E7C766" strokeWidth="2"/>
                    </g>
                    <g id="lowerTeeth">
                      <rect x="252" y="150" width="14" height="26" rx="4" fill="#F3E8D0" stroke="#E7C766" strokeWidth="2"/>
                      <rect x="270" y="150" width="14" height="26" rx="4" fill="#F3E8D0" stroke="#E7C766" strokeWidth="2"/>
                    </g>

                    <path
                      d="M 74,198 C 100,230 150,238 190,222 C 220,210 238,192 250,166 C 246,172 200,182 150,192 C 110,200 90,196 74,198 Z"
                      fill="url(#floorGrad)"
                      stroke="#A85E52"
                      strokeWidth="1.2"
                    />

                    <ellipse id="mkShadow" cx="150" cy="196" rx="72" ry="8" fill="rgba(20,15,10,0.18)" opacity="0">
                      <animate
                        id="mkAnim6"
                        attributeName="opacity"
                        dur="3.625s"
                        repeatCount="1"
                        keyTimes="0;0.2414;0.3793;0.6552;0.8103;1"
                        values="0;0.85;1;1;0.85;0"
                        begin="indefinite"
                      />
                    </ellipse>

                    <g id="mkTongue">
                      <path
                        d="M 88 150 C 72 168 74 196 108 200 C 155 212 200 192 218 178 C 236 164 228 158 210 148 C 197 134 176 126 153 125 C 131 124 106 132 88 150 Z"
                        fill="url(#tongueGrad)"
                        stroke="#C4431F"
                        strokeWidth="2"
                      >
                        <animate
                          id="mkAnim7"
                          attributeName="d"
                          dur="3.625s"
                          repeatCount="1"
                          calcMode="spline"
                          keyTimes="0;0.2414;0.3793;0.6552;0.8103;1"
                          keySplines="0.42 0 1 1;0 0 0.58 1;0 0 1 1;0.42 0 1 1;0 0 0.58 1"
                          values="
                            M 88 150 C 72 168 74 196 108 200 C 155 212 200 192 218 178 C 236 164 228 158 210 148 C 197 134 176 126 153 125 C 131 124 106 132 88 150 Z;
                            M 88 153 C 67 165 75 198 107 202 C 153 213 193 194 212 177 C 230 163 229 152 222 140 C 216 128 203 120 190 119 C 177 118 146 119 88 153 Z;
                            M 88 158 C 66 168 76 202 105 206 C 150 214 180 198 200 176 C 220 160 236 144 248 130 C 256 122 262 118 266 114 C 270 110 220 98 88 158 Z;
                            M 88 158 C 66 168 76 202 105 206 C 150 214 180 198 200 176 C 220 160 236 144 248 130 C 256 122 262 118 266 114 C 270 110 220 98 88 158 Z;
                            M 88 155 C 66 164 75 200 106 204 C 152 213 186 196 206 177 C 222 161 232 148 240 138 C 246 130 250 124 250 120 C 250 114 210 104 88 155 Z;
                            M 88 150 C 72 168 74 196 108 200 C 155 212 200 192 218 178 C 236 164 228 158 210 148 C 197 134 176 126 153 125 C 131 124 106 132 88 150 Z"
                          begin="indefinite"
                        />
                      </path>
                      <path
                        d="M 88 150 C 72 168 74 196 108 200 C 155 212 200 192 218 178 C 236 164 228 158 210 148 C 197 134 176 126 153 125 C 131 124 106 132 88 150 Z"
                        fill="none"
                        stroke="#7A2410"
                        strokeWidth="1.5"
                        opacity="0.22"
                      >
                        <animate
                          id="mkAnim8"
                          attributeName="d"
                          dur="3.625s"
                          repeatCount="1"
                          calcMode="spline"
                          keyTimes="0;0.2414;0.3793;0.6552;0.8103;1"
                          keySplines="0.42 0 1 1;0 0 0.58 1;0 0 1 1;0.42 0 1 1;0 0 0.58 1"
                          values="
                            M 88 150 C 72 168 74 196 108 200 C 155 212 200 192 218 178 C 236 164 228 158 210 148 C 197 134 176 126 153 125 C 131 124 106 132 88 150 Z;
                            M 88 153 C 67 165 75 198 107 202 C 153 213 193 194 212 177 C 230 163 229 152 222 140 C 216 128 203 120 190 119 C 177 118 146 119 88 153 Z;
                            M 88 158 C 66 168 76 202 105 206 C 150 214 180 198 200 176 C 220 160 236 144 248 130 C 256 122 262 118 266 114 C 270 110 220 98 88 158 Z;
                            M 88 158 C 66 168 76 202 105 206 C 150 214 180 198 200 176 C 220 160 236 144 248 130 C 256 122 262 118 266 114 C 270 110 220 98 88 158 Z;
                            M 88 155 C 66 164 75 200 106 204 C 152 213 186 196 206 177 C 222 161 232 148 240 138 C 246 130 250 124 250 120 C 250 114 210 104 88 155 Z;
                            M 88 150 C 72 168 74 196 108 200 C 155 212 200 192 218 178 C 236 164 228 158 210 148 C 197 134 176 126 153 125 C 131 124 106 132 88 150 Z"
                          begin="indefinite"
                        />
                      </path>
                      <path
                        d="M 105 190 C 130 165 165 145 205 148"
                        fill="none"
                        stroke="#C4431F"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        opacity="0.55"
                      >
                        <animate
                          id="mkAnim9"
                          attributeName="d"
                          dur="3.625s"
                          repeatCount="1"
                          calcMode="spline"
                          keyTimes="0;0.2414;0.3793;0.6552;0.8103;1"
                          keySplines="0.42 0 1 1;0 0 0.58 1;0 0 1 1;0.42 0 1 1;0 0 0.58 1"
                          values="
                            M 105 190 C 130 165 165 145 202 150;
                            M 103 192 C 130 168 172 148 214 144;
                            M 100 195 C 130 175 185 148 238 134;
                            M 100 195 C 130 175 185 148 238 134;
                            M 102 193 C 130 172 178 146 230 142;
                            M 105 190 C 130 165 165 145 202 150"
                          begin="indefinite"
                        />
                      </path>
                    </g>

                    <g id="mkAirflow" opacity="0">
                      <animate
                        id="mkAnimAir"
                        attributeName="opacity"
                        dur="3.625s"
                        repeatCount="1"
                        keyTimes="0;0.3793;0.45;0.6552;0.8;1"
                        values="0;0;1;1;0.3;0"
                        begin="indefinite"
                      />
                      <g filter="url(#steamBlur)">
                        <ellipse rx="2.5" ry="1.6" fill="url(#wispGrad)">
                          <animateMotion dur="1.1s" repeatCount="indefinite" begin="0s" rotate="auto" path="M268,124 C 290,110 314,94 336,80"/>
                          <animate attributeName="rx" dur="1.1s" repeatCount="indefinite" begin="0s" values="2.5;6.5;10"/>
                          <animate attributeName="ry" dur="1.1s" repeatCount="indefinite" begin="0s" values="1.4;3.2;4.8"/>
                          <animate attributeName="opacity" dur="1.1s" repeatCount="indefinite" begin="0s" values="0;0.85;0"/>
                        </ellipse>
                        <ellipse rx="3" ry="1.8" fill="url(#wispGrad)">
                          <animateMotion dur="1.25s" repeatCount="indefinite" begin="0.2s" rotate="auto" path="M268,132 C 294,124 320,114 344,104"/>
                          <animate attributeName="rx" dur="1.25s" repeatCount="indefinite" begin="0.2s" values="3;7.5;12"/>
                          <animate attributeName="ry" dur="1.25s" repeatCount="indefinite" begin="0.2s" values="1.6;3.6;5.6"/>
                          <animate attributeName="opacity" dur="1.25s" repeatCount="indefinite" begin="0.2s" values="0;0.9;0"/>
                        </ellipse>
                        <ellipse rx="2.5" ry="1.6" fill="url(#wispGrad)">
                          <animateMotion dur="1.15s" repeatCount="indefinite" begin="0.35s" rotate="auto" path="M268,140 C 292,142 314,140 334,132"/>
                          <animate attributeName="rx" dur="1.15s" repeatCount="indefinite" begin="0.35s" values="2.5;6;9.5"/>
                          <animate attributeName="ry" dur="1.15s" repeatCount="indefinite" begin="0.35s" values="1.4;3;4.6"/>
                          <animate attributeName="opacity" dur="1.15s" repeatCount="indefinite" begin="0.35s" values="0;0.8;0"/>
                        </ellipse>
                      </g>
                    </g>

                    <line x1="270" y1="60" x2="270" y2="82" stroke="#CFE3DD" strokeWidth="1.5"/>
                    <text x="270" y="50" textAnchor="middle" fill="#F7F1E1" fontFamily="Cairo, sans-serif" fontSize="13" fontWeight="700">الثنايا العليا</text>

                    <text x="100" y="245" textAnchor="middle" fill="#F7F1E1" fontFamily="Cairo, sans-serif" fontSize="13" fontWeight="700">اللسان</text>
                    <line x1="100" y1="233" x2="100" y2="192" stroke="#CFE3DD" strokeWidth="1.5"/>
                  </g>
                </svg>

                <button
                  type="button"
                  id="mkPlayBtn"
                  className="mk-play-btn"
                  onClick={playMakhraj}
                  disabled={makhrajPlaying}
                  aria-label="شغّل الحركة"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </button>
              </div>
            </motion.div>
          </div>
        </div>

        {/* مقارنة الأخطاء الشائعة للحروف اللثوية بنظام الثنائيات المباشرة */}
        <motion.div variants={staggerItemVariants} className="lathawiya-bottom-vowels-bar" id="lathawiya-bottom-vowels-bar">
          <div className="vowels-bar-header" id="vowels-bar-header">
            <span className="vowels-bar-title-tag" id="vowels-bar-title-tag">
              احذر الخلط الصوتي — قارن الحرف بنظيره
            </span>
          </div>

          <div className="vowels-compact-grid lathawiya-pairs-grid" id="vowels-compact-grid">
            {/* عمود 1: الثاء مقابل السين */}
            <div className="vowels-letter-col theme-emerald lathawiya-pair-col" id="col-letter-tha">
              <div className="lathawiya-pair-col-head">
                <div className="mistake-letter-tag" id="tag-tha">ث</div>
                <div className="lathawiya-confusion-label">
                  <span>لا تخلطها مع</span>
                  <span className="lathawiya-confused-letter" aria-label="حرف السين">س</span>
                </div>
              </div>

              <div className="lathawiya-pairs-card" id="two-cols-box-tha">
                <div className="lathawiya-pairs-subhead">
                  <span className="lathawiya-subhead-label is-target">بحرف ث</span>
                  <span aria-hidden="true" />
                  <span className="lathawiya-subhead-label is-contrast">بحرف س</span>
                </div>

                <div className="lathawiya-pairs-list">
                  <div className="lathawiya-pair-row">
                    <span className="lathawiya-word-chip is-target" title="نطق حرف الثاء في كلمة: بَثَّ">
                      بَ<span className="highlight-target-char correct">ثَّ</span>
                    </span>
                    <span className="lathawiya-pair-neq" aria-hidden="true">≠</span>
                    <span className="lathawiya-word-chip is-contrast" title="نطق حرف السين في كلمة: بَسًّا">
                      بَ<span className="highlight-target-char contrast">سًّ</span>ا
                    </span>
                  </div>

                  <div className="lathawiya-pair-row">
                    <span className="lathawiya-word-chip is-target" title="نطق حرف الثاء في كلمة: مَثَلُ">
                      مَ<span className="highlight-target-char correct">ثَ</span>لُ
                    </span>
                    <span className="lathawiya-pair-neq" aria-hidden="true">≠</span>
                    <span className="lathawiya-word-chip is-contrast" title="نطق حرف السين في كلمة: مَسَّهُ">
                      مَ<span className="highlight-target-char contrast">سَّ</span>هُ
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="vowels-col-divider" aria-hidden="true" />

            {/* عمود 2: الذال مقابل الزاي */}
            <div className="vowels-letter-col theme-amber lathawiya-pair-col" id="col-letter-thal">
              <div className="lathawiya-pair-col-head">
                <div className="mistake-letter-tag" id="tag-thal">ذ</div>
                <div className="lathawiya-confusion-label">
                  <span>لا تخلطها مع</span>
                  <span className="lathawiya-confused-letter" aria-label="حرف الزاي">ز</span>
                </div>
              </div>

              <div className="lathawiya-pairs-card" id="two-cols-box-thal">
                <div className="lathawiya-pairs-subhead">
                  <span className="lathawiya-subhead-label is-target">بحرف ذ</span>
                  <span aria-hidden="true" />
                  <span className="lathawiya-subhead-label is-contrast">بحرف ز</span>
                </div>

                <div className="lathawiya-pairs-list">
                  <div className="lathawiya-pair-row">
                    <span className="lathawiya-word-chip is-target" title="نطق حرف الذال في كلمة: ذَرْعًا">
                      <span className="highlight-target-char correct">ذَ</span>رْعًا
                    </span>
                    <span className="lathawiya-pair-neq" aria-hidden="true">≠</span>
                    <span className="lathawiya-word-chip is-contrast" title="نطق حرف الزاي في كلمة: زَرْعًا">
                      <span className="highlight-target-char contrast">زَ</span>رْعًا
                    </span>
                  </div>

                  <div className="lathawiya-pair-row">
                    <span className="lathawiya-word-chip is-target" title="نطق حرف الذال في كلمة: تُذِلُّ">
                      تُ<span className="highlight-target-char correct">ذِ</span>لُّ
                    </span>
                    <span className="lathawiya-pair-neq" aria-hidden="true">≠</span>
                    <span className="lathawiya-word-chip is-contrast" title="نطق حرف الزاي في كلمة: تَزِلَّ">
                      تَ<span className="highlight-target-char contrast">زِ</span>لَّ
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="vowels-col-divider" aria-hidden="true" />

            {/* عمود 3: الظاء مقابل الضاد */}
            <div className="vowels-letter-col theme-sky lathawiya-pair-col" id="col-letter-zha">
              <div className="lathawiya-pair-col-head">
                <div className="mistake-letter-tag" id="tag-zha">ظ</div>
                <div className="lathawiya-confusion-label">
                  <span>لا تخلطها مع</span>
                  <span className="lathawiya-confused-letter" aria-label="حرف الضاد">ض</span>
                </div>
              </div>

              <div className="lathawiya-pairs-card" id="two-cols-box-zha">
                <div className="lathawiya-pairs-subhead">
                  <span className="lathawiya-subhead-label is-target">بحرف ظ</span>
                  <span aria-hidden="true" />
                  <span className="lathawiya-subhead-label is-contrast">بحرف ض</span>
                </div>

                <div className="lathawiya-pairs-list">
                  <div className="lathawiya-pair-row">
                    <span className="lathawiya-word-chip is-target" title="نطق حرف الظاء في كلمة: ظَلَّ">
                      <span className="highlight-target-char correct">ظَ</span>لَّ
                    </span>
                    <span className="lathawiya-pair-neq" aria-hidden="true">≠</span>
                    <span className="lathawiya-word-chip is-contrast" title="نطق حرف الضاد في كلمة: ضَلَّ">
                      <span className="highlight-target-char contrast">ضَ</span>لَّ
                    </span>
                  </div>

                  <div className="lathawiya-pair-row">
                    <span className="lathawiya-word-chip is-target" title="نطق حرف الظاء في كلمة: نَاظِرَةٌ">
                      نَا<span className="highlight-target-char correct">ظِ</span>رَةٌ
                    </span>
                    <span className="lathawiya-pair-neq" aria-hidden="true">≠</span>
                    <span className="lathawiya-word-chip is-contrast" title="نطق حرف الضاد في كلمة: نَاضِرَةٌ">
                      نَا<span className="highlight-target-char contrast">ضِ</span>رَةٌ
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.section>
    )}

      {/* TAB 2: LEVEL 1 - ISOLATED LETTERS */}
      {activeTab === 'letters' && (
        <motion.section
          key="letters"
          className="panel active"
          id="panel-letters"
          custom={tabDirection}
          variants={panelVariants}
          initial="enter"
          animate="center"
          exit="exit"
        >
        <div className="card" id="card-level1-game">
          <svg className="card-level1-deco" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="100" cy="20" r="52" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />
            <circle cx="100" cy="20" r="38" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
            <circle cx="100" cy="20" r="22" stroke="currentColor" strokeWidth="1" opacity="0.5" />
            <rect x="76" y="-4" width="48" height="48" rx="6" transform="rotate(45 100 20)" stroke="currentColor" strokeWidth="1" opacity="0.4" />
            <rect x="76" y="-4" width="48" height="48" rx="6" stroke="currentColor" strokeWidth="1" opacity="0.4" />
          </svg>
          <motion.h2 variants={staggerItemVariants} className="intro-heading">
            <span className="ih-row">
              <span className="ih-line"></span>
              <span className="ih-diamond"></span>
              <span className="ih-badge badge-search" aria-hidden="true">
                <Search className="ih-badge-icon" />
              </span>
              <span className="ih-text">ابحث عن الحروف اللثوية</span>
              <span className="ih-diamond"></span>
              <span className="ih-line ih-line-r"></span>
            </span>
          </motion.h2>

          {/* Apple-Inspired Dynamic Glass Countdown Dock */}
          {(() => {
            const ratio = Math.max(0, Math.min(1, level1TimeLeft / level1InitialDuration));
            const isWon = level1CorrectSet.size === 3;
            const isExpired = level1TimerStatus === 'finished' && !isWon;
            const isDanger = level1TimerStatus === 'running' && level1TimeLeft <= 5;
            const isWarn = level1TimerStatus === 'running' && level1TimeLeft <= 10 && level1TimeLeft > 5;
            const urgencyClass = isWon
              ? 'won'
              : isExpired
              ? 'expired'
              : isDanger
              ? 'danger'
              : isWarn
              ? 'warning'
              : level1TimerStatus;

            return (
              <motion.div variants={staggerItemVariants} className="challenge-timer-row" id="letters-stats-row">
                <div className={`challenge-timer-dock ${urgencyClass}`} id="letters-pro-timer-dock">
                  <div className="challenge-timer-main">
                    <div className="challenge-timer-actions">
                      <button
                        type="button"
                        className="challenge-timer-btn primary pill-action"
                        onClick={handleStartOrPauseTimer}
                        title={
                          level1TimerStatus === 'running'
                            ? 'إيقاف مؤقت'
                            : level1TimerStatus === 'finished'
                            ? 'جولة جديدة'
                            : level1TimerStatus === 'paused'
                            ? 'استئناف المؤقت'
                            : 'بدء المؤقت'
                        }
                        aria-label={
                          level1TimerStatus === 'running'
                            ? 'إيقاف مؤقت'
                            : level1TimerStatus === 'finished'
                            ? 'جولة جديدة'
                            : level1TimerStatus === 'paused'
                            ? 'استئناف المؤقت'
                            : 'بدء المؤقت'
                        }
                      >
                        {level1TimerStatus === 'running' ? (
                          <Pause className="w-3.5 h-3.5" fill="currentColor" strokeWidth={1.5} />
                        ) : level1TimerStatus === 'finished' ? (
                          <RotateCcw className="w-3.5 h-3.5" strokeWidth={2.4} />
                        ) : (
                          <Play className="w-3.5 h-3.5" fill="currentColor" strokeWidth={1.5} />
                        )}
                        <span className="challenge-timer-btn-text">
                          {level1TimerStatus === 'running'
                            ? 'إيقاف'
                            : level1TimerStatus === 'finished'
                            ? 'جديد'
                            : level1TimerStatus === 'paused'
                            ? 'استئناف'
                            : 'بدء'}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="challenge-timer-btn circle-reset"
                        onClick={handleResetTimer}
                        title="إعادة ضبط المؤقت"
                        aria-label="إعادة ضبط المؤقت"
                        disabled={level1TimeLeft === level1InitialDuration && level1TimerStatus === 'idle'}
                      >
                        <RotateCcw className="w-4 h-4" strokeWidth={2.2} />
                      </button>
                    </div>

                    <div className="challenge-clock-anchor" ref={timerClockWrapperRef}>
                      <button
                        type="button"
                        className={`challenge-timer-clock ${durationPopoverOpen ? 'open' : ''}`}
                        id="letters-timer-value"
                        onClick={() => setDurationPopoverOpen(prev => !prev)}
                        aria-expanded={durationPopoverOpen}
                        aria-haspopup="true"
                        title="اضغط لاختيار مدة المؤقت"
                      >
                        <span className="challenge-timer-digits">
                          {toArabicDigits(String(Math.floor(level1TimeLeft / 60)).padStart(2, '0'))}
                          <span className="challenge-timer-colon">:</span>
                          {toArabicDigits(String(level1TimeLeft % 60).padStart(2, '0'))}
                        </span>
                        <ChevronDown
                          className={`challenge-clock-chevron ${durationPopoverOpen ? 'rotated' : ''}`}
                          aria-hidden="true"
                        />
                      </button>

                      <AnimatePresence>
                        {durationPopoverOpen && (
                          <div className="challenge-duration-popover-pos">
                            <motion.div
                              className="challenge-duration-popover"
                              role="group"
                              aria-label="اختيار مدة الاختبار"
                              style={{ transformOrigin: 'top center' }}
                              initial={{ opacity: 0, y: -8, scale: 0.95 }}
                              animate={{
                                opacity: 1,
                                y: 0,
                                scale: 1,
                                transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
                              }}
                              exit={{
                                opacity: 0,
                                y: -5,
                                scale: 0.96,
                                transition: { duration: 0.15, ease: [0.4, 0, 1, 1] },
                              }}
                            >
                              <div className="challenge-duration-group">
                                {[15, 30, 45, 60].map((sec) => {
                                  const isActive = level1InitialDuration === sec;
                                  return (
                                    <motion.button
                                      key={sec}
                                      type="button"
                                      className={`challenge-duration-btn ${isActive ? 'active' : ''}`}
                                      onClick={() => handleSelectPresetDuration(sec)}
                                      aria-pressed={isActive}
                                      aria-label={`${toArabicDigits(sec)} ثانية`}
                                      whileTap={{ scale: 0.96 }}
                                      transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
                                    >
                                      <span className="challenge-duration-label">
                                        <span className="challenge-duration-num">{toArabicDigits(sec)}</span>
                                      </span>
                                      {isActive && (
                                        <motion.span
                                          layoutId="appleDurationPill"
                                          className="challenge-duration-pill"
                                          transition={{ type: 'spring', stiffness: 520, damping: 41, mass: 0.8 }}
                                          aria-hidden="true"
                                        />
                                      )}
                                    </motion.button>
                                  );
                                })}
                              </div>
                            </motion.div>
                          </div>
                        )}
                      </AnimatePresence>
                    </div>

                    <div
                      className={`challenge-found-nodes ${isWon ? 'complete' : ''}`}
                      aria-live="polite"
                      aria-label={`تم اكتشاف ${toArabicDigits(level1CorrectSet.size)} من ${toArabicDigits(3)} حروف`}
                      title={`المكتشف: ${toArabicDigits(level1CorrectSet.size)} من ${toArabicDigits(3)}`}
                    >
                      {[0, 1, 2].map((slotIdx) => {
                        const isFound = slotIdx < level1CorrectSet.size;
                        return (
                          <span
                            key={slotIdx}
                            className={`challenge-found-node ${isFound ? 'found' : ''}`}
                            aria-hidden="true"
                          />
                        );
                      })}
                    </div>
                  </div>

                  <div
                    className="challenge-timer-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={level1InitialDuration}
                    aria-valuenow={level1TimeLeft}
                    aria-label="الوقت المتبقي"
                  >
                    <div
                      className="challenge-timer-fill"
                      style={{ transform: `scaleX(${ratio})` }}
                    />
                  </div>
                </div>
              </motion.div>
            );
          })()}

          <motion.div variants={staggerItemVariants} className="letter-grid" id="letters-grid">
            {level1Cards.map((ch, idx) => {
              const isCorrect = level1CorrectSet.has(idx);
              const isRevealed = level1Revealed && TARGETS.includes(ch) && !isCorrect;
              const isWrong = level1WrongIndex === idx;

              return (
                <div
                  key={idx}
                  id={`letter-tile-${idx}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`حرف ${ch}`}
                  className={`tile-btn ${isCorrect ? 'correct' : ''} ${isRevealed ? 'revealed' : ''} ${isWrong ? 'wrong' : ''}`}
                  onClick={() => handleLevel1Click(ch, idx)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleLevel1Click(ch, idx);
                    }
                  }}
                >
                  <svg className="tile-deco-pattern" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <circle cx="100" cy="20" r="52" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />
                    <circle cx="100" cy="20" r="38" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
                    <circle cx="100" cy="20" r="22" stroke="currentColor" strokeWidth="1" opacity="0.5" />
                    <circle cx="100" cy="20" r="8" fill="currentColor" opacity="0.25" />
                    <rect x="76" y="-4" width="48" height="48" rx="6" transform="rotate(45 100 20)" stroke="currentColor" strokeWidth="1" opacity="0.4" />
                    <rect x="76" y="-4" width="48" height="48" rx="6" stroke="currentColor" strokeWidth="1" opacity="0.4" />
                  </svg>
                  <span className="tile-glyph">{ch}</span>
                </div>
              );
            })}
          </motion.div>

          <motion.div variants={staggerItemVariants} className="controls-row" id="letters-controls">
            <button
              type="button"
              className="btn"
              id="letters-reveal"
              onClick={() => setLevel1Revealed(true)}
            >
              إظهار الحل
            </button>
            <button
              type="button"
              className="btn primary"
              id="letters-new"
              onClick={startLevel1Round}
            >
              بطاقات جديدة
            </button>
          </motion.div>
        </div>
      </motion.section>
    )}

      {/* TAB 3: LEVEL 2 - WORDS (Sequential Single-Word Extraction, No Timer) */}
      {activeTab === 'words' && (
        <motion.section
          key="words"
          className="panel active"
          id="panel-words"
          custom={tabDirection}
          variants={panelVariants}
          initial="enter"
          animate="center"
          exit="exit"
        >
        <div className="card" id="card-level2-words">
          <svg className="card-level1-deco" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="100" cy="20" r="52" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />
            <circle cx="100" cy="20" r="38" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
            <circle cx="100" cy="20" r="22" stroke="currentColor" strokeWidth="1" opacity="0.5" />
            <rect x="76" y="-4" width="48" height="48" rx="6" transform="rotate(45 100 20)" stroke="currentColor" strokeWidth="1" opacity="0.4" />
            <rect x="76" y="-4" width="48" height="48" rx="6" stroke="currentColor" strokeWidth="1" opacity="0.4" />
          </svg>
          <motion.h2 variants={staggerItemVariants} className="intro-heading">
            <span className="ih-row">
              <span className="ih-line"></span>
              <span className="ih-diamond"></span>
              <span className="ih-badge badge-words" aria-hidden="true">
                <Layers className="ih-badge-icon" />
              </span>
              <span className="ih-text">ابحث عن الحرف اللثوي داخل الكلمة</span>
              <span className="ih-diamond"></span>
              <span className="ih-line ih-line-r"></span>
            </span>
          </motion.h2>

          {/* Compact Example Progress Pill */}
          <motion.div variants={staggerItemVariants} className="words-progress-row" id="words-progress-row">
            <div
              className="words-progress-pill"
              aria-live="polite"
              aria-label={`المثال ${toArabicDigits(wordIdx + 1)} من ${toArabicDigits(wordsSession.length)}`}
            >
              <span className="words-progress-count">
                المثال {toArabicDigits(wordIdx + 1)} من {toArabicDigits(wordsSession.length)}
              </span>
            </div>
          </motion.div>

          {/* Single Word Extraction Stage */}
          <motion.div variants={staggerItemVariants} className="words-single-stage" id="words-grid">
            <div
              id="word-tile-1"
              className={`tile-btn word-extract-card ${
                wordsCompletedSet.has(wordIdx)
                  ? currentWordItem.has
                    ? 'is-solved'
                    : 'is-solved-none'
                  : wordWrongLetterIdx !== null || wordNoneWrong
                  ? 'is-wrong'
                  : ''
              }`}
            >
              <svg className="tile-deco-pattern" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <circle cx="100" cy="20" r="52" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />
                <circle cx="100" cy="20" r="38" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
                <circle cx="100" cy="20" r="22" stroke="currentColor" strokeWidth="1" opacity="0.5" />
                <circle cx="100" cy="20" r="8" fill="currentColor" opacity="0.25" />
                <rect x="76" y="-4" width="48" height="48" rx="6" transform="rotate(45 100 20)" stroke="currentColor" strokeWidth="1" opacity="0.4" />
                <rect x="76" y="-4" width="48" height="48" rx="6" stroke="currentColor" strokeWidth="1" opacity="0.4" />
              </svg>
              {wordsCompletedSet.has(wordIdx) && currentWordItem.has && (
                <span className="word-extract-done-badge" aria-label="تم تحديد الحرف اللثوي الصحيح">
                  <Check className="w-4 h-4" strokeWidth={2.8} />
                </span>
              )}
              {wordsCompletedSet.has(wordIdx) && !currentWordItem.has && (
                <span className="word-extract-none-badge" aria-label="الكلمة خالية من الحروف اللثوية">
                  <Check className="w-3.5 h-3.5" strokeWidth={2.8} />
                  <span>خالية من اللثوية</span>
                </span>
              )}
              {!wordsCompletedSet.has(wordIdx) && (wordWrongLetterIdx !== null || wordNoneWrong) && (
                <span className="word-extract-wrong-badge" aria-label="إجابة خاطئة">
                  <X className="w-4 h-4" strokeWidth={2.8} />
                </span>
              )}
              <span className="tile-glyph word-extract-glyph" dir="rtl">
                {currentWordTokens.map((token, tIdx) => {
                  if (token.type === 'space') {
                    return <React.Fragment key={tIdx}> </React.Fragment>;
                  }
                  const isCorrect = wordFoundLetters.has(tIdx);
                  const isRevealed = wordRevealed && token.isTarget && !isCorrect;
                  const isWrong = wordWrongLetterIdx === tIdx;

                  return (
                    <span
                      key={`${wordIdx}-${tIdx}`}
                      id={`word-letter-${tIdx}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`حرف ${token.base}`}
                      className={`word-extract-letter ${isCorrect ? 'correct' : ''} ${isRevealed ? 'revealed' : ''} ${isWrong ? 'wrong' : ''}`}
                      onClick={() => handleWordLetterTap(token.isTarget, tIdx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleWordLetterTap(token.isTarget, tIdx);
                        }
                      }}
                    >
                      {token.base + token.extra}
                    </span>
                  );
                })}
              </span>
            </div>

            <button
              type="button"
              id="words-none-btn"
              className={`word-none-choice-btn ${wordNoneCorrect ? 'correct' : ''} ${wordRevealed && !currentWordItem.has && !wordNoneCorrect ? 'revealed' : ''} ${wordNoneWrong ? 'wrong' : ''}`}
              onClick={handleWordNoneClick}
            >
              {wordNoneCorrect && <Check className="w-4 h-4 shrink-0" strokeWidth={2.8} />}
              {wordNoneWrong && <X className="w-4 h-4 shrink-0" strokeWidth={2.8} />}
              <span>لا يوجد حرف لثوي</span>
            </button>

            {wordFeedback && (
              <div
                id="words-feedback-pill"
                role="status"
                aria-live="polite"
                className={`word-extract-feedback is-${wordFeedback.kind}`}
              >
                {wordFeedback.kind === 'wrong' ? (
                  <X className="w-4 h-4 shrink-0" strokeWidth={2.6} />
                ) : (
                  <Check className="w-4 h-4 shrink-0" strokeWidth={2.6} />
                )}
                <span>{wordFeedback.msg}</span>
              </div>
            )}
          </motion.div>

          <motion.div variants={staggerItemVariants} className="controls-row" id="words-controls">
            <button
              type="button"
              className="btn"
              id="words-reveal"
              onClick={() => setWordRevealed(true)}
            >
              إظهار الحل
            </button>
            <button
              type="button"
              className="btn primary"
              id="words-next"
              onClick={handleWordsNext}
            >
              {wordIdx < wordsSession.length - 1 ? 'المثال التالي' : 'أمثلة جديدة'}
            </button>
          </motion.div>
        </div>
      </motion.section>
    )}

      {/* TAB 4: APPLICATION */}
      {activeTab === 'apply' && (
        <motion.section
          key="apply"
          className="panel active"
          id="panel-apply"
          custom={tabDirection}
          variants={panelVariants}
          initial="enter"
          animate="center"
          exit="exit"
        >
        <div className="card" id="card-level3-apply">
          <svg className="card-level1-deco" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="100" cy="20" r="52" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />
            <circle cx="100" cy="20" r="38" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
            <circle cx="100" cy="20" r="22" stroke="currentColor" strokeWidth="1" opacity="0.5" />
            <rect x="76" y="-4" width="48" height="48" rx="6" transform="rotate(45 100 20)" stroke="currentColor" strokeWidth="1" opacity="0.4" />
            <rect x="76" y="-4" width="48" height="48" rx="6" stroke="currentColor" strokeWidth="1" opacity="0.4" />
          </svg>
          <motion.h2 variants={staggerItemVariants} className="intro-heading">
            <span className="ih-row">
              <span className="ih-line"></span>
              <span className="ih-diamond"></span>
              <span className="ih-badge badge-quran" aria-hidden="true">
                <BookOpen className="ih-badge-icon" />
              </span>
              <span className="ih-text">طبّق داخل القرآن الكريم</span>
              <span className="ih-diamond"></span>
              <span className="ih-line ih-line-r"></span>
            </span>
          </motion.h2>

          <motion.div variants={staggerItemVariants} className="sub-tabs apply-segmented-group" id="apply-sub-tabs" role="tablist" aria-label="اختر طريقة التطبيق">
            <button
              type="button"
              role="tab"
              aria-selected={activeSubTab === 'surah'}
              id="sub-tab-btn-surah"
              className={`sub-tab-btn ${activeSubTab === 'surah' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('surah')}
            >
              {activeSubTab === 'surah' && (
                <motion.span
                  layoutId="applySubTabPill"
                  className="apply-subtab-pill"
                  transition={{ type: 'spring', stiffness: 520, damping: 41, mass: 0.8 }}
                  aria-hidden="true"
                />
              )}
              <span className="apply-subtab-label">المصحف الشريف</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSubTab === 'free'}
              id="sub-tab-btn-free"
              className={`sub-tab-btn ${activeSubTab === 'free' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('free')}
            >
              {activeSubTab === 'free' && (
                <motion.span
                  layoutId="applySubTabPill"
                  className="apply-subtab-pill"
                  transition={{ type: 'spring', stiffness: 520, damping: 41, mass: 0.8 }}
                  aria-hidden="true"
                />
              )}
              <span className="apply-subtab-label">آية من اختيارك</span>
            </button>
          </motion.div>

          {/* Subpanel: Embedded 604-Page Uthmani Mus'haf Practice */}
          {activeSubTab === 'surah' && (
            <MushafProgram
              variant="embedded"
              initialTajweed={true}
              practiceConfig={{
                targetLetters: TARGETS,
                targetLabel: 'الحروف اللثوية',
                hitMessage: 'أحسنت! هذا حرف لثوي ✓',
                missMessage: 'حاول مرة أخرى، هذا ليس حرفًا لثويًا',
                completeSingleMessage: 'ممتاز! وجدت كل الحروف اللثوية في هذه الصفحة ✓',
                onPracticeComplete: () => {
                  if (!progress.apply) {
                    setProgress(p => ({ ...p, apply: true }));
                  }
                },
              }}
              onPlayChime={playChime}
              onTriggerConfetti={triggerConfetti}
            />
          )}

          {/* Subpanel: Free Text */}
          <div className={`sub-panel ${activeSubTab === 'free' ? 'active' : ''}`} id="sub-free">
            <motion.div variants={staggerItemVariants} className="apply-free-input-wrap">
              <label className="field-label" htmlFor="free-input">الصق أو اكتب أي آية من القرآن الكريم:</label>
              <textarea
                id="free-input"
                value={freeText}
                onChange={e => setFreeText(e.target.value)}
                placeholder="مثال: وَلَقَدْ يَسَّرْنَا الْقُرْآنَ لِلذِّكْرِ فَهَلْ مِنْ مُدَّكِرٍ"
              ></textarea>
            </motion.div>

            <motion.div variants={staggerItemVariants} className="controls-row" id="free-apply-row">
              <button
                type="button"
                className="btn primary"
                id="free-apply"
                onClick={() => {
                  const trimmed = freeText.trim();
                  if (!trimmed) {
                    setFreeStatus({ msg: 'اكتب أو الصق آية أولًا', kind: 'bad' });
                    setAppliedFreeText('');
                    setFreeCorrectSet(new Set());
                    return;
                  }
                  setAppliedFreeText(trimmed);
                  setFreeCorrectSet(new Set());
                  setFreeRevealed(false);
                  setFreeStatus({ msg: '', kind: null });
                }}
              >
                تطبيق
              </button>
            </motion.div>

            {!appliedFreeText && freeStatus.msg && (
              <motion.div
                variants={staggerItemVariants}
                role="status"
                aria-live="polite"
                className={`status-line word-extract-feedback ${freeStatus.kind === 'bad' ? 'is-wrong' : 'is-correct-letter'}`}
                id="free-status"
              >
                {freeStatus.kind === 'bad' ? (
                  <X className="w-4 h-4 shrink-0" strokeWidth={2.6} />
                ) : (
                  <Check className="w-4 h-4 shrink-0" strokeWidth={2.6} />
                )}
                <span>{freeStatus.msg}</span>
              </motion.div>
            )}

            {appliedFreeText && (
              <>
                <motion.div variants={staggerItemVariants} className="apply-toolbar-row" id="free-toolbar-row">
                  <div className="instruction">
                    اضغط على <span className="apply-instruction-accent">الحروف اللثوية</span> في النص
                  </div>

                  <div
                    className={`counter-pill ${freeTotalTargets > 0 && freeCorrectSet.size === freeTotalTargets ? 'is-complete' : ''}`}
                    id="free-counter"
                    aria-live="polite"
                  >
                    وجدت {toArabicDigits(freeCorrectSet.size)} من {toArabicDigits(freeTotalTargets)}
                  </div>
                </motion.div>

                <motion.div
                  variants={staggerItemVariants}
                  className={`quran-frame ${freeTotalTargets > 0 && freeCorrectSet.size === freeTotalTargets ? 'is-solved' : ''}`}
                  id="free-frame"
                >
                  <svg className="tile-deco-pattern" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <circle cx="100" cy="20" r="52" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />
                    <circle cx="100" cy="20" r="38" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
                    <circle cx="100" cy="20" r="22" stroke="currentColor" strokeWidth="1" opacity="0.5" />
                    <circle cx="100" cy="20" r="8" fill="currentColor" opacity="0.25" />
                    <rect x="76" y="-4" width="48" height="48" rx="6" transform="rotate(45 100 20)" stroke="currentColor" strokeWidth="1" opacity="0.4" />
                    <rect x="76" y="-4" width="48" height="48" rx="6" stroke="currentColor" strokeWidth="1" opacity="0.4" />
                  </svg>
                  <div className="quran-frame-content">
                    <div className="ayah">
                      {freeTokens.map((token, idx) => {
                        if (token.type === 'space') {
                          return <React.Fragment key={idx}> </React.Fragment>;
                        }
                        if (token.type === 'symbol') {
                          return (
                            <span key={idx} className="mushaf-symbol" aria-hidden="true">
                              {token.base + token.extra}
                            </span>
                          );
                        }
                        const isCorrect = freeCorrectSet.has(idx);
                        const isRevealed = freeRevealed && token.isTarget && !isCorrect;
                        const isWrong = freeWrongIdx === idx;

                        return (
                          <span
                            key={idx}
                            id={`free-letter-${idx}`}
                            className={`letter-unit ${isCorrect ? 'correct' : ''} ${isRevealed ? 'revealed' : ''} ${isWrong ? 'wrong' : ''}`}
                            onClick={() => handleFreeLetterClick(token, idx)}
                          >
                            {token.base + token.extra}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>

                {freeStatus.msg && (
                  <motion.div
                    variants={staggerItemVariants}
                    role="status"
                    aria-live="polite"
                    className={`status-line word-extract-feedback ${freeStatus.kind === 'bad' ? 'is-wrong' : 'is-correct-letter'}`}
                    id="free-status"
                  >
                    {freeStatus.kind === 'bad' ? (
                      <X className="w-4 h-4 shrink-0" strokeWidth={2.6} />
                    ) : (
                      <Check className="w-4 h-4 shrink-0" strokeWidth={2.6} />
                    )}
                    <span>{freeStatus.msg}</span>
                  </motion.div>
                )}

                <motion.div variants={staggerItemVariants} className="controls-row" id="free-controls">
                  <button
                    type="button"
                    className="btn"
                    id="free-reveal"
                    onClick={() => setFreeRevealed(true)}
                  >
                    إظهار الحل
                  </button>
                </motion.div>
              </>
            )}
          </div>
        </div>
      </motion.section>
    )}
  </AnimatePresence>
)}
          </>
        )}

      {/* Footer */}
      <footer id="main-footer">
        <div className="footer-content">
          <span>منصة مَعَ السَّفَرَة — تعليم قراءة العربية والقرآن والتجويد</span>
          {appView === 'tajweed' && (
            <div className="footer-keys-hint" title="يمكنك التنقل بين المراحل بالأسهم">
              <span className="key-badge">←</span>
              <span className="key-badge">→</span>
              <span>للتنقل السريع بين المراحل</span>
            </div>
          )}
        </div>
      </footer>

      {/* Global Document-Anchored Drawing Layer (below #main-header) */}
      <GlobalAnnotationLayer />
    </div>

    {/* Root-Level Pro-Grade Optical Laser Layer */}
    <OpticalLaserLayer />

    {/* Root-Level Precision On-Screen Pen / Highlighter / Eraser Cursor */}
    <AnnotationToolCursor />

    {/* Standalone Floating Apple PencilKit Palette */}
    <FloatingAnnotationPalette />
    </>
  );
}

export default function App() {
  return (
    <AnnotationProvider defaultOpen={false}>
      <AppContent />
    </AnnotationProvider>
  );
}
