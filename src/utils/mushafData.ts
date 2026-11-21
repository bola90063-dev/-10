import type { MushafLineItem, MushafLetterUnit } from '../components/MushafLineRow';

export const TOTAL_MUSHAF_PAGES = 604;

export const DIACRITIC_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640]/;
export const MUSHAF_SYMBOLS = new Set(['\u06DE', '\u06E9']);
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toArabicDigits(n: number | string): string {
  return String(n)
    .split('')
    .map((c) => (/[0-9]/.test(c) ? ARABIC_DIGITS[+c] : c))
    .join('');
}

export function tokenizeMushafText(
  text: string,
  targetLetters: string[] = []
): MushafLetterUnit[] {
  const units: MushafLetterUnit[] = [];
  for (const ch of text) {
    if (ch === ' ' || ch === '\u00A0') {
      units.push({ type: 'space', base: ' ', extra: '', isTarget: false });
      continue;
    }
    if (MUSHAF_SYMBOLS.has(ch)) {
      units.push({ type: 'symbol', base: ch, extra: '', isTarget: false });
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
      isTarget: targetLetters.length > 0 && targetLetters.includes(ch),
    });
  }
  return units;
}

export interface MushafSurahMeta {
  id: number;
  name: string;
  rev: 'مَكِّيَّةٌ' | 'مَدَنِيَّةٌ';
  startPage: number;
  totalAyat: number;
}

export interface MushafTextRun {
  s: number;
  a: number;
  t: string;
  e?: 1;
}

export interface MushafRawRow {
  l: number;
  k: 'b' | 'm' | 't';
  s?: number;
  r?: MushafTextRun[];
}

export interface MushafRawPage {
  j: number;
  rows: MushafRawRow[];
}

export interface MushafDataset {
  surahs: MushafSurahMeta[];
  pages: MushafRawPage[];
}

export type TokenizedMushafRow =
  | {
      kind: 'banner';
      line: number;
      surahMeta: MushafSurahMeta;
    }
  | {
      kind: 'basmalah';
      line: number;
      surahId: number;
    }
  | {
      kind: 'text';
      line: number;
      isCentered: boolean;
      items: MushafLineItem[];
    };

export interface TokenizedMushafPage {
  pageNum: number;
  jozz: number;
  surahNames: string[];
  rows: TokenizedMushafRow[];
}

export const INITIAL_MUSHAF_SURAHS: MushafSurahMeta[] = [
  { id: 1, name: 'الفاتحة', rev: 'مَكِّيَّةٌ', startPage: 1, totalAyat: 7 },
  { id: 94, name: 'الشرح', rev: 'مَكِّيَّةٌ', startPage: 596, totalAyat: 8 },
  { id: 103, name: 'العصر', rev: 'مَكِّيَّةٌ', startPage: 601, totalAyat: 3 },
  { id: 105, name: 'الفيل', rev: 'مَكِّيَّةٌ', startPage: 601, totalAyat: 5 },
  { id: 106, name: 'قريش', rev: 'مَكِّيَّةٌ', startPage: 602, totalAyat: 4 },
  { id: 108, name: 'الكوثر', rev: 'مَكِّيَّةٌ', startPage: 602, totalAyat: 3 },
  { id: 109, name: 'الكافرون', rev: 'مَكِّيَّةٌ', startPage: 603, totalAyat: 6 },
  { id: 110, name: 'النصر', rev: 'مَدَنِيَّةٌ', startPage: 603, totalAyat: 3 },
  { id: 111, name: 'المسد', rev: 'مَكِّيَّةٌ', startPage: 603, totalAyat: 5 },
  { id: 112, name: 'الإخلاص', rev: 'مَكِّيَّةٌ', startPage: 604, totalAyat: 4 },
  { id: 113, name: 'الفلق', rev: 'مَكِّيَّةٌ', startPage: 604, totalAyat: 5 },
  { id: 114, name: 'الناس', rev: 'مَكِّيَّةٌ', startPage: 604, totalAyat: 6 },
];
