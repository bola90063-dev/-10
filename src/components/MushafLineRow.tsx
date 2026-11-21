import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TAJWEED_COLORS, type TajweedRuleKind } from '../utils/tajweedRules';

export interface MushafLetterUnit {
  type: 'letter' | 'space' | 'symbol';
  base: string;
  extra: string;
  isTarget: boolean;
}

export type MushafLineItem =
  | {
      kind: 'rosette';
      keyPrefix: string;
      ayahNum: number;
      surahId: number;
    }
  | {
      kind: 'word';
      keyPrefix: string;
      rawWord: string;
      tokens: MushafLetterUnit[];
      tajweed?: Record<number, TajweedRuleKind>;
      ayahEnd: number | null;
      surahId: number;
      ayahNum: number;
    };

interface MushafLineRowProps {
  items: MushafLineItem[];
  isCentered: boolean;
  isPractice: boolean;
  isTajweedEnabled: boolean;
  correctMap: Record<string, boolean>;
  revealed: boolean;
  wrongKey: string | null;
  onLetterClick: (unit: MushafLetterUnit, key: string) => void;
  toArabicDigits: (n: number | string) => string;
  zoomScale?: number;
  uniformFontSize?: number | null;
  isFontSynced?: boolean;
  focusedAyahKeys?: ReadonlySet<string> | null;
  isHifzHidden?: boolean;
  revealedWordKeys?: Record<string, boolean>;
  revealedAyahKeys?: Record<string, boolean>;
  onWordAction?: (word: Extract<MushafLineItem, { kind: 'word' }>) => void;
  onAyahAction?: (surahId: number, ayahNum: number) => void;
  subscribePageResize?: (cb: () => void) => () => void;
}

type HighlightKind = 'correct' | 'revealed' | 'wrong';

interface HighlightBox {
  key: string;
  kind: HighlightKind;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface WordTokenSpan {
  tIdx: number;
  start: number;
  end: number;
  token: MushafLetterUnit;
}

interface ParsedWordData {
  wordText: string;
  leadingSymbols: string;
  trailingSymbols: string;
  spans: WordTokenSpan[];
}

interface KashidaSlot {
  wordKey: string;
  tokenIdx: number;
  tier: number;
}

const PRACTICE_COLORS: Record<'correct' | 'revealed' | 'wrong', string> = {
  correct: '#059669',
  revealed: '#D97706',
  wrong: '#DC2626',
};

// Blink (Desktop/Android Chrome, Edge, Opera) shapes across pure color-only inline spans
// via a single HarfBuzz call while drawing glyphs unclipped, avoiding Blink NGHighlightPainter's
// rectangular ClipRect slicing on UthmanicHafs ligatures and overhanging diacritics.
// WebKit (Safari / all iOS browsers) and Gecko retain CSS.highlights on unsplit text nodes.
const IS_BLINK_ENGINE =
  typeof navigator !== 'undefined' &&
  !/iPhone|iPad|iPod/i.test(navigator.userAgent) &&
  /Chrome\/|Chromium\/|Edg\/|OPR\//.test(navigator.userAgent);

const DUAL_JOIN_LETTERS = new Set([
  'ب',
  'ت',
  'ث',
  'ج',
  'ح',
  'خ',
  'س',
  'ش',
  'ص',
  'ض',
  'ط',
  'ظ',
  'ع',
  'غ',
  'ف',
  'ق',
  'ك',
  'ل',
  'م',
  'ن',
  'ه',
  'ي',
  'ئ',
]);

const ALIF_LETTERS = new Set(['ا', 'أ', 'إ', 'آ', 'ٱ']);
const SPECIAL_MARK_BLOCK_RE = /[\u0640\u0653\u06E2\u06E4\u06E5\u06E6\u06E7\u06E8\u06EA\u06EC\u06ED]/;
const PREFERRED_STRETCHERS = new Set([
  'ب',
  'ت',
  'ث',
  'س',
  'ش',
  'ص',
  'ض',
  'ط',
  'ظ',
  'ف',
  'ق',
  'ك',
  'م',
  'ع',
  'غ',
  'ي',
]);

function collectLineKashidaSlots(items: MushafLineItem[]): KashidaSlot[] {
  const slots: KashidaSlot[] = [];

  for (const item of items) {
    if (item.kind !== 'word') continue;
    // Preserve whole-word GSUB ligatures for Sajdah overline words (U+06E4)
    if (item.tokens.some((t) => t.extra.includes('\u06E4'))) continue;
    const letterIndices: number[] = [];
    for (let i = 0; i < item.tokens.length; i++) {
      if (item.tokens[i].type === 'letter') letterIndices.push(i);
    }
    if (letterIndices.length < 2) continue;

    for (let pos = 0; pos < letterIndices.length - 1; pos++) {
      const i = letterIndices[pos];
      const nextI = letterIndices[pos + 1];
      const cur = item.tokens[i];
      const nxt = item.tokens[nextI];

      if (!DUAL_JOIN_LETTERS.has(cur.base)) continue;
      if (SPECIAL_MARK_BLOCK_RE.test(cur.extra)) continue;
      // Never insert kashida before standalone non-joining Hamza (ء) or Alif Wasla (ٱ)
      if (nxt.base === 'ء' || nxt.base === 'ٱ') continue;
      if (cur.base === 'ل' && ALIF_LETTERS.has(nxt.base)) continue;
      if (cur.base === 'ك' && (nxt.base === 'ل' || ALIF_LETTERS.has(nxt.base))) continue;

      // Preserve the sacred calligraphy of Allah (ٱللَّهِ / لِلَّهِ / ٱللَّهُمَّ)
      const prevLetter = pos > 0 ? item.tokens[letterIndices[pos - 1]] : null;
      const nextNextLetter = pos + 2 < letterIndices.length ? item.tokens[letterIndices[pos + 2]] : null;
      const isAllahummaTail =
        pos + 2 === letterIndices.length - 1 &&
        nextNextLetter?.base === 'م' &&
        nextNextLetter.extra.includes('\u0651');
      if (cur.base === 'ل' && nxt.base === 'ل' && nextNextLetter?.base === 'ه') continue;
      if (
        cur.base === 'ل' &&
        nxt.base === 'ه' &&
        prevLetter?.base === 'ل' &&
        (pos + 1 === letterIndices.length - 1 || isAllahummaTail)
      ) {
        continue;
      }

      const hasDaggerAlif = cur.extra.includes('\u0670');
      const isBeforeRegularAlif = ALIF_LETTERS.has(nxt.base);
      const isPreFinal = pos === letterIndices.length - 2;

      let tier = 2;
      if (hasDaggerAlif) {
        tier = 5;
      } else if (isBeforeRegularAlif) {
        tier = 1;
      } else if (isPreFinal && (PREFERRED_STRETCHERS.has(cur.base) || cur.base === 'ن' || cur.base === 'ل' || cur.base === 'ه')) {
        tier = 4;
      } else if (PREFERRED_STRETCHERS.has(cur.base)) {
        tier = 3;
      }

      slots.push({ wordKey: item.keyPrefix, tokenIdx: i, tier });
    }
  }

  return slots;
}

function distributeKashidas(
  items: MushafLineItem[],
  neededTatweels: number
): Record<string, number> {
  if (neededTatweels <= 0) return {};
  const allSlots = collectLineKashidaSlots(items);
  if (allSlots.length === 0) return {};

  // Group slots by word so we distribute round-robin evenly across words
  const wordOrder: string[] = [];
  const slotsByWord = new Map<string, KashidaSlot[]>();
  for (const slot of allSlots) {
    let arr = slotsByWord.get(slot.wordKey);
    if (!arr) {
      arr = [];
      slotsByWord.set(slot.wordKey, arr);
      wordOrder.push(slot.wordKey);
    }
    arr.push(slot);
  }

  slotsByWord.forEach((arr) => {
    arr.sort((a, b) => b.tier - a.tier || b.tokenIdx - a.tokenIdx);
  });

  const counts: Record<string, number> = {};
  const wordTotal = new Map<string, number>();
  let remaining = neededTatweels;

  // Pass 1..3: assign 1 kashida per word per round, highest tier words first
  const wordsSorted = [...wordOrder].sort((a, b) => {
    const aMax = slotsByWord.get(a)?.[0]?.tier ?? 0;
    const bMax = slotsByWord.get(b)?.[0]?.tier ?? 0;
    return bMax - aMax;
  });

  const maxPerWord = 8;
  const maxPerSlot = 4;

  for (let round = 0; round < maxPerWord && remaining > 0; round++) {
    let addedInRound = false;
    for (const wKey of wordsSorted) {
      if (remaining <= 0) break;
      if ((wordTotal.get(wKey) ?? 0) >= maxPerWord) continue;
      const wSlots = slotsByWord.get(wKey) || [];
      // Avoid tier 1 (before Alif) in early rounds unless word has nothing else
      const candidate =
        wSlots.find((s) => (counts[`${wKey}:${s.tokenIdx}`] ?? 0) < maxPerSlot && s.tier >= 3) ||
        wSlots.find((s) => (counts[`${wKey}:${s.tokenIdx}`] ?? 0) < maxPerSlot && s.tier >= 2) ||
        (round > 0 ? wSlots.find((s) => (counts[`${wKey}:${s.tokenIdx}`] ?? 0) < maxPerSlot) : undefined) ||
        wSlots.find((s) => (counts[`${wKey}:${s.tokenIdx}`] ?? 0) < maxPerSlot);

      if (!candidate) continue;
      const slotKey = `${wKey}:${candidate.tokenIdx}`;
      counts[slotKey] = (counts[slotKey] ?? 0) + 1;
      wordTotal.set(wKey, (wordTotal.get(wKey) ?? 0) + 1);
      remaining--;
      addedInRound = true;
    }
    if (!addedInRound) break;
  }

  return counts;
}

function buildParsedWord(
  wordKey: string,
  rawWord: string,
  tokens: MushafLetterUnit[],
  kashidaCounts: Record<string, number>
): ParsedWordData {
  let wordText = '';
  let leadingSymbols = '';
  let trailingSymbols = '';
  const spans: WordTokenSpan[] = [];
  let seenLetter = false;

  for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
    const token = tokens[tIdx];
    if (token.type === 'symbol') {
      if (!seenLetter) {
        leadingSymbols += token.base + token.extra;
      } else {
        trailingSymbols += token.base + token.extra;
      }
      continue;
    }

    seenLetter = true;
    const kCount = kashidaCounts[`${wordKey}:${tIdx}`] ?? 0;
    const tatweelStr = kCount > 0 ? '\u0640'.repeat(kCount) : '';

    let chunk: string;
    if (tatweelStr && token.extra.includes('\u0670')) {
      // Place tatweel right before dagger alif so the alif sits cleanly above the elongation
      const daggerPos = token.extra.indexOf('\u0670');
      chunk =
        token.base +
        token.extra.slice(0, daggerPos) +
        tatweelStr +
        token.extra.slice(daggerPos);
    } else {
      chunk = token.base + token.extra + tatweelStr;
    }

    const start = wordText.length;
    wordText += chunk;
    spans.push({
      tIdx,
      start,
      end: wordText.length,
      token,
    });
  }

  if (!wordText && !leadingSymbols && !trailingSymbols) {
    wordText = rawWord;
  }

  return { wordText, leadingSymbols, trailingSymbols, spans };
}

interface WordColorSegment {
  text: string;
  color: string | null;
}

function createWordTextRange(rootEl: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode: Text | null = null;
  let startLocal = 0;
  let endNode: Text | null = null;
  let endLocal = 0;

  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (!startNode && start >= pos && start <= pos + len) {
      startNode = node;
      startLocal = start - pos;
    }
    if (end >= pos && end <= pos + len) {
      endNode = node;
      endLocal = end - pos;
      break;
    }
    pos += len;
    node = walker.nextNode() as Text | null;
  }

  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startLocal);
  range.setEnd(endNode, endLocal);
  return range;
}

function buildWordColorSegments(
  parsed: ParsedWordData,
  item: Extract<MushafLineItem, { kind: 'word' }>,
  isPractice: boolean,
  isTajweedEnabled: boolean,
  correctMap: Record<string, boolean>,
  revealed: boolean,
  wrongKey: string | null
): WordColorSegment[] | null {
  if (!isPractice && !isTajweedEnabled) return null;
  if (parsed.spans.length === 0) return null;

  const spanColors: Array<string | null> = parsed.spans.map((span) => {
    const letterKey = `${item.keyPrefix}_${span.tIdx}`;
    if (isPractice) {
      const isCorrect = !!correctMap[letterKey];
      const isRevealed = revealed && span.token.isTarget && !isCorrect;
      const isWrong = wrongKey === letterKey;
      if (isCorrect) return PRACTICE_COLORS.correct;
      if (isRevealed) return PRACTICE_COLORS.revealed;
      if (isWrong) return PRACTICE_COLORS.wrong;
    }
    if (isTajweedEnabled && item.tajweed) {
      const rule = item.tajweed[span.tIdx];
      if (rule) return TAJWEED_COLORS[rule];
    }
    return null;
  });

  if (!spanColors.some((c) => c !== null)) return null;

  const segments: WordColorSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < parsed.spans.length; i++) {
    const span = parsed.spans[i];
    const color = spanColors[i];
    if (span.start > cursor) {
      const prefixText = parsed.wordText.slice(cursor, span.start);
      if (segments.length > 0 && segments[segments.length - 1].color === null) {
        segments[segments.length - 1].text += prefixText;
      } else {
        segments.push({ text: prefixText, color: null });
      }
    }
    const piece = parsed.wordText.slice(span.start, span.end);
    if (segments.length > 0 && segments[segments.length - 1].color === color) {
      segments[segments.length - 1].text += piece;
    } else {
      segments.push({ text: piece, color });
    }
    cursor = span.end;
  }
  if (cursor < parsed.wordText.length) {
    const tail = parsed.wordText.slice(cursor);
    if (segments.length > 0 && segments[segments.length - 1].color === null) {
      segments[segments.length - 1].text += tail;
    } else {
      segments.push({ text: tail, color: null });
    }
  }
  return segments;
}

function kashidaMapsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

// Bounded session caches to eliminate repeated tatweel probes & kashida recalculations across page flips
const MAX_TATWEEL_CACHE = 160;
const tatweelWidthCache = new Map<string, number>();

const MAX_KASHIDA_CACHE = 1800;
const kashidaDistributionCache = new Map<string, Record<string, number>>();

function getCachedKashida(sig: string): Record<string, number> | undefined {
  const hit = kashidaDistributionCache.get(sig);
  if (hit) {
    // Refresh LRU order
    kashidaDistributionCache.delete(sig);
    kashidaDistributionCache.set(sig, hit);
  }
  return hit;
}

function setCachedKashida(sig: string, counts: Record<string, number>): void {
  if (kashidaDistributionCache.size >= MAX_KASHIDA_CACHE) {
    const oldestKey = kashidaDistributionCache.keys().next().value;
    if (oldestKey !== undefined) kashidaDistributionCache.delete(oldestKey);
  }
  kashidaDistributionCache.set(sig, counts);
}

// Global CSS Custom Highlight registry across mounted MushafLineRow instances
type HighlightRegistryLike = {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
};

type HighlightConstructorLike = new (...ranges: Range[]) => unknown;

interface RowHighlightBucket {
  correct: Range[];
  revealed: Range[];
  wrong: Range[];
  maddLong: Range[];
  ghunnah: Range[];
  qalqalah: Range[];
  idgham: Range[];
}

const rowBuckets = new Map<number, RowHighlightBucket>();
let nextRowId = 1;

const HIGHLIGHT_NAME_PAIRS: Array<[keyof RowHighlightBucket, string]> = [
  ['correct', 'mushaf-correct'],
  ['revealed', 'mushaf-revealed'],
  ['wrong', 'mushaf-wrong'],
  ['maddLong', 'tajweed-maddLong'],
  ['ghunnah', 'tajweed-ghunnah'],
  ['qalqalah', 'tajweed-qalqalah'],
  ['idgham', 'tajweed-idgham'],
];

function syncGlobalCssHighlights() {
  if (typeof CSS === 'undefined' || typeof window === 'undefined') return;
  const cssWithHighlights = CSS as unknown as { highlights?: HighlightRegistryLike };
  const HighlightCtor = (window as unknown as { Highlight?: HighlightConstructorLike }).Highlight;
  if (!cssWithHighlights.highlights || !HighlightCtor) return;

  for (const [bucketKey, cssName] of HIGHLIGHT_NAME_PAIRS) {
    const collected: Range[] = [];
    rowBuckets.forEach((bucket) => {
      const list = bucket[bucketKey];
      if (list.length) collected.push(...list);
    });
    if (collected.length) {
      cssWithHighlights.highlights.set(cssName, new HighlightCtor(...collected));
    } else {
      cssWithHighlights.highlights.delete(cssName);
    }
  }
}

export const AYAH_ROSETTE_SYMBOL_ID = 'mushaf-ayah-rosette-symbol';

export const AyahRosetteSymbolDefs: React.FC = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={0}
    height={0}
    style={{
      position: 'absolute',
      width: 0,
      height: 0,
      overflow: 'hidden',
      pointerEvents: 'none',
    }}
  >
    <defs>
      <symbol id={AYAH_ROSETTE_SYMBOL_ID} viewBox="0 0 36 36" fill="none">
        <path
          d="M18 2L21.26 5.83L26 4.14L26.91 9.09L31.86 10L30.17 14.74L34 18L30.17 21.26L31.86 26L26.91 26.91L26 31.86L21.26 30.17L18 34L14.74 30.17L10 31.86L9.09 26.91L4.14 26L5.83 21.26L2 18L5.83 14.74L4.14 10L9.09 9.09L10 4.14L14.74 5.83Z"
          fill="rgba(255, 252, 245, 0.94)"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <circle
          cx="18"
          cy="18"
          r="10.8"
          stroke="currentColor"
          strokeWidth="1.05"
          opacity="0.6"
          fill="#FFFCF5"
        />
      </symbol>
    </defs>
  </svg>
);

// Single shared off-tree measurement probe reused across uniform font sizing and all line rows
let sharedHafsMeasureProbe: HTMLSpanElement | null = null;

export function getSharedHafsMeasureProbe(fontSizePx: number): HTMLSpanElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!sharedHafsMeasureProbe || !sharedHafsMeasureProbe.isConnected) {
    const el = document.createElement('span');
    el.setAttribute('aria-hidden', 'true');
    el.style.position = 'fixed';
    el.style.top = '-9999px';
    el.style.left = '-9999px';
    el.style.visibility = 'hidden';
    el.style.pointerEvents = 'none';
    el.style.contain = 'layout style';
    el.style.whiteSpace = 'nowrap';
    el.style.direction = 'rtl';
    el.style.fontFamily = "'UthmanicHafs', 'Amiri Quran', 'Amiri', serif";
    el.style.fontWeight = '400';
    el.style.lineHeight = '1.34';
    el.style.setProperty('-webkit-text-stroke', '0.24px currentColor');
    el.style.setProperty('paint-order', 'stroke fill');
    el.style.letterSpacing = '0';
    el.style.wordSpacing = '0';
    el.style.fontFeatureSettings = '"liga" 1, "calt" 1, "kern" 1, "curs" 1';
    el.style.fontVariantLigatures = 'normal';
    document.body.appendChild(el);
    sharedHafsMeasureProbe = el;
  }
  const fsStr = `${fontSizePx.toFixed(2)}px`;
  if (sharedHafsMeasureProbe.style.fontSize !== fsStr) {
    sharedHafsMeasureProbe.style.fontSize = fsStr;
  }
  return sharedHafsMeasureProbe;
}

// Fallback single shared ResizeObserver if a row is ever mounted without a parent page subscription
let sharedFallbackResizeObserver: ResizeObserver | null = null;
const sharedFallbackResizeCallbacks = new WeakMap<Element, (width: number) => void>();

function observeRowResizeFallback(el: Element, cb: (width: number) => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  if (!sharedFallbackResizeObserver) {
    sharedFallbackResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const handler = sharedFallbackResizeCallbacks.get(entry.target);
        if (handler) {
          handler(Math.round(entry.contentRect.width));
        }
      }
    });
  }
  sharedFallbackResizeCallbacks.set(el, cb);
  sharedFallbackResizeObserver.observe(el);
  return () => {
    sharedFallbackResizeCallbacks.delete(el);
    sharedFallbackResizeObserver?.unobserve(el);
  };
}

export const AyahRosette: React.FC<{
  ayahNum: number;
  toArabicDigits: (n: number | string) => string;
  isDimmed?: boolean;
  isFocused?: boolean;
  title?: string;
  onClick?: () => void;
}> = ({ ayahNum, toArabicDigits, isDimmed = false, isFocused = false, title, onClick }) => (
  <span
    className={`ayah-num ${isDimmed ? 'is-ayah-dimmed' : ''} ${isFocused ? 'is-ayah-focused' : ''} ${onClick ? 'is-clickable' : ''}`}
    aria-label={`نهاية الآية ${toArabicDigits(ayahNum)}`}
    title={title}
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onClick={onClick}
    onKeyDown={
      onClick
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick();
            }
          }
        : undefined
    }
  >
    <svg className="ayah-rosette-svg" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <use href={`#${AYAH_ROSETTE_SYMBOL_ID}`} />
    </svg>
    <span
      className={`ayah-num-digit ${
        ayahNum >= 100 ? 'is-triple' : ayahNum >= 10 ? 'is-double' : ''
      }`}
    >
      {toArabicDigits(ayahNum)}
    </span>
  </span>
);

export const MushafLineRow: React.FC<MushafLineRowProps> = React.memo(({
  items,
  isCentered,
  isPractice,
  isTajweedEnabled,
  correctMap,
  revealed,
  wrongKey,
  onLetterClick,
  toArabicDigits,
  zoomScale = 1,
  uniformFontSize = null,
  isFontSynced = true,
  focusedAyahKeys = null,
  isHifzHidden = false,
  revealedWordKeys,
  revealedAyahKeys,
  onWordAction,
  onAyahAction,
  subscribePageResize,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const wordTextRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const rowIdRef = useRef<number | null>(null);
  if (rowIdRef.current === null) {
    rowIdRef.current = nextRowId++;
  }

  const [kashidaState, setKashidaState] = useState<{
    sig: string;
    counts: Record<string, number>;
  }>({ sig: '', counts: {} });
  const [hlBoxesMap, setHlBoxesMap] = useState<Record<string, HighlightBox[]>>({});
  const fontsAlreadyLoaded =
    typeof document !== 'undefined' &&
    Boolean(document.fonts?.check?.('16px "UthmanicHafs"'));
  const fontsTickRef = useRef(fontsAlreadyLoaded ? 1 : 0);
  const [fontsTick, setFontsTick] = useState(fontsAlreadyLoaded ? 1 : 0);

  const itemsIdentity = useMemo(
    () => items.map((x) => x.keyPrefix).join('|'),
    [items]
  );

  const parsedWords = useMemo(() => {
    const map = new Map<string, ParsedWordData>();
    for (const item of items) {
      if (item.kind === 'word') {
        map.set(
          item.keyPrefix,
          buildParsedWord(item.keyPrefix, item.rawWord, item.tokens, kashidaState.counts)
        );
      }
    }
    return map;
  }, [items, kashidaState.counts]);

  const computeHighlights = useCallback(() => {
    const rowId = rowIdRef.current!;

    if (IS_BLINK_ENGINE) {
      if (rowBuckets.has(rowId)) {
        rowBuckets.delete(rowId);
        syncGlobalCssHighlights();
      }
      if (!isPractice) {
        setHlBoxesMap((prev) => (Object.keys(prev).length === 0 ? prev : {}));
        return;
      }

      const nextBoxes: Record<string, HighlightBox[]> = {};
      for (const item of items) {
        if (item.kind !== 'word') continue;
        const wordAyahKey = `${item.surahId}:${item.ayahNum}`;
        const isHiddenWord = Boolean(
          isHifzHidden && !revealedWordKeys?.[item.keyPrefix] && !revealedAyahKeys?.[wordAyahKey]
        );
        if (isHiddenWord) continue;
        const parsed = parsedWords.get(item.keyPrefix);
        const wordTextEl = wordTextRefs.current[item.keyPrefix];
        const wordContainerEl = wordTextEl?.parentElement;
        if (!parsed || !wordTextEl || !wordContainerEl) continue;

        const activePracticeSpans: Array<{ span: WordTokenSpan; kind: HighlightKind; key: string }> = [];
        for (const span of parsed.spans) {
          const letterKey = `${item.keyPrefix}_${span.tIdx}`;
          const isCorrect = !!correctMap[letterKey];
          const isRevealed = revealed && span.token.isTarget && !isCorrect;
          const isWrong = wrongKey === letterKey;

          if (isCorrect) {
            activePracticeSpans.push({ span, kind: 'correct', key: letterKey });
          } else if (isRevealed) {
            activePracticeSpans.push({ span, kind: 'revealed', key: letterKey });
          } else if (isWrong) {
            activePracticeSpans.push({ span, kind: 'wrong', key: letterKey });
          }
        }

        if (activePracticeSpans.length === 0) continue;

        const wordRect = wordContainerEl.getBoundingClientRect();
        const boxes: HighlightBox[] = [];
        for (const { span, kind, key } of activePracticeSpans) {
          const range = createWordTextRange(wordTextEl, span.start, span.end);
          if (!range) continue;
          const clientRects = range.getClientRects();
          const rect = clientRects.length > 0 ? clientRects[0] : range.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && wordRect.width > 0) {
            const padX = Math.max(1.5, rect.width * 0.06);
            boxes.push({
              key,
              kind,
              left: rect.left - wordRect.left - padX,
              top: rect.top - wordRect.top + rect.height * 0.1,
              width: rect.width + padX * 2,
              height: rect.height * 0.8,
            });
          }
        }
        if (boxes.length > 0) {
          nextBoxes[item.keyPrefix] = boxes;
        }
      }

      setHlBoxesMap((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(nextBoxes);
        if (prevKeys.length === 0 && nextKeys.length === 0) return prev;
        if (
          prevKeys.length === nextKeys.length &&
          nextKeys.every((k) => {
            const a = prev[k];
            const b = nextBoxes[k];
            if (!a || !b || a.length !== b.length) return false;
            return a.every(
              (x, idx) =>
                x.key === b[idx].key &&
                x.kind === b[idx].kind &&
                Math.abs(x.left - b[idx].left) < 0.5 &&
                Math.abs(x.width - b[idx].width) < 0.5
            );
          })
        ) {
          return prev;
        }
        return nextBoxes;
      });
      return;
    }

    if (!isPractice && !isTajweedEnabled) {
      rowBuckets.delete(rowId);
      syncGlobalCssHighlights();
      setHlBoxesMap((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    const bucket: RowHighlightBucket = {
      correct: [],
      revealed: [],
      wrong: [],
      maddLong: [],
      ghunnah: [],
      qalqalah: [],
      idgham: [],
    };
    const nextBoxes: Record<string, HighlightBox[]> = {};

    for (const item of items) {
      if (item.kind !== 'word') continue;
      const wordAyahKey = `${item.surahId}:${item.ayahNum}`;
      const isHiddenWord = Boolean(
        isHifzHidden && !revealedWordKeys?.[item.keyPrefix] && !revealedAyahKeys?.[wordAyahKey]
      );
      if (isHiddenWord) continue;
      const parsed = parsedWords.get(item.keyPrefix);
      const wordTextEl = wordTextRefs.current[item.keyPrefix];
      const wordContainerEl = wordTextEl?.parentElement;
      const textNode = wordTextEl?.firstChild;

      if (!parsed || !wordTextEl || !wordContainerEl || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
        continue;
      }

      const maxLen = textNode.textContent?.length ?? 0;
      const activePracticeSpans: Array<{ span: WordTokenSpan; kind: HighlightKind; key: string }> = [];

      for (const span of parsed.spans) {
        if (span.end > maxLen) continue;
        const letterKey = `${item.keyPrefix}_${span.tIdx}`;

        if (isPractice) {
          const isCorrect = !!correctMap[letterKey];
          const isRevealed = revealed && span.token.isTarget && !isCorrect;
          const isWrong = wrongKey === letterKey;

          if (isCorrect) {
            activePracticeSpans.push({ span, kind: 'correct', key: letterKey });
            continue;
          }
          if (isRevealed) {
            activePracticeSpans.push({ span, kind: 'revealed', key: letterKey });
            continue;
          }
          if (isWrong) {
            activePracticeSpans.push({ span, kind: 'wrong', key: letterKey });
            continue;
          }
        }

        if (isTajweedEnabled && item.tajweed) {
          const rule = item.tajweed[span.tIdx];
          if (rule) {
            const range = document.createRange();
            range.setStart(textNode, span.start);
            range.setEnd(textNode, span.end);
            bucket[rule].push(range);
          }
        }
      }

      if (activePracticeSpans.length === 0) continue;

      const wordRect = wordContainerEl.getBoundingClientRect();
      const boxes: HighlightBox[] = [];

      for (const { span, kind, key } of activePracticeSpans) {
        const range = document.createRange();
        range.setStart(textNode, span.start);
        range.setEnd(textNode, span.end);

        bucket[kind].push(range);

        const clientRects = range.getClientRects();
        const rect = clientRects.length > 0 ? clientRects[0] : range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && wordRect.width > 0) {
          const padX = Math.max(1.5, rect.width * 0.06);
          boxes.push({
            key,
            kind,
            left: rect.left - wordRect.left - padX,
            top: rect.top - wordRect.top + rect.height * 0.1,
            width: rect.width + padX * 2,
            height: rect.height * 0.8,
          });
        }
      }

      if (boxes.length > 0) {
        nextBoxes[item.keyPrefix] = boxes;
      }
    }

    rowBuckets.set(rowId, bucket);
    syncGlobalCssHighlights();

    setHlBoxesMap((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(nextBoxes);
      if (prevKeys.length === 0 && nextKeys.length === 0) return prev;
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((k) => {
          const a = prev[k];
          const b = nextBoxes[k];
          if (!a || !b || a.length !== b.length) return false;
          return a.every(
            (x, idx) =>
              x.key === b[idx].key &&
              x.kind === b[idx].kind &&
              Math.abs(x.left - b[idx].left) < 0.5 &&
              Math.abs(x.width - b[idx].width) < 0.5
          );
        })
      ) {
        return prev;
      }
      return nextBoxes;
    });
  }, [
    items,
    parsedWords,
    isPractice,
    isTajweedEnabled,
    correctMap,
    revealed,
    wrongKey,
    isHifzHidden,
    revealedWordKeys,
    revealedAyahKeys,
  ]);

  const fitLineRef = useRef<() => void>(() => {});
  const lastMeasuredWidthRef = useRef(0);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el || !isFontSynced) return;

    let cancelled = false;

    const fitLine = () => {
      if (cancelled || !rowRef.current) return;
      const node = rowRef.current;

      const BASE_GAP_EM = 0.12;
      const MAX_GAP_EM = 0.22;

      // Read layout dimensions BEFORE mutating inline styles to avoid read-after-write thrashing
      let available = node.clientWidth;
      lastMeasuredWidthRef.current = Math.round(available);
      const parentBody = node.parentElement;
      if (parentBody) {
        const pcs = getComputedStyle(parentBody);
        const parentInnerW =
          parentBody.clientWidth -
          (parseFloat(pcs.paddingLeft) || 0) -
          (parseFloat(pcs.paddingRight) || 0);
        if (parentInnerW > 0) {
          available = Math.min(available, parentInnerW);
        }
      }

      const targetFontSizeStr = uniformFontSize ? `${uniformFontSize.toFixed(2)}px` : '';
      if (node.style.fontSize !== targetFontSizeStr) {
        node.style.fontSize = targetFontSizeStr;
      }
      if (node.style.justifyContent !== 'center') {
        node.style.justifyContent = 'center';
      }
      const baseGapStr = `${BASE_GAP_EM}em`;
      if (node.style.gap !== baseGapStr) {
        node.style.gap = baseGapStr;
      }

      const base = uniformFontSize && uniformFontSize > 0
        ? uniformFontSize
        : parseFloat(getComputedStyle(node).fontSize);
      if (available <= 0 || base <= 0) {
        return;
      }

      const sig = `${itemsIdentity}:${Math.round(available)}:${Math.round(base * 10)}:${isCentered ? 1 : 0}:${fontsTick}:${Math.round(zoomScale * 100)}`;

      // Short-circuit immediately using cached kashida counts if available
      if (kashidaState.sig !== sig) {
        const cached = getCachedKashida(sig);
        if (cached) {
          if (!kashidaMapsEqual(kashidaState.counts, cached)) {
            setKashidaState({ sig, counts: cached });
            return;
          }
        }
      }

      const itemChildren = Array.from(node.children);
      const gapCount = Math.max(0, itemChildren.length - 1);
      const measureChildrenWidth = (useUnkashidaProbe: boolean): number => {
        const children = itemChildren;
        if (!useUnkashidaProbe || Object.keys(kashidaState.counts).length === 0) {
          let sum = 0;
          for (const child of children) {
            sum += child.getBoundingClientRect().width;
          }
          return sum + gapCount * base * BASE_GAP_EM;
        }

        const probe = getSharedHafsMeasureProbe(base);
        if (!probe) {
          let sum = 0;
          for (const child of children) {
            sum += child.getBoundingClientRect().width;
          }
          return sum + gapCount * base * BASE_GAP_EM;
        }

        let sum = 0;
        for (let idx = 0; idx < children.length; idx++) {
          const child = children[idx];
          const item = items[idx];
          if (item && item.kind === 'word') {
            const unKParsed = buildParsedWord(item.keyPrefix, item.rawWord, item.tokens, {});
            probe.textContent = unKParsed.wordText;
            sum += probe.getBoundingClientRect().width;
            child.querySelectorAll('.mushaf-symbol').forEach((symEl) => {
              sum += symEl.getBoundingClientRect().width + 4;
            });
            const rosetteChild = child.querySelector('.ayah-num');
            if (rosetteChild) {
              sum += rosetteChild.getBoundingClientRect().width + base * 0.08;
            }
          } else {
            sum += child.getBoundingClientRect().width;
          }
        }
        return sum + Math.max(0, items.length - 1) * base * BASE_GAP_EM;
      };

      const measureTatweelWidth = (): number => {
        const twKey = `${base.toFixed(2)}:${fontsTick}`;
        const cachedTw = tatweelWidthCache.get(twKey);
        if (cachedTw !== undefined) return cachedTw;

        const probe = getSharedHafsMeasureProbe(base);
        if (!probe) return base * 0.22;

        probe.textContent = 'بب';
        const w0 = probe.getBoundingClientRect().width;
        probe.textContent = 'ب\u0640\u0640\u0640ب';
        const w3 = probe.getBoundingClientRect().width;
        const result = Math.max(base * 0.22, (w3 - w0) / 3);
        if (fontsTick > 0) {
          if (tatweelWidthCache.size >= MAX_TATWEEL_CACHE) {
            const oldest = tatweelWidthCache.keys().next().value;
            if (oldest !== undefined) tatweelWidthCache.delete(oldest);
          }
          tatweelWidthCache.set(twKey, result);
        }
        return result;
      };

      if (isCentered) {
        if (kashidaState.sig !== sig || Object.keys(kashidaState.counts).length > 0) {
          setCachedKashida(sig, {});
          setKashidaState({ sig, counts: {} });
          return;
        }
        const contentW = measureChildrenWidth(false);
        if (contentW > available + 0.5) {
          const nextSize = Math.max(8, base * (available / contentW) * 0.99);
          node.style.fontSize = `${nextSize.toFixed(2)}px`;
        }
        node.style.justifyContent = 'center';
        node.style.gap = '0.16em';
        return;
      }

      // Compute kashidas once per [items, availableWidth, baseFontSize, fontsLoaded] signature
      if (kashidaState.sig !== sig) {
        const tatweelWidth = measureTatweelWidth();
        const unKWidth = measureChildrenWidth(true);
        const slack = available - unKWidth;

        if (unKWidth > available + 0.5) {
          setCachedKashida(sig, {});
          setKashidaState({ sig, counts: {} });
          return;
        }

        // Reserve minimal gap flexibility (~0.02em per gap) and absorb the rest via kashidas
        const gapReserve = Math.min(slack * 0.15, gapCount * base * 0.02);
        const kashidaSlack = Math.max(0, slack - gapReserve);
        const maxSafeKashidaPx = available * 0.58;
        const usableSlack = Math.min(kashidaSlack, maxSafeKashidaPx);
        const neededTatweels =
          tatweelWidth > 0 && usableSlack > tatweelWidth * 0.85
            ? Math.floor(Math.max(0, usableSlack - tatweelWidth * 0.25) / tatweelWidth)
            : 0;

        const nextCounts = distributeKashidas(items, neededTatweels);
        setCachedKashida(sig, nextCounts);
        if (kashidaState.sig !== sig || !kashidaMapsEqual(kashidaState.counts, nextCounts)) {
          setKashidaState({ sig, counts: nextCounts });
          return;
        }
      }

      // Final layout alignment with applied kashidas
      const renderedContentW = measureChildrenWidth(false);
      if (renderedContentW > available + 0.5 || node.scrollWidth > available + 0.5) {
        // If kashida insertion un-stacked an UthmanicHafs ligature and overshot width,
        // reduce kashidas first so all lines on the page keep the exact same uniform font size.
        const totalApplied = Object.values(kashidaState.counts).reduce((sum, n) => sum + n, 0);
        if (totalApplied > 0) {
          const overshoot = Math.max(renderedContentW, node.scrollWidth) - available;
          const tatweelWidth = measureTatweelWidth();
          const dropCount = Math.max(1, Math.ceil((overshoot + 2) / Math.max(4, tatweelWidth)));
          const nextTotal = Math.max(0, totalApplied - dropCount);
          const nextCounts = nextTotal > 0 ? distributeKashidas(items, nextTotal) : {};
          const actualNextTotal = Object.values(nextCounts).reduce((sum, n) => sum + n, 0);
          if (actualNextTotal < totalApplied && !kashidaMapsEqual(kashidaState.counts, nextCounts)) {
            setCachedKashida(sig, nextCounts);
            setKashidaState({ sig, counts: nextCounts });
            return;
          }
        }

        const actualNeed = Math.max(renderedContentW, node.scrollWidth);
        const nextSize = Math.max(8, base * (available / actualNeed) * 0.992);
        node.style.fontSize = `${nextSize.toFixed(2)}px`;
        node.style.justifyContent = 'space-between';
        node.style.gap = '0.13em';
      } else {
        const remainingSlack = Math.max(0, available - renderedContentW);
        const maxAllowedSlack = gapCount * base * (MAX_GAP_EM - BASE_GAP_EM);
        if (gapCount >= 1 && remainingSlack <= maxAllowedSlack + 2) {
          node.style.justifyContent = 'space-between';
          node.style.gap = `${BASE_GAP_EM}em`;
        } else {
          node.style.justifyContent = 'center';
          node.style.gap = '0.17em';
        }
      }
    };

    fitLineRef.current = fitLine;
    fitLine();

    return () => {
      cancelled = true;
    };
  }, [items, itemsIdentity, isCentered, kashidaState, fontsTick, zoomScale, uniformFontSize, isFontSynced]);

  // Separate effect for practice/CSS highlights so Hifz reveals and Focus transitions never trigger line re-measurement
  useLayoutEffect(() => {
    if (!isFontSynced) return;
    computeHighlights();
  }, [computeHighlights, isFontSynced, kashidaState, uniformFontSize]);

  useEffect(() => {
    const rowId = rowIdRef.current!;
    return () => {
      rowBuckets.delete(rowId);
      syncGlobalCssHighlights();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (typeof document !== 'undefined' && document.fonts) {
      const markReady = () => {
        if (!cancelled && fontsTickRef.current === 0) {
          fontsTickRef.current = 1;
          setFontsTick(1);
        }
      };

      const loadHafs =
        typeof document.fonts.load === 'function'
          ? document.fonts.load('16px "UthmanicHafs"').catch(() => undefined)
          : Promise.resolve();

      Promise.all([loadHafs, document.fonts.ready]).then(markReady);
    }

    const el = rowRef.current;
    if (!el) {
      return () => {
        cancelled = true;
      };
    }

    lastMeasuredWidthRef.current = Math.round(el.clientWidth);

    if (subscribePageResize) {
      const unsubscribe = subscribePageResize(() => {
        if (cancelled || !rowRef.current) return;
        const nextWidth = Math.round(rowRef.current.clientWidth);
        if (nextWidth <= 0 || nextWidth === lastMeasuredWidthRef.current) return;
        lastMeasuredWidthRef.current = nextWidth;
        fitLineRef.current();
      });
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }

    let rafId = 0;
    const unobserve = observeRowResizeFallback(el, (observedWidth) => {
      const nextWidth = observedWidth > 0 ? observedWidth : Math.round(el.clientWidth);
      if (nextWidth <= 0 || nextWidth === lastMeasuredWidthRef.current) return;
      lastMeasuredWidthRef.current = nextWidth;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (!cancelled) {
          fitLineRef.current();
        }
      });
    });

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      unobserve();
    };
  }, [subscribePageResize]);

  const handleWordClick = (
    e: React.MouseEvent<HTMLSpanElement>,
    keyPrefix: string,
    parsed: ParsedWordData
  ) => {
    if (!isPractice) return;
    const textEl = e.currentTarget;
    if (parsed.spans.length === 0) return;

    const clickX = e.clientX;
    let bestSpan: WordTokenSpan | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const span of parsed.spans) {
      const range = createWordTextRange(textEl, span.start, span.end);
      if (!range) continue;
      const rects = range.getClientRects();
      const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
      if (rect.width <= 0) continue;

      if (clickX >= rect.left - 1 && clickX <= rect.right + 1) {
        bestSpan = span;
        break;
      }

      const center = (rect.left + rect.right) / 2;
      const dist = Math.abs(clickX - center);
      if (dist < bestDist) {
        bestDist = dist;
        bestSpan = span;
      }
    }

    if (bestSpan) {
      onLetterClick(bestSpan.token, `${keyPrefix}_${bestSpan.tIdx}`);
    }
  };

  return (
    <div
      ref={rowRef}
      className={`mushaf-line-row ${isCentered ? 'is-centered' : 'is-justified'}`}
      dir="rtl"
    >
      {items.map((item, itemIdx) => {
        const hasFocusSelection = Boolean(focusedAyahKeys && focusedAyahKeys.size > 0);
        const focusCount = focusedAyahKeys ? focusedAyahKeys.size : 0;

        if (item.kind === 'rosette') {
          const rKey = `${item.surahId}:${item.ayahNum}`;
          const isRosetteFocused = Boolean(hasFocusSelection && focusedAyahKeys!.has(rKey));
          const isRosetteDimmed = Boolean(hasFocusSelection && !isRosetteFocused);
          return (
            <AyahRosette
              key={`${item.keyPrefix}_${itemIdx}`}
              ayahNum={item.ayahNum}
              toArabicDigits={toArabicDigits}
              isDimmed={isRosetteDimmed}
              isFocused={isRosetteFocused}
              title={
                isHifzHidden
                  ? 'اضغط لكشف أو إخفاء الآية كاملة'
                  : hasFocusSelection
                  ? isRosetteFocused
                    ? focusCount > 1
                      ? 'اضغط لإزالة هذه الآية من التركيز'
                      : 'آية في وضع التركيز'
                    : 'اضغط لإضافة هذه الآية إلى التركيز'
                  : undefined
              }
              onClick={onAyahAction ? () => onAyahAction(item.surahId, item.ayahNum) : undefined}
            />
          );
        }

        const parsed =
          parsedWords.get(item.keyPrefix) ??
          buildParsedWord(item.keyPrefix, item.rawWord, item.tokens, kashidaState.counts);
        const wordAyahKey = `${item.surahId}:${item.ayahNum}`;
        const isWordFocused = Boolean(hasFocusSelection && focusedAyahKeys!.has(wordAyahKey));
        const isWordDimmed = Boolean(hasFocusSelection && !isWordFocused);
        const isWordHidden = Boolean(
          isHifzHidden && !revealedWordKeys?.[item.keyPrefix] && !revealedAyahKeys?.[wordAyahKey]
        );
        const isWordRevealedInHifz = Boolean(isHifzHidden && !isWordHidden);
        const boxes = isPractice && !isWordHidden ? hlBoxesMap[item.keyPrefix] : undefined;
        const colorSegments =
          IS_BLINK_ENGINE && !isWordHidden
            ? buildWordColorSegments(
                parsed,
                item,
                isPractice,
                isTajweedEnabled,
                correctMap,
                revealed,
                wrongKey
              )
            : null;

        return (
          <span key={`${item.keyPrefix}_${itemIdx}`} className="mushaf-word-cluster">
            <span
              data-ayah-key={wordAyahKey}
              className={`mushaf-word ${isWordFocused ? 'is-ayah-focused' : ''} ${
                isWordDimmed ? 'is-ayah-dimmed' : ''
              } ${isWordHidden ? 'is-hifz-hidden' : ''} ${
                isWordRevealedInHifz ? 'is-hifz-revealed' : ''
              } ${onWordAction ? 'is-teacher-interactive' : ''}`}
              title={
                isWordHidden
                  ? 'اضغط لكشف الكلمة'
                  : isWordRevealedInHifz
                  ? 'اضغط لإعادة إخفاء الكلمة'
                  : hasFocusSelection
                  ? isWordFocused
                    ? focusCount > 1
                      ? 'اضغط لإزالة هذه الآية من التركيز'
                      : undefined
                    : 'اضغط لإضافة هذه الآية إلى التركيز'
                  : undefined
              }
              onClick={onWordAction ? () => onWordAction(item) : undefined}
            >
              {parsed.leadingSymbols && (
                <span className="mushaf-symbol" aria-hidden="true">
                  {parsed.leadingSymbols}
                </span>
              )}
              <span
                ref={(node) => {
                  wordTextRefs.current[item.keyPrefix] = node;
                }}
                className="mushaf-word-text"
                onClick={
                  !onWordAction && isPractice
                    ? (e) => handleWordClick(e, item.keyPrefix, parsed)
                    : undefined
                }
              >
                {colorSegments
                  ? colorSegments.map((seg, sIdx) =>
                      seg.color ? (
                        <span key={sIdx} style={{ color: seg.color }}>
                          {seg.text}
                        </span>
                      ) : (
                        <React.Fragment key={sIdx}>{seg.text}</React.Fragment>
                      )
                    )
                  : parsed.wordText}
              </span>
              {parsed.trailingSymbols && (
                <span className="mushaf-symbol" aria-hidden="true">
                  {parsed.trailingSymbols}
                </span>
              )}
              {boxes?.map((b) => (
                <span
                  key={b.key}
                  aria-hidden="true"
                  className={`mushaf-letter-hl is-${b.kind}`}
                  style={{
                    left: `${b.left.toFixed(1)}px`,
                    top: `${b.top.toFixed(1)}px`,
                    width: `${b.width.toFixed(1)}px`,
                    height: `${b.height.toFixed(1)}px`,
                  }}
                />
              ))}
            </span>
            {item.ayahEnd !== null && (
              <AyahRosette
                ayahNum={item.ayahEnd}
                toArabicDigits={toArabicDigits}
                isDimmed={isWordDimmed}
                isFocused={isWordFocused}
                title={
                  isHifzHidden
                    ? 'اضغط لكشف أو إخفاء الآية كاملة'
                    : hasFocusSelection
                    ? isWordFocused
                      ? focusCount > 1
                        ? 'اضغط لإزالة هذه الآية من التركيز'
                        : 'آية في وضع التركيز'
                      : 'اضغط لإضافة هذه الآية إلى التركيز'
                    : undefined
                }
                onClick={onAyahAction ? () => onAyahAction(item.surahId, item.ayahEnd!) : undefined}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}, (prev, next) => {
  if (
    prev.items !== next.items ||
    prev.isCentered !== next.isCentered ||
    prev.isPractice !== next.isPractice ||
    prev.isTajweedEnabled !== next.isTajweedEnabled ||
    prev.revealed !== next.revealed ||
    prev.onLetterClick !== next.onLetterClick ||
    prev.toArabicDigits !== next.toArabicDigits ||
    prev.zoomScale !== next.zoomScale ||
    prev.uniformFontSize !== next.uniformFontSize ||
    prev.isFontSynced !== next.isFontSynced ||
    prev.isHifzHidden !== next.isHifzHidden ||
    prev.onWordAction !== next.onWordAction ||
    prev.onAyahAction !== next.onAyahAction ||
    prev.subscribePageResize !== next.subscribePageResize
  ) {
    return false;
  }

  // Practice-mode state only invalidates rows that actually contain changed/wrong keys
  if (prev.isPractice) {
    if (prev.correctMap !== next.correctMap) return false;
    if (prev.wrongKey !== next.wrongKey) {
      const touchesRow = next.items.some(
        (it) =>
          it.kind === 'word' &&
          ((prev.wrongKey && prev.wrongKey.startsWith(`${it.keyPrefix}_`)) ||
            (next.wrongKey && next.wrongKey.startsWith(`${it.keyPrefix}_`)))
      );
      if (touchesRow) return false;
    }
  }

  // Focus state only matters if focus selection changed for any ayah on this row or multi-focus count toggled
  if (prev.focusedAyahKeys !== next.focusedAyahKeys) {
    const prevSize = prev.focusedAyahKeys?.size ?? 0;
    const nextSize = next.focusedAyahKeys?.size ?? 0;
    if ((prevSize === 0) !== (nextSize === 0)) return false;
    if ((prevSize > 1) !== (nextSize > 1)) return false;
    const ayahFocusChanged = next.items.some((it) => {
      const k = `${it.surahId}:${it.ayahNum}`;
      return Boolean(prev.focusedAyahKeys?.has(k)) !== Boolean(next.focusedAyahKeys?.has(k));
    });
    if (ayahFocusChanged) return false;
  }

  // Hifz state only re-renders rows whose words/ayahs actually toggled reveal state
  if (next.isHifzHidden && (prev.revealedWordKeys !== next.revealedWordKeys || prev.revealedAyahKeys !== next.revealedAyahKeys)) {
    const hifzChanged = next.items.some((it) => {
      const aKey = `${it.surahId}:${it.ayahNum}`;
      if (Boolean(prev.revealedAyahKeys?.[aKey]) !== Boolean(next.revealedAyahKeys?.[aKey])) {
        return true;
      }
      if (it.kind === 'word' && Boolean(prev.revealedWordKeys?.[it.keyPrefix]) !== Boolean(next.revealedWordKeys?.[it.keyPrefix])) {
        return true;
      }
      return false;
    });
    if (hifzChanged) return false;
  }

  return true;
});
