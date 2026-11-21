export const LATHAWIYA_TARGETS = ['ث', 'ذ', 'ظ'] as const;

export const DIACRITIC_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640]/;

export interface WordBankItem {
  w: string;
  has: boolean;
}

export interface LetterUnit {
  type: 'letter' | 'space';
  base: string;
  extra: string;
  isTarget: boolean;
}

export const LATHAWIYA_WORD_BANK: WordBankItem[] = [
  // كلمات قرآنية بحرف الثاء (ث)
  { w: 'مَثَلُ', has: true },
  { w: 'كَثِيرًا', has: true },
  { w: 'بَثَّ', has: true },
  { w: 'ثَلَاثَةِ', has: true },
  { w: 'حَدِيثُ', has: true },
  { w: 'وَرِثَ', has: true },
  { w: 'أَثْقَالَهَا', has: true },
  { w: 'الْغَيْثَ', has: true },
  // كلمات قرآنية بحرف الذال (ذ)
  { w: 'ذَهَبَ', has: true },
  { w: 'عَذَابٌ', has: true },
  { w: 'أَخَذَ', has: true },
  { w: 'ذِكْرٌ', has: true },
  { w: 'ذَرْعًا', has: true },
  { w: 'تُذِلُّ', has: true },
  { w: 'لَذَّةٍ', has: true },
  // كلمات قرآنية بحرف الظاء (ظ)
  { w: 'عَظِيمٌ', has: true },
  { w: 'ظَلَّ', has: true },
  { w: 'نَاظِرَةٌ', has: true },
  { w: 'حَفِيظٌ', has: true },
  { w: 'ظِلٍّ', has: true },
  { w: 'ظُلُمَاتٍ', has: true },
  { w: 'نَظَرَ', has: true },
  // كلمات قرآنية خالية من الحروف اللثوية
  { w: 'أَمَرَ', has: false },
  { w: 'سَأَلَ', has: false },
  { w: 'بَطَشَ', has: false },
  { w: 'خَلَقَ', has: false },
  { w: 'كَتَبَ', has: false },
  { w: 'سَلَامٌ', has: false },
  { w: 'كِتَابٌ', has: false },
  { w: 'قَمَرًا', has: false },
  { w: 'عِلْمًا', has: false },
  { w: 'حَكِيمٌ', has: false },
];

export function tokenizeLathawiya(text: string): LetterUnit[] {
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
    units.push({
      type: 'letter',
      base: ch,
      extra: '',
      isTarget: (LATHAWIYA_TARGETS as readonly string[]).includes(ch),
    });
  }
  return units;
}

export function shuffleItems<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Builds an 8-card word round containing exactly 3 target words (one each for ث, ذ, ظ)
 * and 5 non-target distractor words, shuffled for the 4x2 word challenge grid.
 */
export function buildWordsRound(
  bank: readonly WordBankItem[] = LATHAWIYA_WORD_BANK,
  distractorCount = 5,
  rng: () => number = Math.random
): WordBankItem[] {
  const chosenTargets: WordBankItem[] = [];

  for (const targetLetter of LATHAWIYA_TARGETS) {
    const matching = bank.filter(
      (item) => item.has && item.w.includes(targetLetter) && !chosenTargets.includes(item)
    );
    if (matching.length > 0) {
      const picked = shuffleItems(matching, rng)[0];
      chosenTargets.push(picked);
    }
  }

  const distractors = shuffleItems(
    bank.filter((item) => !item.has),
    rng
  ).slice(0, distractorCount);

  return shuffleItems([...chosenTargets, ...distractors], rng);
}

export function getTargetTokenIndices(units: readonly LetterUnit[]): number[] {
  const indices: number[] = [];
  units.forEach((unit, idx) => {
    if (unit.type === 'letter' && unit.isTarget) {
      indices.push(idx);
    }
  });
  return indices;
}

/**
 * Builds an 8-example sequential session: 6 target words (2 each for ث, ذ, ظ)
 * plus 2 distractor words without Lathawiya letters, shuffled in random order.
 */
export function buildSequentialWordsSession(
  bank: readonly WordBankItem[] = LATHAWIYA_WORD_BANK,
  targetsPerLetter = 2,
  distractorCount = 2,
  rng: () => number = Math.random
): WordBankItem[] {
  const chosenTargets: WordBankItem[] = [];

  for (const targetLetter of LATHAWIYA_TARGETS) {
    const matching = shuffleItems(
      bank.filter(
        (item) => item.has && item.w.includes(targetLetter) && !chosenTargets.includes(item)
      ),
      rng
    );
    chosenTargets.push(...matching.slice(0, targetsPerLetter));
  }

  const distractors = shuffleItems(
    bank.filter((item) => !item.has),
    rng
  ).slice(0, distractorCount);

  return shuffleItems([...chosenTargets, ...distractors], rng);
}

