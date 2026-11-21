import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, type Variants } from 'motion/react';
import { Activity, Search, BookOpen, Layers, Sparkles, BookMarked, ChevronDown, Check, Play, Pause, RotateCcw, Volume2, Award, Flame } from 'lucide-react';
import { InteractiveGhunnahMakhraj } from './InteractiveGhunnahMakhraj';

const DIACRITIC_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640]/;
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function toArabicDigits(n: number | string): string {
  return String(n).split('').map(c => (/[0-9]/.test(c) ? ARABIC_DIGITS[+c] : c)).join('');
}

interface LetterUnit {
  type: 'letter' | 'space';
  base: string;
  extra: string;
  isTarget: boolean;
}

function tokenizeNoonMeem(text: string): LetterUnit[] {
  const units: LetterUnit[] = [];
  for (const ch of text) {
    if (ch === ' ') {
      units.push({ type: 'space', base: ' ', extra: '', isTarget: false });
      continue;
    }
    if (DIACRITIC_RE.test(ch) && units.length && units[units.length - 1].type === 'letter') {
      units[units.length - 1].extra += ch;
      continue;
    }
    units.push({ type: 'letter', base: ch, extra: '', isTarget: false });
  }

  for (const unit of units) {
    if (unit.type === 'letter') {
      const isNoonOrMeem = unit.base === 'ن' || unit.base === 'م';
      const hasShaddah = unit.extra.includes('\u0651') || unit.base.includes('ّ');
      unit.isTarget = isNoonOrMeem && hasShaddah;
    }
  }
  return units;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const NOON_MEEM_LETTER_POOL = ['نّ', 'مّ', 'نْ', 'مْ', 'نَ', 'مُ', 'لّ', 'رّ', 'بّ', 'كّ', 'سّ', 'تّ', 'دّ', 'هـ'];

const NOON_MEEM_WORD_BANK = [
  { w: 'إِنَّ', has: true },
  { w: 'النَّاسِ', has: true },
  { w: 'ثُمَّ', has: true },
  { w: 'جَنَّاتٍ', has: true },
  { w: 'عَمَّ', has: true },
  { w: 'مُحَمَّدٌ', has: true },
  { w: 'أُمَّةٍ', has: true },
  { w: 'مِمَّا', has: true },
  { w: 'إِمَّا', has: true },
  { w: 'النَّعِيمِ', has: true },
  { w: 'حَمَّالَةَ', has: true },
  { w: 'أَنَّهُمْ', has: true },
  { w: 'مَسَدٍ', has: false },
  { w: 'نَصْرُ', has: false },
  { w: 'كِتَابٌ', has: false },
  { w: 'سَلَامٌ', has: false },
  { w: 'مَدْرَسَة', has: false },
  { w: 'قَلَمٌ', has: false },
  { w: 'شَجَرَة', has: false },
  { w: 'بَيْتٌ', has: false },
  { w: 'يَعْمَلُونَ', has: false },
  { w: 'أَنْعَمْتَ', has: false },
];

const NOON_MEEM_SURAHS: Record<string, string[]> = {
  'الناس': [
    'قُلْ أَعُوذُ بِرَبِّ النَّاسِ',
    'مَلِكِ النَّاسِ',
    'إِلَٰهِ النَّاسِ',
    'مِن شَرِّ الْوَسْوَاسِ الْخَنَّاسِ',
    'الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ',
    'مِنَ الْجِنَّةِ وَالنَّاسِ',
  ],
  'الكوثر': [
    'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ',
    'فَصَلِّ لِرَبِّكَ وَانْحَرْ',
    'إِنَّ شَانِئَكَ هُوَ الْأَبْتَرُ',
  ],
  'التكاثر': [
    'أَلْهَاكُمُ التَّكَاثُرُ',
    'حَتَّىٰ زُرْتُمُ الْمَقَابِرَ',
    'كَلَّا سَوْفَ تَعْلَمُونَ',
    'ثُمَّ كَلَّا سَوْفَ تَعْلَمُونَ',
    'كَلَّا لَوْ تَعْلَمُونَ عِلْمَ الْيَقِينِ',
    'لَتَرَوُنَّ الْجَحِيمَ',
    'ثُمَّ لَتَرَوُنَّهَا عَيْنَ الْيَقِينِ',
    'ثُمَّ لَتُسْأَلُنَّ يَوْمَئِذٍ عَنِ النَّعِيمِ',
  ],
  'النبأ': [
    'عَمَّ يَتَسَاءَلُونَ',
    'عَنِ النَّبَإِ الْعَظِيمِ',
    'الَّذِي هُمْ فِيهِ مُخْتَلِفُونَ',
    'كَلَّا سَيَعْلَمُونَ',
    'ثُمَّ كَلَّا سَيَعْلَمُونَ',
    'أَلَمْ نَجْعَلِ الْأَرْضَ مِهَادًا',
    'وَالْجِبَالَ أَوْتَادًا',
    'وَخَلَقْنَاكُمْ أَزْوَاجًا',
  ],
  'المسد': [
    'تَبَّتْ يَدَا أَبِي لَهَبٍ وَتَبَّ',
    'مَا أَغْنَىٰ عَنْهُ مَالُهُ وَمَا كَسَبَ',
    'سَيَصْلَىٰ نَارًا ذَاتَ لَهَبٍ',
    'وَامْرَأَتُهُ حَمَّالَةَ الْحَطَبِ',
    'فِي جِيدِهَا حَبْلٌ مِّن مَّسَدٍ',
  ],
  'الفاتحة': [
    'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
    'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ',
    'الرَّحْمَٰنِ الرَّحِيمِ',
    'مَالِكِ يَوْمِ الدِّينِ',
    'إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ',
    'اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ',
    'صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ',
  ],
  'الإخلاص': [
    'قُلْ هُوَ اللَّهُ أَحَدٌ',
    'اللَّهُ الصَّمَدُ',
    'لَمْ يَلِدْ وَلَمْ يُولَدْ',
    'وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ',
  ],
  'الفلق': [
    'قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ',
    'مِن شَرِّ مَا خَلَقَ',
    'وَمِن شَرِّ غَاسِقٍ إِذَا وَقَبَ',
    'وَمِن شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ',
    'وَمِن شَرِّ حَاسِدٍ إِذَا حَسَدَ',
  ],
  'قريش': [
    'لِإِيلَافِ قُرَيْشٍ',
    'إِيلَافِهِمْ رِحْلَةَ الشِّتَاءِ وَالصَّيْفِ',
    'فَلْيَعْبُدُوا رَبَّ هَٰذَا الْبَيْتِ',
    'الَّذِي أَطْعَمَهُم مِّن جُوعٍ وَآمَنَهُم مِّنْ خَوْفٍ',
  ],
  'الشرح': [
    'أَلَمْ نَشْرَحْ لَكَ صَدْرَكَ',
    'وَوَضَعْنَا عَنكَ وِزْرَكَ',
    'الَّذِي أَنقَضَ ظَهْرَكَ',
    'وَرَفَعْنَا لَكَ ذِكْرَكَ',
    'فَإِنَّ مَعَ الْعُسْرِ يُسْرًا',
    'إِنَّ مَعَ الْعُسْرِ يُسْرًا',
    'فَإِذَا فَرَغْتَ فَانصَبْ',
    'وَإِلَىٰ رَبِّكَ فَارْغَبْ',
  ],
};

interface NoonMeemSectionProps {
  activeTab: 'explain' | 'letters' | 'words' | 'apply';
  tabDirection: 1 | -1;
  playChime: (success?: boolean) => void;
  triggerConfetti: () => void;
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

export const NoonMeemSection: React.FC<NoonMeemSectionProps> = ({
  activeTab,
  tabDirection,
  playChime,
  triggerConfetti,
}) => {
  // Tab 1 state
  const [makhrajPlaying, setMakhrajPlaying] = useState(false);
  const [selectedShowcaseLetter, setSelectedShowcaseLetter] = useState<'نّ' | 'مّ'>('نّ');

  // Tab 2: Level 1 State
  const [level1Cards, setLevel1Cards] = useState<string[]>([]);
  const [level1CorrectSet, setLevel1CorrectSet] = useState<Set<number>>(new Set());
  const [level1Revealed, setLevel1Revealed] = useState(false);
  const [level1WrongIndex, setLevel1WrongIndex] = useState<number | null>(null);
  const [level1TimeLeft, setLevel1TimeLeft] = useState(0);
  const [level1Status, setLevel1Status] = useState<{ msg: string; kind: 'ok' | 'bad' | null }>({ msg: '', kind: null });
  const [level1Active, setLevel1Active] = useState(true);
  const [level1TimerStatus, setLevel1TimerStatus] = useState<'idle' | 'running' | 'paused' | 'finished'>('idle');

  // Tab 3: Level 2 Words State
  const [wordOrder, setWordOrder] = useState<number[]>([]);
  const [wordIdx, setWordIdx] = useState(0);
  const [wordsDoneSet, setWordsDoneSet] = useState<Set<number>>(new Set());
  const [wordLetterState, setWordLetterState] = useState<{ correct: Set<number>; revealed: boolean; wrongIdx: number | null }>({
    correct: new Set(),
    revealed: false,
    wrongIdx: null,
  });
  const [wordStatus, setWordStatus] = useState<{ msg: string; kind: 'ok' | 'bad' | null }>({ msg: '', kind: null });

  // Tab 4: Application State
  const [activeSubTab, setActiveSubTab] = useState<'surah' | 'free'>('surah');
  const [selectedSurah, setSelectedSurah] = useState('الناس');
  const [surahCorrectMap, setSurahCorrectMap] = useState<Record<string, boolean>>({});
  const [surahRevealed, setSurahRevealed] = useState(false);
  const [surahStatus, setSurahStatus] = useState<{ msg: string; kind: 'ok' | 'bad' | null }>({ msg: '', kind: null });
  const [surahWrongKey, setSurahWrongKey] = useState<string | null>(null);

  // Free Text State
  const [freeText, setFreeText] = useState('');
  const [appliedFreeText, setAppliedFreeText] = useState('');
  const [freeCorrectSet, setFreeCorrectSet] = useState<Set<number>>(new Set());
  const [freeRevealed, setFreeRevealed] = useState(false);
  const [freeStatus, setFreeStatus] = useState<{ msg: string; kind: 'ok' | 'bad' | null }>({ msg: '', kind: null });
  const [freeWrongIdx, setFreeWrongIdx] = useState<number | null>(null);

  // Initialize Level 1
  const startLevel1Round = () => {
    const pool = shuffle(NOON_MEEM_LETTER_POOL);
    setLevel1Cards(pool);
    setLevel1CorrectSet(new Set());
    setLevel1Revealed(false);
    setLevel1WrongIndex(null);
    setLevel1TimeLeft(0);
    setLevel1Active(true);
    setLevel1TimerStatus('idle');
    setLevel1Status({ msg: '', kind: null });
  };

  const handleStartOrPauseTimer = () => {
    if (level1TimerStatus === 'idle') {
      setLevel1TimerStatus('running');
      setLevel1Status({ msg: 'بدأ حساب الوقت ⏱ استخرج بطاقتي النون والميم المشددتين (نّ - مّ)', kind: 'ok' });
      setTimeout(() => {
        setLevel1Status(prev => prev.msg.includes('بدأ حساب الوقت') ? { msg: '', kind: null } : prev);
      }, 1800);
    } else if (level1TimerStatus === 'running') {
      setLevel1TimerStatus('paused');
      setLevel1Status({ msg: 'تم إيقاف العداد مؤقتاً ⏸', kind: null });
    } else if (level1TimerStatus === 'paused') {
      setLevel1TimerStatus('running');
      setLevel1Status({ msg: 'تم استئناف العداد ▶', kind: 'ok' });
      setTimeout(() => {
        setLevel1Status(prev => prev.msg.includes('تم استئناف العداد') ? { msg: '', kind: null } : prev);
      }, 1500);
    } else if (level1TimerStatus === 'finished') {
      startLevel1Round();
    }
  };

  const handleResetTimer = () => {
    setLevel1TimeLeft(0);
    setLevel1CorrectSet(new Set());
    setLevel1Revealed(false);
    setLevel1WrongIndex(null);
    setLevel1Active(true);
    setLevel1TimerStatus('idle');
    setLevel1Status({ msg: 'تمت إعادة ضبط العداد للصفر (٠٠:٠٠) ⏱', kind: 'ok' });
    setTimeout(() => {
      setLevel1Status(prev => prev.msg.includes('إعادة ضبط') ? { msg: '', kind: null } : prev);
    }, 1500);
  };

  useEffect(() => {
    startLevel1Round();
    const order = shuffle(NOON_MEEM_WORD_BANK.map((_, i) => i));
    setWordOrder(order);
    setWordIdx(0);
  }, []);

  // Upward Stopwatch Timer for Level 1
  useEffect(() => {
    if (activeTab !== 'letters' || !level1Active || level1TimerStatus !== 'running') return;
    const timer = setInterval(() => {
      setLevel1TimeLeft(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [activeTab, level1Active, level1TimerStatus]);

  // Load Word when wordIdx changes
  useEffect(() => {
    setWordLetterState({ correct: new Set(), revealed: false, wrongIdx: null });
    setWordStatus({ msg: '', kind: null });
  }, [wordIdx, wordOrder]);

  const currentWordItem = wordOrder.length > 0 ? NOON_MEEM_WORD_BANK[wordOrder[wordIdx]] : NOON_MEEM_WORD_BANK[0];
  const currentWordTokens = tokenizeNoonMeem(currentWordItem ? currentWordItem.w : '');
  const currentWordTargetCount = currentWordTokens.filter(t => t.type === 'letter' && t.isTarget).length;

  const isCardTarget = (ch: string) => ch === 'نّ' || ch === 'مّ';

  // Handler for Level 1 letter click
  const handleLevel1Click = (ch: string, index: number) => {
    if (!level1Active || level1CorrectSet.has(index)) return;

    if (level1TimerStatus === 'idle') {
      setLevel1TimerStatus('running');
    }

    if (isCardTarget(ch)) {
      playChime(true);
      const nextSet = new Set(level1CorrectSet);
      nextSet.add(index);
      setLevel1CorrectSet(nextSet);
      setLevel1Status({ msg: `أحسنت! «${ch}» حرف غنة مشدد ✓`, kind: 'ok' });

      // Total targets in the current pool
      const totalTargets = level1Cards.filter(c => isCardTarget(c)).length;
      if (nextSet.size === totalTargets && totalTargets > 0) {
        setLevel1Active(false);
        setLevel1TimerStatus('finished');
        setLevel1Status({
          msg: `مبارك! اكتمل التحدي في ${toArabicDigits(level1TimeLeft)} ثانية 🎉 استخرجت النون والميم المشددتين بنجاح`,
          kind: 'ok',
        });
        triggerConfetti();
      }
    } else {
      playChime(false);
      setLevel1WrongIndex(index);
      setLevel1Status({ msg: `حاول مرة أخرى، «${ch}» ليس نوناً أو ميماً مشددة`, kind: 'bad' });
      setTimeout(() => setLevel1WrongIndex(null), 450);
    }
  };

  // Handler for Word letter click
  const handleWordLetterClick = (unit: LetterUnit, idx: number) => {
    if (wordLetterState.correct.has(idx)) {
      const next = new Set(wordLetterState.correct);
      next.delete(idx);
      setWordLetterState(s => ({ ...s, correct: next }));
      setWordStatus({ msg: '', kind: null });
      return;
    }

    if (unit.isTarget) {
      playChime(true);
      const next = new Set(wordLetterState.correct);
      next.add(idx);
      setWordLetterState(s => ({ ...s, correct: next }));
      setWordStatus({ msg: 'أحسنت! هذا حرف غنة مشدد بمقدار حركتين ✓', kind: 'ok' });

      if (next.size === currentWordTargetCount) {
        setWordStatus({ msg: 'أحسنت! وجدت كل أحرف الغنة المشددة في هذه الكلمة ✓', kind: 'ok' });
        const absIdx = wordOrder[wordIdx];
        const nextDone = new Set(wordsDoneSet);
        nextDone.add(absIdx);
        setWordsDoneSet(nextDone);
        if (nextDone.size === NOON_MEEM_WORD_BANK.length) {
          triggerConfetti();
        }
      }
    } else {
      playChime(false);
      setWordLetterState(s => ({ ...s, wrongIdx: idx }));
      setWordStatus({ msg: 'حاول مرة أخرى، هذا الحرف ليس نوناً أو ميماً مشددة', kind: 'bad' });
      setTimeout(() => setWordLetterState(s => ({ ...s, wrongIdx: null })), 450);
    }
  };

  // Check "No target letters" button
  const handleWordNone = () => {
    if (currentWordItem.has) {
      playChime(false);
      setWordStatus({ msg: 'انتبه، هذه الكلمة تحتوي على حرف غنة مشدد، ابحث عنه', kind: 'bad' });
    } else {
      playChime(true);
      setWordStatus({ msg: 'صحيح! لا يوجد نون أو ميم مشددة في هذه الكلمة ✓', kind: 'ok' });
      const absIdx = wordOrder[wordIdx];
      const nextDone = new Set(wordsDoneSet);
      nextDone.add(absIdx);
      setWordsDoneSet(nextDone);
      if (nextDone.size === NOON_MEEM_WORD_BANK.length) {
        triggerConfetti();
      }
    }
  };

  // Surah Token calculation
  const surahAyat = NOON_MEEM_SURAHS[selectedSurah] || [];
  let surahTotalTargets = 0;
  surahAyat.forEach(ayah => {
    const tokens = tokenizeNoonMeem(ayah);
    tokens.forEach(t => {
      if (t.type === 'letter' && t.isTarget) surahTotalTargets++;
    });
  });

  const surahFoundCount = Object.keys(surahCorrectMap).filter(k => surahCorrectMap[k]).length;

  const handleSurahLetterClick = (unit: LetterUnit, key: string) => {
    if (surahCorrectMap[key]) {
      const next = { ...surahCorrectMap, [key]: false };
      setSurahCorrectMap(next);
      setSurahStatus({ msg: '', kind: null });
      return;
    }

    if (unit.isTarget) {
      playChime(true);
      const next = { ...surahCorrectMap, [key]: true };
      setSurahCorrectMap(next);
      setSurahStatus({ msg: 'أحسنت! هذا حرف غنة مشدد ✓', kind: 'ok' });

      const newFound = Object.keys(next).filter(k => next[k]).length;
      if (newFound === surahTotalTargets && surahTotalTargets > 0) {
        setSurahStatus({ msg: 'ممتاز! استخرجت كل النون والميم المشددتين في السورة المباركة ✓', kind: 'ok' });
        triggerConfetti();
      }
    } else {
      playChime(false);
      setSurahWrongKey(key);
      setSurahStatus({ msg: 'حاول مرة أخرى، هذا ليس حرف غنة مشدد', kind: 'bad' });
      setTimeout(() => setSurahWrongKey(null), 450);
    }
  };

  // Free Ayat Tokens
  const freeTokens = tokenizeNoonMeem(appliedFreeText);
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
      setFreeStatus({ msg: 'أحسنت! هذا حرف غنة مشدد ✓', kind: 'ok' });
      if (next.size === freeTotalTargets && freeTotalTargets > 0) {
        setFreeStatus({ msg: 'أحسنت! وجدت كل أحرف الغنة المشددة ✓', kind: 'ok' });
        triggerConfetti();
      }
    } else {
      playChime(false);
      setFreeWrongIdx(idx);
      setFreeStatus({ msg: 'حاول مرة أخرى، هذا ليس حرف غنة مشدد', kind: 'bad' });
      setTimeout(() => setFreeWrongIdx(null), 450);
    }
  };

  // Makhraj Animation runner for Ghunnah
  const playMakhraj = () => {
    setMakhrajPlaying(true);
    const ids = ['ghAnimStream', 'ghAnimRipples', 'ghAnimNoseFlow', 'ghAnimGlow'];
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
  };

  const handleLetterCardClick = (letter: string, name: string, e: React.MouseEvent<HTMLDivElement>) => {
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

    playChime(true);
  };

  return (
    <AnimatePresence mode="wait" custom={tabDirection}>
      {/* TAB 1: EXPLANATION */}
      {activeTab === 'explain' && (
        <motion.section
          key="explain-noon-meem"
          className="panel active"
          id="panel-explain-noon-meem"
          custom={tabDirection}
          variants={panelVariants}
          initial="enter"
          animate="center"
          exit="exit"
        >
          <div className="card explain-card" id="card-explain-overview">
            <div className="explain-grid" id="explain-main-grid">
              {/* Column 1: Letter Cards & Definition */}
              <motion.div variants={staggerItemVariants} className="explain-col-letters" id="explain-col-letters">
                <header className="explain-col-header" id="col-header-letters">
                  <h2 className="intro-subheading subheading-prominent theme-emerald">
                    <span className="subheading-accent-bar" aria-hidden="true" />
                    <span className="subheading-text">حكم النون والميم المشددتين</span>
                  </h2>
                </header>

                {/* 2 Showcase Cards for Noon & Meem Mushaddadatayn (Now at Top for Concrete to Abstract pedagogical flow) */}
                <div className="letters-trio duo-grid" id="letters-duo-showcase">
                  {/* Card 1: Noon Mushaddadah (Emerald Theme) */}
                  <div className="card-glow-wrap">
                    <div
                      className="letter-card c1"
                      id="letter-card-noon"
                      onClick={e => {
                        handleLetterCardClick('نّ', 'النون المشددة', e);
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
                        e.currentTarget.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px) scale(1.012)`;
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
                      <div className="glyph glyph-noon">نّ</div>
                      <div className="glyph-name">النون المشددة</div>
                    </div>
                  </div>

                  {/* Card 2: Meem Mushaddadah (Amber Theme) */}
                  <div className="card-glow-wrap">
                    <div
                      className="letter-card c2"
                      id="letter-card-meem"
                      onClick={e => {
                        handleLetterCardClick('مّ', 'الميم المشددة', e);
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
                        e.currentTarget.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px) scale(1.012)`;
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
                      <div className="glyph glyph-meem">مّ</div>
                      <div className="glyph-name">الميم المشددة</div>
                    </div>
                  </div>
                </div>

                {/* Definition Card with Clean Unified Craftsmanship */}
                <div className="letters-definition-card" id="letters-def-card">
                  {/* Primary Rule Callout */}
                  <div className="def-rule-container" id="def-part-intro">
                    <p className="def-rule-text">
                      إخراج غُنَّة بمقدار حركتين من الخيشوم عند النطق بـ نون أو ميم مشددتين
                    </p>
                  </div>

                  {/* Refined Minimalist Spec Strip */}
                  <div className="def-spec-strip" id="def-part-makhraj">
                    <div className="def-spec-item" id="triad-item-makhraj">
                      <div className="def-spec-badge">المخرج</div>
                      <div className="def-spec-value">الأنف</div>
                    </div>

                    <div className="def-spec-divider" aria-hidden="true" />

                    <div className="def-spec-item" id="triad-item-miqdar">
                      <div className="def-spec-badge">المقدار</div>
                      <div className="def-spec-value">حركتان</div>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Column 2: Interactive Anatomical Makhraj Visualizer for Ghunnah (الخيشوم) */}
              <motion.div variants={staggerItemVariants} className="explain-col-makhraj" id="explain-col-makhraj">
                <header className="explain-col-header" id="col-header-makhraj">
                  <h2 className="intro-subheading subheading-prominent theme-amber">
                    <span className="subheading-accent-bar" aria-hidden="true" />
                    <span className="subheading-text">التدرب على زمن الغُنَّة الصحيح</span>
                  </h2>
                </header>

                {/* Medical Grade Interactive Anatomical Visualizer */}
                <InteractiveGhunnahMakhraj
                  playChime={playChime}
                />
              </motion.div>
            </div>
          </div>

          {/* Bottom Capsule: Tuhfat Al-Atfal Matn Quote & Common Mistakes */}
          <motion.div variants={staggerItemVariants} className="lathawiya-bottom-vowels-bar" id="noon-meem-bottom-bar">
            {/* Header Tag */}
            <div className="vowels-bar-header" id="vowels-bar-header">
              <span className="vowels-bar-title-tag" id="vowels-bar-title-tag">
                الشاهد التجويدي والأخطاء الشائعة
              </span>
            </div>

            {/* Matn Quote Box */}
            <div className="matn-quote-banner" id="matn-quote-banner">
              <span className="matn-quote-text">
                «وَغُنَّ مِيمًا ثُمَّ نُونًا شُدِّدَا ... وَسَمِّ كُلاًّ حَرْفَ غُنَّةٍ بَدَا»
              </span>
            </div>

            {/* 2-Column Mistakes Grid for Noon and Meem */}
            <div className="vowels-compact-grid duo" id="noon-meem-mistakes-grid">
              {/* Col 1: Noon Mushaddadah */}
              <div className="vowels-letter-col theme-emerald" id="col-letter-noon-mushaddad">
                <div className="mistake-letter-tag" id="tag-noon">
                  نّ
                </div>

                <div className="mistake-two-cols-box" id="two-cols-box-noon">
                  <div className="mistake-side-col correct-side" id="col-correct-noon">
                    <div className="mistake-side-header correct">مشددة</div>
                    <div className="mistake-words-stack">
                      <span className="mistake-word-item correct" title="كلمة قرآنية بنون مشددة: إِنَّ">
                        إِنَّ
                      </span>
                      <span className="mistake-word-item correct" title="كلمة قرآنية بنون مشددة: النَّاسِ">
                        النَّاسِ
                      </span>
                      <span className="mistake-word-item correct" title="كلمة قرآنية بنون مشددة: جَنَّاتٍ">
                        جَنَّاتٍ
                      </span>
                    </div>
                  </div>

                  <div className="mistake-side-divider" aria-hidden="true">≠</div>

                  <div className="mistake-side-col wrong-side" id="col-wrong-noon">
                    <div className="mistake-side-header wrong">غير مشددة</div>
                    <div className="mistake-words-stack">
                      <span className="mistake-word-item wrong" title="كلمة سهلة ومعروفة (الفاتحة): أَنْعَمْتَ">
                        أَنْعَمْتَ
                      </span>
                      <span className="mistake-word-item wrong" title="كلمة سهلة وقصيرة (سورة النبأ): عِنَبًا">
                        عِنَبًا
                      </span>
                      <span className="mistake-word-item wrong" title="كلمة سهلة وقصيرة (سورة طه): صَنَعَ">
                        صَنَعَ
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="vowels-col-divider" aria-hidden="true" />

              {/* Col 2: Meem Mushaddadah */}
              <div className="vowels-letter-col theme-amber" id="col-letter-meem-mushaddad">
                <div className="mistake-letter-tag" id="tag-meem">
                  مّ
                </div>

                <div className="mistake-two-cols-box" id="two-cols-box-meem">
                  <div className="mistake-side-col correct-side" id="col-correct-meem">
                    <div className="mistake-side-header correct">مشددة</div>
                    <div className="mistake-words-stack">
                      <span className="mistake-word-item correct" title="كلمة قرآنية بميم مشددة: ثُمَّ">
                        ثُمَّ
                      </span>
                      <span className="mistake-word-item correct" title="كلمة قرآنية بميم مشددة: عَمَّ">
                        عَمَّ
                      </span>
                      <span className="mistake-word-item correct" title="كلمة قرآنية بميم مشددة: أُمَّةٍ">
                        أُمَّةٍ
                      </span>
                    </div>
                  </div>

                  <div className="mistake-side-divider" aria-hidden="true">≠</div>

                  <div className="mistake-side-col wrong-side" id="col-wrong-meem">
                    <div className="mistake-side-header wrong">غير مشددة</div>
                    <div className="mistake-words-stack">
                      <span className="mistake-word-item wrong" title="كلمة سهلة وقصيرة (سورة القمر): الْقَمَرُ">
                        الْقَمَرُ
                      </span>
                      <span className="mistake-word-item wrong" title="كلمة سهلة وقصيرة: سَمِيعٌ">
                        سَمِيعٌ
                      </span>
                      <span className="mistake-word-item wrong" title="كلمة سهلة وقصيرة في وسطها ميم: عَمَلًا">
                        عَمَلًا
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
          key="letters-noon-meem"
          className="panel active"
          id="panel-letters-noon-meem"
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
                <span className="ih-text">ابحث عن النون والميم المشددتين</span>
                <span className="ih-diamond"></span>
                <span className="ih-line ih-line-r"></span>
              </span>
            </motion.h2>
            <motion.div variants={staggerItemVariants} className="instruction">
              اضغط على بطاقات النون والميم المشددتين (نّ - مّ) فقط من بين الحروف الآتية، قبل ما ينتهي الوقت.
            </motion.div>

            {/* Apple iOS Style Stopwatch */}
            <motion.div variants={staggerItemVariants} className="ios-stopwatch-row" id="letters-stats-row">
              <div className={`ios-stopwatch-dock ${level1TimerStatus}`} id="letters-pro-timer-dock">
                {/* iOS Primary Start / Stop Button */}
                <button
                  type="button"
                  className={`ios-action-btn ios-toggle-btn ${level1TimerStatus}`}
                  onClick={handleStartOrPauseTimer}
                  title={
                    level1TimerStatus === 'idle'
                      ? 'بدء العداد'
                      : level1TimerStatus === 'running'
                      ? 'إيقاف مؤقت'
                      : 'استئناف'
                  }
                  aria-label={level1TimerStatus === 'running' ? 'إيقاف' : 'بدء'}
                >
                  <span className="ios-btn-label">
                    {level1TimerStatus === 'running' ? 'إيقاف' : level1TimerStatus === 'paused' ? 'استئناف' : 'بدء'}
                  </span>
                </button>

                {/* iOS Monospace Digital Time Counter */}
                <div
                  className="ios-time-display"
                  id="letters-timer-pill"
                  onClick={handleStartOrPauseTimer}
                  title="انقر للبدء أو الإيقاف"
                >
                  <div className="ios-digits-wrapper" id="letters-timer-value">
                    <span className="ios-digits">
                      {toArabicDigits(String(Math.floor(level1TimeLeft / 60)).padStart(2, '0'))}
                      <span className={`ios-colon ${level1TimerStatus === 'running' ? 'blink' : ''}`}>:</span>
                      {toArabicDigits(String(level1TimeLeft % 60).padStart(2, '0'))}
                    </span>
                  </div>
                </div>

                {/* iOS Secondary Reset Button */}
                <button
                  type="button"
                  className="ios-action-btn ios-reset-btn"
                  onClick={handleResetTimer}
                  title="إعادة تعيين (٠٠:٠٠)"
                  aria-label="إعادة تعيين"
                  disabled={level1TimeLeft === 0 && level1TimerStatus === 'idle'}
                >
                  <span className="ios-btn-label">إلغاء</span>
                </button>
              </div>
            </motion.div>

            {/* Letter Cards Grid */}
            <motion.div variants={staggerItemVariants} className="tile-grid" id="letters-tile-grid">
              {level1Cards.map((ch, idx) => {
                const isCorrect = level1CorrectSet.has(idx);
                const isRevealed = level1Revealed && isCardTarget(ch) && !isCorrect;
                const isWrong = level1WrongIndex === idx;

                return (
                  <div
                    key={idx}
                    id={`letter-tile-${idx}`}
                    className={`tile-btn ${isCorrect ? 'correct' : ''} ${isRevealed ? 'revealed' : ''} ${isWrong ? 'wrong' : ''}`}
                    onClick={() => handleLevel1Click(ch, idx)}
                  >
                    {ch}
                  </div>
                );
              })}
            </motion.div>

            <motion.div variants={staggerItemVariants} className={`status-line ${level1Status.kind || ''}`} id="letters-status">
              {level1Status.msg || '\u00A0'}
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

      {/* TAB 3: LEVEL 2 - WORDS */}
      {activeTab === 'words' && (
        <motion.section
          key="words-noon-meem"
          className="panel active"
          id="panel-words-noon-meem"
          custom={tabDirection}
          variants={panelVariants}
          initial="enter"
          animate="center"
          exit="exit"
        >
          <div className="card" id="card-level2-words">
            <motion.h2 variants={staggerItemVariants} className="intro-heading">
              <span className="ih-row">
                <span className="ih-line"></span>
                <span className="ih-diamond"></span>
                <span className="ih-badge badge-words" aria-hidden="true">
                  <Layers className="ih-badge-icon" />
                </span>
                <span className="ih-text">ابحث عن النون والميم المشددتين داخل الكلمة</span>
                <span className="ih-diamond"></span>
                <span className="ih-line ih-line-r"></span>
              </span>
            </motion.h2>
            <motion.div variants={staggerItemVariants} className="instruction">
              اضغط على النون أو الميم المشددة (نّ - مّ) داخل الكلمة إن وُجدت. وإن لم يوجد أي حرف غنة مشدد، اضغط زر «لا يوجد».
            </motion.div>

            <motion.div variants={staggerItemVariants} className="counter-pill" id="words-counter">
              الكلمة {toArabicDigits(wordIdx + 1)} من {toArabicDigits(NOON_MEEM_WORD_BANK.length)}
            </motion.div>

            <motion.div variants={staggerItemVariants} className="quran-frame" id="word-display-frame">
              <div className="word-display" id="word-display">
                {currentWordTokens.map((token, idx) => {
                  if (token.type === 'space') {
                    return <React.Fragment key={idx}> </React.Fragment>;
                  }
                  const isCorrect = wordLetterState.correct.has(idx);
                  const isRevealed = wordLetterState.revealed && token.isTarget && !isCorrect;
                  const isWrong = wordLetterState.wrongIdx === idx;

                  return (
                    <span
                      key={idx}
                      id={`word-letter-${idx}`}
                      className={`letter-unit ${isCorrect ? 'correct' : ''} ${isRevealed ? 'revealed' : ''} ${isWrong ? 'wrong' : ''}`}
                      onClick={() => handleWordLetterClick(token, idx)}
                    >
                      {token.base + token.extra}
                    </span>
                  );
                })}
              </div>
            </motion.div>

            <motion.div variants={staggerItemVariants} className={`status-line ${wordStatus.kind || ''}`} id="words-status">
              {wordStatus.msg || '\u00A0'}
            </motion.div>

            <motion.div variants={staggerItemVariants} className="controls-row" id="words-controls">
              <button
                type="button"
                className="btn"
                id="words-none"
                onClick={handleWordNone}
              >
                لا يوجد حرف غنة مشدد
              </button>
              <button
                type="button"
                className="btn"
                id="words-reveal"
                onClick={() => setWordLetterState(s => ({ ...s, revealed: true }))}
              >
                إظهار الحل
              </button>
              <button
                type="button"
                className="btn primary"
                id="words-next"
                onClick={() => {
                  const nextI = (wordIdx + 1) % NOON_MEEM_WORD_BANK.length;
                  if (nextI === 0) {
                    setWordOrder(shuffle(NOON_MEEM_WORD_BANK.map((_, i) => i)));
                  }
                  setWordIdx(nextI);
                }}
              >
                الكلمة التالية
              </button>
            </motion.div>
          </div>
        </motion.section>
      )}

      {/* TAB 4: APPLICATION */}
      {activeTab === 'apply' && (
        <motion.section
          key="apply-noon-meem"
          className="panel active"
          id="panel-apply-noon-meem"
          custom={tabDirection}
          variants={panelVariants}
          initial="enter"
          animate="center"
          exit="exit"
        >
          <div className="card" id="card-level3-apply">
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

            <motion.div variants={staggerItemVariants} className="sub-tabs" id="apply-sub-tabs">
              <button
                type="button"
                id="sub-tab-btn-surah"
                className={`sub-tab-btn ${activeSubTab === 'surah' ? 'active' : ''}`}
                onClick={() => setActiveSubTab('surah')}
              >
                سورة جاهزة
              </button>
              <button
                type="button"
                id="sub-tab-btn-free"
                className={`sub-tab-btn ${activeSubTab === 'free' ? 'active' : ''}`}
                onClick={() => setActiveSubTab('free')}
              >
                آية من اختيارك
              </button>
            </motion.div>

            {/* Subpanel: Surah */}
            <div className={`sub-panel ${activeSubTab === 'surah' ? 'active' : ''}`} id="sub-surah">
              <motion.div variants={staggerItemVariants}>
                <label className="field-label" htmlFor="surah-select">اختر سورة مباركة:</label>
                <select
                  id="surah-select"
                  value={selectedSurah}
                  onChange={e => {
                    setSelectedSurah(e.target.value);
                    setSurahCorrectMap({});
                    setSurahRevealed(false);
                    setSurahStatus({ msg: '', kind: null });
                  }}
                >
                  {Object.keys(NOON_MEEM_SURAHS).map(name => (
                    <option key={name} value={name}>
                      سورة {name}
                    </option>
                  ))}
                </select>
              </motion.div>

              <motion.div variants={staggerItemVariants} className="instruction" style={{ marginTop: '14px' }}>
                اضغط على كل نون أو ميم مشددة (نّ - مّ) تجدها في الآيات.
              </motion.div>

              <motion.div variants={staggerItemVariants} className="counter-pill" id="surah-counter">
                وجدت {toArabicDigits(surahFoundCount)} من {toArabicDigits(surahTotalTargets)}
              </motion.div>

              <motion.div variants={staggerItemVariants} className="quran-frame" id="surah-frame">
                {surahAyat.map((ayahText, aIdx) => {
                  const tokens = tokenizeNoonMeem(ayahText);
                  return (
                    <div key={aIdx} className="ayah" id={`surah-ayah-${aIdx}`}>
                      {tokens.map((token, tIdx) => {
                        if (token.type === 'space') {
                          return <React.Fragment key={tIdx}> </React.Fragment>;
                        }
                        const letterKey = `${aIdx}_${tIdx}`;
                        const isCorrect = !!surahCorrectMap[letterKey];
                        const isRevealed = surahRevealed && token.isTarget && !isCorrect;
                        const isWrong = surahWrongKey === letterKey;

                        return (
                          <span
                            key={tIdx}
                            id={`surah-letter-${letterKey}`}
                            className={`letter-unit ${isCorrect ? 'correct' : ''} ${isRevealed ? 'revealed' : ''} ${isWrong ? 'wrong' : ''}`}
                            onClick={() => handleSurahLetterClick(token, letterKey)}
                          >
                            {token.base + token.extra}
                          </span>
                        );
                      })}
                      <span className="ayah-num">{toArabicDigits(aIdx + 1)}</span>
                    </div>
                  );
                })}
              </motion.div>

              <motion.div variants={staggerItemVariants} className={`status-line ${surahStatus.kind || ''}`} id="surah-status">
                {surahStatus.msg || '\u00A0'}
              </motion.div>

              <motion.div variants={staggerItemVariants} className="controls-row" id="surah-controls">
                <button
                  type="button"
                  className="btn"
                  id="surah-reveal"
                  onClick={() => setSurahRevealed(true)}
                >
                  إظهار الحل
                </button>
                <button
                  type="button"
                  className="btn primary"
                  id="surah-reset"
                  onClick={() => {
                    setSurahCorrectMap({});
                    setSurahRevealed(false);
                    setSurahStatus({ msg: '', kind: null });
                  }}
                >
                  إعادة المحاولة
                </button>
              </motion.div>
            </div>

            {/* Subpanel: Free Text */}
            <div className={`sub-panel ${activeSubTab === 'free' ? 'active' : ''}`} id="sub-free">
              <motion.div variants={staggerItemVariants}>
                <label className="field-label" htmlFor="free-input">الصق أو اكتب أي آية من القرآن الكريم:</label>
                <textarea
                  id="free-input"
                  value={freeText}
                  onChange={e => setFreeText(e.target.value)}
                  placeholder="مثال: إِنَّ اللَّهَ مَعَ الصَّابِرِينَ ... أَوْ: ثُمَّ لَتُسْأَلُنَّ يَوْمَئِذٍ عَنِ النَّعِيمِ"
                ></textarea>
              </motion.div>

              <motion.div variants={staggerItemVariants} className="controls-row" style={{ marginTop: '10px' }}>
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

              {appliedFreeText && (
                <>
                  <motion.div variants={staggerItemVariants} className="instruction" style={{ marginTop: '14px' }}>
                    اضغط على كل نون أو ميم مشددة (نّ - مّ) تجدها في النص.
                  </motion.div>

                  <motion.div variants={staggerItemVariants} className="counter-pill" id="free-counter">
                    وجدت {toArabicDigits(freeCorrectSet.size)} من {toArabicDigits(freeTotalTargets)}
                  </motion.div>

                  <motion.div variants={staggerItemVariants} className="quran-frame" id="free-frame">
                    <div className="ayah">
                      {freeTokens.map((token, idx) => {
                        if (token.type === 'space') {
                          return <React.Fragment key={idx}> </React.Fragment>;
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
                  </motion.div>

                  <motion.div variants={staggerItemVariants} className={`status-line ${freeStatus.kind || ''}`} id="free-status">
                    {freeStatus.msg || '\u00A0'}
                  </motion.div>

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
  );
};
