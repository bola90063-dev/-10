import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ArrowLeft, ArrowRight, Play, Timer, Sparkles, ChevronDown, Award } from 'lucide-react';

interface TajweedSegment {
  text: string;
  type: 'ghunnah' | 'silent' | 'mad' | 'qalqalah' | 'normal';
}

// Arabic characters that do NOT connect to the following (left) character in cursive script
const NON_CONNECTING_FORWARD = new Set(['ا', 'أ', 'إ', 'آ', 'ٱ', 'ء', 'د', 'ذ', 'ر', 'ز', 'و', 'ؤ', 'ة', ' ']);
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function toArabicDigits(n: number | string): string {
  return String(n).split('').map(c => (/[0-9]/.test(c) ? ARABIC_DIGITS[+c] : c)).join('');
}

function getBaseChars(str: string): string[] {
  // Strip combining diacritics / tashkeel
  return Array.from(str).filter(ch => !/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/.test(ch));
}

function formatConnectedTajweedSegments(segments: TajweedSegment[]): TajweedSegment[] {
  if (!segments || segments.length <= 1) return segments || [];
  return segments.map((seg, i) => {
    let text = seg.text;
    const baseChars = getBaseChars(text);
    if (baseChars.length === 0) return seg;

    const firstBase = baseChars[0];
    const lastBase = baseChars[baseChars.length - 1];

    // Connect with previous segment if previous letter connects forward
    if (i > 0) {
      const prevBaseChars = getBaseChars(segments[i - 1].text);
      const prevLastBase = prevBaseChars[prevBaseChars.length - 1];
      if (prevLastBase && !NON_CONNECTING_FORWARD.has(prevLastBase) && firstBase !== ' ') {
        text = '\u200D' + text;
      }
    }

    // Connect with next segment if current last letter connects forward
    if (i < segments.length - 1) {
      const nextBaseChars = getBaseChars(segments[i + 1].text);
      const nextFirstBase = nextBaseChars[0];
      if (lastBase && !NON_CONNECTING_FORWARD.has(lastBase) && nextFirstBase !== ' ') {
        text = text + '\u200D';
      }
    }

    return { ...seg, text };
  });
}

export type GhunnahDifficultyLevel = 'سهل' | 'متوسط' | 'متقدم' | 'خبير';

interface QuranGhunnahWord {
  id: string;
  word: string;
  letter: 'نّ' | 'مّ';
  level: GhunnahDifficultyLevel;
  segments: TajweedSegment[];
}

const GHUNNAH_WORDS: QuranGhunnahWord[] = [
  // ==========================================
  // 1. المستوى السهل: كلمات قصيرة أساسية (16 كلمة متوازنة بين نّ و مّ)
  // ==========================================
  {
    id: 's1',
    word: 'عَمَّ',
    letter: 'مّ',
    level: 'سهل',
    segments: [
      { text: 'عَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
    ],
  },
  {
    id: 's2',
    word: 'إِنَّ',
    letter: 'نّ',
    level: 'سهل',
    segments: [
      { text: 'إِ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
    ],
  },
  {
    id: 's3',
    word: 'ثُمَّ',
    letter: 'مّ',
    level: 'سهل',
    segments: [
      { text: 'ثُ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
    ],
  },
  {
    id: 's4',
    word: 'أَنَّ',
    letter: 'نّ',
    level: 'سهل',
    segments: [
      { text: 'أَ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
    ],
  },
  {
    id: 's5',
    word: 'لَمَّا',
    letter: 'مّ',
    level: 'سهل',
    segments: [
      { text: 'لَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'ا', type: 'normal' },
    ],
  },
  {
    id: 's6',
    word: 'إِنَّا',
    letter: 'نّ',
    level: 'سهل',
    segments: [
      { text: 'إِ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'ا', type: 'normal' },
    ],
  },
  {
    id: 's7',
    word: 'عَمَّا',
    letter: 'مّ',
    level: 'سهل',
    segments: [
      { text: 'عَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'ا', type: 'normal' },
    ],
  },
  {
    id: 's8',
    word: 'عَنَّا',
    letter: 'نّ',
    level: 'سهل',
    segments: [
      { text: 'عَ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'ا', type: 'normal' },
    ],
  },
  {
    id: 's9',
    word: 'إِمَّا',
    letter: 'مّ',
    level: 'سهل',
    segments: [
      { text: 'إِ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'ا', type: 'normal' },
    ],
  },
  {
    id: 's10',
    word: 'مِنَّا',
    letter: 'نّ',
    level: 'سهل',
    segments: [
      { text: 'مِ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'ا', type: 'normal' },
    ],
  },
  {
    id: 's11',
    word: 'هَمَّ',
    letter: 'مّ',
    level: 'سهل',
    segments: [
      { text: 'هَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
    ],
  },
  {
    id: 's12',
    word: 'ظَنَّ',
    letter: 'نّ',
    level: 'سهل',
    segments: [
      { text: 'ظَ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
    ],
  },
  {
    id: 's13',
    word: 'أُمٍّ',
    letter: 'مّ',
    level: 'سهل',
    segments: [
      { text: 'أُ', type: 'normal' },
      { text: 'مٍّ', type: 'ghunnah' },
    ],
  },
  {
    id: 's14',
    word: 'جَنٌّ',
    letter: 'نّ',
    level: 'سهل',
    segments: [
      { text: 'جَ', type: 'normal' },
      { text: 'نٌّ', type: 'ghunnah' },
    ],
  },
  {
    id: 's15',
    word: 'طَمَّتْ',
    letter: 'مّ',
    level: 'سهل',
    segments: [
      { text: 'طَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'تْ', type: 'normal' },
    ],
  },
  {
    id: 's16',
    word: 'مَنَّ',
    letter: 'نّ',
    level: 'سهل',
    segments: [
      { text: 'مَ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
    ],
  },

  // ==========================================
  // 2. المستوى المتوسط: كلمات شائعة من 3 إلى 4 أحرف بحركات متتالية (18 كلمة)
  // ==========================================
  {
    id: 'm1',
    word: 'مِمَّا',
    letter: 'مّ',
    level: 'متوسط',
    segments: [
      { text: 'مِ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'ا', type: 'normal' },
    ],
  },
  {
    id: 'm2',
    word: 'جَنَّةٍ',
    letter: 'نّ',
    level: 'متوسط',
    segments: [
      { text: 'جَ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'ةٍ', type: 'normal' },
    ],
  },
  {
    id: 'm3',
    word: 'أُمَّةً',
    letter: 'مّ',
    level: 'متوسط',
    segments: [
      { text: 'أُ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'ةً', type: 'normal' },
    ],
  },
  {
    id: 'm4',
    word: 'النَّاسِ',
    letter: 'نّ',
    level: 'متوسط',
    segments: [
      { text: 'ا', type: 'silent' },
      { text: 'ل', type: 'silent' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'اسِ', type: 'normal' },
    ],
  },
  {
    id: 'm5',
    word: 'تَمَّتْ',
    letter: 'مّ',
    level: 'متوسط',
    segments: [
      { text: 'تَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'تْ', type: 'normal' },
    ],
  },
  {
    id: 'm6',
    word: 'الْجِنَّةِ',
    letter: 'نّ',
    level: 'متوسط',
    segments: [
      { text: 'ا', type: 'silent' },
      { text: 'لْجِ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'ةِ', type: 'normal' },
    ],
  },
  {
    id: 'm7',
    word: 'هَمَّتْ',
    letter: 'مّ',
    level: 'متوسط',
    segments: [
      { text: 'هَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'تْ', type: 'normal' },
    ],
  },
  {
    id: 'm8',
    word: 'إِنَّهَا',
    letter: 'نّ',
    level: 'متوسط',
    segments: [
      { text: 'إِ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'هَا', type: 'normal' },
    ],
  },
  {
    id: 'm9',
    word: 'فَأَمَّا',
    letter: 'مّ',
    level: 'متوسط',
    segments: [
      { text: 'فَأَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'ا', type: 'normal' },
    ],
  },
  {
    id: 'm10',
    word: 'النَّعِيمِ',
    letter: 'نّ',
    level: 'متوسط',
    segments: [
      { text: 'ا', type: 'silent' },
      { text: 'ل', type: 'silent' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'عِيمِ', type: 'normal' },
    ],
  },
  {
    id: 'm11',
    word: 'أُمِّي',
    letter: 'مّ',
    level: 'متوسط',
    segments: [
      { text: 'أُ', type: 'normal' },
      { text: 'مِّ', type: 'ghunnah' },
      { text: 'ي', type: 'normal' },
    ],
  },
  {
    id: 'm12',
    word: 'الْخَنَّاسِ',
    letter: 'نّ',
    level: 'متوسط',
    segments: [
      { text: 'ا', type: 'silent' },
      { text: 'لْخَ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'اسِ', type: 'normal' },
    ],
  },
  {
    id: 'm13',
    word: 'دَمَّرَ',
    letter: 'مّ',
    level: 'متوسط',
    segments: [
      { text: 'دَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'رَ', type: 'normal' },
    ],
  },
  {
    id: 'm14',
    word: 'النَّبَإِ',
    letter: 'نّ',
    level: 'متوسط',
    segments: [
      { text: 'ا', type: 'silent' },
      { text: 'ل', type: 'silent' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'بَإِ', type: 'normal' },
    ],
  },
  {
    id: 'm15',
    word: 'سُمَّ',
    letter: 'مّ',
    level: 'متوسط',
    segments: [
      { text: 'سُ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
    ],
  },
  {
    id: 'm16',
    word: 'أَنَّهُمْ',
    letter: 'نّ',
    level: 'متوسط',
    segments: [
      { text: 'أَ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'هُمْ', type: 'normal' },
    ],
  },
  {
    id: 'm17',
    word: 'تَيَمَّمُوا',
    letter: 'مّ',
    level: 'متوسط',
    segments: [
      { text: 'تَيَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'مُوا', type: 'normal' },
    ],
  },
  {
    id: 'm18',
    word: 'يَمُنُّونَ',
    letter: 'نّ',
    level: 'متوسط',
    segments: [
      { text: 'يَ', type: 'normal' },
      { text: 'مُ', type: 'normal' },
      { text: 'نُّ', type: 'ghunnah' },
      { text: 'ونَ', type: 'normal' },
    ],
  },

  // ==========================================
  // 3. المستوى المتقدم: كلمات أطول وتراكيب مشددة مركبة (18 كلمة)
  // ==========================================
  {
    id: 'adv1',
    word: 'فَأُمُّهُ',
    letter: 'مّ',
    level: 'متقدم',
    segments: [
      { text: 'فَأُ', type: 'normal' },
      { text: 'مُّ', type: 'ghunnah' },
      { text: 'هُ', type: 'normal' },
    ],
  },
  {
    id: 'adv2',
    word: 'يَظُنُّونَ',
    letter: 'نّ',
    level: 'متقدم',
    segments: [
      { text: 'يَظُ', type: 'normal' },
      { text: 'نُّ', type: 'ghunnah' },
      { text: 'ونَ', type: 'normal' },
    ],
  },
  {
    id: 'adv3',
    word: 'حَمَّالَةَ',
    letter: 'مّ',
    level: 'متقدم',
    segments: [
      { text: 'حَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'الَةَ', type: 'normal' },
    ],
  },
  {
    id: 'adv4',
    word: 'كَأَنَّهُنَّ',
    letter: 'نّ',
    level: 'متقدم',
    segments: [
      { text: 'كَأَ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'هُ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
    ],
  },
  {
    id: 'adv5',
    word: 'مُحَمَّدٌ',
    letter: 'مّ',
    level: 'متقدم',
    segments: [
      { text: 'مُحَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'دٌ', type: 'normal' },
    ],
  },
  {
    id: 'adv6',
    word: 'لَيُنْبَذَنَّ',
    letter: 'نّ',
    level: 'متقدم',
    segments: [
      { text: 'لَيُنْبَذَ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
    ],
  },
  {
    id: 'adv7',
    word: 'فَتَيَمَّمُوا',
    letter: 'مّ',
    level: 'متقدم',
    segments: [
      { text: 'فَتَيَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'مُوا', type: 'normal' },
    ],
  },
  {
    id: 'adv8',
    word: 'تَظُنُّونَ',
    letter: 'نّ',
    level: 'متقدم',
    segments: [
      { text: 'تَظُ', type: 'normal' },
      { text: 'نُّ', type: 'ghunnah' },
      { text: 'ونَ', type: 'normal' },
    ],
  },
  {
    id: 'adv9',
    word: 'يُعَمَّرُ',
    letter: 'مّ',
    level: 'متقدم',
    segments: [
      { text: 'يُعَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'رُ', type: 'normal' },
    ],
  },
  {
    id: 'adv10',
    word: 'لَتَرَوُنَّهَا',
    letter: 'نّ',
    level: 'متقدم',
    segments: [
      { text: 'لَتَرَوُ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'هَا', type: 'normal' },
    ],
  },
  {
    id: 'adv11',
    word: 'مُزَّمِّلُ',
    letter: 'مّ',
    level: 'متقدم',
    segments: [
      { text: 'مُزَّ', type: 'normal' },
      { text: 'مِّ', type: 'ghunnah' },
      { text: 'لُ', type: 'normal' },
    ],
  },
  {
    id: 'adv12',
    word: 'لَتُسْأَلُنَّ',
    letter: 'نّ',
    level: 'متقدم',
    segments: [
      { text: 'لَتُسْأَلُ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
    ],
  },
  {
    id: 'adv13',
    word: 'يَتَغَمَّدُ',
    letter: 'مّ',
    level: 'متقدم',
    segments: [
      { text: 'يَتَغَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'دُ', type: 'normal' },
    ],
  },
  {
    id: 'adv14',
    word: 'النَّفَّاثَاتِ',
    letter: 'نّ',
    level: 'متقدم',
    segments: [
      { text: 'ا', type: 'silent' },
      { text: 'ل', type: 'silent' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'فَّاثَاتِ', type: 'normal' },
    ],
  },
  {
    id: 'adv15',
    word: 'يُعَمَّرُونَ',
    letter: 'مّ',
    level: 'متقدم',
    segments: [
      { text: 'يُعَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'رُونَ', type: 'normal' },
    ],
  },
  {
    id: 'adv16',
    word: 'جَهَنَّمَ',
    letter: 'نّ',
    level: 'متقدم',
    segments: [
      { text: 'جَ', type: 'normal' },
      { text: 'هَ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'مَ', type: 'normal' },
    ],
  },
  {
    id: 'adv17',
    word: 'فَلَمَّا',
    letter: 'مّ',
    level: 'متقدم',
    segments: [
      { text: 'فَلَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'ا', type: 'normal' },
    ],
  },
  {
    id: 'adv18',
    word: 'فَإِمَّا',
    letter: 'مّ',
    level: 'متقدم',
    segments: [
      { text: 'فَإِ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'ا', type: 'normal' },
    ],
  },

  // ==========================================
  // 4. مستوى الخبير: تراكيب قرآنية وجمل وآيات متصلة (12 تركيباً)
  // ==========================================
  {
    id: 'exp1',
    word: 'فَلَمَّا جَنَّ',
    letter: 'نّ',
    level: 'خبير',
    segments: [
      { text: 'فَلَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'ا ', type: 'normal' },
      { text: 'جَ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
    ],
  },
  {
    id: 'exp2',
    word: 'عَمَّ يَتَسَاءَلُونَ',
    letter: 'مّ',
    level: 'خبير',
    segments: [
      { text: 'عَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: ' يَتَسَاءَلُونَ', type: 'normal' },
    ],
  },
  {
    id: 'exp3',
    word: 'إِنَّ رَبَّهُم',
    letter: 'نّ',
    level: 'خبير',
    segments: [
      { text: 'إِ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: ' رَبَّهُم', type: 'normal' },
    ],
  },
  {
    id: 'exp4',
    word: 'ثُمَّ كَلَّا سَوْفَ',
    letter: 'مّ',
    level: 'خبير',
    segments: [
      { text: 'ثُ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: ' كَلَّا سَوْفَ', type: 'normal' },
    ],
  },
  {
    id: 'exp5',
    word: 'إِنَّا أَعْطَيْنَاكَ',
    letter: 'نّ',
    level: 'خبير',
    segments: [
      { text: 'إِ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'ا أَعْطَيْنَاكَ', type: 'normal' },
    ],
  },
  {
    id: 'exp6',
    word: 'مِمَّا عَمِلَتْ',
    letter: 'مّ',
    level: 'خبير',
    segments: [
      { text: 'مِ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'ا عَمِلَتْ', type: 'normal' },
    ],
  },
  {
    id: 'exp7',
    word: 'إِنَّ شَانِئَكَ',
    letter: 'نّ',
    level: 'خبير',
    segments: [
      { text: 'إِ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: ' شَانِئَكَ', type: 'normal' },
    ],
  },
  {
    id: 'exp8',
    word: 'أَمَّن يُجِيبُ',
    letter: 'مّ',
    level: 'خبير',
    segments: [
      { text: 'أَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'ن يُجِيبُ', type: 'normal' },
    ],
  },
  {
    id: 'exp9',
    word: 'مِنَ الْجِنَّةِ وَالنَّاسِ',
    letter: 'نّ',
    level: 'خبير',
    segments: [
      { text: 'مِنَ الْجِ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'ةِ وَا', type: 'normal' },
      { text: 'ل', type: 'silent' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'اسِ', type: 'normal' },
    ],
  },
  {
    id: 'exp10',
    word: 'ثُمَّ لَتَرَوُنَّهَا',
    letter: 'مّ',
    level: 'خبير',
    segments: [
      { text: 'ثُ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: ' لَتَرَوُ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: 'هَا', type: 'normal' },
    ],
  },
  {
    id: 'exp11',
    word: 'إِنَّ مَعَ الْعُسْرِ',
    letter: 'نّ',
    level: 'خبير',
    segments: [
      { text: 'إِ', type: 'normal' },
      { text: 'نَّ', type: 'ghunnah' },
      { text: ' مَعَ الْعُسْرِ', type: 'normal' },
    ],
  },
  {
    id: 'exp12',
    word: 'فَأَمَّا مَن ثَقُلَتْ',
    letter: 'مّ',
    level: 'خبير',
    segments: [
      { text: 'فَأَ', type: 'normal' },
      { text: 'مَّ', type: 'ghunnah' },
      { text: 'ا مَن ثَقُلَتْ', type: 'normal' },
    ],
  },
];

const DIFFICULTY_LEVELS: { key: GhunnahDifficultyLevel; label: string; count: number }[] = [
  { key: 'سهل', label: 'سهل', count: GHUNNAH_WORDS.filter(w => w.level === 'سهل').length },
  { key: 'متوسط', label: 'متوسط', count: GHUNNAH_WORDS.filter(w => w.level === 'متوسط').length },
  { key: 'متقدم', label: 'متقدم', count: GHUNNAH_WORDS.filter(w => w.level === 'متقدم').length },
  { key: 'خبير', label: 'خبير', count: GHUNNAH_WORDS.filter(w => w.level === 'خبير').length },
];

interface GhunnahTrainerProps {
  activeLetter?: 'نّ' | 'مّ';
  onLetterSelect?: (letter: 'نّ' | 'مّ') => void;
  playChime?: (success?: boolean) => void;
}

export const InteractiveGhunnahMakhraj: React.FC<GhunnahTrainerProps> = ({
  activeLetter = 'نّ',
  onLetterSelect,
  playChime,
}) => {
  // Selected Level state
  const [selectedLevel, setSelectedLevel] = useState<GhunnahDifficultyLevel>('سهل');
  // Index of active word within the currently filtered level list
  const [currentWordIdx, setCurrentWordIdx] = useState(0);

  // Timing simulation state: 'idle' | 'timing' | 'completed'
  const [timerStatus, setTimerStatus] = useState<'idle' | 'timing' | 'completed'>('idle');
  const [timerProgress, setTimerProgress] = useState(0); // 0 to 1

  const animRef = useRef<number | null>(null);
  const resetTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Exact 2-Harakat Canonical Tajweed Timing (~1300ms)
  const TARGET_HARAKAT_MS = 1300;

  // Words filtered by selected difficulty level
  const activeLevelWords = useMemo(() => {
    return GHUNNAH_WORDS.filter(w => w.level === selectedLevel);
  }, [selectedLevel]);

  const activeWord = activeLevelWords[currentWordIdx % activeLevelWords.length] || activeLevelWords[0] || GHUNNAH_WORDS[0];

  // Sync external letter selection if provided
  useEffect(() => {
    if (activeLetter) {
      const matchIdx = activeLevelWords.findIndex(w => w.letter === activeLetter);
      if (matchIdx !== -1 && activeWord.letter !== activeLetter) {
        setCurrentWordIdx(matchIdx);
      }
    }
  }, [activeLetter, activeLevelWords]);

  // Handle switching level from the top
  const handleSelectLevel = (lvl: GhunnahDifficultyLevel) => {
    stopTimer();
    setSelectedLevel(lvl);
    setCurrentWordIdx(0);
    const newWords = GHUNNAH_WORDS.filter(w => w.level === lvl);
    if (newWords.length > 0 && onLetterSelect) {
      onLetterSelect(newWords[0].letter);
    }
  };

  // Handle sequential transition within current level
  const handleNextWord = () => {
    stopTimer();
    const nextIdx = (currentWordIdx + 1) % activeLevelWords.length;
    setCurrentWordIdx(nextIdx);
    if (onLetterSelect && activeLevelWords[nextIdx]) {
      onLetterSelect(activeLevelWords[nextIdx].letter);
    }
  };

  const handlePrevWord = () => {
    stopTimer();
    const prevIdx = (currentWordIdx - 1 + activeLevelWords.length) % activeLevelWords.length;
    setCurrentWordIdx(prevIdx);
    if (onLetterSelect && activeLevelWords[prevIdx]) {
      onLetterSelect(activeLevelWords[prevIdx].letter);
    }
  };

  // Play gentle acoustic ghunnah resonance tone
  const playGhunnahResonance = (letter: 'نّ' | 'مّ', durationMs: number) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();

      const durSec = durationMs / 1000;
      const now = ctx.currentTime;

      // Base nasal harmonic oscillator
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      const baseFreq = letter === 'نّ' ? 240 : 210;
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(baseFreq, now);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(baseFreq * 2, now);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(letter === 'نّ' ? 520 : 440, now);
      filter.Q.setValueAtTime(3.5, now);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.055, now + 0.08);
      gain.gain.setValueAtTime(0.055, now + durSec - 0.1);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + durSec);
      osc2.stop(now + durSec);
    } catch {
      if (playChime) playChime(true);
    }
  };

  // Play celebration success chime
  const playCelebrationChime = () => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        if (playChime) playChime(true);
        return;
      }
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();

      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const now = ctx.currentTime + idx * 0.08;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.5);
      });
    } catch {
      if (playChime) playChime(true);
    }
  };

  const stopTimer = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setTimerStatus('idle');
    setTimerProgress(0);
  };

  // Start Interactive 2-Harakat Timer
  const startTimer = (withAudioDemo = false) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    setTimerProgress(0);
    setTimerStatus('timing');

    if (withAudioDemo) {
      playGhunnahResonance(activeWord.letter, TARGET_HARAKAT_MS);
    }

    let startTime: number | null = null;
    const DURATION = TARGET_HARAKAT_MS;

    const tick = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const prog = Math.min(elapsed / DURATION, 1);

      if (prog < 1) {
        setTimerProgress(prog);
        animRef.current = requestAnimationFrame(tick);
      } else {
        animRef.current = null;
        setTimerProgress(1);
        setTimerStatus('completed');
        playCelebrationChime();
        resetTimerRef.current = setTimeout(() => {
          setTimerStatus('idle');
          setTimerProgress(0);
        }, 800);
      }
    };

    animRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  return (
    <div className="ghunnah-trainer-clean-card" id="ghunnahTrainerCard">
      {/* 1. Top Header: Unified Level Selector in One Clean Container */}
      <div className="trainer-level-selector-row" id="trainerLevelSelectorRow">
        <div className="trainer-single-level-box" id="trainerSingleLevelBox">
          <div className="trainer-level-select-wrap">
            <select
              id="ghunnahLevelSelect"
              className="trainer-level-native-select"
              value={selectedLevel}
              onChange={(e) => handleSelectLevel(e.target.value as GhunnahDifficultyLevel)}
              aria-label="اختر المستوى"
            >
              {DIFFICULTY_LEVELS.map(lvl => (
                <option key={lvl.key} value={lvl.key} className="bg-slate-900 text-slate-100">
                  {lvl.label}
                </option>
              ))}
            </select>
            <ChevronDown className="trainer-level-select-chevron" aria-hidden="true" />
          </div>
        </div>

        {/* Word Progress Indicator inside Level */}
        <div className="trainer-word-counter-badge" id="trainerWordCounter">
          <span className="counter-current">{toArabicDigits((currentWordIdx % activeLevelWords.length) + 1)}</span>
          <span className="counter-sep">/</span>
          <span className="counter-total">{toArabicDigits(activeLevelWords.length)}</span>
        </div>
      </div>

      {/* 2. Unified Master Center: High-Precision Spacious Breathing Ring with Quranic Word */}
      <div className="trainer-unified-stage">
        <div className="trainer-unified-ring-wrap">
          <svg className="trainer-unified-svg" viewBox="0 0 300 300">
            <defs>
              {/* Premium Multi-Stop Gradient for Active Ghunnah Measurement */}
              <linearGradient id="cleanGhunnahGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#38BDF8" />
                <stop offset="45%" stopColor="#818CF8" />
                <stop offset="85%" stopColor="#10B981" />
                <stop offset="100%" stopColor="#34D399" />
              </linearGradient>

              {/* Luminous Celebration Gradient for Full Haraka Completion */}
              <linearGradient id="cleanSuccessGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#10B981" />
                <stop offset="50%" stopColor="#34D399" />
                <stop offset="100%" stopColor="#6EE7B7" />
              </linearGradient>

              {/* Glowing Filter for Leading Orbit Head */}
              <filter id="headGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              {/* Radial Depth Background Gradient */}
              <radialGradient id="innerDepthGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(15, 23, 42, 0.75)" />
                <stop offset="80%" stopColor="rgba(2, 6, 23, 0.92)" />
                <stop offset="100%" stopColor="rgba(30, 58, 138, 0.4)" />
              </radialGradient>
            </defs>

            {/* Decorative Outer Precision Ring with subtle ticks */}
            <circle
              cx="150"
              cy="150"
              r="144"
              stroke="rgba(255, 255, 255, 0.05)"
              strokeWidth="1"
              strokeDasharray="3 5"
              fill="none"
            />

            {/* Inner Quranic Depth Disc (Spacious 256px wide interior) */}
            <circle
              cx="150"
              cy="150"
              r="128"
              fill="url(#innerDepthGrad)"
            />

            {/* Subtle Inner Accent Border */}
            <circle
              cx="150"
              cy="150"
              r="128"
              stroke="rgba(255, 255, 255, 0.08)"
              strokeWidth="1.5"
              fill="none"
            />

            {/* Background Track Ring (Laser-carved track appearance) */}
            <circle
              cx="150"
              cy="150"
              r="134"
              className="unified-track-bg"
              strokeWidth="8"
              fill="none"
            />

            {/* Precision Dual-Harakah Phase Markers (Jeweled Quranic Nodes in Unified Cyan Theme) */}
            {/* Top Marker (Start / 2 Harakat End point - 0° / 360°) */}
            <circle
              cx="150"
              cy="16"
              r="6"
              stroke={timerProgress >= 0.99 ? "rgba(52, 211, 153, 0.7)" : "rgba(56, 189, 248, 0.35)"}
              strokeWidth="1.2"
              fill="rgba(2, 6, 23, 0.7)"
              className="transition-colors duration-200"
            />
            <circle
              cx="150"
              cy="16"
              r="3"
              fill={timerProgress >= 0.99 ? "#34D399" : "#38BDF8"}
              className="transition-colors duration-200"
            />

            {/* Bottom Marker (1 Harakah Midpoint - 180°) */}
            <circle
              cx="150"
              cy="284"
              r="6"
              stroke={timerProgress >= 0.5 ? "rgba(56, 189, 248, 0.7)" : "rgba(56, 189, 248, 0.35)"}
              strokeWidth="1.2"
              fill="rgba(2, 6, 23, 0.7)"
              className="transition-colors duration-200"
            />
            <circle
              cx="150"
              cy="284"
              r="3"
              fill={timerProgress >= 0.5 ? "#38BDF8" : "rgba(56, 189, 248, 0.75)"}
              className="transition-colors duration-200"
            />

            {/* Live Progress Arc */}
            <circle
              cx="150"
              cy="150"
              r="134"
              className={`unified-live-arc ${timerStatus === 'completed' ? 'success' : ''}`}
              stroke={timerStatus === 'completed' ? 'url(#cleanSuccessGrad)' : 'url(#cleanGhunnahGrad)'}
              strokeWidth="7"
              fill="none"
              strokeDasharray={2 * Math.PI * 134}
              strokeDashoffset={2 * Math.PI * 134 * (1 - timerProgress)}
              strokeLinecap="round"
              transform="rotate(-90 150 150)"
            />

            {/* Ultra-Smooth Hardware-Accelerated Glowing Orbit Particle Head */}
            {timerStatus === 'timing' && timerProgress > 0.01 && timerProgress < 0.99 && (
              (() => {
                const angle = -Math.PI / 2 + timerProgress * 2 * Math.PI;
                const headX = 150 + 134 * Math.cos(angle);
                const headY = 150 + 134 * Math.sin(angle);
                return (
                  <g pointerEvents="none">
                    {/* Outer soft aura */}
                    <circle cx={headX} cy={headY} r="8" fill="rgba(56, 189, 248, 0.25)" />
                    {/* Mid radiant core */}
                    <circle cx={headX} cy={headY} r="5" fill="rgba(56, 189, 248, 0.85)" />
                    {/* Center pure white starlet */}
                    <circle cx={headX} cy={headY} r="2.8" fill="#FFFFFF" />
                  </g>
                );
              })()
            )}
          </svg>

          {/* Unified Word Display Inside the Ring with Authentic Tajweed Color Coding */}
          <div className="trainer-unified-core">
            <div
              key={activeWord.id}
              className={`trainer-core-word ${timerStatus === 'completed' ? 'completed' : ''}`}
              id="ghunnahWordDisplay"
              dir="rtl"
            >
              {activeWord.segments && activeWord.segments.length > 0
                ? formatConnectedTajweedSegments(activeWord.segments).map((seg, i) => (
                    <span
                      key={i}
                      className={`tajweed-char tajweed-${seg.type}`}
                    >{seg.text}</span>
                  ))
                : activeWord.word}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Action Controls: Previous Word, Primary Timer Button, and Next Word */}
      <div className="trainer-clean-actions">
        <button
          type="button"
          id="btnPrevGhunnahWord"
          className="trainer-nav-word-btn"
          onClick={handlePrevWord}
          title="الانتقال للكلمة السابقة"
        >
          <ArrowRight className="w-4 h-4 ml-1.5" />
          <span>السابقة</span>
        </button>

        <button
          type="button"
          id="btnStartGhunnahTimer"
          className="trainer-primary-btn"
          onClick={() => startTimer(false)}
        >
          {timerStatus === 'timing' ? (
            <>
              <Timer className="w-4 h-4 ml-2 animate-spin text-sky-200" />
              <span>جارٍ القياس...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 ml-2 fill-current text-sky-200" />
              <span>ابدأ التدريب</span>
            </>
          )}
        </button>

        <button
          type="button"
          id="btnNextGhunnahWord"
          className="trainer-nav-word-btn"
          onClick={handleNextWord}
          title="الانتقال للكلمة التالية"
        >
          <span>التالية</span>
          <ArrowLeft className="w-4 h-4 mr-1.5" />
        </button>
      </div>
    </div>
  );
};
