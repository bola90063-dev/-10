import type { MushafLetterUnit } from '../components/MushafLineRow';

export type TajweedRuleKind = 'maddLong' | 'ghunnah' | 'qalqalah' | 'idgham';

export interface TajweedLegendItem {
  kind: TajweedRuleKind;
  label: string;
  color: string;
}

export const TAJWEED_COLORS: Record<TajweedRuleKind, string> = {
  maddLong: '#F00028',
  ghunnah: '#00B848',
  qalqalah: '#009DFF',
  idgham: '#7E8CA0',
};

// Vivid, high-clarity 4-color Tajweed palette for the Mushaf page:
// highlights Long Madd (4-6 counts), Ghunnah/Ikhfa, Qalqalah, and Idgham/Silent letters
// with unmistakable separation from base ink and warm ivory paper.
export const TAJWEED_LEGEND: TajweedLegendItem[] = [
  { kind: 'maddLong', label: 'مدّ طويل (٤–٦ حركات)', color: TAJWEED_COLORS.maddLong },
  { kind: 'ghunnah', label: 'غُنَّة وإخفاء (حركتان)', color: TAJWEED_COLORS.ghunnah },
  { kind: 'qalqalah', label: 'قلقلة', color: TAJWEED_COLORS.qalqalah },
  { kind: 'idgham', label: 'إدغام ، وما لا يُلفَظ', color: TAJWEED_COLORS.idgham },
];

export interface AnalyzeWordTajweedOptions {
  prevWordTokens?: MushafLetterUnit[];
  nextWordTokens?: MushafLetterUnit[];
  isAyahEnd?: boolean;
}

const QALQALAH_LETTERS = new Set(['ق', 'ط', 'ب', 'ج', 'د']);
const IDGHAM_GHUNNAH_LETTERS = new Set(['ي', 'ن', 'م', 'و']);
const IDGHAM_NO_GHUNNAH_LETTERS = new Set(['ل', 'ر']);
const ALIF_LIGATURE_SECONDS = new Set(['ا', 'أ', 'إ', 'آ', 'ٱ']);
const IKHFA_LETTERS = new Set([
  'ص',
  'ذ',
  'ث',
  'ك',
  'ج',
  'ش',
  'ق',
  'س',
  'د',
  'ط',
  'ز',
  'ف',
  'ت',
  'ض',
  'ظ',
]);

const TANWEEN_IDGHAM_IKHFA_RE = /[\u0656\u0657\u065E]/;
const HARAKA_CHECK_RE = /[\u064B-\u0652\u0656-\u0658\u065E\u0670\u06E0\u06E1\u06E2\u06ED]/;
const ASSIMILATED_EXCLUDE_BASES = new Set(['ا', 'أ', 'إ', 'آ', 'ٱ', 'ى', 'و', 'ي', 'ن', 'م', 'ل']);

function extractLetters(tokens: MushafLetterUnit[] | undefined): MushafLetterUnit[] {
  if (!tokens) return [];
  const res: MushafLetterUnit[] = [];
  for (const t of tokens) {
    if (t.type === 'letter') res.push(t);
  }
  return res;
}

function isPrevWordEndingWithGhunnahTrigger(prevLetters: MushafLetterUnit[]): boolean {
  if (prevLetters.length === 0) return false;
  const last = prevLetters[prevLetters.length - 1];
  // Bare Nun Sakinah at end of previous word (e.g. مَن يَقُولُ / مِّن وَّالٍ)
  if (last.base === 'ن' && !HARAKA_CHECK_RE.test(last.extra)) {
    return true;
  }
  // Sequential tanween directly on last letter (e.g. بَرۡقٞ يَجۡعَلُونَ, هُدٗى وَرَحۡمَةٗ)
  if (TANWEEN_IDGHAM_IKHFA_RE.test(last.extra)) {
    return true;
  }
  // Sequential tanween fath on penultimate letter before silent Alif (e.g. مَثَلٗا يَوۡمَ)
  if (
    last.base === 'ا' &&
    !HARAKA_CHECK_RE.test(last.extra) &&
    prevLetters.length >= 2 &&
    TANWEEN_IDGHAM_IKHFA_RE.test(prevLetters[prevLetters.length - 2].extra)
  ) {
    return true;
  }
  return false;
}

/**
 * Analyzes an authentic KFGQPC Uthmani Hafs v18 word (with optional previous/next word context)
 * and maps token indices to the calm 4-color Tajweed rules (Long Madd, Ghunnah/Ikhfa, Qalqalah, Idgham/Silent).
 */
export function analyzeWordTajweed(
  tokens: MushafLetterUnit[],
  optionsOrNextTokens?: AnalyzeWordTajweedOptions | MushafLetterUnit[]
): Record<number, TajweedRuleKind> {
  const result: Record<number, TajweedRuleKind> = {};

  // UthmanicHafs renders KFGQPC Sajdah overline words (marked with U+06E4) via
  // whole-word GSUB ligatures (sajda1..sajda15); keep them unsplit so glyphs stay intact.
  if (tokens.some((t) => t.extra.includes('\u06E4'))) {
    return result;
  }

  const options: AnalyzeWordTajweedOptions = Array.isArray(optionsOrNextTokens)
    ? { nextWordTokens: optionsOrNextTokens }
    : optionsOrNextTokens || {};

  const letterIndices: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'letter') {
      letterIndices.push(i);
    }
  }
  if (letterIndices.length === 0) return result;

  const prevLetters = extractLetters(options.prevWordTokens);
  const nextLetters = extractLetters(options.nextWordTokens);
  const nextFirstLetter = nextLetters[0] ?? null;
  const prevEndedWithGhunnah = isPrevWordEndingWithGhunnahTrigger(prevLetters);

  // Detect Lafz al-Jalalah (ٱللَّهُ / لِلَّهِ / ٱللَّهُمَّ) and preserve its unified GSUB ligature
  const allahIndices = new Set<number>();
  for (let pos = 0; pos <= letterIndices.length - 3; pos++) {
    const l1Idx = letterIndices[pos];
    const l2Idx = letterIndices[pos + 1];
    const hIdx = letterIndices[pos + 2];
    const l1 = tokens[l1Idx];
    const l2 = tokens[l2Idx];
    const h = tokens[hIdx];

    if (
      l1.base === 'ل' &&
      l2.base === 'ل' &&
      l2.extra.includes('\u0651') &&
      h.base === 'ه' &&
      !h.extra.includes('\u06E1')
    ) {
      const rem = letterIndices.length - (pos + 3);
      const isAllahumma =
        rem === 1 &&
        tokens[letterIndices[pos + 3]].base === 'م' &&
        tokens[letterIndices[pos + 3]].extra.includes('\u0651');
      if (rem === 0 || isAllahumma) {
        allahIndices.add(l1Idx);
        allahIndices.add(l2Idx);
        allahIndices.add(hIdx);
        break;
      }
    }
  }

  for (let pos = 0; pos < letterIndices.length; pos++) {
    const tIdx = letterIndices[pos];
    if (allahIndices.has(tIdx)) continue;

    const cur = tokens[tIdx];
    const prev = pos > 0 ? tokens[letterIndices[pos - 1]] : null;
    const inWord = pos + 1 < letterIndices.length;
    const nxt = inWord ? tokens[letterIndices[pos + 1]] : nextFirstLetter;

    let rule: TajweedRuleKind | null = null;

    // 1. Long Madd (4-6 counts): any Maddah sign ٓ (U+0653) except 2-count Badal on أٓ
    if (cur.extra.includes('\u0653')) {
      if (cur.base !== 'أ') {
        rule = 'maddLong';
      }
    }
    // 2. Iqlab (U+06E2 ۢ or U+06ED ۭ) -> Ghunnah site (2 counts)
    else if (cur.extra.includes('\u06E2') || cur.extra.includes('\u06ED')) {
      rule = 'ghunnah';
    }
    // 3. Ghunnah Mushaddadah (نّ or مّ — 2 counts)
    else if ((cur.base === 'ن' || cur.base === 'م') && cur.extra.includes('\u0651')) {
      rule = 'ghunnah';
    }
    // 4. Bare Nun Sakinah (no sukun/vowel => Idgham or Ikhfa)
    else if (cur.base === 'ن' && !HARAKA_CHECK_RE.test(cur.extra) && nxt) {
      if (IDGHAM_GHUNNAH_LETTERS.has(nxt.base) || IDGHAM_NO_GHUNNAH_LETTERS.has(nxt.base)) {
        rule = 'idgham';
      } else if (IKHFA_LETTERS.has(nxt.base)) {
        rule = 'ghunnah';
      }
    }
    // 5. Bare Meem Sakinah (no sukun/vowel => Idgham Shafawi or Ikhfa Shafawi)
    else if (cur.base === 'م' && !HARAKA_CHECK_RE.test(cur.extra) && nxt) {
      if (nxt.base === 'م') {
        rule = 'idgham';
      } else if (nxt.base === 'ب') {
        rule = 'ghunnah';
      }
    }
    // 6. Ghunnah site on initial ي / و after bare Nun or sequential Tanween in Idgham bi-Ghunnah
    else if (pos === 0 && (cur.base === 'ي' || cur.base === 'و') && prevEndedWithGhunnah) {
      rule = 'ghunnah';
    }
    // 7. Silent letters marked with Uthmani zero (U+0652 ْ or U+06E0 ۠)
    else if (cur.extra.includes('\u0652') || cur.extra.includes('\u06E0')) {
      rule = 'idgham';
    }
    // 8. Solar Laam and Idgham Laam (قُل رَّبِّ, بَل لَّا)
    else if (
      cur.base === 'ل' &&
      !HARAKA_CHECK_RE.test(cur.extra) &&
      nxt &&
      nxt.extra.includes('\u0651') &&
      (inWord || nxt.base === 'ل' || nxt.base === 'ر')
    ) {
      rule = 'idgham';
    }
    // 9. Idgham Mutamathilayn / Mutajanisayn / Mutaqaribayn (bare consonant before shaddah)
    else if (
      !ASSIMILATED_EXCLUDE_BASES.has(cur.base) &&
      !HARAKA_CHECK_RE.test(cur.extra) &&
      nxt &&
      nxt.extra.includes('\u0651')
    ) {
      rule = 'idgham';
    }
    // 10. Connecting Alif Wasla (mid-word e.g. بِٱللَّهِ, or mid-ayah e.g. ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ), excluding ل+ٱ ligature
    else if (
      cur.base === 'ٱ' &&
      ((pos > 0 && prev?.base !== 'ل') || (pos === 0 && prevLetters.length > 0))
    ) {
      rule = 'idgham';
    }
    // 11. Qalqalah (ق ط ب ج د with Uthmani Sukun ۡ U+06E1)
    else if (QALQALAH_LETTERS.has(cur.base) && cur.extra.includes('\u06E1')) {
      rule = 'qalqalah';
    }
    // 12. Sequential Tanween Ikhfa (before Ikhfa letter)
    else if (
      TANWEEN_IDGHAM_IKHFA_RE.test(cur.extra) &&
      nextFirstLetter &&
      IKHFA_LETTERS.has(nextFirstLetter.base)
    ) {
      rule = 'ghunnah';
    }

    if (rule) {
      result[tIdx] = rule;
    }
  }

  // Keep UthmanicHafs lam-alif ligatures (e.g. لَآ in أَلَآ / إِلَّآ / هَٰٓؤُلَآءِ)
  // unified under one rule so the single GSUB ligature glyph is never sliced across colors.
  for (let pos = 0; pos < letterIndices.length - 1; pos++) {
    const lamIdx = letterIndices[pos];
    const alifIdx = letterIndices[pos + 1];
    if (tokens[lamIdx].base === 'ل' && ALIF_LIGATURE_SECONDS.has(tokens[alifIdx].base)) {
      const alifRule = result[alifIdx];
      const lamRule = result[lamIdx];
      if (alifRule) {
        result[lamIdx] = alifRule;
      } else if (lamRule) {
        result[alifIdx] = lamRule;
      }
    }
  }

  return result;
}
