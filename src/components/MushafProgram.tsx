import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  BookMarked,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  ListChecks,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  Pin,
  PinOff,
  Plus,
  ScanEye,
  SlidersHorizontal,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  AyahRosette,
  AyahRosetteSymbolDefs,
  getSharedHafsMeasureProbe,
  MushafLineRow,
  type MushafLetterUnit,
  type MushafLineItem,
} from './MushafLineRow';
import { AnnotationSurface, useAnnotationActions } from './annotation';
import { analyzeWordTajweed, TAJWEED_COLORS, TAJWEED_LEGEND } from '../utils/tajweedRules';
import {
  DIACRITIC_RE,
  INITIAL_MUSHAF_SURAHS,
  TOTAL_MUSHAF_PAGES,
  toArabicDigits,
  tokenizeMushafText,
  type MushafDataset,
  type MushafRawPage,
  type MushafSurahMeta,
  type TokenizedMushafPage,
  type TokenizedMushafRow,
} from '../utils/mushafData';

export interface MushafPracticeConfig {
  targetLetters: string[];
  targetLabel: string;
  hitMessage?: string;
  missMessage?: string;
  completeSingleMessage?: string;
  onPracticeComplete?: () => void;
}

export interface MushafProgramProps {
  variant?: 'standalone' | 'embedded';
  initialPage?: number;
  initialTajweed?: boolean;
  isPresentationMode?: boolean;
  onTogglePresentationMode?: () => void;
  practiceConfig?: MushafPracticeConfig;
  onPlayChime?: (success: boolean) => void;
  onTriggerConfetti?: () => void;
}

const MUSHAF_BASE_SCALE = 1.3;
const MUSHAF_ZOOM_STEPS = [0.75, 0.85, 1, 1.15, 1.3] as const;
const MUSHAF_ZOOM_PRESETS: Record<
  (typeof MUSHAF_ZOOM_STEPS)[number],
  { capPx: number; slotPct: number; mobilePct: number }
> = {
  0.75: { capPx: 960, slotPct: 68, mobilePct: 82 },
  0.85: { capPx: 1120, slotPct: 77, mobilePct: 89 },
  1: { capPx: 1300, slotPct: 86, mobilePct: 95 },
  1.15: { capPx: 1460, slotPct: 93, mobilePct: 98 },
  1.3: { capPx: 1620, slotPct: 100, mobilePct: 100 },
};
const BOOKMARKS_STORAGE_KEY = 'talakah_mushaf_bookmarks_v1';

// Module-level caches for instant re-entry, zero-stall page flipping, and cached font shaping widths
let cachedMushafDataset: MushafDataset | null = null;
let cachedMushafDatasetPromise: Promise<MushafDataset | null> | null = null;

function loadMushafDatasetCached(): Promise<MushafDataset | null> {
  if (cachedMushafDataset) return Promise.resolve(cachedMushafDataset);
  if (!cachedMushafDatasetPromise) {
    cachedMushafDatasetPromise = fetch('/data/mushaf_pages_v18.json')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load Mushaf dataset'))))
      .then((data: MushafDataset) => {
        if (
          data &&
          Array.isArray(data.surahs) &&
          Array.isArray(data.pages) &&
          data.pages.length === TOTAL_MUSHAF_PAGES
        ) {
          cachedMushafDataset = data;
          return data;
        }
        return null;
      })
      .catch(() => {
        cachedMushafDatasetPromise = null;
        return null;
      });
  }
  return cachedMushafDatasetPromise;
}

const MAX_TOKENIZED_PAGE_CACHE = 120;
const tokenizedPageCache = new Map<string, TokenizedMushafPage>();

const MAX_PROBE_WORD_CACHE = 6000;
const probeWordWidthCache = new Map<string, number>();

const MAX_UNIFORM_FS_CACHE = 800;
const uniformFontSizeCache = new Map<string, number>();

function computeAndCacheUniformFontSize(
  pageData: TokenizedMushafPage,
  pageNum: number,
  availableWidth: number,
  bodyHeight: number,
  fontsReadyTick: number
): number {
  const isOpeningSpread = pageNum <= 2;
  const rowCount = isOpeningSpread ? 8 : 15;
  const rowHeight = bodyHeight > 0 ? bodyHeight / rowCount : 0;
  const fsCacheKey = `${pageNum}:${Math.round(availableWidth)}:${Math.round(rowHeight)}:${fontsReadyTick}`;

  if (fontsReadyTick > 0) {
    const cachedSize = uniformFontSizeCache.get(fsCacheKey);
    if (cachedSize !== undefined) {
      return cachedSize;
    }
  }

  const REF_FONT_PX = 40;
  const canUseWordCache = fontsReadyTick > 0;
  const probeEl = getSharedHafsMeasureProbe(REF_FONT_PX);

  const measureTextAtRef = (text: string): number => {
    if (canUseWordCache) {
      const hit = probeWordWidthCache.get(text);
      if (hit !== undefined) return hit;
    }
    if (!probeEl) return 0;
    probeEl.textContent = text;
    const w = probeEl.getBoundingClientRect().width;
    if (canUseWordCache && w > 0) {
      if (probeWordWidthCache.size >= MAX_PROBE_WORD_CACHE) {
        const oldest = probeWordWidthCache.keys().next().value;
        if (oldest !== undefined) probeWordWidthCache.delete(oldest);
      }
      probeWordWidthCache.set(text, w);
    }
    return w;
  };

  let minRowFit = Number.POSITIVE_INFINITY;

  for (const row of pageData.rows) {
    if (row.kind === 'basmalah') {
      const basmalahW = measureTextAtRef('بِسۡ\u0640\u0640\u0640مِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِي\u0640\u0640\u0640مِ');
      if (basmalahW > 0) {
        minRowFit = Math.min(minRowFit, REF_FONT_PX * (availableWidth / basmalahW));
      }
      continue;
    }

    if (row.kind !== 'text' || row.items.length === 0) continue;

    let scalableW = 0;
    let fixedW = 0;

    for (const item of row.items) {
      if (item.kind === 'rosette') {
        scalableW += REF_FONT_PX * 0.88;
        continue;
      }

      let wordText = '';
      let leadingSymbols = '';
      let trailingSymbols = '';
      let seenLetter = false;
      for (const token of item.tokens) {
        if (token.type === 'symbol') {
          if (!seenLetter) {
            leadingSymbols += token.base + token.extra;
          } else {
            trailingSymbols += token.base + token.extra;
          }
        } else {
          seenLetter = true;
          wordText += token.base + token.extra;
        }
      }
      if (!wordText && !leadingSymbols && !trailingSymbols) {
        wordText = item.rawWord;
      }

      if (leadingSymbols) {
        scalableW += measureTextAtRef(leadingSymbols);
        fixedW += 4;
      }
      if (wordText) {
        scalableW += measureTextAtRef(wordText);
      }
      if (trailingSymbols) {
        scalableW += measureTextAtRef(trailingSymbols);
        fixedW += 4;
      }
      if (item.ayahEnd !== null) {
        scalableW += REF_FONT_PX * (0.88 + 0.08);
      }
    }

    const gapEm = row.isCentered ? 0.16 : 0.14;
    scalableW += Math.max(0, row.items.length - 1) * REF_FONT_PX * gapEm;

    if (scalableW > 0) {
      const usableW = Math.max(1, availableWidth - fixedW);
      minRowFit = Math.min(minRowFit, REF_FONT_PX * (usableW / scalableW));
    }
  }

  const maxByWidthRatio = availableWidth * (isOpeningSpread ? 0.055 : 0.0455);
  const maxByHeight = rowHeight > 0 ? rowHeight * (isOpeningSpread ? 0.57 : 0.62) : maxByWidthRatio;
  const safeWidthScale = availableWidth > 16 ? (availableWidth - 4) / availableWidth : 1;
  const fitByWidth = Number.isFinite(minRowFit)
    ? minRowFit * safeWidthScale * 0.972
    : maxByWidthRatio;
  const computedSize = Math.max(
    8,
    Number(Math.min(fitByWidth, maxByHeight, maxByWidthRatio).toFixed(2))
  );

  if (canUseWordCache) {
    if (uniformFontSizeCache.size >= MAX_UNIFORM_FS_CACHE) {
      const oldest = uniformFontSizeCache.keys().next().value;
      if (oldest !== undefined) uniformFontSizeCache.delete(oldest);
    }
    uniformFontSizeCache.set(fsCacheKey, computedSize);
  }

  return computedSize;
}

interface MushafBookmark {
  id: string;
  pageNum: number;
  surahName: string;
  surahId?: number;
  ayahNum?: number;
  focusedKeys?: string[];
  label: string;
  createdAt: number;
}

function loadSavedBookmarks(): MushafBookmark[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const MushafProgram: React.FC<MushafProgramProps> = ({
  variant = 'standalone',
  initialPage = 1,
  initialTajweed = true,
  isPresentationMode = false,
  onTogglePresentationMode,
  practiceConfig,
  onPlayChime,
  onTriggerConfetti,
}) => {
  const hasPractice = !!practiceConfig && practiceConfig.targetLetters.length > 0;
  const targetLetters = practiceConfig?.targetLetters ?? [];
  const targetLettersKey = targetLetters.join(',');

  const [mushafDataset, setMushafDataset] = useState<MushafDataset | null>(() => cachedMushafDataset);
  const [selectedSurah, setSelectedSurah] = useState('الفاتحة');
  const [currentMushafPage, setCurrentMushafPage] = useState(initialPage);
  const [mushafMode, setMushafMode] = useState<'practice' | 'reading'>(
    hasPractice ? 'practice' : 'reading'
  );
  const [mushafTajweed, setMushafTajweed] = useState(initialTajweed);
  const [surahCorrectMap, setSurahCorrectMap] = useState<Record<string, boolean>>({});
  const [surahRevealed, setSurahRevealed] = useState(false);
  const [surahStatus, setSurahStatus] = useState<{ msg: string; kind: 'ok' | 'bad' | null }>({
    msg: '',
    kind: null,
  });
  const [surahWrongKey, setSurahWrongKey] = useState<string | null>(null);
  const [mushafZoom, setMushafZoom] = useState<number>(1);
  const [pageTurn, setPageTurn] = useState<{ dir: 'next' | 'prev'; seq: number } | null>(null);
  const turnSeqRef = useRef(0);
  const pageBodyRef = useRef<HTMLDivElement>(null);
  const [uniformFontState, setUniformFontState] = useState<{
    pageNum: number;
    zoomKey: number;
    size: number;
  } | null>(null);
  const [fontsReadyTick, setFontsReadyTick] = useState(() =>
    typeof document !== 'undefined' && Boolean(document.fonts?.check?.('16px "UthmanicHafs"')) ? 1 : 0
  );

  // Interactive online teacher tools (Focus, Hifz, Bookmarks; drawing lives in global floating palette)
  const { setActiveTool: setAnnotationTool } = useAnnotationActions();
  const [isTeacherDockOpen, setIsTeacherDockOpen] = useState(false);
  const [isScrolledPastToolbar, setIsScrolledPastToolbar] = useState(false);
  const [isFloatingHudOpen, setIsFloatingHudOpen] = useState(false);
  const [isFloatingPinned, setIsFloatingPinned] = useState(false);
  const [reservedHudHeight, setReservedHudHeight] = useState(0);
  const [floatingHudWidth, setFloatingHudWidth] = useState(0);
  const hudSlotRef = useRef<HTMLDivElement>(null);
  const hudBoxRef = useRef<HTMLDivElement>(null);
  const hudSentinelRef = useRef<HTMLDivElement>(null);
  const lensStageRef = useRef<HTMLDivElement>(null);
  const pendingScrollAyahRef = useRef<string | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isFocusLensOpen, setIsFocusLensOpen] = useState(false);
  const [focusedAyahKeys, setFocusedAyahKeys] = useState<string[]>([]);
  const [isFocusPickerOpen, setIsFocusPickerOpen] = useState(false);
  const [isLensPickerOpen, setIsLensPickerOpen] = useState(false);
  const [isHifzHidden, setIsHifzHidden] = useState(false);
  const [revealedWordKeys, setRevealedWordKeys] = useState<Record<string, boolean>>({});
  const [revealedAyahKeys, setRevealedAyahKeys] = useState<Record<string, boolean>>({});
  const [bookmarks, setBookmarks] = useState<MushafBookmark[]>(() => loadSavedBookmarks());
  const [isBookmarksOpen, setIsBookmarksOpen] = useState(false);
  const [bookmarkNoteInput, setBookmarkNoteInput] = useState('');
  const [isFloatingHudEntering, setIsFloatingHudEntering] = useState(false);
  const [isHudLauncherEntering, setIsHudLauncherEntering] = useState(false);

  const pageResizeListenersRef = useRef<Set<() => void>>(new Set());
  const subscribePageResize = useCallback((cb: () => void) => {
    pageResizeListenersRef.current.add(cb);
    return () => {
      pageResizeListenersRef.current.delete(cb);
    };
  }, []);

  const showFloatingHud = isScrolledPastToolbar && isFloatingHudOpen;
  const showHudLauncher = isScrolledPastToolbar && !isFloatingHudOpen;

  useEffect(() => {
    if (!showFloatingHud) {
      setIsFloatingHudEntering(false);
      return;
    }
    setIsFloatingHudEntering(true);
    const timer = window.setTimeout(() => {
      setIsFloatingHudEntering(false);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [showFloatingHud]);

  useEffect(() => {
    if (!showHudLauncher) {
      setIsHudLauncherEntering(false);
      return;
    }
    setIsHudLauncherEntering(true);
    const timer = window.setTimeout(() => {
      setIsHudLauncherEntering(false);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [showHudLauncher]);

  useEffect(() => {
    const sentinel = hudSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const passed = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        setIsScrolledPastToolbar((prev) => (prev === passed ? prev : passed));
        if (!passed) {
          setIsFloatingHudOpen(false);
        }
      },
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!showFloatingHud) return;
    const syncWidth = () => {
      if (hudSlotRef.current) {
        setFloatingHudWidth(Math.round(hudSlotRef.current.getBoundingClientRect().width));
      }
    };
    syncWidth();
    window.addEventListener('resize', syncWidth);
    return () => window.removeEventListener('resize', syncWidth);
  }, [showFloatingHud]);

  useEffect(() => {
    if (!showFloatingHud || isFocusLensOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsFloatingHudOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [showFloatingHud, isFocusLensOpen]);

  const handleOpenFloatingHud = useCallback(() => {
    if (hudBoxRef.current) {
      setReservedHudHeight(hudBoxRef.current.offsetHeight);
    }
    if (hudSlotRef.current) {
      setFloatingHudWidth(Math.round(hudSlotRef.current.getBoundingClientRect().width));
    }
    setIsFloatingHudOpen(true);
  }, []);

  const handleScrollToTop = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleToggleTeacherDock = useCallback(() => {
    setIsTeacherDockOpen((prev) => !prev);
  }, []);

  const zoomStepIdx = MUSHAF_ZOOM_STEPS.findIndex((z) => Math.abs(z - mushafZoom) < 0.01);
  const resolvedZoomIdx = zoomStepIdx >= 0 ? zoomStepIdx : MUSHAF_ZOOM_STEPS.indexOf(1);
  const resolvedZoomStep = MUSHAF_ZOOM_STEPS[resolvedZoomIdx];
  const activeZoomPreset = MUSHAF_ZOOM_PRESETS[resolvedZoomStep];
  const effectiveMushafScale = Number((mushafZoom * MUSHAF_BASE_SCALE).toFixed(3));
  const currentZoomKey = Math.round(mushafZoom * 100);
  const canZoomOut = resolvedZoomIdx > 0;
  const canZoomIn = resolvedZoomIdx < MUSHAF_ZOOM_STEPS.length - 1;
  const handleStepZoom = (delta: -1 | 1) => {
    const nextIdx = Math.max(0, Math.min(MUSHAF_ZOOM_STEPS.length - 1, resolvedZoomIdx + delta));
    setMushafZoom(MUSHAF_ZOOM_STEPS[nextIdx]);
  };

  useEffect(() => {
    setMushafMode(hasPractice ? 'practice' : 'reading');
    setSurahCorrectMap({});
    setSurahRevealed(false);
    setSurahStatus({ msg: '', kind: null });
  }, [hasPractice, targetLettersKey]);

  useEffect(() => {
    if (mushafDataset) return;
    let cancelled = false;
    loadMushafDatasetCached().then((data) => {
      if (!cancelled && data) {
        setMushafDataset(data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mushafDataset]);

  const mushafSurahs = mushafDataset?.surahs || INITIAL_MUSHAF_SURAHS;

  const surahMetaMap = useMemo(() => {
    const map = new Map<number, MushafSurahMeta>();
    for (const s of mushafSurahs) {
      map.set(s.id, s);
    }
    return map;
  }, [mushafSurahs]);

  const clampedMushafPage = Math.max(1, Math.min(TOTAL_MUSHAF_PAGES, currentMushafPage));

  const getPageSurahNames = useCallback(
    (rawPage: MushafRawPage | undefined): string[] => {
      if (!rawPage) return [];
      const names: string[] = [];
      for (const row of rawPage.rows) {
        if (row.k === 't' && row.r) {
          for (const run of row.r) {
            const meta = surahMetaMap.get(run.s);
            if (meta && !names.includes(meta.name)) {
              names.push(meta.name);
            }
          }
        }
      }
      if (names.length === 0) {
        for (const row of rawPage.rows) {
          if (row.s) {
            const meta = surahMetaMap.get(row.s);
            if (meta && !names.includes(meta.name)) {
              names.push(meta.name);
            }
          }
        }
      }
      return names;
    },
    [surahMetaMap]
  );

  // Memoize all 604 Mushaf page selector labels once per dataset load instead of scanning 604 pages on every render
  const pageSelectOptions = useMemo(() => {
    const opts: Array<{ pageNum: number; label: string }> = new Array(TOTAL_MUSHAF_PAGES);
    for (let idx = 0; idx < TOTAL_MUSHAF_PAGES; idx++) {
      const pNum = idx + 1;
      const pSurah = getPageSurahNames(mushafDataset?.pages[idx])[0];
      opts[idx] = {
        pageNum: pNum,
        label: `صفحة ${toArabicDigits(pNum)}${pSurah ? ` (${pSurah})` : ''}`,
      };
    }
    return opts;
  }, [mushafDataset, getPageSurahNames]);

  const buildTokenizedPage = useCallback(
    (pageNum: number): TokenizedMushafPage | null => {
      const rawPage = mushafDataset?.pages[pageNum - 1];
      if (!rawPage) return null;

      const cacheKey = `${targetLettersKey}:${pageNum}`;
      const cached = tokenizedPageCache.get(cacheKey);
      if (cached) {
        tokenizedPageCache.delete(cacheKey);
        tokenizedPageCache.set(cacheKey, cached);
        return cached;
      }

    const surahNames = getPageSurahNames(rawPage);
    const rows: TokenizedMushafRow[] = [];

    for (const row of rawPage.rows) {
      if (row.k === 'b' && row.s) {
        const surahMeta = surahMetaMap.get(row.s);
        if (surahMeta) {
          rows.push({ kind: 'banner', line: row.l, surahMeta });
        }
        continue;
      }

      if (row.k === 'm' && row.s) {
        rows.push({ kind: 'basmalah', line: row.l, surahId: row.s });
        continue;
      }

      if (row.k === 't' && row.r) {
        const items: MushafLineItem[] = [];
        let endCount = 0;
        const plainParts: string[] = [];

        row.r.forEach((run, runIdx) => {
          const hasRubMarker = run.t.startsWith('\u00A0') && !run.t.includes('\u06DE');
          const clean = run.t.replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, '');
          const words = clean ? clean.split(/[\s\u00A0]+/) : [];
          if (run.e === 1) endCount++;

          if (words.length === 0) {
            if (run.e === 1) {
              items.push({
                kind: 'rosette',
                keyPrefix: `${pageNum}_${row.l}_${runIdx}_end`,
                ayahNum: run.a,
                surahId: run.s,
              });
            }
            return;
          }

          plainParts.push(clean);
          words.forEach((word, wIdx) => {
            const isFirstWordOfRun = wIdx === 0;
            const isLastWordOfRun = wIdx === words.length - 1;
            const rawWithRub = isFirstWordOfRun && hasRubMarker ? `\u06DE${word}` : word;
            items.push({
              kind: 'word',
              keyPrefix: `${pageNum}_${row.l}_${runIdx}_${wIdx}`,
              rawWord: rawWithRub,
              tokens: tokenizeMushafText(rawWithRub, targetLetters),
              ayahEnd: isLastWordOfRun && run.e === 1 ? run.a : null,
              surahId: run.s,
              ayahNum: run.a,
            });
          });
        });

        const lastRun = row.r[row.r.length - 1];
        const lastSurahMeta = lastRun ? surahMetaMap.get(lastRun.s) : undefined;
        const isSurahEnd = !!(
          lastRun &&
          lastRun.e === 1 &&
          lastSurahMeta &&
          lastRun.a === lastSurahMeta.totalAyat
        );
        const baseTextLen =
          plainParts.join(' ').replace(new RegExp(DIACRITIC_RE.source, 'g'), '').length + endCount * 3;
        const isClosingPairRow = pageNum === 604 && row.l === 14;
        const isCentered = pageNum <= 2 || isClosingPairRow || (isSurahEnd && baseTextLen < 36);

        rows.push({
          kind: 'text',
          line: row.l,
          isCentered,
          items,
        });
      }
    }

    const flatWords: Array<Extract<MushafLineItem, { kind: 'word' }>> = [];
    for (const r of rows) {
      if (r.kind === 'text') {
        for (const item of r.items) {
          if (item.kind === 'word') {
            flatWords.push(item);
          }
        }
      }
    }

    let prevPageLastWord:
      | { surahId: number; ayahNum: number; tokens: MushafLetterUnit[] }
      | undefined;
    const prevRawPage = pageNum > 1 ? mushafDataset?.pages[pageNum - 2] : undefined;
    if (prevRawPage) {
      for (let rIdx = prevRawPage.rows.length - 1; rIdx >= 0; rIdx--) {
        const pr = prevRawPage.rows[rIdx];
        if (pr.k === 't' && pr.r && pr.r.length > 0) {
          const lastRun = pr.r[pr.r.length - 1];
          if (lastRun.e === 1) break;
          const clean = lastRun.t.replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, '');
          const words = clean ? clean.split(/[\s\u00A0]+/) : [];
          if (words.length > 0) {
            prevPageLastWord = {
              surahId: lastRun.s,
              ayahNum: lastRun.a,
              tokens: tokenizeMushafText(words[words.length - 1], targetLetters),
            };
          }
          break;
        }
        if (pr.k === 'b' || pr.k === 'm') break;
      }
    }

    let nextPageFirstWord:
      | { surahId: number; ayahNum: number; tokens: MushafLetterUnit[] }
      | undefined;
    const nextRawPage = pageNum < TOTAL_MUSHAF_PAGES ? mushafDataset?.pages[pageNum] : undefined;
    if (nextRawPage) {
      for (const nr of nextRawPage.rows) {
        if (nr.k === 'b' || nr.k === 'm') break;
        if (nr.k === 't' && nr.r) {
          for (const nRun of nr.r) {
            const clean = nRun.t.replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, '');
            const words = clean ? clean.split(/[\s\u00A0]+/) : [];
            if (words.length > 0) {
              nextPageFirstWord = {
                surahId: nRun.s,
                ayahNum: nRun.a,
                tokens: tokenizeMushafText(words[0], targetLetters),
              };
              break;
            }
          }
        }
        if (nextPageFirstWord) break;
      }
    }

    flatWords.forEach((wordItem, idx) => {
      const isFirstOnPage = idx === 0;
      const isLastOnPage = idx === flatWords.length - 1;
      const prevWord = idx > 0 ? flatWords[idx - 1] : undefined;
      const prevWordTokens = isFirstOnPage
        ? prevPageLastWord &&
          prevPageLastWord.surahId === wordItem.surahId &&
          prevPageLastWord.ayahNum === wordItem.ayahNum
          ? prevPageLastWord.tokens
          : undefined
        : prevWord &&
          prevWord.ayahEnd === null &&
          prevWord.surahId === wordItem.surahId &&
          prevWord.ayahNum === wordItem.ayahNum
        ? prevWord.tokens
        : undefined;
      const nextWord = idx < flatWords.length - 1 ? flatWords[idx + 1] : undefined;
      const sameNextAyahOnPage = !!(
        nextWord &&
        nextWord.surahId === wordItem.surahId &&
        nextWord.ayahNum === wordItem.ayahNum
      );
      const nextWordTokens =
        wordItem.ayahEnd !== null
          ? undefined
          : isLastOnPage
          ? nextPageFirstWord &&
            nextPageFirstWord.surahId === wordItem.surahId &&
            nextPageFirstWord.ayahNum === wordItem.ayahNum
            ? nextPageFirstWord.tokens
            : undefined
          : sameNextAyahOnPage
          ? nextWord!.tokens
          : undefined;
      const isAyahEndBoundary =
        wordItem.ayahEnd !== null || (!isLastOnPage && !sameNextAyahOnPage);
      wordItem.tajweed = analyzeWordTajweed(wordItem.tokens, {
        prevWordTokens,
        nextWordTokens,
        isAyahEnd: isAyahEndBoundary,
      });
    });

    const built: TokenizedMushafPage = {
      pageNum,
      jozz: rawPage.j,
      surahNames,
      rows,
    };

    if (tokenizedPageCache.size >= MAX_TOKENIZED_PAGE_CACHE) {
      const oldest = tokenizedPageCache.keys().next().value;
      if (oldest !== undefined) tokenizedPageCache.delete(oldest);
    }
    tokenizedPageCache.set(cacheKey, built);

    return built;
  },
  [mushafDataset, surahMetaMap, getPageSurahNames, targetLetters, targetLettersKey]
  );

  const activeSinglePageData = useMemo(
    () => buildTokenizedPage(clampedMushafPage),
    [buildTokenizedPage, clampedMushafPage]
  );

  // Pre-tokenize and pre-compute uniform font sizes/word widths for adjacent pages during idle frames
  useEffect(() => {
    if (!mushafDataset) return;

    type IdleDeadlineLike = { timeRemaining: () => number };
    const w = window as unknown as {
      requestIdleCallback?: (cb: (deadline: IdleDeadlineLike) => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const neighborPages: number[] = [];
    if (clampedMushafPage < TOTAL_MUSHAF_PAGES) neighborPages.push(clampedMushafPage + 1);
    if (clampedMushafPage > 1) neighborPages.push(clampedMushafPage - 1);
    if (neighborPages.length === 0) return;

    let cancelled = false;
    let idleId: number | null = null;
    let timeoutId: number | null = null;
    let nextIdx = 0;

    const warmOnePage = (targetPageNum: number) => {
      const tokenized = buildTokenizedPage(targetPageNum);
      if (!tokenized || fontsReadyTick <= 0) return;
      const bodyEl = pageBodyRef.current;
      if (!bodyEl) return;
      const cs = getComputedStyle(bodyEl);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const targetIsOpening = targetPageNum <= 2;
      const currentIsOpening = clampedMushafPage <= 2;
      const bodyW = bodyEl.clientWidth;
      const availableWidth =
        targetIsOpening === currentIsOpening
          ? bodyW - padX
          : targetIsOpening
          ? Math.max(0, bodyW - padX)
          : bodyW;
      if (availableWidth <= 0) return;
      const bodyHeight =
        targetIsOpening === currentIsOpening
          ? bodyEl.clientHeight
          : targetIsOpening
          ? Math.round(bodyW * 0.93)
          : Math.round(bodyW * 1.46);
      computeAndCacheUniformFontSize(
        tokenized,
        targetPageNum,
        availableWidth,
        bodyHeight,
        fontsReadyTick
      );
    };

    const scheduleStep = () => {
      if (cancelled || nextIdx >= neighborPages.length) return;
      if (typeof w.requestIdleCallback === 'function') {
        idleId = w.requestIdleCallback(
          (deadline) => {
            idleId = null;
            if (cancelled) return;
            while (nextIdx < neighborPages.length) {
              warmOnePage(neighborPages[nextIdx]);
              nextIdx += 1;
              if (nextIdx < neighborPages.length && deadline.timeRemaining() < 2) {
                scheduleStep();
                return;
              }
            }
          },
          { timeout: 240 }
        );
      } else {
        timeoutId = window.setTimeout(() => {
          timeoutId = null;
          if (cancelled) return;
          warmOnePage(neighborPages[nextIdx]);
          nextIdx += 1;
          if (nextIdx < neighborPages.length) {
            scheduleStep();
          }
        }, 48);
      }
    };

    scheduleStep();

    return () => {
      cancelled = true;
      if (idleId !== null) w.cancelIdleCallback?.(idleId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [mushafDataset, clampedMushafPage, buildTokenizedPage, fontsReadyTick, currentZoomKey, isPresentationMode]);

  const visiblePagesData = useMemo(
    () => [activeSinglePageData],
    [activeSinglePageData]
  );

  const uniformPageFontSize =
    uniformFontState && uniformFontState.pageNum === clampedMushafPage
      ? uniformFontState.size
      : null;
  const isUniformFontSynced = Boolean(
    uniformFontState &&
      uniformFontState.pageNum === clampedMushafPage &&
      uniformFontState.zoomKey === currentZoomKey
  );

  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    let cancelled = false;
    const markReady = () => {
      if (!cancelled) {
        setFontsReadyTick((prev) => (prev === 0 ? 1 : prev + 1));
      }
    };
    const loadHafs =
      typeof document.fonts.load === 'function'
        ? document.fonts.load('16px "UthmanicHafs"').catch(() => undefined)
        : Promise.resolve();
    Promise.all([loadHafs, document.fonts.ready]).then(markReady);
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    const bodyEl = pageBodyRef.current;
    if (!bodyEl || !activeSinglePageData) {
      setUniformFontState(null);
      return;
    }

    let cancelled = false;
    let rafId = 0;

    const computeUniformFontSize = (): boolean => {
      if (cancelled || !pageBodyRef.current) return false;
      const node = pageBodyRef.current;
      const cs = getComputedStyle(node);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const availableWidth = node.clientWidth - padX;
      if (availableWidth <= 0) return false;

      const computedSize = computeAndCacheUniformFontSize(
        activeSinglePageData,
        clampedMushafPage,
        availableWidth,
        node.clientHeight,
        fontsReadyTick
      );

      let didUpdate = false;
      setUniformFontState((prev) => {
        if (
          prev &&
          prev.pageNum === clampedMushafPage &&
          prev.zoomKey === currentZoomKey &&
          Math.abs(prev.size - computedSize) < 0.15
        ) {
          return prev;
        }
        didUpdate = true;
        return { pageNum: clampedMushafPage, zoomKey: currentZoomKey, size: computedSize };
      });
      return didUpdate;
    };

    computeUniformFontSize();

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        cancelled = true;
      };
    }

    let lastW = Math.round(bodyEl.clientWidth);
    let lastH = Math.round(bodyEl.clientHeight);
    const ro = new ResizeObserver(() => {
      const nextW = Math.round(bodyEl.clientWidth);
      const nextH = Math.round(bodyEl.clientHeight);
      if (nextW <= 0 || (nextW === lastW && nextH === lastH)) return;
      lastW = nextW;
      lastH = nextH;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const sizeChanged = computeUniformFontSize();
        if (!sizeChanged) {
          pageResizeListenersRef.current.forEach((cb) => cb());
        }
      });
    });

    ro.observe(bodyEl);

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [activeSinglePageData, clampedMushafPage, currentZoomKey, isPresentationMode, fontsReadyTick]);

  const currentJozz = activeSinglePageData?.jozz || 1;
  const currentSurahIdx = Math.max(0, mushafSurahs.findIndex((s) => s.name === selectedSurah));
  const currentSurahEntry = mushafSurahs[currentSurahIdx] || mushafSurahs[0];

  const { pageAyahList, pageWordKeysByAyah } = useMemo(() => {
    if (!activeSinglePageData) {
      return {
        pageAyahList: [] as Array<{ key: string; surahId: number; ayahNum: number; surahName: string }>,
        pageWordKeysByAyah: new Map<string, string[]>(),
      };
    }
    const seen = new Set<string>();
    const list: Array<{ key: string; surahId: number; ayahNum: number; surahName: string }> = [];
    const wordMap = new Map<string, string[]>();
    for (const row of activeSinglePageData.rows) {
      if (row.kind !== 'text') continue;
      for (const item of row.items) {
        const key = `${item.surahId}:${item.ayahNum}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push({
            key,
            surahId: item.surahId,
            ayahNum: item.ayahNum,
            surahName: surahMetaMap.get(item.surahId)?.name || '',
          });
        }
        if (item.kind === 'word') {
          let arr = wordMap.get(key);
          if (!arr) {
            arr = [];
            wordMap.set(key, arr);
          }
          arr.push(item.keyPrefix);
        }
      }
    }
    return { pageAyahList: list, pageWordKeysByAyah: wordMap };
  }, [activeSinglePageData, surahMetaMap]);

  const currentPageBookmark = useMemo(
    () => bookmarks.find((bm) => bm.pageNum === clampedMushafPage),
    [bookmarks, clampedMushafPage]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(bookmarks));
    } catch {
      // Ignore storage quota issues
    }
  }, [bookmarks]);

  const surahTotalTargets = useMemo(() => {
    if (!hasPractice) return 0;
    let count = 0;
    for (const pageData of visiblePagesData) {
      if (!pageData) continue;
      for (const row of pageData.rows) {
        if (row.kind !== 'text') continue;
        for (const item of row.items) {
          if (item.kind !== 'word') continue;
          for (const t of item.tokens) {
            if (t.type === 'letter' && t.isTarget) count++;
          }
        }
      }
    }
    return count;
  }, [hasPractice, visiblePagesData]);

  const surahFoundCount = useMemo(() => {
    if (!hasPractice) return 0;
    let count = 0;
    for (const pageData of visiblePagesData) {
      if (!pageData) continue;
      for (const row of pageData.rows) {
        if (row.kind !== 'text') continue;
        for (const item of row.items) {
          if (item.kind !== 'word') continue;
          for (let tIdx = 0; tIdx < item.tokens.length; tIdx++) {
            const key = `${item.keyPrefix}_${tIdx}`;
            if (item.tokens[tIdx].isTarget && surahCorrectMap[key]) count++;
          }
        }
      }
    }
    return count;
  }, [hasPractice, visiblePagesData, surahCorrectMap]);

  const handleSelectSurah = (name: string) => {
    const target = mushafSurahs.find((s) => s.name === name);
    setSelectedSurah(name);
    if (target) {
      setCurrentMushafPage(target.startPage);
    }
    setSurahRevealed(false);
    setSurahStatus({ msg: '', kind: null });
    setFocusedAyahKeys([]);
    setIsFocusPickerOpen(false);
    setIsLensPickerOpen(false);
    setRevealedWordKeys({});
    setRevealedAyahKeys({});
  };

  const handleJumpToPage = (pageNum: number) => {
    const clampedPage = Math.max(1, Math.min(TOTAL_MUSHAF_PAGES, pageNum));
    setCurrentMushafPage(clampedPage);
    const pNames = getPageSurahNames(mushafDataset?.pages[clampedPage - 1]);
    if (pNames[0]) {
      setSelectedSurah(pNames[0]);
    }
    setSurahRevealed(false);
    setSurahStatus({ msg: '', kind: null });
    setFocusedAyahKeys([]);
    setIsFocusPickerOpen(false);
    setIsLensPickerOpen(false);
    setRevealedWordKeys({});
    setRevealedAyahKeys({});
  };

  const triggerTurnEffect = useCallback((dir: 'next' | 'prev') => {
    turnSeqRef.current += 1;
    setPageTurn({ dir, seq: turnSeqRef.current });
  }, []);

  useEffect(() => {
    if (!pageTurn) return;
    const timer = window.setTimeout(() => {
      setPageTurn((prev) => (prev && prev.seq === pageTurn.seq ? null : prev));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [pageTurn]);

  const handleStepMushafPage = (delta: number) => {
    const target = Math.max(1, Math.min(TOTAL_MUSHAF_PAGES, clampedMushafPage + delta));
    if (target === clampedMushafPage) return;
    handleJumpToPage(target);
    triggerTurnEffect(delta > 0 ? 'next' : 'prev');
  };

  useEffect(() => {
    if (variant !== 'standalone') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isFocusLensOpen) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (clampedMushafPage < TOTAL_MUSHAF_PAGES) {
          handleJumpToPage(clampedMushafPage + 1);
          triggerTurnEffect('next');
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (clampedMushafPage > 1) {
          handleJumpToPage(clampedMushafPage - 1);
          triggerTurnEffect('prev');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [variant, clampedMushafPage, mushafDataset, triggerTurnEffect, isFocusLensOpen]);

  const handleSurahLetterClick = (unit: MushafLetterUnit, key: string) => {
    if (!hasPractice || mushafMode !== 'practice') return;

    if (surahCorrectMap[key]) {
      const next = { ...surahCorrectMap, [key]: false };
      setSurahCorrectMap(next);
      setSurahStatus({ msg: '', kind: null });
      return;
    }

    if (unit.isTarget) {
      onPlayChime?.(true);
      const next = { ...surahCorrectMap, [key]: true };
      setSurahCorrectMap(next);
      setSurahStatus({
        msg: practiceConfig?.hitMessage || 'أحسنت! إجابة صحيحة ✓',
        kind: 'ok',
      });

      const newFound = surahFoundCount + 1;
      if (newFound === surahTotalTargets && surahTotalTargets > 0) {
        setSurahStatus({
          msg:
            practiceConfig?.completeSingleMessage ||
            `ممتاز! وجدت كل ${practiceConfig?.targetLabel || 'المواضع المطلوبة'} في هذه الصفحة ✓`,
          kind: 'ok',
        });
        onTriggerConfetti?.();
        practiceConfig?.onPracticeComplete?.();
      }
    } else {
      onPlayChime?.(false);
      setSurahWrongKey(key);
      setSurahStatus({
        msg: practiceConfig?.missMessage || 'حاول مرة أخرى، هذا ليس الحرف المطلوب',
        kind: 'bad',
      });
      setTimeout(() => setSurahWrongKey(null), 450);
    }
  };

  const handleSurahLetterClickRef = useRef(handleSurahLetterClick);
  handleSurahLetterClickRef.current = handleSurahLetterClick;
  const stableSurahLetterClick = useCallback((unit: MushafLetterUnit, key: string) => {
    handleSurahLetterClickRef.current(unit, key);
  }, []);

  const isEffectivePractice = hasPractice && mushafMode === 'practice';
  const hasTeacherActiveState = isFocusMode || isHifzHidden;

  const liquidCardRectRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const liquidMoveRafRef = useRef(0);
  const liquidPendingPtRef = useRef<{ el: HTMLElement; x: number; y: number } | null>(null);

  const handleLiquidPointerEnter = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    liquidCardRectRef.current = { left: r.left, top: r.top, width: r.width, height: r.height };
  }, []);

  const handleLiquidPointerLeave = useCallback(() => {
    liquidCardRectRef.current = null;
  }, []);

  const handleLiquidPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    liquidPendingPtRef.current = { el, x: e.clientX, y: e.clientY };
    if (liquidMoveRafRef.current) return;
    liquidMoveRafRef.current = window.requestAnimationFrame(() => {
      liquidMoveRafRef.current = 0;
      const pt = liquidPendingPtRef.current;
      if (!pt) return;
      const rect = liquidCardRectRef.current ?? pt.el.getBoundingClientRect();
      if (!liquidCardRectRef.current) {
        liquidCardRectRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      }
      if (rect.width <= 0 || rect.height <= 0) return;
      const xPct = Math.max(0, Math.min(100, ((pt.x - rect.left) / rect.width) * 100));
      const yPct = Math.max(0, Math.min(100, ((pt.y - rect.top) / rect.height) * 100));
      pt.el.style.setProperty('--lg-x', `${xPct.toFixed(1)}%`);
      pt.el.style.setProperty('--lg-y', `${yPct.toFixed(1)}%`);
    });
  }, []);

  useEffect(() => {
    if (!isFocusLensOpen) {
      liquidCardRectRef.current = null;
      if (liquidMoveRafRef.current) {
        window.cancelAnimationFrame(liquidMoveRafRef.current);
        liquidMoveRafRef.current = 0;
      }
    }
  }, [isFocusLensOpen]);

  const pageAyahIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    pageAyahList.forEach((a, idx) => map.set(a.key, idx));
    return map;
  }, [pageAyahList]);

  const pageAyahGroupsBySurah = useMemo(() => {
    const groups: Array<{
      surahId: number;
      surahName: string;
      ayahs: Array<{ key: string; surahId: number; ayahNum: number; surahName: string }>;
    }> = [];
    for (const ayah of pageAyahList) {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.surahId === ayah.surahId) {
        lastGroup.ayahs.push(ayah);
      } else {
        groups.push({
          surahId: ayah.surahId,
          surahName: ayah.surahName,
          ayahs: [ayah],
        });
      }
    }
    return groups;
  }, [pageAyahList]);

  const sortFocusKeys = useCallback(
    (keys: Iterable<string>): string[] => {
      const unique = Array.from(new Set(keys)).filter((k) => pageAyahIndexMap.has(k));
      unique.sort((a, b) => (pageAyahIndexMap.get(a) ?? 0) - (pageAyahIndexMap.get(b) ?? 0));
      return unique;
    },
    [pageAyahIndexMap]
  );

  useEffect(() => {
    if (isFocusMode && focusedAyahKeys.length === 0 && pageAyahList.length > 0) {
      setFocusedAyahKeys([pageAyahList[0].key]);
    }
  }, [isFocusMode, focusedAyahKeys.length, pageAyahList]);

  const handleToggleFocusMode = () => {
    if (isFocusMode) {
      setIsFocusMode(false);
      setIsFocusLensOpen(false);
      setIsFocusPickerOpen(false);
      setIsLensPickerOpen(false);
      setFocusedAyahKeys([]);
    } else {
      setIsFocusMode(true);
      setAnnotationTool('cursor');
      if (pageAyahList.length > 0) {
        setFocusedAyahKeys([pageAyahList[0].key]);
      }
    }
  };

  const focusedAyahSet = useMemo(() => new Set(focusedAyahKeys), [focusedAyahKeys]);

  const focusedAyahIndices = useMemo(() => {
    const indices: number[] = [];
    for (const k of focusedAyahKeys) {
      const idx = pageAyahIndexMap.get(k);
      if (idx !== undefined) indices.push(idx);
    }
    indices.sort((a, b) => a - b);
    return indices;
  }, [focusedAyahKeys, pageAyahIndexMap]);

  const firstFocusedIdx = focusedAyahIndices.length > 0 ? focusedAyahIndices[0] : -1;
  const lastFocusedIdx =
    focusedAyahIndices.length > 0 ? focusedAyahIndices[focusedAyahIndices.length - 1] : -1;

  const focusedAyahMetas = useMemo(
    () => focusedAyahIndices.map((idx) => pageAyahList[idx]).filter(Boolean),
    [focusedAyahIndices, pageAyahList]
  );

  const primaryFocusedAyahMeta = focusedAyahMetas[0] ?? null;
  const focusedCount = focusedAyahMetas.length;

  const isFocusedContiguous = useMemo(() => {
    if (focusedAyahIndices.length <= 1) return true;
    for (let i = 1; i < focusedAyahIndices.length; i++) {
      if (focusedAyahIndices[i] !== focusedAyahIndices[i - 1] + 1) return false;
    }
    return true;
  }, [focusedAyahIndices]);

  const focusedSingleSurahName = useMemo(() => {
    if (focusedAyahMetas.length === 0) return null;
    const firstSurahId = focusedAyahMetas[0].surahId;
    return focusedAyahMetas.every((m) => m.surahId === firstSurahId)
      ? focusedAyahMetas[0].surahName
      : null;
  }, [focusedAyahMetas]);

  const focusedCompactLabel = useMemo(() => {
    if (focusedAyahMetas.length === 0) return 'اختر آية';
    if (focusedAyahMetas.length === 1) {
      return `آية ${toArabicDigits(focusedAyahMetas[0].ayahNum)}`;
    }
    if (isFocusedContiguous && focusedSingleSurahName) {
      const firstNum = toArabicDigits(focusedAyahMetas[0].ayahNum);
      const lastNum = toArabicDigits(focusedAyahMetas[focusedAyahMetas.length - 1].ayahNum);
      return `آيات ${firstNum} – ${lastNum}`;
    }
    if (focusedAyahMetas.length <= 3 && focusedSingleSurahName) {
      return `آيات ${focusedAyahMetas.map((m) => toArabicDigits(m.ayahNum)).join('، ')}`;
    }
    return `${toArabicDigits(focusedAyahMetas.length)} آيات`;
  }, [focusedAyahMetas, isFocusedContiguous, focusedSingleSurahName]);

  const focusedLensTitle = useMemo(() => {
    if (focusedAyahMetas.length === 0) return { surah: '', ayahs: '', countBadge: null as string | null };
    if (focusedSingleSurahName) {
      if (focusedAyahMetas.length === 1) {
        return {
          surah: `سورة ${focusedSingleSurahName}`,
          ayahs: `الآية ${toArabicDigits(focusedAyahMetas[0].ayahNum)}`,
          countBadge: null,
        };
      }
      if (isFocusedContiguous) {
        const firstNum = toArabicDigits(focusedAyahMetas[0].ayahNum);
        const lastNum = toArabicDigits(focusedAyahMetas[focusedAyahMetas.length - 1].ayahNum);
        return {
          surah: `سورة ${focusedSingleSurahName}`,
          ayahs: `الآيات ${firstNum} – ${lastNum}`,
          countBadge: `${toArabicDigits(focusedAyahMetas.length)} آيات`,
        };
      }
      if (focusedAyahMetas.length <= 4) {
        return {
          surah: `سورة ${focusedSingleSurahName}`,
          ayahs: `الآيات ${focusedAyahMetas.map((m) => toArabicDigits(m.ayahNum)).join('، ')}`,
          countBadge: `${toArabicDigits(focusedAyahMetas.length)} آيات`,
        };
      }
      return {
        surah: `سورة ${focusedSingleSurahName}`,
        ayahs: 'مقطع مختار',
        countBadge: `${toArabicDigits(focusedAyahMetas.length)} آيات`,
      };
    }
    const uniqueSurahs = Array.from(new Set(focusedAyahMetas.map((m) => m.surahName)));
    return {
      surah: uniqueSurahs.map((s) => `سورة ${s}`).join(' · '),
      ayahs: `${toArabicDigits(focusedAyahMetas.length)} آيات مختارة`,
      countBadge: null,
    };
  }, [focusedAyahMetas, focusedSingleSurahName, isFocusedContiguous]);

  /**
   * Groups focused word items into natural Mushaf passages:
   * - Contiguous ayahs within the same Surah stay seamlessly joined together.
   * - Skipped ayah gaps or Surah transitions create clean separated blocks.
   */
  const focusedLensPassageGroups = useMemo(() => {
    if (!activeSinglePageData || focusedAyahSet.size === 0) return [];

    // 1. Collect all line items (words + standalone rosettes) per focused ayah key
    const itemsByAyah = new Map<string, MushafLineItem[]>();
    for (const row of activeSinglePageData.rows) {
      if (row.kind !== 'text') continue;
      for (const item of row.items) {
        const k = `${item.surahId}:${item.ayahNum}`;
        if (!focusedAyahSet.has(k)) continue;
        const arr = itemsByAyah.get(k);
        if (arr) arr.push(item);
        else itemsByAyah.set(k, [item]);
      }
    }

    // 2. Partition focused indices into contiguous same-surah runs
    const groups: Array<{
      id: string;
      surahId: number;
      surahName: string;
      ayahLabel: string;
      items: MushafLineItem[];
    }> = [];

    let runStartIdx = 0;
    while (runStartIdx < focusedAyahIndices.length) {
      let runEndIdx = runStartIdx;
      const startMeta = pageAyahList[focusedAyahIndices[runStartIdx]];
      while (
        runEndIdx + 1 < focusedAyahIndices.length &&
        focusedAyahIndices[runEndIdx + 1] === focusedAyahIndices[runEndIdx] + 1 &&
        pageAyahList[focusedAyahIndices[runEndIdx + 1]]?.surahId === startMeta.surahId
      ) {
        runEndIdx++;
      }

      const runMetas = focusedAyahIndices
        .slice(runStartIdx, runEndIdx + 1)
        .map((i) => pageAyahList[i])
        .filter(Boolean);
      const runItems: MushafLineItem[] = [];
      for (const meta of runMetas) {
        const list = itemsByAyah.get(meta.key);
        if (list) runItems.push(...list);
      }

      const firstNum = runMetas[0].ayahNum;
      const lastNum = runMetas[runMetas.length - 1].ayahNum;
      groups.push({
        id: `${runMetas[0].key}_${runMetas[runMetas.length - 1].key}`,
        surahId: startMeta.surahId,
        surahName: startMeta.surahName,
        ayahLabel:
          runMetas.length === 1
            ? `الآية ${toArabicDigits(firstNum)}`
            : `الآيات ${toArabicDigits(firstNum)} – ${toArabicDigits(lastNum)}`,
        items: runItems,
      });

      runStartIdx = runEndIdx + 1;
    }

    return groups;
  }, [activeSinglePageData, focusedAyahSet, focusedAyahIndices, pageAyahList]);

  const canStepFocusPrev = firstFocusedIdx > 0;
  const canStepFocusNext = lastFocusedIdx >= 0 && lastFocusedIdx < pageAyahList.length - 1;
  const canAppendFocusAyah =
    pageAyahList.length > 0 && focusedAyahIndices.length < pageAyahList.length;

  const handleToggleFocusAyahKey = useCallback(
    (aKey: string) => {
      setFocusedAyahKeys((prev) => {
        if (prev.includes(aKey)) {
          if (prev.length <= 1) return prev;
          return sortFocusKeys(prev.filter((k) => k !== aKey));
        }
        return sortFocusKeys([...prev, aKey]);
      });
    },
    [sortFocusKeys]
  );

  const handleAppendFocusedAyah = useCallback(() => {
    if (pageAyahList.length === 0) return;
    setFocusedAyahKeys((prev) => {
      const ordered = sortFocusKeys(prev);
      if (ordered.length === 0) return [pageAyahList[0].key];
      const indices = ordered
        .map((k) => pageAyahIndexMap.get(k))
        .filter((v): v is number => v !== undefined);
      const maxIdx = Math.max(...indices);
      const minIdx = Math.min(...indices);
      if (maxIdx < pageAyahList.length - 1) {
        return sortFocusKeys([...ordered, pageAyahList[maxIdx + 1].key]);
      }
      if (minIdx > 0) {
        return sortFocusKeys([...ordered, pageAyahList[minIdx - 1].key]);
      }
      // Fill any interior gap if both ends are already selected
      const missing = pageAyahList.find((a) => !ordered.includes(a.key));
      return missing ? sortFocusKeys([...ordered, missing.key]) : ordered;
    });
  }, [pageAyahList, pageAyahIndexMap, sortFocusKeys]);

  const handleRemoveLastFocusedAyah = useCallback(() => {
    setFocusedAyahKeys((prev) => {
      const ordered = sortFocusKeys(prev);
      if (ordered.length <= 1) return ordered;
      return ordered.slice(0, -1);
    });
  }, [sortFocusKeys]);

  const handleResetToSingleFocus = useCallback(() => {
    setFocusedAyahKeys((prev) => {
      const ordered = sortFocusKeys(prev);
      return ordered.length > 0 ? [ordered[0]] : ordered;
    });
  }, [sortFocusKeys]);

  const handleSelectAllPageFocus = useCallback(() => {
    if (pageAyahList.length === 0) return;
    setFocusedAyahKeys(pageAyahList.map((a) => a.key));
  }, [pageAyahList]);

  const scrollAyahIntoView = useCallback(
    (ayahKey: string) => {
      if (typeof window === 'undefined') return;
      window.requestAnimationFrame(() => {
        if (isFocusLensOpen) {
          const stageEl = lensStageRef.current;
          if (!stageEl) return;
          const els = stageEl.querySelectorAll<HTMLElement>(`[data-lens-ayah-key="${ayahKey}"]`);
          if (els.length === 0) return;
          const stageRect = stageEl.getBoundingClientRect();
          let minTop = Infinity;
          let maxBottom = -Infinity;
          els.forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.top < minTop) minTop = r.top;
            if (r.bottom > maxBottom) maxBottom = r.bottom;
          });
          if (maxBottom > stageRect.bottom - 18 || minTop < stageRect.top + 18) {
            const delta = minTop - (stageRect.top + 28);
            stageEl.scrollTo({
              top: Math.max(0, stageEl.scrollTop + delta),
              behavior: 'smooth',
            });
          }
          return;
        }

        const bodyEl = pageBodyRef.current;
        if (!bodyEl) return;
        const els = bodyEl.querySelectorAll<HTMLElement>(`[data-ayah-key="${ayahKey}"]`);
        if (els.length === 0) return;

        let minTop = Infinity;
        let maxBottom = -Infinity;
        els.forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.top < minTop) minTop = r.top;
          if (r.bottom > maxBottom) maxBottom = r.bottom;
        });

        const topSafe = showFloatingHud ? 108 : 64;
        const bottomSafe = window.innerHeight - 108;
        if (maxBottom <= bottomSafe && minTop >= topSafe) {
          return;
        }

        const ayahHeight = maxBottom - minTop;
        const safeHeight = Math.max(120, bottomSafe - topSafe);
        let desiredTop = topSafe + 18;
        if (ayahHeight <= safeHeight && maxBottom > bottomSafe) {
          desiredTop = Math.max(
            topSafe + 18,
            Math.min(topSafe + safeHeight * 0.32, bottomSafe - ayahHeight - 20)
          );
        }

        const deltaY = minTop - desiredTop;
        const prefersReduced =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({
          top: Math.max(0, window.scrollY + deltaY),
          behavior: prefersReduced ? 'auto' : 'smooth',
        });
      });
    },
    [isFocusLensOpen, showFloatingHud]
  );

  const scrollToMushafTop = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      const targetEl = pageBodyRef.current || hudSlotRef.current;
      if (!targetEl) return;
      const rect = targetEl.getBoundingClientRect();
      const topTarget = Math.max(0, window.scrollY + rect.top - 72);
      const prefersReduced =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: topTarget, behavior: prefersReduced ? 'auto' : 'smooth' });
    });
  }, []);

  useEffect(() => {
    const key = pendingScrollAyahRef.current;
    if (!key) return;
    pendingScrollAyahRef.current = null;
    scrollAyahIntoView(key);
  }, [focusedAyahKeys, revealedAyahKeys, scrollAyahIntoView]);

  const handleStepFocusedAyah = useCallback(
    (delta: -1 | 1) => {
      if (pageAyahList.length === 0) return;
      setFocusedAyahKeys((prev) => {
        const ordered = sortFocusKeys(prev);
        if (ordered.length === 0) {
          pendingScrollAyahRef.current = pageAyahList[0].key;
          return [pageAyahList[0].key];
        }
        const indices = ordered
          .map((k) => pageAyahIndexMap.get(k))
          .filter((v): v is number => v !== undefined);
        if (indices.length === 0) {
          pendingScrollAyahRef.current = pageAyahList[0].key;
          return [pageAyahList[0].key];
        }
        if (delta < 0 && indices[0] <= 0) return ordered;
        if (delta > 0 && indices[indices.length - 1] >= pageAyahList.length - 1) return ordered;
        const shifted = indices.map((idx) =>
          pageAyahList[Math.max(0, Math.min(pageAyahList.length - 1, idx + delta))].key
        );
        const nextOrdered = sortFocusKeys(shifted);
        pendingScrollAyahRef.current =
          delta > 0 ? nextOrdered[nextOrdered.length - 1] : nextOrdered[0];
        return nextOrdered;
      });
    },
    [pageAyahList, pageAyahIndexMap, sortFocusKeys]
  );

  useEffect(() => {
    if (!isFocusLensOpen) return;
    const handleLensKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsFocusLensOpen(false);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleStepFocusedAyah(1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleStepFocusedAyah(-1);
      }
    };
    window.addEventListener('keydown', handleLensKeyDown, true);
    return () => window.removeEventListener('keydown', handleLensKeyDown, true);
  }, [isFocusLensOpen, handleStepFocusedAyah]);

  const handleToggleHifzMode = () => {
    if (isHifzHidden) {
      setIsHifzHidden(false);
      setRevealedWordKeys({});
      setRevealedAyahKeys({});
    } else {
      setIsHifzHidden(true);
      setAnnotationTool('cursor');
      setRevealedWordKeys({});
      setRevealedAyahKeys({});
    }
  };

  const handleRevealNextAyah = useCallback(
    (allowNextPage = false) => {
      if (pageAyahList.length === 0) return;
      const nextHidden = pageAyahList.find((a) => {
        if (revealedAyahKeys[a.key]) return false;
        const wordKeys = pageWordKeysByAyah.get(a.key);
        if (wordKeys && wordKeys.length > 0 && wordKeys.every((wk) => Boolean(revealedWordKeys[wk]))) {
          return false;
        }
        return true;
      });
      if (!nextHidden) {
        if (allowNextPage && clampedMushafPage < TOTAL_MUSHAF_PAGES) {
          handleJumpToPage(clampedMushafPage + 1);
          triggerTurnEffect('next');
          scrollToMushafTop();
        }
        return;
      }
      pendingScrollAyahRef.current = nextHidden.key;
      setRevealedAyahKeys((prev) => ({ ...prev, [nextHidden.key]: true }));
      if (isFocusMode) {
        setFocusedAyahKeys((prev) => sortFocusKeys([...prev, nextHidden.key]));
      }
    },
    [
      pageAyahList,
      pageWordKeysByAyah,
      revealedAyahKeys,
      revealedWordKeys,
      isFocusMode,
      sortFocusKeys,
      clampedMushafPage,
      mushafDataset,
      triggerTurnEffect,
      scrollToMushafTop,
    ]
  );

  useEffect(() => {
    if (!isHifzHidden && !isFocusMode) return;
    const handleSpaceKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest('.apple-palette-dock, .apple-palette-anchor'))
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (
        target instanceof HTMLElement &&
        target.closest('.mushaf-sticky-hud, .mushaf-hud-launcher, .mushaf-liquid-lens-header, .mushaf-liquid-lens-footer')
      ) {
        target.blur();
      }
      if (e.repeat) return;
      if (isHifzHidden) {
        handleRevealNextAyah(true);
      } else if (isFocusMode) {
        if (canStepFocusNext) {
          handleStepFocusedAyah(1);
        } else if (clampedMushafPage < TOTAL_MUSHAF_PAGES) {
          handleJumpToPage(clampedMushafPage + 1);
          triggerTurnEffect('next');
          scrollToMushafTop();
        }
      }
    };
    window.addEventListener('keydown', handleSpaceKeyDown, true);
    return () => window.removeEventListener('keydown', handleSpaceKeyDown, true);
  }, [
    isHifzHidden,
    isFocusMode,
    handleRevealNextAyah,
    handleStepFocusedAyah,
    canStepFocusNext,
    clampedMushafPage,
    mushafDataset,
    triggerTurnEffect,
    scrollToMushafTop,
  ]);

  const handleRevealAllHifz = () => {
    const all: Record<string, boolean> = {};
    for (const a of pageAyahList) {
      all[a.key] = true;
    }
    setRevealedAyahKeys(all);
  };

  const handleHideAllHifz = () => {
    setRevealedWordKeys({});
    setRevealedAyahKeys({});
  };

  const areAllFocusedRevealed = useMemo(
    () => focusedAyahMetas.length > 0 && focusedAyahMetas.every((m) => Boolean(revealedAyahKeys[m.key])),
    [focusedAyahMetas, revealedAyahKeys]
  );

  const handleToggleRevealFocusedAyahs = useCallback(() => {
    if (focusedAyahMetas.length === 0) return;
    const nextVal = !areAllFocusedRevealed;
    setRevealedAyahKeys((prev) => {
      const updated = { ...prev };
      for (const m of focusedAyahMetas) {
        updated[m.key] = nextVal;
      }
      return updated;
    });
  }, [areAllFocusedRevealed, focusedAyahMetas]);

  const teacherActionRef = useRef({
    isHifzHidden,
    isFocusMode,
    revealedAyahKeys,
    focusedAyahSet,
    sortFocusKeys,
    handleToggleFocusAyahKey,
  });
  teacherActionRef.current = {
    isHifzHidden,
    isFocusMode,
    revealedAyahKeys,
    focusedAyahSet,
    sortFocusKeys,
    handleToggleFocusAyahKey,
  };

  // Stable callback identities prevent all 15 MushafLineRow instances from failing React.memo on reveal/focus updates
  const handleWordTeacherClick = useCallback((word: Extract<MushafLineItem, { kind: 'word' }>) => {
    const state = teacherActionRef.current;
    const aKey = `${word.surahId}:${word.ayahNum}`;
    if (state.isHifzHidden) {
      if (state.revealedAyahKeys[aKey]) {
        setRevealedAyahKeys((prev) => ({ ...prev, [aKey]: false }));
      } else {
        setRevealedWordKeys((prev) => ({ ...prev, [word.keyPrefix]: !prev[word.keyPrefix] }));
      }
      if (state.isFocusMode && !state.focusedAyahSet.has(aKey)) {
        setFocusedAyahKeys((prev) => state.sortFocusKeys([...prev, aKey]));
      }
      return;
    }
    if (state.isFocusMode) {
      state.handleToggleFocusAyahKey(aKey);
    }
  }, []);

  const handleAyahTeacherClick = useCallback((surahId: number, ayahNum: number) => {
    const state = teacherActionRef.current;
    const aKey = `${surahId}:${ayahNum}`;
    if (state.isHifzHidden) {
      setRevealedAyahKeys((prev) => ({ ...prev, [aKey]: !prev[aKey] }));
      if (state.isFocusMode && !state.focusedAyahSet.has(aKey)) {
        setFocusedAyahKeys((prev) => state.sortFocusKeys([...prev, aKey]));
      }
      return;
    }
    if (state.isFocusMode) {
      state.handleToggleFocusAyahKey(aKey);
    }
  }, []);

  const handleSaveBookmark = (e?: React.FormEvent) => {
    e?.preventDefault();
    const pageSurah =
      primaryFocusedAyahMeta?.surahName ||
      activeSinglePageData?.surahNames[0] ||
      currentSurahEntry.name;
    const customLabel = bookmarkNoteInput.trim();
    const defaultLabel =
      focusedAyahMetas.length > 0
        ? `سورة ${pageSurah} · ${focusedCompactLabel}`
        : `سورة ${pageSurah} · صفحة ${toArabicDigits(clampedMushafPage)}`;
    const newBm: MushafBookmark = {
      id: `bm_${Date.now()}`,
      pageNum: clampedMushafPage,
      surahName: pageSurah,
      surahId: primaryFocusedAyahMeta?.surahId,
      ayahNum: primaryFocusedAyahMeta?.ayahNum,
      focusedKeys: isFocusMode && focusedAyahKeys.length > 0 ? [...focusedAyahKeys] : undefined,
      label: customLabel || defaultLabel,
      createdAt: Date.now(),
    };
    setBookmarks((prev) => {
      const filtered = prev.filter(
        (b) => !(b.pageNum === newBm.pageNum && b.ayahNum === newBm.ayahNum && b.label === newBm.label)
      );
      return [newBm, ...filtered].slice(0, 12);
    });
    setBookmarkNoteInput('');
  };

  const handleJumpToBookmark = (bm: MushafBookmark) => {
    handleJumpToPage(bm.pageNum);
    if (bm.focusedKeys && bm.focusedKeys.length > 0) {
      setIsFocusMode(true);
      setFocusedAyahKeys(bm.focusedKeys);
    } else if (bm.surahId && bm.ayahNum) {
      setIsFocusMode(true);
      setFocusedAyahKeys([`${bm.surahId}:${bm.ayahNum}`]);
    }
    setIsBookmarksOpen(false);
  };

  const handleDeleteBookmark = (id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  };

  const renderLensWordText = (wordItem: Extract<MushafLineItem, { kind: 'word' }>) => {
    const segments: Array<{ text: string; color: string | null }> = [];
    for (let tIdx = 0; tIdx < wordItem.tokens.length; tIdx++) {
      const token = wordItem.tokens[tIdx];
      if (token.type === 'symbol') continue;
      const piece = token.base + token.extra;
      const rule = mushafTajweed && wordItem.tajweed ? wordItem.tajweed[tIdx] : undefined;
      const color = rule ? TAJWEED_COLORS[rule] : null;
      if (segments.length > 0 && segments[segments.length - 1].color === color) {
        segments[segments.length - 1].text += piece;
      } else {
        segments.push({ text: piece, color });
      }
    }
    return segments.map((seg, idx) =>
      seg.color ? (
        <span key={idx} style={{ color: seg.color }}>
          {seg.text}
        </span>
      ) : (
        <React.Fragment key={idx}>{seg.text}</React.Fragment>
      )
    );
  };

  return (
    <div
      className="sub-panel active"
      id="sub-surah"
      data-variant={variant}
    >
      <AyahRosetteSymbolDefs />
      <div
        ref={hudSlotRef}
        className={`mushaf-hud-slot ${showFloatingHud ? 'is-floating-open' : ''}`}
        style={
          showFloatingHud
            ? ({
                minHeight: reservedHudHeight > 0 ? `${reservedHudHeight}px` : undefined,
                '--mushaf-floating-w': floatingHudWidth > 0 ? `${floatingHudWidth}px` : undefined,
              } as React.CSSProperties)
            : undefined
        }
      >
      <div
        ref={hudBoxRef}
        className={`mushaf-sticky-hud ${showFloatingHud ? 'is-floating-open' : ''} ${
          showFloatingHud && isFloatingHudEntering ? 'is-entering' : ''
        }`}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget && isFloatingHudEntering) {
            setIsFloatingHudEntering(false);
          }
        }}
        data-annotation-ui="true"
      >
        <div className="apply-toolbar-row mushaf-toolbar-row" id="surah-toolbar-row">
        <div className="apply-select-group mushaf-nav-controls">
          <div className="apply-select-wrap">
            <select
              id="surah-select"
              aria-label="اختر سورة"
              value={currentSurahEntry.name}
              onChange={(e) => handleSelectSurah(e.target.value)}
            >
              {mushafSurahs.map((surah) => (
                <option key={surah.id} value={surah.name}>
                  {toArabicDigits(surah.id)}. سورة {surah.name} ({toArabicDigits(surah.totalAyat)})
                </option>
              ))}
            </select>
            <ChevronDown className="apply-select-chevron" aria-hidden="true" />
          </div>
        </div>

        <div className="mushaf-toolbar-actions">

          {hasPractice && (
            <div className="mushaf-mode-toggle" role="group" aria-label="وضع عرض المصحف">
              <button
                type="button"
                className={`mushaf-mode-btn ${mushafMode === 'practice' ? 'is-active' : ''}`}
                onClick={() => {
                  setMushafMode('practice');
                  setSurahStatus({ msg: '', kind: null });
                }}
              >
                <BookMarked className="w-3.5 h-3.5" aria-hidden="true" />
                <span>وضع التدريب</span>
              </button>
              <button
                type="button"
                className={`mushaf-mode-btn ${mushafMode === 'reading' ? 'is-active' : ''}`}
                onClick={() => {
                  setMushafMode('reading');
                  setSurahRevealed(false);
                  setSurahStatus({ msg: '', kind: null });
                }}
              >
                <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                <span>وضع القراءة</span>
              </button>
            </div>
          )}

          <div className="mushaf-zoom-control" role="group" aria-label="تكبير وتصغير الآيات">
            <button
              type="button"
              className="mushaf-zoom-btn"
              disabled={!canZoomIn}
              onClick={() => handleStepZoom(1)}
              title="تكبير الآيات"
              aria-label="تكبير الآيات"
            >
              <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`mushaf-zoom-readout ${mushafZoom !== 1 ? 'is-modified' : ''}`}
              disabled={mushafZoom === 1}
              onClick={() => setMushafZoom(1)}
              title={mushafZoom === 1 ? 'الحجم الافتراضي للآيات' : 'إعادة الحجم إلى ١٠٠٪'}
              aria-label={`نسبة تكبير الآيات ${toArabicDigits(Math.round(mushafZoom * 100))} بالمئة`}
            >
              {toArabicDigits(Math.round(mushafZoom * 100))}٪
            </button>
            <button
              type="button"
              className="mushaf-zoom-btn"
              disabled={!canZoomOut}
              onClick={() => handleStepZoom(-1)}
              title="تصغير الآيات"
              aria-label="تصغير الآيات"
            >
              <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            className={`mushaf-tajweed-toggle-btn ${mushafTajweed ? 'is-active' : ''}`}
            aria-pressed={mushafTajweed}
            aria-label={mushafTajweed ? 'التجويد مفعّل، اضغط للإيقاف' : 'التجويد متوقف، اضغط للتفعيل'}
            onClick={() => setMushafTajweed((prev) => !prev)}
            title={mushafTajweed ? 'إيقاف ألوان التجويد' : 'تفعيل ألوان التجويد'}
          >
            <Palette className="w-3.5 h-3.5" aria-hidden="true" />
            <span>التجويد</span>
            <span className="mushaf-tajweed-switch" aria-hidden="true">
              <span className="mushaf-tajweed-switch-knob" />
            </span>
          </button>

          <button
            type="button"
            className={`mushaf-teacher-toggle-btn ${isTeacherDockOpen ? 'is-open' : ''} ${
              hasTeacherActiveState ? 'has-active' : ''
            }`}
            aria-expanded={isTeacherDockOpen}
            aria-pressed={isTeacherDockOpen}
            onClick={handleToggleTeacherDock}
            title="أدوات الحصة للمصحف (تركيز آية، إخفاء للتسميع، علامة التوقف)"
          >
            <ScanEye className="w-3.5 h-3.5" aria-hidden="true" />
            <span>أدوات المعلم</span>
          </button>

          {variant === 'standalone' && onTogglePresentationMode && (
            <button
              type="button"
              className={`mushaf-presentation-btn ${isPresentationMode ? 'is-active' : ''}`}
              aria-pressed={isPresentationMode}
              onClick={onTogglePresentationMode}
              title={isPresentationMode ? 'إنهاء ملء الشاشة (Esc)' : 'تكبير العرض للبث والشاشة الكاملة'}
            >
              {isPresentationMode ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>إنهاء العرض</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>ملء الشاشة</span>
                </>
              )}
            </button>
          )}

          {isEffectivePractice && (
            <div
              className={`counter-pill ${
                surahTotalTargets > 0 && surahFoundCount === surahTotalTargets ? 'is-complete' : ''
              }`}
              id="surah-counter"
              aria-live="polite"
            >
              وجدت {toArabicDigits(surahFoundCount)} من {toArabicDigits(surahTotalTargets)}
            </div>
          )}

          {showFloatingHud && (
            <div className="mushaf-floating-hud-controls">
              <button
                type="button"
                className={`mushaf-floating-pin-btn ${isFloatingPinned ? 'is-pinned' : ''}`}
                aria-pressed={isFloatingPinned}
                onClick={() => setIsFloatingPinned((prev) => !prev)}
                title={
                  isFloatingPinned
                    ? 'إلغاء تثبيت الشريط (ينطوي تلقائياً عند لمس المصحف)'
                    : 'تثبيت الشريط العائم أثناء التمرير'
                }
              >
                {isFloatingPinned ? (
                  <PinOff className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Pin className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{isFloatingPinned ? 'مثبّت' : 'تثبيت'}</span>
              </button>
              <button
                type="button"
                className="mushaf-floating-close-btn"
                onClick={() => setIsFloatingHudOpen(false)}
                title="طي الشريط لإتاحة كامل مساحة المصحف (Esc)"
                aria-label="طي الشريط"
              >
                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                <span>طي</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {isTeacherDockOpen && (
        <div
          className="mushaf-teacher-dock"
          role="toolbar"
          aria-label="أدوات المعلم للمصحف أثناء الحصة"
        >
          <div className="mushaf-teacher-dock-row">
            <div className="mushaf-teacher-group" role="group" aria-label="وضع التركيز على آية أو عدة آيات">
              <button
                type="button"
                className={`mushaf-teacher-btn ${isFocusMode ? 'is-active' : ''}`}
                aria-pressed={isFocusMode}
                onClick={handleToggleFocusMode}
                title="تعتيم باقي الصفحة وإضاءة آية أو عدة آيات معاً لمنع التشتت"
              >
                <ScanEye className="w-3.5 h-3.5" aria-hidden="true" />
                <span>وضع التركيز</span>
              </button>

              {isFocusMode && pageAyahList.length > 0 && (
                <>
                  <div className="mushaf-teacher-stepper">
                    <button
                      type="button"
                      className="mushaf-teacher-step-btn"
                      disabled={!canStepFocusPrev}
                      onClick={() => handleStepFocusedAyah(-1)}
                      title={focusedCount > 1 ? 'تحريك المقطع للآية السابقة' : 'الآية السابقة'}
                      aria-label={focusedCount > 1 ? 'تحريك المقطع للآية السابقة' : 'الآية السابقة'}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <span className="mushaf-teacher-step-label">{focusedCompactLabel}</span>
                    <button
                      type="button"
                      className="mushaf-teacher-step-btn"
                      disabled={!canStepFocusNext}
                      onClick={() => handleStepFocusedAyah(1)}
                      title={focusedCount > 1 ? 'تحريك المقطع للآية التالية' : 'الآية التالية'}
                      aria-label={focusedCount > 1 ? 'تحريك المقطع للآية التالية' : 'الآية التالية'}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="mushaf-teacher-stepper is-range-ctrl" role="group" aria-label="إضافة أو تقليص آيات التركيز">
                    <button
                      type="button"
                      className="mushaf-teacher-step-btn is-add-ayah"
                      disabled={!canAppendFocusAyah}
                      onClick={handleAppendFocusedAyah}
                      title="إضافة الآية التالية إلى وضع التركيز"
                      aria-label="إضافة الآية التالية إلى وضع التركيز"
                    >
                      <Plus className="w-3.5 h-3.5" strokeWidth={2.3} />
                      <span>إضافة آية</span>
                    </button>
                    {focusedCount > 1 && (
                      <button
                        type="button"
                        className="mushaf-teacher-step-btn is-remove-ayah"
                        onClick={handleRemoveLastFocusedAyah}
                        title="إزالة آخر آية مضافة من التركيز"
                        aria-label="إزالة آخر آية مضافة من التركيز"
                      >
                        <Minus className="w-3.5 h-3.5" strokeWidth={2.3} />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className={`mushaf-teacher-btn ${isFocusPickerOpen ? 'is-active' : 'is-subtle'}`}
                    aria-expanded={isFocusPickerOpen}
                    onClick={() => setIsFocusPickerOpen((prev) => !prev)}
                    title="اختيار أي مجموعة آيات من الصفحة لوضع التركيز"
                  >
                    <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>تحديد الآيات</span>
                  </button>

                  <button
                    type="button"
                    className={`mushaf-teacher-btn ${isFocusLensOpen ? 'is-active' : 'is-subtle'}`}
                    aria-pressed={isFocusLensOpen}
                    onClick={() => setIsFocusLensOpen((prev) => !prev)}
                    title="عرض الآيات المختارة داخل عدسة زجاجية هادئة فوق صفحة القرآن"
                  >
                    <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>عدسة زجاجية</span>
                  </button>
                </>
              )}
            </div>

            <div className="mushaf-teacher-divider" aria-hidden="true" />

            <div className="mushaf-teacher-group" role="group" aria-label="أدوات التسميع والإخفاء">
              <button
                type="button"
                className={`mushaf-teacher-btn ${isHifzHidden ? 'is-active' : ''}`}
                aria-pressed={isHifzHidden}
                onClick={handleToggleHifzMode}
                title="إخفاء كلمات الآيات للتسميع مع إبقاء أرقام الآيات ظاهرة"
              >
                {isHifzHidden ? (
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{isHifzHidden ? 'إنهاء التسميع' : 'إخفاء للتسميع'}</span>
              </button>

              {isHifzHidden && (
                <>
                  <button
                    type="button"
                    className="mushaf-teacher-btn is-subtle"
                    onClick={() => handleRevealNextAyah(false)}
                    title="كشف الآية التالية كاملة بالتدريج (أو اضغط المسطرة Space)"
                  >
                    <span>كشف آية</span>
                  </button>
                  <button
                    type="button"
                    className="mushaf-teacher-btn is-subtle"
                    onClick={handleRevealAllHifz}
                    title="كشف جميع آيات الصفحة"
                  >
                    <span>كشف الكل</span>
                  </button>
                  <button
                    type="button"
                    className="mushaf-teacher-btn is-subtle"
                    onClick={handleHideAllHifz}
                    title="إعادة إخفاء جميع الكلمات"
                  >
                    <span>إخفاء الكل</span>
                  </button>
                </>
              )}
            </div>

            <div className="mushaf-teacher-divider" aria-hidden="true" />

            <div className="mushaf-teacher-group" role="group" aria-label="علامة التوقف">
              <button
                type="button"
                className={`mushaf-teacher-btn ${currentPageBookmark ? 'is-bookmarked' : ''}`}
                onClick={() => handleSaveBookmark()}
                title="حفظ الصفحة والآية الحالية كعلامة توقف للطالب"
              >
                {currentPageBookmark ? (
                  <BookmarkCheck className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>حفظ الموضع</span>
              </button>

              <button
                type="button"
                className={`mushaf-teacher-btn ${isBookmarksOpen ? 'is-active' : ''}`}
                aria-expanded={isBookmarksOpen}
                onClick={() => setIsBookmarksOpen((prev) => !prev)}
                title="عرض العلامات المحفوظة للطلاب"
              >
                <span>العلامات ({toArabicDigits(bookmarks.length)})</span>
              </button>

            </div>
          </div>

          {isFocusMode && isFocusPickerOpen && pageAyahList.length > 0 && (
            <div className="mushaf-focus-picker-drawer" role="region" aria-label="اختيار آيات وضع التركيز">
              <div className="mushaf-focus-picker-head">
                <span className="mushaf-focus-picker-hint">
                  اضغط على أرقام الآيات أو مباشرة على الصفحة لإضافتها أو إزالتها ({toArabicDigits(focusedCount)} من{' '}
                  {toArabicDigits(pageAyahList.length)})
                </span>
                <div className="mushaf-focus-picker-quick">
                  {focusedCount > 1 && (
                    <button
                      type="button"
                      className="mushaf-focus-quick-btn"
                      onClick={handleResetToSingleFocus}
                    >
                      آية واحدة
                    </button>
                  )}
                  {focusedCount < pageAyahList.length && (
                    <button
                      type="button"
                      className="mushaf-focus-quick-btn"
                      onClick={handleSelectAllPageFocus}
                    >
                      كل الصفحة
                    </button>
                  )}
                </div>
              </div>
              <div className="mushaf-focus-picker-chips">
                {pageAyahGroupsBySurah.map((group) => (
                  <React.Fragment key={group.surahId}>
                    {pageAyahGroupsBySurah.length > 1 && (
                      <span className="mushaf-focus-surah-tag">{group.surahName}</span>
                    )}
                    {group.ayahs.map((ayah) => {
                      const isSelected = focusedAyahSet.has(ayah.key);
                      return (
                        <button
                          key={ayah.key}
                          type="button"
                          className={`mushaf-focus-ayah-chip ${isSelected ? 'is-selected' : ''}`}
                          aria-pressed={isSelected}
                          onClick={() => handleToggleFocusAyahKey(ayah.key)}
                          title={
                            isSelected
                              ? focusedCount > 1
                                ? `إزالة آية ${toArabicDigits(ayah.ayahNum)} من التركيز`
                                : `آية ${toArabicDigits(ayah.ayahNum)} محددة`
                              : `إضافة آية ${toArabicDigits(ayah.ayahNum)} إلى التركيز`
                          }
                        >
                          {toArabicDigits(ayah.ayahNum)}
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {isBookmarksOpen && (
            <div className="mushaf-bookmarks-drawer">
              <form className="mushaf-bookmark-form" onSubmit={handleSaveBookmark}>
                <input
                  type="text"
                  className="mushaf-bookmark-input"
                  value={bookmarkNoteInput}
                  onChange={(e) => setBookmarkNoteInput(e.target.value)}
                  placeholder="اسم الطالب أو ملاحظة (اختياري، مثل: أحمد — سورة النبأ)"
                  aria-label="اسم الطالب أو عنوان علامة التوقف"
                />
                <button type="submit" className="mushaf-teacher-btn is-active">
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>إضافة علامة هنا</span>
                </button>
              </form>

              {bookmarks.length > 0 ? (
                <div className="mushaf-bookmarks-list">
                  {bookmarks.map((bm) => (
                    <div
                      key={bm.id}
                      className={`mushaf-bookmark-item ${
                        bm.pageNum === clampedMushafPage ? 'is-current' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="mushaf-bookmark-jump"
                        onClick={() => handleJumpToBookmark(bm)}
                      >
                        <BookmarkCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span className="mushaf-bookmark-label">{bm.label}</span>
                        <span className="mushaf-bookmark-meta">
                          ص {toArabicDigits(bm.pageNum)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="mushaf-bookmark-del"
                        onClick={() => handleDeleteBookmark(bm.id)}
                        aria-label={`حذف علامة ${bm.label}`}
                        title="حذف العلامة"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mushaf-bookmarks-empty">
                  لا توجد علامات توقف محفوظة بعد — اضغط «حفظ الموضع» لحفظ صفحة الطالب والعودة إليها بضغطة واحدة.
                </p>
              )}
            </div>
          )}
        </div>
      )}
      </div>
      </div>
      <div ref={hudSentinelRef} className="mushaf-hud-sentinel" aria-hidden="true" />

      {showHudLauncher && (
        <div
          className={`mushaf-hud-launcher ${isHudLauncherEntering ? 'is-entering' : ''}`}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget && isHudLauncherEntering) {
              setIsHudLauncherEntering(false);
            }
          }}
          data-annotation-ui="true"
          role="region"
          aria-label="وصول سريع لشريط المصحف"
        >
          <button
            type="button"
            className="mushaf-hud-launcher-btn"
            onClick={handleOpenFloatingHud}
            title="إظهار شريط أدوات المصحف"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            <span>أدوات المصحف</span>
            {(isHifzHidden || isFocusMode) && (
              <span className="mushaf-hud-launcher-dot" aria-hidden="true" />
            )}
          </button>

          <span className="mushaf-hud-launcher-sep" aria-hidden="true" />
          <button
            type="button"
            className="mushaf-hud-launcher-top"
            onClick={handleScrollToTop}
            title="العودة لأعلى الصفحة"
            aria-label="العودة لأعلى الصفحة"
          >
            <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {isEffectivePractice && practiceConfig && (
        <div className="instruction">
          اضغط على <span className="apply-instruction-accent">{practiceConfig.targetLabel}</span> في الصفحة
        </div>
      )}

      <div
        className={`quran-frame ${
          isEffectivePractice && surahTotalTargets > 0 && surahFoundCount === surahTotalTargets
            ? 'is-solved'
            : ''
        }`}
        id="surah-frame"
        onPointerDownCapture={() => {
          if (showFloatingHud && !isFloatingPinned) {
            setIsFloatingHudOpen(false);
          }
        }}
      >
        <svg
          className="tile-deco-pattern"
          viewBox="0 0 120 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="100" cy="20" r="52" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />
          <circle cx="100" cy="20" r="38" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
          <circle cx="100" cy="20" r="22" stroke="currentColor" strokeWidth="1" opacity="0.5" />
          <circle cx="100" cy="20" r="8" fill="currentColor" opacity="0.25" />
          <rect x="76" y="-4" width="48" height="48" rx="6" transform="rotate(45 100 20)" stroke="currentColor" strokeWidth="1" opacity="0.4" />
          <rect x="76" y="-4" width="48" height="48" rx="6" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        </svg>

        <div
          className={`mushaf-inner-frame ${isEffectivePractice ? 'is-practice-mode' : 'is-reading-mode'} ${
            pageTurn ? 'is-turning' : ''
          }`}
          style={
            {
              '--mushaf-zoom': effectiveMushafScale,
              '--mushaf-user-zoom': mushafZoom,
              '--mushaf-cap-px': `${activeZoomPreset.capPx}px`,
              '--mushaf-slot-pct': `${activeZoomPreset.slotPct}%`,
              '--mushaf-mobile-pct': `${activeZoomPreset.mobilePct}%`,
            } as React.CSSProperties
          }
        >
          <div className="mushaf-spread-stage">
            <div className="mushaf-side-nav-rail is-prev">
              <button
                type="button"
                className="mushaf-side-nav-btn"
                title="الصفحة السابقة"
                aria-label="الصفحة السابقة"
                disabled={clampedMushafPage <= 1}
                onClick={() => handleStepMushafPage(-1)}
              >
                <ChevronRight className="w-5 h-5" strokeWidth={2.5} aria-hidden="true" />
              </button>
            </div>

            <div className="mushaf-spread-slot">
            <div
              className="mushaf-book-spread is-single-page"
              data-turn-dir={pageTurn?.dir}
              data-turn-phase={pageTurn ? (pageTurn.seq % 2 === 0 ? 'a' : 'b') : undefined}
              onAnimationEnd={(e) => {
                if (pageTurn && e.target === e.currentTarget) {
                  setPageTurn(null);
                }
              }}
              aria-label={`المصحف الشريف - صفحة ${toArabicDigits(clampedMushafPage)}`}
            >
            {[{ side: 'single' as const, pageNum: clampedMushafPage, pageData: activeSinglePageData }].map(
              ({ side, pageNum, pageData }) => (
              <article
                key="mushaf-single-sheet"
                className={`mushaf-page-sheet is-${side}-page ${pageNum <= 2 ? 'is-opening-spread' : ''} ${
                  isFocusMode ? 'is-focus-mode-active' : ''
                } ${isHifzHidden ? 'is-hifz-mode-active' : ''} ${
                  isFocusMode && isFocusLensOpen && focusedCount > 0 ? 'has-focus-lens' : ''
                }`}
                aria-label={`صفحة ${toArabicDigits(pageNum)}`}
              >
                <div className="mushaf-page-border-outer">
                  <div className="mushaf-page-border-inner">
                    <header className="mushaf-page-header">
                      <span className="mushaf-page-header-surah">
                        {pageData && pageData.surahNames.length > 0
                          ? pageData.surahNames.length === 1
                            ? `سُورَةُ ${pageData.surahNames[0]}`
                            : pageData.surahNames.join(' · ')
                          : `صفحة ${toArabicDigits(pageNum)}`}
                      </span>
                      <span className="mushaf-page-header-right">
                        {currentPageBookmark && (
                          <span className="mushaf-page-bookmark-tag" title={currentPageBookmark.label}>
                            <BookmarkCheck className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>علامة التوقف</span>
                          </span>
                        )}
                        <span className="mushaf-page-header-juz">
                          الجزء {toArabicDigits(pageData?.jozz || currentJozz)}
                        </span>
                      </span>
                    </header>

                    <div
                      ref={pageBodyRef}
                      className={`mushaf-page-body ${pageNum <= 2 ? 'is-opening-spread' : 'is-standard-page'}`}
                      style={
                        uniformPageFontSize
                          ? ({ '--mushaf-uniform-fs': `${uniformPageFontSize.toFixed(2)}px` } as React.CSSProperties)
                          : undefined
                      }
                    >
                      {pageData ? (
                        pageData.rows.map((row) => {
                          if (row.kind === 'banner') {
                            const seg = row.surahMeta;
                            return (
                              <div
                                key={`${pageNum}_b_${row.line}_${seg.id}`}
                                className="mushaf-surah-banner"
                                aria-label={`سورة ${seg.name}`}
                              >
                                <div className="mushaf-banner-dashed-inset" aria-hidden="true" />

                                <div className="mushaf-banner-wing is-right">
                                  <div className="mushaf-wing-fill" aria-hidden="true" />
                                  <svg
                                    className="mushaf-wing-arc-svg"
                                    viewBox="0 0 28 60"
                                    preserveAspectRatio="none"
                                    fill="none"
                                    aria-hidden="true"
                                  >
                                    <path d="M28 0H22C10 2 3 15 3 30C3 45 10 58 22 60H28Z" fill="#EEF3FF" />
                                    <path
                                      d="M25 1.5C11 3.5 3.5 16 3.5 30C3.5 44 11 56.5 25 58.5"
                                      stroke="currentColor"
                                      strokeWidth="1.35"
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                  <svg className="mushaf-wing-star" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                                    <path
                                      d="M10 1.5L12.1 7.9L18.5 10L12.1 12.1L10 18.5L7.9 12.1L1.5 10L7.9 7.9L10 1.5Z"
                                      fill="rgba(59, 130, 246, 0.14)"
                                      stroke="currentColor"
                                      strokeWidth="1.4"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                  <span className="mushaf-wing-text">{seg.rev}</span>
                                </div>

                                <div className="mushaf-surah-center">
                                  <svg className="mushaf-center-asterisk" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                                    <path
                                      d="M9 1.5V16.5M1.5 9H16.5M3.7 3.7L14.3 14.3M14.3 3.7L3.7 14.3"
                                      stroke="currentColor"
                                      strokeWidth="1.35"
                                      strokeLinecap="round"
                                    />
                                    <circle cx="9" cy="9" r="1.6" fill="#FFFFFF" stroke="currentColor" strokeWidth="1.1" />
                                  </svg>
                                  <span className="mushaf-surah-title">سُورَةُ {seg.name}</span>
                                  <svg className="mushaf-center-asterisk" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                                    <path
                                      d="M9 1.5V16.5M1.5 9H16.5M3.7 3.7L14.3 14.3M14.3 3.7L3.7 14.3"
                                      stroke="currentColor"
                                      strokeWidth="1.35"
                                      strokeLinecap="round"
                                    />
                                    <circle cx="9" cy="9" r="1.6" fill="#FFFFFF" stroke="currentColor" strokeWidth="1.1" />
                                  </svg>
                                </div>

                                <div className="mushaf-banner-wing is-left">
                                  <div className="mushaf-wing-fill" aria-hidden="true" />
                                  <svg
                                    className="mushaf-wing-arc-svg"
                                    viewBox="0 0 28 60"
                                    preserveAspectRatio="none"
                                    fill="none"
                                    aria-hidden="true"
                                  >
                                    <path d="M0 0H6C18 2 25 15 25 30C25 45 18 58 6 60H0Z" fill="#EEF3FF" />
                                    <path
                                      d="M3 1.5C17 3.5 24.5 16 24.5 30C24.5 44 17 56.5 3 58.5"
                                      stroke="currentColor"
                                      strokeWidth="1.35"
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                  <span className="mushaf-wing-text">آيَاتُهَا</span>
                                  <span
                                    className={`mushaf-wing-ayah-badge ${seg.totalAyat >= 100 ? 'is-triple' : ''}`}
                                    aria-label={`${toArabicDigits(seg.totalAyat)} آية`}
                                  >
                                    <svg className="mushaf-wing-badge-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                      <path
                                        d="M12 1.8L14.8 4.6L18.8 4.6L19.4 8.6L22.2 12L19.4 15.4L18.8 19.4L14.8 19.4L12 22.2L9.2 19.4L5.2 19.4L4.6 15.4L1.8 12L4.6 8.6L5.2 4.6L9.2 4.6L12 1.8Z"
                                        fill="#FFFFFF"
                                        stroke="currentColor"
                                        strokeWidth="1.35"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                    <span className="mushaf-wing-badge-num">{toArabicDigits(seg.totalAyat)}</span>
                                  </span>
                                  <svg className="mushaf-wing-star" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                                    <path
                                      d="M10 1.5L12.1 7.9L18.5 10L12.1 12.1L10 18.5L7.9 12.1L1.5 10L7.9 7.9L10 1.5Z"
                                      fill="rgba(59, 130, 246, 0.14)"
                                      stroke="currentColor"
                                      strokeWidth="1.4"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </div>
                              </div>
                            );
                          }

                          if (row.kind === 'basmalah') {
                            return (
                              <div
                                key={`${pageNum}_m_${row.line}_${row.surahId}`}
                                className="mushaf-basmalah"
                                aria-hidden="true"
                              >
                                {'بِسۡ\u0640\u0640\u0640مِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِي\u0640\u0640\u0640مِ'}
                              </div>
                            );
                          }

                          return (
                            <MushafLineRow
                              key={`${pageNum}_t_${row.line}`}
                              items={row.items}
                              isCentered={row.isCentered}
                              isPractice={isEffectivePractice}
                              isTajweedEnabled={mushafTajweed}
                              correctMap={surahCorrectMap}
                              revealed={surahRevealed}
                              wrongKey={surahWrongKey}
                              onLetterClick={stableSurahLetterClick}
                              toArabicDigits={toArabicDigits}
                              zoomScale={effectiveMushafScale}
                              uniformFontSize={uniformPageFontSize}
                              isFontSynced={isUniformFontSynced}
                              focusedAyahKeys={isFocusMode ? focusedAyahSet : null}
                              isHifzHidden={isHifzHidden}
                              revealedWordKeys={revealedWordKeys}
                              revealedAyahKeys={revealedAyahKeys}
                              onWordAction={
                                isHifzHidden || isFocusMode ? handleWordTeacherClick : undefined
                              }
                              onAyahAction={
                                isHifzHidden || isFocusMode ? handleAyahTeacherClick : undefined
                              }
                              subscribePageResize={subscribePageResize}
                            />
                          );
                        })
                      ) : (
                        <div className="mushaf-page-loading">جارٍ تحميل صفحات المصحف الشريف...</div>
                      )}
                    </div>

                    <footer className="mushaf-page-footer">
                      <span className="mushaf-page-footer-flourish" aria-hidden="true">✦</span>
                      <span className="mushaf-page-footer-num">{toArabicDigits(pageNum)}</span>
                      <span className="mushaf-page-footer-flourish" aria-hidden="true">✦</span>
                    </footer>

                    <AnnotationSurface
                      surfaceId={`mushaf:page:${pageNum}`}
                      ariaLabel={`طبقة الرسم والتظليل على صفحة ${toArabicDigits(pageNum)}`}
                    />
                  </div>
                </div>

                {isFocusMode && isFocusLensOpen && focusedCount > 0 && (
                  <div
                    className="mushaf-liquid-lens-backdrop"
                    role="dialog"
                    aria-modal="false"
                    aria-label={`عدسة التركيز الزجاجية — ${focusedLensTitle.surah} ${focusedLensTitle.ayahs}`}
                    dir="rtl"
                    onClick={(e) => {
                      if (e.target === e.currentTarget) {
                        setIsFocusLensOpen(false);
                      }
                    }}
                  >
                    <div
                      className="mushaf-liquid-lens-card"
                      onPointerEnter={handleLiquidPointerEnter}
                      onPointerLeave={handleLiquidPointerLeave}
                      onPointerMove={handleLiquidPointerMove}
                    >
                      <header className="mushaf-liquid-lens-header">
                        <div className="mushaf-liquid-lens-title">
                          <span>{focusedLensTitle.surah}</span>
                          <span className="mushaf-liquid-sep" aria-hidden="true">·</span>
                          <span>{focusedLensTitle.ayahs}</span>
                          {focusedLensTitle.countBadge && (
                            <span className="mushaf-liquid-count-tag">
                              {focusedLensTitle.countBadge}
                            </span>
                          )}
                        </div>

                        <div className="mushaf-liquid-lens-head-actions">
                          <button
                            type="button"
                            className={`mushaf-liquid-btn ${isLensPickerOpen ? 'is-active' : ''}`}
                            aria-expanded={isLensPickerOpen}
                            onClick={() => setIsLensPickerOpen((prev) => !prev)}
                            title="تحديد أو إضافة آيات أخرى داخل العدسة"
                          >
                            <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>تحديد الآيات</span>
                          </button>
                          <button
                            type="button"
                            className={`mushaf-liquid-btn ${isHifzHidden ? 'is-active' : ''}`}
                            aria-pressed={isHifzHidden}
                            onClick={handleToggleHifzMode}
                            title={isHifzHidden ? 'إظهار كلمات الآيات' : 'إخفاء كلمات الآيات للتسميع'}
                          >
                            {isHifzHidden ? (
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                            ) : (
                              <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            <span>{isHifzHidden ? 'إنهاء الإخفاء' : 'إخفاء للتسميع'}</span>
                          </button>
                          <button
                            type="button"
                            className="mushaf-liquid-icon-btn"
                            onClick={() => setIsFocusLensOpen(false)}
                            title="إغلاق العدسة (Esc)"
                            aria-label="إغلاق العدسة الزجاجية"
                          >
                            <X className="w-4 h-4" strokeWidth={2.2} />
                          </button>
                        </div>
                      </header>

                      {isLensPickerOpen && (
                        <div className="mushaf-lens-picker-bar" role="region" aria-label="اختيار آيات العدسة">
                          <div className="mushaf-focus-picker-chips">
                            {pageAyahGroupsBySurah.map((group) => (
                              <React.Fragment key={group.surahId}>
                                {pageAyahGroupsBySurah.length > 1 && (
                                  <span className="mushaf-focus-surah-tag">{group.surahName}</span>
                                )}
                                {group.ayahs.map((ayah) => {
                                  const isSelected = focusedAyahSet.has(ayah.key);
                                  return (
                                    <button
                                      key={ayah.key}
                                      type="button"
                                      className={`mushaf-focus-ayah-chip ${isSelected ? 'is-selected' : ''}`}
                                      aria-pressed={isSelected}
                                      onClick={() => handleToggleFocusAyahKey(ayah.key)}
                                      title={
                                        isSelected
                                          ? focusedCount > 1
                                            ? `إزالة آية ${toArabicDigits(ayah.ayahNum)}`
                                            : `آية ${toArabicDigits(ayah.ayahNum)}`
                                          : `إضافة آية ${toArabicDigits(ayah.ayahNum)}`
                                      }
                                    >
                                      {toArabicDigits(ayah.ayahNum)}
                                    </button>
                                  );
                                })}
                              </React.Fragment>
                            ))}
                          </div>
                          <div className="mushaf-focus-picker-quick">
                            {focusedCount > 1 && (
                              <button
                                type="button"
                                className="mushaf-focus-quick-btn"
                                onClick={handleResetToSingleFocus}
                              >
                                آية واحدة
                              </button>
                            )}
                            {focusedCount < pageAyahList.length && (
                              <button
                                type="button"
                                className="mushaf-focus-quick-btn"
                                onClick={handleSelectAllPageFocus}
                              >
                                كل الصفحة
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      <div ref={lensStageRef} className="mushaf-liquid-lens-stage">
                        <div className="mushaf-liquid-lens-scroll-inner">
                          {focusedLensPassageGroups.map((group, gIdx) => (
                            <React.Fragment key={group.id}>
                              {gIdx > 0 && (
                                <div className="mushaf-lens-passage-divider" aria-hidden="true">
                                  <span className="mushaf-lens-passage-line" />
                                  <span className="mushaf-lens-passage-meta">
                                    {group.surahId !== focusedLensPassageGroups[gIdx - 1].surahId
                                      ? `سورة ${group.surahName} · ${group.ayahLabel}`
                                      : group.ayahLabel}
                                  </span>
                                  <span className="mushaf-lens-passage-line" />
                                </div>
                              )}
                              <div
                                className={`mushaf-liquid-lens-ayah ${
                                  focusedCount >= 4
                                    ? 'is-count-many'
                                    : focusedCount >= 2
                                    ? 'is-count-multi'
                                    : 'is-count-single'
                                }`}
                                dir="rtl"
                              >
                                {group.items.map((lineItem, wIdx) => {
                                  if (lineItem.kind === 'rosette') {
                                    return (
                                      <AyahRosette
                                        key={`${lineItem.keyPrefix}_lens_r_${wIdx}`}
                                        ayahNum={lineItem.ayahNum}
                                        toArabicDigits={toArabicDigits}
                                        isFocused={true}
                                        title={isHifzHidden ? 'اضغط لكشف أو إخفاء الآية كاملة' : undefined}
                                        onClick={
                                          isHifzHidden
                                            ? () => handleAyahTeacherClick(lineItem.surahId, lineItem.ayahNum)
                                            : undefined
                                        }
                                      />
                                    );
                                  }
                                  const wordItem = lineItem;
                                  const wordAyahKey = `${wordItem.surahId}:${wordItem.ayahNum}`;
                                  const isWordHidden = Boolean(
                                    isHifzHidden &&
                                      !revealedWordKeys[wordItem.keyPrefix] &&
                                      !revealedAyahKeys[wordAyahKey]
                                  );
                                  const isWordRevealedInHifz = Boolean(isHifzHidden && !isWordHidden);
                                  return (
                                    <span
                                      key={`${wordItem.keyPrefix}_lens_${wIdx}`}
                                      className="mushaf-lens-word-cluster"
                                    >
                                      <span
                                        data-lens-ayah-key={wordAyahKey}
                                        className={`mushaf-lens-word ${isWordHidden ? 'is-hifz-hidden' : ''} ${
                                          isWordRevealedInHifz ? 'is-hifz-revealed' : ''
                                        } ${isHifzHidden ? 'is-interactive' : ''}`}
                                        title={
                                          isWordHidden
                                            ? 'اضغط لكشف الكلمة'
                                            : isWordRevealedInHifz
                                            ? 'اضغط لإعادة إخفاء الكلمة'
                                            : undefined
                                        }
                                        onClick={
                                          isHifzHidden ? () => handleWordTeacherClick(wordItem) : undefined
                                        }
                                      >
                                        <span className="mushaf-lens-word-text">
                                          {isWordHidden ? wordItem.rawWord : renderLensWordText(wordItem)}
                                        </span>
                                      </span>
                                      {wordItem.ayahEnd !== null && (
                                        <AyahRosette
                                          ayahNum={wordItem.ayahEnd}
                                          toArabicDigits={toArabicDigits}
                                          isFocused={true}
                                          title={isHifzHidden ? 'اضغط لكشف أو إخفاء الآية كاملة' : undefined}
                                          onClick={
                                            isHifzHidden
                                              ? () => handleAyahTeacherClick(wordItem.surahId, wordItem.ayahEnd!)
                                              : undefined
                                          }
                                        />
                                      )}
                                    </span>
                                  );
                                })}
                              </div>
                            </React.Fragment>
                          ))}
                          {isHifzHidden && (
                            <p className="mushaf-liquid-lens-hint">
                              اضغط على أي قطعة زجاجية لكشف الكلمة، أو رقم الآية لكشف الآية كاملة
                            </p>
                          )}
                        </div>
                      </div>

                      <footer className="mushaf-liquid-lens-footer">
                        <button
                          type="button"
                          className="mushaf-liquid-btn"
                          disabled={!canStepFocusPrev}
                          onClick={() => handleStepFocusedAyah(-1)}
                        >
                          <ChevronRight className="w-4 h-4" strokeWidth={2.2} />
                          <span>{focusedCount > 1 ? 'المقطع السابق' : 'الآية السابقة'}</span>
                        </button>

                        <div className="mushaf-liquid-lens-mid-actions">
                          <div className="mushaf-liquid-range-group" role="group" aria-label="إضافة أو تقليص آية">
                            <button
                              type="button"
                              className="mushaf-liquid-btn is-primary"
                              disabled={!canAppendFocusAyah}
                              onClick={handleAppendFocusedAyah}
                              title="إضافة الآية التالية إلى العدسة"
                            >
                              <Plus className="w-3.5 h-3.5" strokeWidth={2.4} aria-hidden="true" />
                              <span>إضافة آية</span>
                            </button>
                            {focusedCount > 1 && (
                              <button
                                type="button"
                                className="mushaf-liquid-icon-btn"
                                onClick={handleRemoveLastFocusedAyah}
                                title="إزالة آخر آية مضافة"
                                aria-label="إزالة آخر آية مضافة"
                              >
                                <Minus className="w-3.5 h-3.5" strokeWidth={2.4} />
                              </button>
                            )}
                          </div>

                          {isHifzHidden && (
                            <button
                              type="button"
                              className="mushaf-liquid-btn is-primary"
                              onClick={handleToggleRevealFocusedAyahs}
                            >
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>
                                {areAllFocusedRevealed
                                  ? focusedCount > 1
                                    ? 'إعادة إخفاء الآيات'
                                    : 'إعادة إخفاء الآية'
                                  : focusedCount > 1
                                  ? 'كشف الآيات المختارة'
                                  : 'كشف هذه الآية'}
                              </span>
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          className="mushaf-liquid-btn"
                          disabled={!canStepFocusNext}
                          onClick={() => handleStepFocusedAyah(1)}
                        >
                          <span>{focusedCount > 1 ? 'المقطع التالي' : 'الآية التالية'}</span>
                          <ChevronLeft className="w-4 h-4" strokeWidth={2.2} />
                        </button>
                      </footer>
                    </div>
                  </div>
                )}
              </article>
            ))}
            </div>
            </div>

            <div className="mushaf-side-nav-rail is-next">
              <button
                type="button"
                className="mushaf-side-nav-btn"
                title="الصفحة التالية"
                aria-label="الصفحة التالية"
                disabled={clampedMushafPage >= TOTAL_MUSHAF_PAGES}
                onClick={() => handleStepMushafPage(1)}
              >
                <ChevronLeft className="w-5 h-5" strokeWidth={2.5} aria-hidden="true" />
              </button>
            </div>
          </div>

          {mushafTajweed && (
            <div className="mushaf-tajweed-legend" aria-label="دليل ألوان أحكام التجويد">
              {TAJWEED_LEGEND.map((item) => (
                <span key={item.kind} className="mushaf-tajweed-chip">
                  <span
                    className="mushaf-tajweed-dot"
                    style={{ backgroundColor: item.color }}
                    aria-hidden="true"
                  />
                  <span
                    className="mushaf-tajweed-label"
                    style={{ color: item.kind === 'idgham' ? '#526075' : item.color }}
                  >
                    {item.label}
                  </span>
                </span>
              ))}
            </div>
          )}

          <div className="mushaf-pagination-bar" role="navigation" aria-label="تصفح صفحات المصحف">
            <button
              type="button"
              className="mushaf-page-btn"
              disabled={clampedMushafPage <= 1}
              onClick={() => handleStepMushafPage(-1)}
            >
              <ChevronRight className="w-4 h-4" strokeWidth={2.4} />
              <span>الصفحة السابقة</span>
            </button>

            <div className="mushaf-page-jump">
              <select
                className="mushaf-page-select"
                aria-label="اختر صفحة المصحف"
                value={clampedMushafPage}
                onChange={(e) => handleJumpToPage(Number(e.target.value))}
              >
                {pageSelectOptions.map((opt) => (
                  <option key={opt.pageNum} value={opt.pageNum}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="mushaf-page-btn"
              disabled={clampedMushafPage >= TOTAL_MUSHAF_PAGES}
              onClick={() => handleStepMushafPage(1)}
            >
              <span>الصفحة التالية</span>
              <ChevronLeft className="w-4 h-4" strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </div>

      {isEffectivePractice && surahStatus.msg && (
        <div
          role="status"
          aria-live="polite"
          className={`status-line word-extract-feedback ${
            surahStatus.kind === 'bad' ? 'is-wrong' : 'is-correct-letter'
          }`}
          id="surah-status"
        >
          {surahStatus.kind === 'bad' ? (
            <X className="w-4 h-4 shrink-0" strokeWidth={2.6} />
          ) : (
            <Check className="w-4 h-4 shrink-0" strokeWidth={2.6} />
          )}
          <span>{surahStatus.msg}</span>
        </div>
      )}

      {isEffectivePractice && (
        <div className="controls-row" id="surah-controls">
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
        </div>
      )}
    </div>
  );
};
