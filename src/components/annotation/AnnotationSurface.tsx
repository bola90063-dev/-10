import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAnnotation } from './AnnotationContext';
import {
  adjustSnappedShapeOnDrag,
  applyShapeHandleDrag,
  buildQuickShapeFromDrag,
  createLivePenDraftSession,
  cssBoundsToPixelRect,
  detectHoldShape,
  drawAppleHighlighterStroke,
  drawApplePenStroke,
  drawLassoOverlay,
  drawMagneticSnapIndicator,
  drawShapeSelectionOverlay,
  enforcePerfectShape,
  eraseStrokePartiallyPath,
  findMagneticSnapTarget,
  findScribbleErasedStrokeIds,
  findStrokesInLasso,
  getStrokeScreenBounds,
  getStrokesGroupBounds,
  hitTestShapeHandle,
  hitTestShapeStroke,
  hitTestStroke,
  hitTestStrokePath,
  remapPointsAfterShapeEdit,
  renderLiveHighlighterWithSession,
  renderLivePenDraftWithSession,
  renderMorphedShapeStroke,
  resetLivePenDraftSession,
  snapInitialShapeToAnchors,
  translateStroke,
  tryMergeTwoStrokeArrow,
  unionPixelRects,
  type LivePenDraftSession,
  type PixelRect,
  type RenderTransform,
  type SnapDragBase,
} from './strokeEngine';
import type { AnnotationPoint, AnnotationStroke, AnnotationStrokeKind, AnnotationTool } from './types';

interface AnnotationSurfaceProps {
  /** Unique persistent ID for this drawing surface (e.g. "mushaf:page:1", "whiteboard:1") */
  surfaceId: string;
  /** Optional accessible label */
  ariaLabel?: string;
  /** Optional extra CSS class */
  className?: string;
}

const HOLD_SNAP_DELAY_MS = 760;
const HOLD_MOVE_THRESHOLD_PX = 3.5;
const HOLD_PATH_RESET_PX = 4.5;
const MAX_SURFACE_DPR = 1.5;

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return `rgba(0, 122, 255, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isDrawSelectionTool(tool: AnnotationTool): boolean {
  return (
    tool === 'pen' ||
    tool === 'fountain' ||
    tool === 'pencil' ||
    tool === 'highlighter' ||
    tool === 'shapes' ||
    tool === 'tape'
  );
}

/**
 * Reusable bounded High-DPI Apple PencilKit drawing surface.
 *
 * Ultra-low-latency 3-layer architecture (0-frame pen-to-ink latency even during Google Meet screen share):
 * - Static committed `penCanvas` & `hlCanvas`: NEVER cleared or copied during `pointermove`!
 * - Dedicated live `draftCanvas` (`display: none` when idle) with tight dirty-rect clearing (~100x fewer pixels).
 * - Tight dirty-rect restore + multiply composite for live highlighter dragging.
 * - Synchronous 0-frame-delay live paint inside `pointermove` so ink lands in the exact same frame as the nib cursor.
 * - Incremental O(1) stroke commit on `pointerup` (stamps only the 1 new stroke — zero full-page rebuild!).
 * - Zero `getBoundingClientRect()` on `pointerdown` or `pointermove` via scroll-tracked cached geometry.
 */
export const AnnotationSurface: React.FC<AnnotationSurfaceProps> = ({
  surfaceId,
  ariaLabel = 'طبقة الرسم والشرح',
  className = '',
}) => {
  const {
    activeTool,
    penSettings,
    fountainSettings,
    pencilSettings,
    highlighterSettings,
    shapesSettings,
    tapeSettings,
    eraserSettings,
    lassoSettings,
    systemSettings,
    selectedStroke,
    setSelectedStroke,
    selectedStrokeIds,
    setSelectedStrokeIds,
    setSelectedStrokeAnchor,
    registerBoundedSurface,
    unregisterBoundedSurface,
    registerSurfaceExporter,
    getStrokes,
    addStroke,
    updateStroke,
    updateStrokesBatch,
    toggleTapeRevealed,
    removeStrokes,
    applyEraseBatch,
  } = useAnnotation();

  const containerRef = useRef<HTMLDivElement>(null);
  const hlCanvasRef = useRef<HTMLCanvasElement>(null);
  const penCanvasRef = useRef<HTMLCanvasElement>(null);
  const draftCanvasRef = useRef<HTMLCanvasElement>(null);

  // Cached 2D contexts (avoids repeated getContext lookups on every pointer frame)
  const hlCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const penCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const draftCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Offscreen static highlighter cache + reusable scratch canvas for chisel meniscus
  const committedHlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const committedHlCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasCommittedHlRef = useRef(false);

  // Incremental O(1) commit tracking
  const renderedStrokesRef = useRef<AnnotationStroke[]>([]);
  const renderedSurfaceIdRef = useRef<string>(surfaceId);
  const lastBuiltSizeTickRef = useRef<number>(-1);

  // Tight device-pixel dirty rects for O(1) live draft clearing
  const prevDraftRectRef = useRef<PixelRect | null>(null);
  const prevHlDraftRectRef = useRef<PixelRect | null>(null);

  const activePointerIdRef = useRef<number | null>(null);
  const drawGestureStartClientRef = useRef<{ x: number; y: number } | null>(null);
  const isDrawingBodyClassActiveRef = useRef<boolean>(false);
  const draftRef = useRef<AnnotationStroke | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdDeadlineRef = useRef<number>(0);
  const holdAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const holdPathAccumRef = useRef<number>(0);
  const mergePrevStrokeIdRef = useRef<string | null>(null);
  const lockPerfectRef = useRef<boolean>(false);
  const lastRawPtRef = useRef<AnnotationPoint | null>(null);
  const snapPulseRef = useRef<{ x: number; y: number; color: string; size: number; startedAt: number } | null>(null);
  const erasePulseRef = useRef<{ x: number; y: number; startedAt: number } | null>(null);
  const morphAnimRef = useRef<{
    strokeId: string;
    startedAt: number;
    durationMs: number;
    freehandPts: AnnotationPoint[];
  } | null>(null);
  const magneticCueRef = useRef<{ x: number; y: number } | null>(null);
  const selectedStrokeIdRef = useRef<string | null>(null);
  const selectedGroupIdsRef = useRef<string[]>([]);
  const lassoLoopRef = useRef<Array<{ x: number; y: number }> | null>(null);
  const groupDragSessionRef = useRef<{
    strokeIds: string[];
    startNorm: AnnotationPoint;
    origStrokes: AnnotationStroke[];
    currentStrokes: AnnotationStroke[];
  } | null>(null);
  const editingHiddenStrokeIdRef = useRef<string | null>(null);
  const editingStrokeRef = useRef<AnnotationStroke | null>(null);
  const editSessionRef = useRef<{
    strokeId: string;
    mode: 'move' | 'handle';
    handleId: string | null;
    startNorm: AnnotationPoint;
    origStroke: AnnotationStroke;
    rotationDeg?: number | null;
  } | null>(null);
  const snapBaseRef = useRef<SnapDragBase | null>(null);
  const quickShapeActiveRef = useRef<boolean>(false);
  const tapeTapStartRef = useRef<{ sx: number; sy: number; maxMove: number } | null>(null);
  const hlAxisLockRef = useRef<{ axis: 'none' | 'h' | 'v' | 'broken'; peakExcursionPx: number }>({
    axis: 'none',
    peakExcursionPx: 0,
  });
  const livePenSessionRef = useRef<LivePenDraftSession | null>(null);

  const sizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 });
  const rectRef = useRef<{
    left: number;
    top: number;
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  } | null>(null);

  const rafRenderRef = useRef<number>(0);
  const dirtyLiveRef = useRef<{ draft: boolean; hl: boolean }>({ draft: false, hl: false });
  const hasRecordedEraseUndoRef = useRef(false);
  const lastEraserPtRef = useRef<{ x: number; y: number } | null>(null);

  const [sizeTick, setSizeTick] = useState(0);
  const strokes = getStrokes(surfaceId);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const selectedStrokeRef = useRef(selectedStroke);
  selectedStrokeRef.current = selectedStroke;
  const selectedStrokeIdsRef = useRef(selectedStrokeIds);
  selectedStrokeIdsRef.current = selectedStrokeIds;

  const getHlCtx = useCallback((): CanvasRenderingContext2D | null => {
    if (!hlCtxRef.current && hlCanvasRef.current) {
      hlCtxRef.current = hlCanvasRef.current.getContext('2d');
    }
    return hlCtxRef.current;
  }, []);

  const getPenCtx = useCallback((): CanvasRenderingContext2D | null => {
    if (!penCtxRef.current && penCanvasRef.current) {
      penCtxRef.current = penCanvasRef.current.getContext('2d');
    }
    return penCtxRef.current;
  }, []);

  const getDraftCtx = useCallback((): CanvasRenderingContext2D | null => {
    if (!draftCtxRef.current && draftCanvasRef.current) {
      draftCtxRef.current = draftCanvasRef.current.getContext('2d');
    }
    return draftCtxRef.current;
  }, []);

  const ensureCommittedHlBuffer = useCallback((pw: number, ph: number): CanvasRenderingContext2D | null => {
    if (!committedHlCanvasRef.current) {
      committedHlCanvasRef.current = document.createElement('canvas');
      committedHlCtxRef.current = committedHlCanvasRef.current.getContext('2d');
    }
    const cHl = committedHlCanvasRef.current;
    if (cHl.width !== pw || cHl.height !== ph) {
      cHl.width = pw;
      cHl.height = ph;
    }
    return committedHlCtxRef.current;
  }, []);

  const ensureScratchCanvas = useCallback((): HTMLCanvasElement => {
    if (!scratchCanvasRef.current) {
      scratchCanvasRef.current = document.createElement('canvas');
    }
    return scratchCanvasRef.current;
  }, []);

  // Register this bounded surface & PNG exporter while mounted
  useEffect(() => {
    registerBoundedSurface(surfaceId);
    const unregisterExporter = registerSurfaceExporter(surfaceId, () => {
      const hl = hlCanvasRef.current;
      const pen = penCanvasRef.current;
      if (!hl || !pen) return null;
      const container = containerRef.current;
      const sheet = container?.closest('.mushaf-page-sheet, .card, section, body');
      let bg = '#FCF8EE';
      if (sheet instanceof HTMLElement) {
        const cs = window.getComputedStyle(sheet).backgroundColor;
        if (cs && cs !== 'rgba(0, 0, 0, 0)' && cs !== 'transparent') {
          bg = cs;
        }
      }
      return {
        hlCanvas: hl,
        penCanvas: pen,
        backgroundHex: bg,
        pageElement: sheet instanceof HTMLElement ? sheet : container,
        overlayElement: container,
        isBounded: true,
      };
    });
    return () => {
      unregisterExporter();
      unregisterBoundedSurface(surfaceId);
    };
  }, [surfaceId, registerBoundedSurface, unregisterBoundedSurface, registerSurfaceExporter]);

  useEffect(() => {
    return () => {
      drawGestureStartClientRef.current = null;
      isDrawingBodyClassActiveRef.current = false;
      document.body.classList.remove('is-annotation-drawing');
      if (holdTimerRef.current) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      if (rafRenderRef.current) {
        cancelAnimationFrame(rafRenderRef.current);
        rafRenderRef.current = 0;
      }
      if (livePenSessionRef.current) {
        resetLivePenDraftSession(livePenSessionRef.current);
      }
    };
  }, []);

  const refreshCachedRect = useCallback(() => {
    const el = containerRef.current || penCanvasRef.current;
    if (!el) {
      rectRef.current = null;
      return null;
    }
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) {
      rectRef.current = null;
      return null;
    }
    const cached = {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
    rectRef.current = cached;
    return cached;
  }, []);

  const getTransform = useCallback((): RenderTransform => {
    const { w, h } = sizeRef.current;
    return {
      scaleX: w / 1000,
      scaleY: h / 1000,
      offsetX: 0,
      offsetY: 0,
      unitScale: Math.max(0.55, Math.min(1.65, w / 920)),
    };
  }, []);

  const clearDraftOverlay = useCallback(() => {
    const draftCanvas = draftCanvasRef.current;
    const draftCtx = getDraftCtx();
    const prev = prevDraftRectRef.current;
    if (draftCtx && draftCanvas && prev) {
      draftCtx.save();
      draftCtx.setTransform(1, 0, 0, 1, 0, 0);
      draftCtx.clearRect(prev.x, prev.y, prev.w, prev.h);
      draftCtx.restore();
    }
    if (livePenSessionRef.current) {
      resetLivePenDraftSession(livePenSessionRef.current);
    }
    prevDraftRectRef.current = null;
    if (draftCanvas && draftCanvas.style.opacity !== '') {
      draftCanvas.style.opacity = '';
    }
  }, [getDraftCtx]);

  const restoreHlDraftArea = useCallback(() => {
    const prev = prevHlDraftRectRef.current;
    if (!prev) return;
    const hlCanvas = hlCanvasRef.current;
    const hlCtx = getHlCtx();
    if (hlCtx && hlCanvas) {
      hlCtx.save();
      hlCtx.setTransform(1, 0, 0, 1, 0, 0);
      hlCtx.clearRect(prev.x, prev.y, prev.w, prev.h);
      if (hasCommittedHlRef.current && committedHlCanvasRef.current) {
        hlCtx.drawImage(
          committedHlCanvasRef.current,
          prev.x,
          prev.y,
          prev.w,
          prev.h,
          prev.x,
          prev.y,
          prev.w,
          prev.h
        );
      }
      hlCtx.restore();
    }
    prevHlDraftRectRef.current = null;
  }, [getHlCtx]);

  // Cancel active draft & hold timer cleanly when tool or surface changes
  useEffect(() => {
    drawGestureStartClientRef.current = null;
    isDrawingBodyClassActiveRef.current = false;
    document.body.classList.remove('is-annotation-drawing');
    hasRecordedEraseUndoRef.current = false;
    if (draftRef.current) {
      draftRef.current = null;
      clearDraftOverlay();
      restoreHlDraftArea();
    }
    snapBaseRef.current = null;
    quickShapeActiveRef.current = false;
    tapeTapStartRef.current = null;
    hlAxisLockRef.current = { axis: 'none', peakExcursionPx: 0 };
    morphAnimRef.current = null;
    magneticCueRef.current = null;
    if (penCanvasRef.current && penCanvasRef.current.style.cursor !== '') {
      penCanvasRef.current.style.cursor = '';
    }
    if (!isDrawSelectionTool(activeTool) && activeTool !== 'lasso') {
      selectedStrokeIdRef.current = null;
      selectedGroupIdsRef.current = [];
    }
    lassoLoopRef.current = null;
    groupDragSessionRef.current = null;
    editSessionRef.current = null;
    editingStrokeRef.current = null;
    if (editingHiddenStrokeIdRef.current) {
      editingHiddenStrokeIdRef.current = null;
    }
    if (mergePrevStrokeIdRef.current) {
      mergePrevStrokeIdRef.current = null;
    }
    activePointerIdRef.current = null;
    clearDraftOverlay();
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, [activeTool, surfaceId, clearDraftOverlay, restoreHlDraftArea]);

  /**
   * Stamps a single committed stroke incrementally onto the permanent layer(s) in O(1) time.
   */
  const stampCommittedStroke = useCallback(
    (stroke: AnnotationStroke, clearPrevHlDraft = false) => {
      const hlCanvas = hlCanvasRef.current;
      const penCanvas = penCanvasRef.current;
      if (!hlCanvas || !penCanvas) return;

      const { w, h } = sizeRef.current;
      const pw = penCanvas.width;
      const ph = penCanvas.height;
      if (w <= 0 || h <= 0 || pw <= 0 || ph <= 0) return;

      const tf = getTransform();
      const dprX = pw / w;
      const dprY = ph / h;

      if (stroke.kind !== 'highlighter') {
        const penCtx = getPenCtx();
        if (!penCtx) return;
        penCtx.save();
        penCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
        drawApplePenStroke(penCtx, stroke, tf, false);
        penCtx.restore();
        return;
      }

      if (stroke.kind === 'highlighter') {
        const cHlCtx = ensureCommittedHlBuffer(pw, ph);
        const hlCtx = getHlCtx();
        if (!cHlCtx || !hlCtx) return;

        if (!hasCommittedHlRef.current && committedHlCanvasRef.current) {
          cHlCtx.save();
          cHlCtx.setTransform(1, 0, 0, 1, 0, 0);
          cHlCtx.clearRect(0, 0, pw, ph);
          cHlCtx.restore();
        }

        const scratch = ensureScratchCanvas();
        const finalRect = drawAppleHighlighterStroke(cHlCtx, scratch, stroke, tf, dprX, dprY, false);
        hasCommittedHlRef.current = true;

        const dirty = clearPrevHlDraft
          ? unionPixelRects(prevHlDraftRectRef.current, finalRect)
          : finalRect;
        prevHlDraftRectRef.current = null;

        if (dirty && committedHlCanvasRef.current) {
          hlCtx.save();
          hlCtx.setTransform(1, 0, 0, 1, 0, 0);
          hlCtx.clearRect(dirty.x, dirty.y, dirty.w, dirty.h);
          hlCtx.drawImage(
            committedHlCanvasRef.current,
            dirty.x,
            dirty.y,
            dirty.w,
            dirty.h,
            dirty.x,
            dirty.y,
            dirty.w,
            dirty.h
          );
          hlCtx.restore();
        }
      }
    },
    [ensureCommittedHlBuffer, ensureScratchCanvas, getHlCtx, getPenCtx, getTransform]
  );

  /**
   * Full rebuild of committed layers — called ONLY on Undo, Redo, Erase, Clear, Page Switch, or Resize.
   * NEVER called during live drawing or normal stroke commit!
   */
  const rebuildAllCommittedLayers = useCallback(() => {
    const hlCanvas = hlCanvasRef.current;
    const penCanvas = penCanvasRef.current;
    const draftCanvas = draftCanvasRef.current;
    if (!hlCanvas || !penCanvas) return;

    const { w, h } = sizeRef.current;
    const pw = penCanvas.width;
    const ph = penCanvas.height;
    if (w <= 0 || h <= 0 || pw <= 0 || ph <= 0) return;

    const tf = getTransform();
    const dprX = pw / w;
    const dprY = ph / h;
    const list = strokesRef.current;
    const hiddenId = mergePrevStrokeIdRef.current;
    const editingHiddenId = editingHiddenStrokeIdRef.current;
    const groupHiddenIds = groupDragSessionRef.current?.strokeIds ?? null;
    const isHidden = (id: string) =>
      (hiddenId !== null && id === hiddenId) ||
      (editingHiddenId !== null && id === editingHiddenId) ||
      (groupHiddenIds !== null && groupHiddenIds.includes(id));

    let hasHl = false;
    let hasPen = false;
    for (let i = 0; i < list.length; i++) {
      if (isHidden(list[i].id)) continue;
      if (list[i].kind === 'highlighter') hasHl = true;
      else hasPen = true;
    }
    hasCommittedHlRef.current = hasHl;

    // 1. Committed Highlighter layer
    const hlCtx = getHlCtx();
    if (hasHl && hlCtx) {
      const cHlCtx = ensureCommittedHlBuffer(pw, ph);
      const scratch = ensureScratchCanvas();
      if (cHlCtx && committedHlCanvasRef.current) {
        cHlCtx.save();
        cHlCtx.setTransform(1, 0, 0, 1, 0, 0);
        cHlCtx.clearRect(0, 0, pw, ph);
        cHlCtx.restore();
        for (let i = 0; i < list.length; i++) {
          if (isHidden(list[i].id)) continue;
          if (list[i].kind === 'highlighter') {
            drawAppleHighlighterStroke(cHlCtx, scratch, list[i], tf, dprX, dprY, false);
          }
        }
        hlCtx.save();
        hlCtx.setTransform(1, 0, 0, 1, 0, 0);
        hlCtx.clearRect(0, 0, pw, ph);
        hlCtx.drawImage(committedHlCanvasRef.current, 0, 0);
        hlCtx.restore();
      }
    } else {
      if (committedHlCtxRef.current && committedHlCanvasRef.current) {
        const cHl = committedHlCanvasRef.current;
        if (cHl.width > 0 && cHl.height > 0) {
          committedHlCtxRef.current.clearRect(0, 0, cHl.width, cHl.height);
        }
      }
      if (hlCtx) {
        hlCtx.save();
        hlCtx.setTransform(1, 0, 0, 1, 0, 0);
        hlCtx.clearRect(0, 0, pw, ph);
        hlCtx.restore();
      }
    }
    prevHlDraftRectRef.current = null;

    // 2. Committed Pen / Fountain / Pencil / Tape layer
    const penCtx = getPenCtx();
    if (penCtx) {
      penCtx.save();
      penCtx.setTransform(1, 0, 0, 1, 0, 0);
      penCtx.clearRect(0, 0, pw, ph);
      if (hasPen) {
        penCtx.scale(dprX, dprY);
        for (let i = 0; i < list.length; i++) {
          if (isHidden(list[i].id)) continue;
          if (list[i].kind !== 'highlighter') {
            drawApplePenStroke(penCtx, list[i], tf, false);
          }
        }
      }
      penCtx.restore();
    }

    // 3. Clear any stale pixels on live draft overlay
    if (draftCanvas) {
      const dCtx = getDraftCtx();
      if (dCtx) {
        dCtx.save();
        dCtx.setTransform(1, 0, 0, 1, 0, 0);
        dCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
        dCtx.restore();
      }
      prevDraftRectRef.current = null;
    }

    renderedStrokesRef.current = list.slice();
    renderedSurfaceIdRef.current = surfaceId;
  }, [ensureCommittedHlBuffer, ensureScratchCanvas, getDraftCtx, getHlCtx, getPenCtx, getTransform, surfaceId]);

  /**
   * Ultra-fast dirty-rect live draft & ripple renderer.
   * Touches ONLY the tiny bounding box of the live stroke — NEVER touches `penCanvas`!
   */
  const renderLiveDraftFrame = useCallback(() => {
    if (rafRenderRef.current) {
      cancelAnimationFrame(rafRenderRef.current);
      rafRenderRef.current = 0;
    }

    const hlCanvas = hlCanvasRef.current;
    const draftCanvas = draftCanvasRef.current;
    if (!hlCanvas || !draftCanvas) return;

    const { w, h } = sizeRef.current;
    if (w <= 0 || h <= 0) return;

    const pw = draftCanvas.width;
    const ph = draftCanvas.height;
    if (pw <= 0 || ph <= 0) return;

    const dprX = pw / w;
    const dprY = ph / h;
    const tf = getTransform();
    const draft = draftRef.current;

    const redrawHl = dirtyLiveRef.current.hl;
    const redrawDraft = dirtyLiveRef.current.draft;
    dirtyLiveRef.current.hl = false;
    dirtyLiveRef.current.draft = false;

    let needsMoreFrames = false;
    let needsMoreHlFrames = false;

    const groupDrag = groupDragSessionRef.current;
    const activeHlStroke =
      draft && draft.kind === 'highlighter'
        ? draft
        : editingStrokeRef.current && editingStrokeRef.current.kind === 'highlighter'
        ? editingStrokeRef.current
        : null;

    // 1. Live Highlighter draft / live Highlighter shape edit / Lasso group drag highlighters
    if (groupDrag) {
      const hlCtx = getHlCtx();
      if (hlCtx) {
        hlCtx.save();
        hlCtx.setTransform(1, 0, 0, 1, 0, 0);
        hlCtx.clearRect(0, 0, pw, ph);
        if (hasCommittedHlRef.current && committedHlCanvasRef.current) {
          hlCtx.drawImage(committedHlCanvasRef.current, 0, 0);
        }
        hlCtx.restore();
        const movedHls = groupDrag.currentStrokes.filter((s) => s.kind === 'highlighter');
        if (movedHls.length > 0) {
          const scratch = ensureScratchCanvas();
          for (const st of movedHls) {
            drawAppleHighlighterStroke(hlCtx, scratch, st, tf, dprX, dprY, false);
          }
        }
      }
    } else if (redrawHl || activeHlStroke) {
      const hlCtx = getHlCtx();
      if (hlCtx) {
        if (activeHlStroke) {
          const scratch = ensureScratchCanvas();
          let currRect: PixelRect | null = null;
          const hlMorph = morphAnimRef.current;
          if (activeHlStroke.shape && hlMorph && hlMorph.strokeId === activeHlStroke.id) {
            const elapsed = performance.now() - hlMorph.startedAt;
            if (elapsed < hlMorph.durationMs) {
              if (scratch.width !== pw || scratch.height !== ph) {
                scratch.width = pw;
                scratch.height = ph;
              }
              const sCtx = scratch.getContext('2d');
              if (sCtx) {
                sCtx.save();
                sCtx.setTransform(1, 0, 0, 1, 0, 0);
                sCtx.clearRect(0, 0, pw, ph);
                sCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
                const bounds = renderMorphedShapeStroke(
                  sCtx,
                  hlMorph.freehandPts,
                  activeHlStroke.shape,
                  activeHlStroke,
                  tf,
                  elapsed / hlMorph.durationMs,
                  1
                );
                sCtx.restore();
                if (bounds) {
                  currRect = cssBoundsToPixelRect(bounds, dprX, dprY, pw, ph);
                }
              }
              needsMoreFrames = true;
              needsMoreHlFrames = true;
            } else {
              morphAnimRef.current = null;
            }
          }

          if (!needsMoreHlFrames) {
            if (!livePenSessionRef.current) {
              livePenSessionRef.current = createLivePenDraftSession();
            }
            currRect = renderLiveHighlighterWithSession(
              scratch,
              livePenSessionRef.current,
              activeHlStroke,
              tf,
              dprX,
              dprY,
              pw,
              ph
            );
          }
          const dirty = unionPixelRects(prevHlDraftRectRef.current, currRect);
          if (dirty) {
            hlCtx.save();
            hlCtx.setTransform(1, 0, 0, 1, 0, 0);
            hlCtx.clearRect(dirty.x, dirty.y, dirty.w, dirty.h);
            if (hasCommittedHlRef.current && committedHlCanvasRef.current) {
              hlCtx.drawImage(
                committedHlCanvasRef.current,
                dirty.x,
                dirty.y,
                dirty.w,
                dirty.h,
                dirty.x,
                dirty.y,
                dirty.w,
                dirty.h
              );
            }
            if (currRect) {
              hlCtx.globalCompositeOperation = 'multiply';
              hlCtx.globalAlpha = activeHlStroke.opacity;
              hlCtx.drawImage(
                scratch,
                currRect.x,
                currRect.y,
                currRect.w,
                currRect.h,
                currRect.x,
                currRect.y,
                currRect.w,
                currRect.h
              );
            }
            hlCtx.restore();
          }
          prevHlDraftRectRef.current = currRect;
        } else {
          restoreHlDraftArea();
        }
      }
    }

    // 2. Live Pen draft + Morph Animation + Snap/Erase ripples + Magnetic Cue + Selection/Lasso Overlay on `draftCanvas`
    const activeSelStroke =
      editingStrokeRef.current ??
      (isDrawSelectionTool(activeTool) && selectedStrokeIdRef.current
        ? strokesRef.current.find((s) => s.id === selectedStrokeIdRef.current) ?? null
        : null);
    const activeGroupStrokes = groupDrag
      ? groupDrag.currentStrokes
      : activeTool === 'lasso' && selectedGroupIdsRef.current.length > 0
      ? strokesRef.current.filter((s) => selectedGroupIdsRef.current.includes(s.id))
      : [];
    const hasLassoWork = Boolean(lassoLoopRef.current || activeGroupStrokes.length > 0);
    const hasSnappedShape = Boolean(draft && draft.shape);
    const hasOverlayWork = Boolean(
      activeSelStroke || magneticCueRef.current || morphAnimRef.current || hasLassoWork
    );

    if (redrawDraft || snapPulseRef.current || erasePulseRef.current || hasSnappedShape || hasOverlayWork) {
      const dCtx = getDraftCtx();
      if (dCtx) {
        let nextRect: PixelRect | null = null;
        const prevRect = prevDraftRectRef.current;

        const morph = morphAnimRef.current;
        let isMorphing = false;
        if (draft && draft.kind !== 'highlighter' && draft.shape && morph && morph.strokeId === draft.id) {
          const elapsed = performance.now() - morph.startedAt;
          if (elapsed < morph.durationMs) {
            isMorphing = true;
            if (prevRect) {
              dCtx.save();
              dCtx.setTransform(1, 0, 0, 1, 0, 0);
              dCtx.clearRect(prevRect.x, prevRect.y, prevRect.w, prevRect.h);
              dCtx.restore();
            }
            dCtx.save();
            dCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
            const bounds = renderMorphedShapeStroke(
              dCtx,
              morph.freehandPts,
              draft.shape,
              draft,
              tf,
              elapsed / morph.durationMs,
              1
            );
            dCtx.restore();
            if (bounds) {
              nextRect = cssBoundsToPixelRect(bounds, dprX, dprY, pw, ph);
            }
            needsMoreFrames = true;
          } else {
            morphAnimRef.current = null;
          }
        }

        if (!isMorphing) {
          if (draft && draft.kind !== 'highlighter') {
            if (!livePenSessionRef.current) {
              livePenSessionRef.current = createLivePenDraftSession();
            }
            nextRect = renderLivePenDraftWithSession(
              dCtx,
              draftCanvas,
              livePenSessionRef.current,
              draft,
              tf,
              dprX,
              dprY,
              pw,
              ph,
              prevRect
            );
          } else {
            if (draftCanvas.style.opacity !== '') {
              draftCanvas.style.opacity = '';
            }
            if (
              (!draft || draft.kind !== 'highlighter') &&
              livePenSessionRef.current &&
              (livePenSessionRef.current.strokeId || livePenSessionRef.current.frozenBounds)
            ) {
              resetLivePenDraftSession(livePenSessionRef.current);
            }
            if (prevRect) {
              dCtx.save();
              dCtx.setTransform(1, 0, 0, 1, 0, 0);
              dCtx.clearRect(prevRect.x, prevRect.y, prevRect.w, prevRect.h);
              dCtx.restore();
            }
          }
        }

        // Render live dragged group pen/fountain/pencil/tape strokes + lasso overlay
        if (groupDrag) {
          dCtx.save();
          dCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
          for (const st of groupDrag.currentStrokes) {
            if (st.kind !== 'highlighter') {
              const b = drawApplePenStroke(dCtx, st, tf, false);
              if (b) {
                nextRect = unionPixelRects(nextRect, cssBoundsToPixelRect(b, dprX, dprY, pw, ph));
              }
            }
          }
          dCtx.restore();
        }

        if (hasLassoWork) {
          const groupBounds =
            activeGroupStrokes.length > 0 ? getStrokesGroupBounds(activeGroupStrokes, tf) : null;
          dCtx.save();
          dCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
          const lassoBounds = drawLassoOverlay(
            dCtx,
            lassoLoopRef.current,
            groupBounds,
            lassoSettings.mode
          );
          dCtx.restore();
          if (lassoBounds) {
            nextRect = unionPixelRects(nextRect, cssBoundsToPixelRect(lassoBounds, dprX, dprY, pw, ph));
          }
        }

        // Render live edited pen/fountain/pencil/tape stroke + selection handles + magnetic snap ring
        if (editingStrokeRef.current && editingStrokeRef.current.kind !== 'highlighter') {
          dCtx.save();
          dCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
          const editBounds = drawApplePenStroke(dCtx, editingStrokeRef.current, tf, false);
          dCtx.restore();
          if (editBounds) {
            nextRect = unionPixelRects(nextRect, cssBoundsToPixelRect(editBounds, dprX, dprY, pw, ph));
          }
        }

        if (activeSelStroke) {
          dCtx.save();
          dCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
          const selBounds = drawShapeSelectionOverlay(
            dCtx,
            activeSelStroke,
            tf,
            editSessionRef.current?.handleId ?? null
          );
          dCtx.restore();
          if (selBounds) {
            nextRect = unionPixelRects(nextRect, cssBoundsToPixelRect(selBounds, dprX, dprY, pw, ph));
          }
        }

        if (magneticCueRef.current) {
          dCtx.save();
          dCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
          const cueBounds = drawMagneticSnapIndicator(
            dCtx,
            magneticCueRef.current.x,
            magneticCueRef.current.y
          );
          dCtx.restore();
          nextRect = unionPixelRects(nextRect, cssBoundsToPixelRect(cueBounds, dprX, dprY, pw, ph));
        }

        if (snapPulseRef.current || erasePulseRef.current) {
          dCtx.save();
          dCtx.setTransform(dprX, 0, 0, dprY, 0, 0);

          // Refined dual-ring Apple PencilKit Hold-to-Snap confirmation shimmer
          const pulse = snapPulseRef.current;
          if (pulse) {
            const elapsed = performance.now() - pulse.startedAt;
            if (elapsed < 380) {
              const progress = elapsed / 380;
              const ease = 1 - Math.pow(1 - progress, 3);
              const strokeW = Math.max(1.2, pulse.size);
              const halfTip = strokeW * 0.5;
              const startOuterR = Math.max(1.8, halfTip + 1.0);
              const expandOuter = Math.max(3.8, Math.min(18, strokeW * 1.15 + 2.4));
              const outerR = startOuterR + ease * expandOuter;
              const innerStart = Math.max(0.9, startOuterR * 0.5);
              const innerR = innerStart + ease * (expandOuter * 0.52);
              const fade = Math.pow(1 - progress, 1.35);
              dCtx.save();
              dCtx.beginPath();
              dCtx.arc(pulse.x, pulse.y, outerR, 0, Math.PI * 2);
              dCtx.strokeStyle = hexToRgba(pulse.color, fade * 0.58);
              dCtx.lineWidth = Math.max(1.0, Math.min(2.2, 0.85 + strokeW * 0.1)) * (1 - progress * 0.35);
              dCtx.stroke();

              dCtx.beginPath();
              dCtx.arc(pulse.x, pulse.y, innerR, 0, Math.PI * 2);
              dCtx.strokeStyle = `rgba(255, 255, 255, ${fade * 0.85})`;
              dCtx.lineWidth = Math.max(0.75, Math.min(1.3, 0.65 + strokeW * 0.05));
              dCtx.stroke();
              dCtx.restore();

              const pad = outerR + 4;
              const pulseRect = cssBoundsToPixelRect(
                { minX: pulse.x - pad, minY: pulse.y - pad, maxX: pulse.x + pad, maxY: pulse.y + pad },
                dprX,
                dprY,
                pw,
                ph
              );
              nextRect = unionPixelRects(nextRect, pulseRect);
              needsMoreFrames = true;
            } else {
              snapPulseRef.current = null;
            }
          }

          // Subtle frosted-rose dissolve ripple on eraser hit
          const erasePulse = erasePulseRef.current;
          if (erasePulse) {
            const elapsed = performance.now() - erasePulse.startedAt;
            if (elapsed < 260) {
              const p = elapsed / 260;
              const ease = 1 - Math.pow(1 - p, 3);
              const fade = 1 - p;
              const r = 7 + ease * 15;
              dCtx.save();
              dCtx.beginPath();
              dCtx.arc(erasePulse.x, erasePulse.y, r, 0, Math.PI * 2);
              dCtx.strokeStyle = `rgba(236, 72, 153, ${fade * 0.42})`;
              dCtx.lineWidth = 1.5;
              dCtx.stroke();
              dCtx.restore();

              const pad = r + 4;
              const epRect = cssBoundsToPixelRect(
                {
                  minX: erasePulse.x - pad,
                  minY: erasePulse.y - pad,
                  maxX: erasePulse.x + pad,
                  maxY: erasePulse.y + pad,
                },
                dprX,
                dprY,
                pw,
                ph
              );
              nextRect = unionPixelRects(nextRect, epRect);
              needsMoreFrames = true;
            } else {
              erasePulseRef.current = null;
            }
          }

          dCtx.restore();
        }

        prevDraftRectRef.current = nextRect;
      }
    }

    if (needsMoreFrames) {
      dirtyLiveRef.current.draft = true;
      if (needsMoreHlFrames) {
        dirtyLiveRef.current.hl = true;
      }
      rafRenderRef.current = requestAnimationFrame(renderLiveDraftFrame);
    }
  }, [
    activeTool,
    ensureScratchCanvas,
    getDraftCtx,
    getHlCtx,
    getTransform,
    lassoSettings.mode,
    restoreHlDraftArea,
  ]);

  const scheduleLiveDraw = useCallback(
    (layers: { draft?: boolean; hl?: boolean }) => {
      if (layers.draft) dirtyLiveRef.current.draft = true;
      if (layers.hl) dirtyLiveRef.current.hl = true;
      if (rafRenderRef.current) return;
      rafRenderRef.current = requestAnimationFrame(renderLiveDraftFrame);
    },
    [renderLiveDraftFrame]
  );

  const syncCanvasSize = useCallback((): boolean => {
    const hlCanvas = hlCanvasRef.current;
    const penCanvas = penCanvasRef.current;
    const draftCanvas = draftCanvasRef.current;
    if (!hlCanvas || !penCanvas || !draftCanvas) return false;

    const rect = refreshCachedRect();
    if (!rect) return false;

    const w = rect.width;
    const h = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_SURFACE_DPR);
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));

    if (
      Math.abs(sizeRef.current.w - w) > 0.5 ||
      Math.abs(sizeRef.current.h - h) > 0.5 ||
      sizeRef.current.dpr !== dpr ||
      hlCanvas.width !== pw ||
      hlCanvas.height !== ph ||
      penCanvas.width !== pw ||
      penCanvas.height !== ph ||
      draftCanvas.width !== pw ||
      draftCanvas.height !== ph
    ) {
      sizeRef.current = { w, h, dpr };
      hlCanvas.width = pw;
      hlCanvas.height = ph;
      penCanvas.width = pw;
      penCanvas.height = ph;
      draftCanvas.width = pw;
      draftCanvas.height = ph;
      prevDraftRectRef.current = null;
      prevHlDraftRectRef.current = null;
      return true;
    }
    return false;
  }, [refreshCachedRect]);

  // Keep High-DPI canvases & rect synced across resize, zoom, visualViewport, transitions, and nested scrolls
  const syncSelectedAnchor = useCallback(
    (selId: string | null) => {
      if (
        editSessionRef.current !== null ||
        groupDragSessionRef.current !== null
      ) {
        if (
          selectedStrokeRef.current?.surfaceId === surfaceId ||
          selectedStrokeIdsRef.current?.surfaceId === surfaceId
        ) {
          setSelectedStrokeAnchor(null);
        }
        return;
      }

      const rect = rectRef.current ?? refreshCachedRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        if (
          selectedStrokeRef.current?.surfaceId === surfaceId ||
          selectedStrokeIdsRef.current?.surfaceId === surfaceId
        ) {
          setSelectedStrokeAnchor(null);
        }
        return;
      }

      if (activeTool === 'lasso') {
        const gIds = selectedGroupIdsRef.current;
        if (gIds.length === 0) {
          if (selectedStrokeIdsRef.current?.surfaceId === surfaceId) {
            setSelectedStrokeAnchor(null);
          }
          return;
        }
        const picked = strokesRef.current.filter((s) => gIds.includes(s.id));
        const gBounds = getStrokesGroupBounds(picked, getTransform());
        if (!gBounds || picked.length === 0) {
          if (selectedStrokeIdsRef.current?.surfaceId === surfaceId) {
            setSelectedStrokeAnchor(null);
          }
          return;
        }
        const kinds = new Set(picked.map((s) => s.kind));
        const kind: AnnotationStrokeKind | 'mixed' =
          kinds.size === 1 ? picked[0].kind : 'mixed';
        setSelectedStrokeAnchor({
          surfaceId,
          strokeId: picked[0].id,
          strokeIds: picked.map((s) => s.id),
          count: picked.length,
          kind,
          centerX: rect.left + (gBounds.minX + gBounds.maxX) * 0.5,
          topY: rect.top + gBounds.minY,
          bottomY: rect.top + gBounds.maxY,
        });
        return;
      }

      if (!selId || !isDrawSelectionTool(activeTool)) {
        if (selectedStrokeRef.current?.surfaceId === surfaceId) {
          setSelectedStrokeAnchor(null);
        }
        return;
      }
      const stroke = strokesRef.current.find((s) => s.id === selId);
      if (!stroke) {
        if (selectedStrokeRef.current?.surfaceId === surfaceId) {
          setSelectedStrokeAnchor(null);
        }
        return;
      }
      const bounds = getStrokeScreenBounds(stroke, getTransform());
      if (!bounds) {
        if (selectedStrokeRef.current?.surfaceId === surfaceId) {
          setSelectedStrokeAnchor(null);
        }
        return;
      }
      setSelectedStrokeAnchor({
        surfaceId,
        strokeId: selId,
        strokeIds: [selId],
        count: 1,
        kind: stroke.kind,
        centerX: rect.left + (bounds.minX + bounds.maxX) * 0.5,
        topY: rect.top + bounds.minY,
        bottomY: rect.top + bounds.maxY,
      });
    },
    [activeTool, getTransform, refreshCachedRect, setSelectedStrokeAnchor, surfaceId]
  );

  const syncSelectedAnchorRef = useRef(syncSelectedAnchor);
  syncSelectedAnchorRef.current = syncSelectedAnchor;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let geoRaf = 0;
    const handleResize = () => {
      if (syncCanvasSize()) {
        setSizeTick((t) => t + 1);
        rebuildAllCommittedLayers();
      }
      if (selectedStrokeIdRef.current) {
        refreshCachedRect();
        syncSelectedAnchorRef.current(selectedStrokeIdRef.current);
      }
    };

    const scheduleGeometrySync = () => {
      if (geoRaf) return;
      geoRaf = requestAnimationFrame(() => {
        geoRaf = 0;
        handleResize();
      });
    };

    const handleScroll = () => {
      refreshCachedRect();
      if (selectedStrokeIdRef.current) {
        syncSelectedAnchorRef.current(selectedStrokeIdRef.current);
      }
    };

    if (syncCanvasSize()) {
      setSizeTick((t) => t + 1);
    }
    rebuildAllCommittedLayers();

    window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    window.addEventListener('resize', scheduleGeometrySync, { passive: true });
    window.visualViewport?.addEventListener('resize', scheduleGeometrySync, { passive: true });
    window.visualViewport?.addEventListener('scroll', handleScroll, { passive: true });

    const frameAncestor = el.closest('#surah-frame') || el.closest('.app') || el;
    frameAncestor.addEventListener('transitionend', scheduleGeometrySync, { passive: true });
    frameAncestor.addEventListener('animationend', scheduleGeometrySync, { passive: true });

    let isMounted = true;
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(handleResize);
      ro.observe(el);
    }
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (isMounted) scheduleGeometrySync();
      });
    }
    return () => {
      isMounted = false;
      if (geoRaf) cancelAnimationFrame(geoRaf);
      window.removeEventListener('scroll', handleScroll, { capture: true });
      window.removeEventListener('resize', scheduleGeometrySync);
      window.visualViewport?.removeEventListener('resize', scheduleGeometrySync);
      window.visualViewport?.removeEventListener('scroll', handleScroll);
      frameAncestor.removeEventListener('transitionend', scheduleGeometrySync);
      frameAncestor.removeEventListener('animationend', scheduleGeometrySync);
      ro?.disconnect();
    };
  }, [rebuildAllCommittedLayers, syncCanvasSize, refreshCachedRect]);

  // Incremental O(1) reconciliation when committed strokes or sizeTick change
  useEffect(() => {
    const sizeChanged = lastBuiltSizeTickRef.current !== sizeTick;
    const surfaceChanged = renderedSurfaceIdRef.current !== surfaceId;
    lastBuiltSizeTickRef.current = sizeTick;

    if (sizeChanged || surfaceChanged) {
      rebuildAllCommittedLayers();
      return;
    }

    const prev = renderedStrokesRef.current;
    const curr = strokes;

    // 1. Exact match (already stamped synchronously on pointerup!) -> 0.00ms!
    if (prev.length === curr.length) {
      let same = true;
      for (let i = 0; i < curr.length; i++) {
        if (prev[i] !== curr[i]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }

    // 2. Pure append fast path -> stamp ONLY the newly added stroke(s) in O(1)!
    if (curr.length > prev.length) {
      let prefixMatches = true;
      for (let i = 0; i < prev.length; i++) {
        if (prev[i] !== curr[i]) {
          prefixMatches = false;
          break;
        }
      }
      if (prefixMatches) {
        for (let i = prev.length; i < curr.length; i++) {
          stampCommittedStroke(curr[i], false);
        }
        renderedStrokesRef.current = curr.slice();
        return;
      }
    }

    // 3. Undo / Redo / Erase / Edit / Clear -> full rebuild
    rebuildAllCommittedLayers();
    if (isDrawSelectionTool(activeTool) && selectedStrokeIdRef.current && !editSessionRef.current) {
      scheduleLiveDraw({ draft: true });
    }
  }, [strokes, sizeTick, surfaceId, activeTool, rebuildAllCommittedLayers, stampCommittedStroke, scheduleLiveDraw]);

  // Sync selection highlight, handles, lasso group & floating anchor with Context state
  useEffect(() => {
    const nextId = selectedStroke?.surfaceId === surfaceId ? selectedStroke.strokeId : null;
    const prevId = selectedStrokeIdRef.current;
    selectedStrokeIdRef.current = nextId;

    const nextGroupIds =
      selectedStrokeIds?.surfaceId === surfaceId ? selectedStrokeIds.strokeIds : [];
    const prevGroupKey = selectedGroupIdsRef.current.join(',');
    const nextGroupKey = nextGroupIds.join(',');
    selectedGroupIdsRef.current = nextGroupIds;

    if (editSessionRef.current || groupDragSessionRef.current) return;

    if (activeTool === 'lasso') {
      const validIds = nextGroupIds.filter((id) => strokes.some((s) => s.id === id));
      if (validIds.length !== nextGroupIds.length) {
        selectedGroupIdsRef.current = validIds;
        setSelectedStrokeIds(validIds.length > 0 ? { surfaceId, strokeIds: validIds } : null);
      }
      if (validIds.length > 0) {
        if (prevGroupKey !== validIds.join(',') || !lassoLoopRef.current) {
          scheduleLiveDraw({ draft: true });
        }
        syncSelectedAnchor(validIds[0]);
      } else {
        if (prevGroupKey !== '' || lassoLoopRef.current) {
          clearDraftOverlay();
        }
        if (selectedStrokeIds?.surfaceId === surfaceId) {
          setSelectedStrokeAnchor(null);
        }
      }
      return;
    }

    if (nextId && isDrawSelectionTool(activeTool)) {
      const exists = strokes.some((s) => s.id === nextId);
      if (!exists) {
        selectedStrokeIdRef.current = null;
        setSelectedStroke(null);
        clearDraftOverlay();
        return;
      }
      if (prevId !== nextId) {
        scheduleLiveDraw({ draft: true });
      }
      syncSelectedAnchor(nextId);
    } else {
      if (prevId !== nextId || prevGroupKey !== nextGroupKey) {
        clearDraftOverlay();
      }
      if (selectedStroke?.surfaceId === surfaceId) {
        setSelectedStrokeAnchor(null);
      }
    }
  }, [
    selectedStroke,
    selectedStrokeIds,
    surfaceId,
    activeTool,
    strokes,
    sizeTick,
    scheduleLiveDraw,
    clearDraftOverlay,
    syncSelectedAnchor,
    setSelectedStroke,
    setSelectedStrokeIds,
    setSelectedStrokeAnchor,
  ]);

  // Pure cached-rect coordinate mapping — ZERO getBoundingClientRect() during pointermove!
  const mapClientToSurface = useCallback(
    (clientX: number, clientY: number): { norm: AnnotationPoint; screenX: number; screenY: number } | null => {
      let rect = rectRef.current;
      if (!rect || rect.scrollX !== window.scrollX || rect.scrollY !== window.scrollY) {
        rect = refreshCachedRect();
      }
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      const sx = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const sy = Math.max(0, Math.min(rect.height, clientY - rect.top));
      return {
        norm: {
          x: (sx / rect.width) * 1000,
          y: (sy / rect.height) * 1000,
          pressure: 0.5,
          t: performance.now(),
        },
        screenX: sx,
        screenY: sy,
      };
    },
    [refreshCachedRect]
  );

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const armHoldSnapTimer = useCallback(
    (screenX: number, screenY: number) => {
      const draft = draftRef.current;
      if (!draft || quickShapeActiveRef.current) return;
      if (
        (draft.kind === 'pen' ||
          draft.kind === 'fountain' ||
          draft.kind === 'pencil' ||
          draft.kind === 'highlighter') &&
        !systemSettings.smartShapes
      ) {
        return;
      }

      holdAnchorRef.current = { x: screenX, y: screenY };
      holdDeadlineRef.current = performance.now() + HOLD_SNAP_DELAY_MS;
      if (holdTimerRef.current !== null) return;

      const scheduleCheck = (delayMs: number) => {
        holdTimerRef.current = window.setTimeout(() => {
          holdTimerRef.current = null;
          const cur = draftRef.current;
          if (!cur || cur.shape) return;
          const remaining = holdDeadlineRef.current - performance.now();
          if (remaining > 18) {
            scheduleCheck(remaining);
            return;
          }
          if (cur.points.length < 4) return;
          const { w, h } = sizeRef.current;
          if (w <= 0 || h <= 0) return;

          const sx = w / 1000;
          const sy = h / 1000;
          let detected = null;
          let mergedPrevId: string | null = null;
          const isInkPenKind = cur.kind === 'pen' || cur.kind === 'fountain' || cur.kind === 'pencil';

          if (isInkPenKind && strokesRef.current.length > 0) {
            const prevStroke = strokesRef.current[strokesRef.current.length - 1];
            const merged = tryMergeTwoStrokeArrow(prevStroke, cur.points, sx, sy);
            if (merged) {
              detected = merged;
              mergedPrevId = prevStroke.id;
            }
          }

          if (!detected) {
            detected = detectHoldShape(cur.points, sx, sy, cur.kind !== 'highlighter');
          }

          if (detected) {
            if (lockPerfectRef.current) {
              detected = enforcePerfectShape(detected, sx, sy);
            } else if (!mergedPrevId) {
              const mag = snapInitialShapeToAnchors(
                detected,
                strokesRef.current,
                { scaleX: sx, scaleY: sy, offsetX: 0, offsetY: 0, unitScale: (sx + sy) * 0.5 || 1 },
                cur.id,
                11
              );
              detected = mag.shape;
              if (mag.cue) {
                magneticCueRef.current = mag.cue;
              }
            }
            const lastPt = cur.points[cur.points.length - 1];
            snapBaseRef.current = {
              shape: detected,
              anchorX: lastPt.x,
              anchorY: lastPt.y,
            };
            lastRawPtRef.current = lastPt;
            cur.shape = detected;
            if (mergedPrevId) {
              mergePrevStrokeIdRef.current = mergedPrevId;
              morphAnimRef.current = null;
              rebuildAllCommittedLayers();
            } else {
              morphAnimRef.current = {
                strokeId: cur.id,
                startedAt: performance.now(),
                durationMs: 130,
                freehandPts: cur.points.map((p) => ({ ...p })),
              };
            }
            const anchor = holdAnchorRef.current;
            const unitScale = getTransform().unitScale;
            const pulseStrokeW =
              cur.kind === 'highlighter' || cur.kind === 'tape'
                ? Math.min(28, Math.max(8, cur.size * unitScale) * 0.7)
                : Math.max(1.2, cur.size * unitScale);
            snapPulseRef.current = {
              x: anchor ? anchor.x : screenX,
              y: anchor ? anchor.y : screenY,
              color: cur.kind === 'highlighter' ? '#007AFF' : cur.color,
              size: pulseStrokeW,
              startedAt: performance.now(),
            };
            scheduleLiveDraw({ draft: true, hl: cur.kind === 'highlighter' });
          }
        }, delayMs);
      };

      scheduleCheck(HOLD_SNAP_DELAY_MS);
    },
    [
      getTransform,
      systemSettings.smartShapes,
      rebuildAllCommittedLayers,
      scheduleLiveDraw,
    ]
  );

  // Allow deleting currently selected stroke(s) via Delete/Backspace without switching tools
  useEffect(() => {
    if (!isDrawSelectionTool(activeTool) && activeTool !== 'lasso') return;
    const onDeleteKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t instanceof HTMLInputElement ||
          t instanceof HTMLTextAreaElement ||
          t instanceof HTMLSelectElement ||
          t.isContentEditable)
      ) {
        return;
      }
      const groupIds =
        activeTool === 'lasso'
          ? selectedGroupIdsRef.current
          : selectedStrokeIdRef.current
          ? [selectedStrokeIdRef.current]
          : [];
      if (groupIds.length === 0) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const existing = groupIds.filter((id) => strokesRef.current.some((s) => s.id === id));
        if (existing.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          selectedStrokeIdRef.current = null;
          selectedGroupIdsRef.current = [];
          setSelectedStroke(null);
          removeStrokes(surfaceId, existing);
          clearDraftOverlay();
        }
      }
    };
    window.addEventListener('keydown', onDeleteKey);
    return () => window.removeEventListener('keydown', onDeleteKey);
  }, [activeTool, surfaceId, removeStrokes, setSelectedStroke, clearDraftOverlay]);

  const erasePath = useCallback(
    (sweepPts: ReadonlyArray<{ x: number; y: number }>) => {
      if (sweepPts.length === 0) return;
      const tf = getTransform();
      const radiusPx = Math.max(10, eraserSettings.size * tf.unitScale * 0.55);
      const list = strokesRef.current;
      const hlOnly = Boolean(eraserSettings.highlighterOnly);

      if (eraserSettings.mode === 'partial') {
        const removeIds: string[] = [];
        const additions: AnnotationStroke[] = [];
        for (let i = 0; i < list.length; i++) {
          const st = list[i];
          if (hlOnly && st.kind !== 'highlighter') continue;
          const res = eraseStrokePartiallyPath(st, sweepPts, radiusPx, tf);
          if (res !== null) {
            removeIds.push(st.id);
            if (res.length > 0) {
              additions.push(...res);
            }
          }
        }
        if (removeIds.length > 0) {
          const recordHistory = !hasRecordedEraseUndoRef.current;
          hasRecordedEraseUndoRef.current = true;
          applyEraseBatch(surfaceId, removeIds, additions, recordHistory);
        }
        return;
      }

      const hitIds: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const st = list[i];
        if (hlOnly && st.kind !== 'highlighter') continue;
        if (hitTestStrokePath(sweepPts, st, radiusPx, tf)) {
          hitIds.push(st.id);
        }
      }
      if (hitIds.length > 0) {
        const recordHistory = !hasRecordedEraseUndoRef.current;
        hasRecordedEraseUndoRef.current = true;
        applyEraseBatch(surfaceId, hitIds, [], recordHistory);
      }
    },
    [
      applyEraseBatch,
      eraserSettings.highlighterOnly,
      eraserSettings.mode,
      eraserSettings.size,
      getTransform,
      surfaceId,
    ]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeTool === 'cursor') return;

    if (activeTool === 'laser') {
      e.preventDefault();
      return;
    }

    const isDrawTool = isDrawSelectionTool(activeTool);
    const isRightButton = e.button === 2 && isDrawTool;
    const isAltEdit = e.button === 0 && e.altKey && isDrawTool;

    if (!isRightButton && e.button !== 0 && e.pointerType === 'mouse') return;

    // Always measure live bounding rect directly on pointerdown so initial render,
    // font load, or layout changes can never offset a dot or stroke before scrolling.
    if (syncCanvasSize()) {
      rebuildAllCommittedLayers();
    }
    const liveRect = refreshCachedRect();
    if (!liveRect || liveRect.width <= 0 || liveRect.height <= 0) return;

    const sx = Math.max(0, Math.min(liveRect.width, e.clientX - liveRect.left));
    const sy = Math.max(0, Math.min(liveRect.height, e.clientY - liveRect.top));
    const mapped = {
      norm: {
        x: (sx / liveRect.width) * 1000,
        y: (sy / liveRect.height) * 1000,
        pressure: 0.5,
        t: performance.now(),
      },
      screenX: sx,
      screenY: sy,
    };

    if (typeof window.focus === 'function' && !document.hasFocus()) {
      window.focus();
    }

    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic/unsupported pointer capture errors
    }
    activePointerIdRef.current = e.pointerId;
    drawGestureStartClientRef.current = { x: e.clientX, y: e.clientY };
    isDrawingBodyClassActiveRef.current = false;
    if (e.currentTarget.style.cursor !== '') {
      e.currentTarget.style.cursor = '';
    }
    hasRecordedEraseUndoRef.current = false;

    if (activeTool === 'eraser') {
      lastEraserPtRef.current = { x: mapped.screenX, y: mapped.screenY };
      erasePath([{ x: mapped.screenX, y: mapped.screenY }]);
      return;
    }

    if (activeTool === 'lasso') {
      const tf = getTransform();
      const gIds = selectedGroupIdsRef.current;
      if (gIds.length > 0) {
        const picked = strokesRef.current.filter((s) => gIds.includes(s.id));
        const gBounds = getStrokesGroupBounds(picked, tf);
        const insideGroupBox =
          gBounds &&
          mapped.screenX >= gBounds.minX - 6 &&
          mapped.screenX <= gBounds.maxX + 6 &&
          mapped.screenY >= gBounds.minY - 6 &&
          mapped.screenY <= gBounds.maxY + 6;
        if (insideGroupBox) {
          setSelectedStrokeAnchor(null);
          groupDragSessionRef.current = {
            strokeIds: picked.map((s) => s.id),
            startNorm: mapped.norm,
            origStrokes: picked,
            currentStrokes: picked,
          };
          rebuildAllCommittedLayers();
          dirtyLiveRef.current = { draft: true, hl: true };
          renderLiveDraftFrame();
          return;
        }
      }

      selectedGroupIdsRef.current = [];
      setSelectedStrokeIds(null);
      lassoLoopRef.current = [{ x: mapped.screenX, y: mapped.screenY }];
      dirtyLiveRef.current = { draft: true, hl: false };
      renderLiveDraftFrame();
      return;
    }

    // 1) If a shape is already selected, allow left-dragging directly on one of its handles
    if (isDrawTool && selectedStrokeIdRef.current && e.button === 0 && !e.altKey) {
      const tf = getTransform();
      const curSel = strokesRef.current.find((s) => s.id === selectedStrokeIdRef.current);
      if (curSel?.shape) {
        const h = hitTestShapeHandle(mapped.screenX, mapped.screenY, curSel.shape, tf, 12);
        if (h) {
          setSelectedStrokeAnchor(null);
          if (draftCanvasRef.current && draftCanvasRef.current.style.opacity !== '') {
            draftCanvasRef.current.style.opacity = '';
          }
          editingHiddenStrokeIdRef.current = curSel.id;
          editingStrokeRef.current = curSel;
          editSessionRef.current = {
            strokeId: curSel.id,
            mode: 'handle',
            handleId: h.id,
            startNorm: mapped.norm,
            origStroke: curSel,
          };
          rebuildAllCommittedLayers();
          dirtyLiveRef.current = {
            draft: true,
            hl: curSel.kind === 'highlighter',
          };
          renderLiveDraftFrame();
          return;
        }
      }
      // Left-clicking elsewhere dismisses selection handles and draws normally
      selectedStrokeIdRef.current = null;
      setSelectedStroke(null);
      clearDraftOverlay();
    }

    // 2) Right-click / Right-drag OR Alt+Drag moves/resizes any shape or stroke directly without switching tools
    if (isRightButton || isAltEdit) {
      const tf = getTransform();
      const list = strokesRef.current;
      let hitStroke: AnnotationStroke | null = null;
      let hitHandleId: string | null = null;

      if (selectedStrokeIdRef.current) {
        const curSel = list.find((s) => s.id === selectedStrokeIdRef.current);
        if (curSel?.shape) {
          const h = hitTestShapeHandle(mapped.screenX, mapped.screenY, curSel.shape, tf, 12);
          if (h) {
            hitStroke = curSel;
            hitHandleId = h.id;
          }
        }
      }

      if (!hitStroke) {
        for (let i = list.length - 1; i >= 0; i--) {
          const st = list[i];
          if (st.shape) {
            const h = hitTestShapeHandle(mapped.screenX, mapped.screenY, st.shape, tf, 11);
            if (h) {
              hitStroke = st;
              hitHandleId = h.id;
              break;
            }
          }
        }
      }

      if (!hitStroke) {
        for (let i = list.length - 1; i >= 0; i--) {
          if (hitTestShapeStroke(mapped.screenX, mapped.screenY, list[i], tf, 10)) {
            hitStroke = list[i];
            break;
          }
        }
      }

      if (hitStroke) {
        selectedStrokeIdRef.current = hitStroke.id;
        setSelectedStroke({ surfaceId, strokeId: hitStroke.id });
        setSelectedStrokeAnchor(null);
        if (draftCanvasRef.current && draftCanvasRef.current.style.opacity !== '') {
          draftCanvasRef.current.style.opacity = '';
        }
        editingHiddenStrokeIdRef.current = hitStroke.id;
        editingStrokeRef.current = hitStroke;
        editSessionRef.current = {
          strokeId: hitStroke.id,
          mode: hitHandleId ? 'handle' : 'move',
          handleId: hitHandleId,
          startNorm: mapped.norm,
          origStroke: hitStroke,
        };
        rebuildAllCommittedLayers();
        dirtyLiveRef.current = {
          draft: true,
          hl: hitStroke.kind === 'highlighter',
        };
        renderLiveDraftFrame();
        return;
      }

      // Right-clicking empty space clears selection and skips drawing
      selectedStrokeIdRef.current = null;
      setSelectedStroke(null);
      activePointerIdRef.current = null;
      drawGestureStartClientRef.current = null;
      isDrawingBodyClassActiveRef.current = false;
      document.body.classList.remove('is-annotation-drawing');
      clearDraftOverlay();
      return;
    }

    const pt: AnnotationPoint = {
      ...mapped.norm,
      pressure: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5,
    };

    const isHighlighter = activeTool === 'highlighter';
    snapBaseRef.current = null;
    hlAxisLockRef.current = { axis: 'none', peakExcursionPx: 0 };
    morphAnimRef.current = null;
    magneticCueRef.current = null;
    quickShapeActiveRef.current = activeTool === 'shapes';
    tapeTapStartRef.current =
      activeTool === 'tape' ? { sx: mapped.screenX, sy: mapped.screenY, maxMove: 0 } : null;

    const strokeId = `st_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    if (activeTool === 'highlighter') {
      draftRef.current = {
        id: strokeId,
        kind: 'highlighter',
        color: highlighterSettings.color,
        size: highlighterSettings.size,
        opacity: highlighterSettings.opacity,
        smoothing: highlighterSettings.smoothing,
        points: [pt],
        shape: undefined,
      };
    } else if (activeTool === 'fountain') {
      draftRef.current = {
        id: strokeId,
        kind: 'fountain',
        color: fountainSettings.color,
        size: fountainSettings.size,
        opacity: fountainSettings.opacity,
        smoothing: fountainSettings.smoothing,
        nibAngleDeg: fountainSettings.nibAngleDeg,
        points: [pt],
        shape: undefined,
      };
    } else if (activeTool === 'pencil') {
      draftRef.current = {
        id: strokeId,
        kind: 'pencil',
        color: pencilSettings.color,
        size: pencilSettings.size,
        opacity: pencilSettings.opacity,
        smoothing: pencilSettings.smoothing,
        points: [pt],
        shape: undefined,
      };
    } else if (activeTool === 'tape') {
      draftRef.current = {
        id: strokeId,
        kind: 'tape',
        color: tapeSettings.color,
        size: tapeSettings.size,
        opacity: tapeSettings.opacity,
        smoothing: tapeSettings.smoothing,
        tapePattern: tapeSettings.pattern,
        revealed: false,
        points: [pt],
        shape: undefined,
      };
    } else if (activeTool === 'shapes') {
      draftRef.current = {
        id: strokeId,
        kind: 'pen',
        color: shapesSettings.color,
        size: shapesSettings.size,
        opacity: shapesSettings.opacity,
        smoothing: 0.5,
        lineStyle: shapesSettings.lineStyle,
        points: [pt],
        shape: undefined,
      };
    } else {
      draftRef.current = {
        id: strokeId,
        kind: 'pen',
        color: penSettings.color,
        size: penSettings.size,
        opacity: penSettings.opacity,
        smoothing: penSettings.smoothing,
        lineStyle: penSettings.lineStyle,
        points: [pt],
        shape: undefined,
      };
    }

    if (draftCanvasRef.current && draftCanvasRef.current.style.opacity !== '') {
      draftCanvasRef.current.style.opacity = '';
    }

    holdPathAccumRef.current = 0;
    mergePrevStrokeIdRef.current = null;
    lockPerfectRef.current = e.ctrlKey || e.shiftKey;
    lastRawPtRef.current = pt;
    if (!quickShapeActiveRef.current) {
      armHoldSnapTimer(mapped.screenX, mapped.screenY);
    }
    dirtyLiveRef.current = { draft: !isHighlighter, hl: isHighlighter };
    renderLiveDraftFrame();
  };

  useEffect(() => {
    const onModifierChange = (ev: KeyboardEvent) => {
      if (ev.key !== 'Control' && ev.key !== 'Shift') return;
      if (activePointerIdRef.current === null || !draftRef.current) return;
      const nextLock = ev.ctrlKey || ev.shiftKey;
      if (lockPerfectRef.current === nextLock) return;
      lockPerfectRef.current = nextLock;
      if (nextLock) {
        magneticCueRef.current = null;
      }

      const cur = draftRef.current;
      const { w, h } = sizeRef.current;
      if (w <= 0 || h <= 0) return;

      const pt = lastRawPtRef.current ?? cur.points[cur.points.length - 1];
      if (!pt) return;
      if (quickShapeActiveRef.current) {
        cur.shape = buildQuickShapeFromDrag(
          shapesSettings.shapeMode,
          cur.points[0],
          pt,
          cur.points,
          w / 1000,
          h / 1000,
          nextLock
        );
        dirtyLiveRef.current = { draft: true, hl: false };
        renderLiveDraftFrame();
        return;
      }
      if (!cur.shape) return;
      cur.shape = adjustSnappedShapeOnDrag(
        cur.shape,
        pt,
        w / 1000,
        h / 1000,
        snapBaseRef.current,
        nextLock
      );
      dirtyLiveRef.current = { draft: true, hl: cur.kind === 'highlighter' };
      renderLiveDraftFrame();
    };
    window.addEventListener('keydown', onModifierChange);
    window.addEventListener('keyup', onModifierChange);
    return () => {
      window.removeEventListener('keydown', onModifierChange);
      window.removeEventListener('keyup', onModifierChange);
    };
  }, [renderLiveDraftFrame, shapesSettings.shapeMode]);

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeTool === 'cursor' || activeTool === 'laser') return;

    if (
      activePointerIdRef.current === e.pointerId &&
      !isDrawingBodyClassActiveRef.current &&
      drawGestureStartClientRef.current
    ) {
      const dx = e.clientX - drawGestureStartClientRef.current.x;
      const dy = e.clientY - drawGestureStartClientRef.current.y;
      if (dx * dx + dy * dy >= 16) {
        isDrawingBodyClassActiveRef.current = true;
        document.body.classList.add('is-annotation-drawing');
      }
    }

    if (activeTool === 'eraser') {
      if (e.currentTarget.style.cursor !== '') {
        e.currentTarget.style.cursor = '';
      }
      if (activePointerIdRef.current === e.pointerId) {
        let rect = rectRef.current;
        if (!rect || rect.scrollX !== window.scrollX || rect.scrollY !== window.scrollY) {
          rect = refreshCachedRect();
        }
        if (!rect || rect.width <= 0 || rect.height <= 0) return;

        const samples =
          typeof e.nativeEvent.getCoalescedEvents === 'function'
            ? e.nativeEvent.getCoalescedEvents()
            : null;
        const sampleCount = samples && samples.length > 0 ? samples.length : 0;
        const loopLen = sampleCount > 0 ? sampleCount : 1;

        const sweepPts: Array<{ x: number; y: number }> = [];
        if (lastEraserPtRef.current) {
          sweepPts.push(lastEraserPtRef.current);
        }

        for (let i = 0; i < loopLen; i++) {
          const ev = sampleCount > 0 ? samples![i] : e.nativeEvent;
          const sx = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
          const sy = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
          const prevSweep = sweepPts[sweepPts.length - 1];
          if (!prevSweep || Math.hypot(sx - prevSweep.x, sy - prevSweep.y) >= 1.2) {
            sweepPts.push({ x: sx, y: sy });
          }
        }

        if (sweepPts.length > 0) {
          lastEraserPtRef.current = sweepPts[sweepPts.length - 1];
          erasePath(sweepPts);
        }
      }
      return;
    }

    if (activeTool === 'lasso') {
      const mapped = mapClientToSurface(e.clientX, e.clientY);
      if (!mapped) return;
      const tf = getTransform();
      if (activePointerIdRef.current === null) {
        const gIds = selectedGroupIdsRef.current;
        let nextCursor = '';
        if (gIds.length > 0) {
          const picked = strokesRef.current.filter((s) => gIds.includes(s.id));
          const gb = getStrokesGroupBounds(picked, tf);
          if (
            gb &&
            mapped.screenX >= gb.minX - 6 &&
            mapped.screenX <= gb.maxX + 6 &&
            mapped.screenY >= gb.minY - 6 &&
            mapped.screenY <= gb.maxY + 6
          ) {
            nextCursor = 'move';
          }
        }
        if (e.currentTarget.style.cursor !== nextCursor) {
          e.currentTarget.style.cursor = nextCursor;
        }
        return;
      }
      if (activePointerIdRef.current === e.pointerId) {
        if (groupDragSessionRef.current) {
          const sess = groupDragSessionRef.current;
          const dx = mapped.norm.x - sess.startNorm.x;
          const dy = mapped.norm.y - sess.startNorm.y;
          sess.currentStrokes = sess.origStrokes.map((st) => translateStroke(st, dx, dy));
          scheduleLiveDraw({ draft: true, hl: true });
          return;
        }
        if (lassoLoopRef.current) {
          const pts = lassoLoopRef.current;
          if (lassoSettings.mode === 'rect') {
            const last = pts[pts.length - 1];
            if (!last || Math.hypot(mapped.screenX - last.x, mapped.screenY - last.y) >= 2) {
              lassoLoopRef.current = [pts[0], { x: mapped.screenX, y: mapped.screenY }];
              scheduleLiveDraw({ draft: true });
            }
          } else {
            let rect = rectRef.current;
            if (!rect || rect.scrollX !== window.scrollX || rect.scrollY !== window.scrollY) {
              rect = refreshCachedRect();
            }
            const samples =
              typeof e.nativeEvent.getCoalescedEvents === 'function'
                ? e.nativeEvent.getCoalescedEvents()
                : null;
            const sampleCount = samples && samples.length > 0 ? samples.length : 0;
            const loopLen = sampleCount > 0 ? sampleCount : 1;
            let didAdd = false;
            for (let i = 0; i < loopLen; i++) {
              const ev = sampleCount > 0 ? samples![i] : e.nativeEvent;
              const sx = rect
                ? Math.max(0, Math.min(rect.width, ev.clientX - rect.left))
                : mapped.screenX;
              const sy = rect
                ? Math.max(0, Math.min(rect.height, ev.clientY - rect.top))
                : mapped.screenY;
              const last = pts[pts.length - 1];
              if (!last || Math.hypot(sx - last.x, sy - last.y) >= 2.5) {
                pts.push({ x: sx, y: sy });
                didAdd = true;
              }
            }
            if (didAdd) {
              scheduleLiveDraw({ draft: true });
            }
          }
          return;
        }
      }
      return;
    }

    if (activePointerIdRef.current === null) {
      const mapped = mapClientToSurface(e.clientX, e.clientY);
      if (mapped) {
        const tf = getTransform();
        let nextCursor = '';
        const selId = selectedStrokeIdRef.current;
        if (selId) {
          const sel = strokesRef.current.find((s) => s.id === selId);
          if (sel?.shape && hitTestShapeHandle(mapped.screenX, mapped.screenY, sel.shape, tf, 12)) {
            nextCursor = 'grab';
          }
        }
        if (!nextCursor && e.altKey) {
          for (let i = strokesRef.current.length - 1; i >= 0; i--) {
            const st = strokesRef.current[i];
            if (
              (st.shape && hitTestShapeHandle(mapped.screenX, mapped.screenY, st.shape, tf, 11)) ||
              hitTestShapeStroke(mapped.screenX, mapped.screenY, st, tf, 10)
            ) {
              nextCursor = 'move';
              break;
            }
          }
        }
        if (e.currentTarget.style.cursor !== nextCursor) {
          e.currentTarget.style.cursor = nextCursor;
        }
      }
      return;
    }

    if (editSessionRef.current && activePointerIdRef.current === e.pointerId) {
      const mapped = mapClientToSurface(e.clientX, e.clientY);
      if (!mapped) return;
      const { w, h } = sizeRef.current;
      if (w <= 0 || h <= 0) return;
      const session = editSessionRef.current;
      const lockPerfect = e.ctrlKey || e.shiftKey;
      const tf = getTransform();

      if (session.mode === 'move') {
        const dx = mapped.norm.x - session.startNorm.x;
        const dy = mapped.norm.y - session.startNorm.y;
        editingStrokeRef.current = translateStroke(session.origStroke, dx, dy);
        magneticCueRef.current = null;
      } else if (session.handleId && session.origStroke.shape) {
        let targetPt = mapped.norm;
        const hId = session.handleId;
        const isEndpointHandle =
          hId === 'start' ||
          hId === 'end' ||
          (session.origStroke.shape.type === 'polygon' && !session.origStroke.shape.closed);
        if (!e.altKey && !lockPerfect && isEndpointHandle) {
          const snap = findMagneticSnapTarget(mapped.norm, strokesRef.current, tf, session.strokeId, 12);
          if (snap) {
            targetPt = { ...mapped.norm, x: snap.x, y: snap.y };
            magneticCueRef.current = { x: snap.screenX, y: snap.screenY };
          } else {
            magneticCueRef.current = null;
          }
        } else {
          magneticCueRef.current = null;
        }
        const scaleX = w / 1000;
        const scaleY = h / 1000;
        const nextShape = applyShapeHandleDrag(
          session.origStroke.shape,
          session.handleId,
          targetPt,
          scaleX,
          scaleY,
          lockPerfect,
          session.startNorm
        );
        if (session.handleId === 'rotate') {
          const b = getStrokeScreenBounds(session.origStroke, tf);
          const cx = b ? (b.minX + b.maxX) * 0.5 : mapped.screenX;
          const cy = b ? (b.minY + b.maxY) * 0.5 : mapped.screenY;
          const sPxX = session.startNorm.x * scaleX;
          const sPxY = session.startNorm.y * scaleY;
          const a0 = Math.atan2(sPxY - cy, sPxX - cx);
          const a1 = Math.atan2(mapped.screenY - cy, mapped.screenX - cx);
          let deg = ((a1 - a0) * 180) / Math.PI;
          if (lockPerfect) deg = Math.round(deg / 15) * 15;
          session.rotationDeg = deg;
        } else {
          session.rotationDeg = null;
        }
        editingStrokeRef.current = {
          ...session.origStroke,
          shape: nextShape,
          points: remapPointsAfterShapeEdit(
            session.origStroke,
            nextShape,
            tf,
            session.handleId,
            session.startNorm,
            targetPt
          ),
        };
      }

      scheduleLiveDraw({ draft: true, hl: session.origStroke.kind === 'highlighter' });
      return;
    }

    if (activePointerIdRef.current !== e.pointerId || !draftRef.current) return;

    let rect = rectRef.current;
    if (!rect || rect.scrollX !== window.scrollX || rect.scrollY !== window.scrollY) {
      rect = refreshCachedRect();
    }
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const draft = draftRef.current;
    const invW = 1000 / rect.width;
    const invH = 1000 / rect.height;
    const mainSx = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const mainSy = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const nowTs = performance.now();

    const lockPerfect = e.ctrlKey || e.shiftKey;
    lockPerfectRef.current = lockPerfect;
    const rawMovePt: AnnotationPoint = {
      x: mainSx * invW,
      y: mainSy * invH,
      pressure: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5,
      t: nowTs,
    };
    lastRawPtRef.current = rawMovePt;

    if (quickShapeActiveRef.current) {
      const { w, h } = sizeRef.current;
      if (w > 0 && h > 0) {
        const scaleX = w / 1000;
        const scaleY = h / 1000;
        const tf = getTransform();
        let targetPt = rawMovePt;
        const canMagSnap =
          !e.altKey &&
          !lockPerfect &&
          (shapesSettings.shapeMode === 'line' ||
            shapesSettings.shapeMode === 'arrow' ||
            shapesSettings.shapeMode === 'auto');
        if (canMagSnap) {
          const snap = findMagneticSnapTarget(rawMovePt, strokesRef.current, tf, draft.id, 12);
          if (snap) {
            targetPt = { ...rawMovePt, x: snap.x, y: snap.y };
            magneticCueRef.current = { x: snap.screenX, y: snap.screenY };
          } else {
            magneticCueRef.current = null;
          }
        } else {
          magneticCueRef.current = null;
        }

        if (shapesSettings.shapeMode === 'auto') {
          const prev = draft.points[draft.points.length - 1];
          const dxPx = (targetPt.x - prev.x) * scaleX;
          const dyPx = (targetPt.y - prev.y) * scaleY;
          if (dxPx * dxPx + dyPx * dyPx >= 4) {
            draft.points.push(targetPt);
          }
        } else {
          draft.points = [draft.points[0], targetPt];
        }

        draft.shape = buildQuickShapeFromDrag(
          shapesSettings.shapeMode,
          draft.points[0],
          targetPt,
          draft.points,
          scaleX,
          scaleY,
          lockPerfect
        );
        scheduleLiveDraw({ draft: true });
      }
      return;
    }

    if (tapeTapStartRef.current) {
      const moved = Math.hypot(
        mainSx - tapeTapStartRef.current.sx,
        mainSy - tapeTapStartRef.current.sy
      );
      if (moved > tapeTapStartRef.current.maxMove) {
        tapeTapStartRef.current.maxMove = moved;
      }
    }

    if (draft.shape) {
      const { w, h } = sizeRef.current;
      if (w > 0 && h > 0) {
        if (morphAnimRef.current) {
          const anchor = holdAnchorRef.current;
          if (!anchor || Math.hypot(mainSx - anchor.x, mainSy - anchor.y) > 4.5) {
            morphAnimRef.current = null;
          }
        }
        const tf = getTransform();
        const isEndpointDrag =
          draft.shape.type === 'line' ||
          draft.shape.type === 'arc' ||
          draft.shape.type === 'arrow' ||
          draft.shape.type === 'brace' ||
          draft.shape.type === 'curve' ||
          (draft.shape.type === 'polygon' && !draft.shape.closed);

        let snappedMovePt = rawMovePt;
        if (!e.altKey && !lockPerfect && isEndpointDrag) {
          const snap = findMagneticSnapTarget(rawMovePt, strokesRef.current, tf, draft.id, 12);
          if (snap) {
            snappedMovePt = { ...rawMovePt, x: snap.x, y: snap.y };
            magneticCueRef.current = { x: snap.screenX, y: snap.screenY };
          } else {
            magneticCueRef.current = null;
          }
        } else {
          magneticCueRef.current = null;
        }

        draft.shape = adjustSnappedShapeOnDrag(
          draft.shape,
          snappedMovePt,
          w / 1000,
          h / 1000,
          snapBaseRef.current,
          lockPerfect
        );
        scheduleLiveDraw(draft.kind === 'highlighter' ? { hl: true, draft: true } : { draft: true });
      }
      return;
    }

    const samples =
      typeof e.nativeEvent.getCoalescedEvents === 'function'
        ? e.nativeEvent.getCoalescedEvents()
        : null;
    const sampleCount = samples && samples.length > 0 ? samples.length : 0;
    const { w, h } = sizeRef.current;
    const scaleX = w / 1000;
    const scaleY = h / 1000;
    const activeSmoothing =
      draft.kind === 'highlighter'
        ? highlighterSettings.smoothing
        : draft.kind === 'fountain'
        ? fountainSettings.smoothing
        : draft.kind === 'pencil'
        ? pencilSettings.smoothing
        : draft.kind === 'tape'
        ? tapeSettings.smoothing
        : penSettings.smoothing;
    const smoothThresh = activeSmoothing > 0.1 ? 2.4 : 1.3;
    let didAppend = false;
    let appendedPathPx = 0;

    const loopLen = sampleCount > 0 ? sampleCount : 1;
    const firstSampleTs = sampleCount > 1 ? samples![0].timeStamp : 0;
    const lastSampleTs = sampleCount > 1 ? samples![sampleCount - 1].timeStamp : 0;
    const hasCoalescedSpan = sampleCount > 1 && lastSampleTs > firstSampleTs;
    for (let i = 0; i < loopLen; i++) {
      const ev = sampleCount > 0 ? samples![i] : e.nativeEvent;
      const sx = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
      const sy = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
      const nx = sx * invW;
      const ny = sy * invH;

      const prev = draft.points[draft.points.length - 1];
      const dxPx = (nx - prev.x) * scaleX;
      const dyPx = (ny - prev.y) * scaleY;
      const distSq = dxPx * dxPx + dyPx * dyPx;

      const minStepPx =
        draft.kind === 'highlighter' || draft.kind === 'tape'
          ? ev.pointerType === 'pen'
            ? 1.0
            : 1.45
          : draft.kind === 'pen' || draft.kind === 'fountain' || draft.kind === 'pencil'
          ? ev.pointerType === 'pen'
            ? 0.9
            : 1.3
          : ev.pointerType === 'pen'
          ? 1.1
          : smoothThresh * 0.65;
      if (distSq < minStepPx * minStepPx) continue;

      let finalX = nx;
      let finalY = ny;
      const useStraightAssist =
        (draft.kind === 'highlighter' && highlighterSettings.straightAssist) ||
        (draft.kind === 'tape' && tapeSettings.straightAssist);
      if (useStraightAssist && draft.points.length >= 2) {
        const origin = draft.points[0];
        const absDxPx = Math.abs((nx - origin.x) * scaleX);
        const absDyPx = Math.abs((ny - origin.y) * scaleY);
        const lock = hlAxisLockRef.current;
        if (lock.axis === 'none') {
          if (absDxPx > 14 && absDyPx < Math.max(12, absDxPx * 0.14)) {
            lock.axis = 'h';
            lock.peakExcursionPx = absDxPx;
          } else if (absDyPx > 14 && absDxPx < Math.max(10, absDyPx * 0.12)) {
            lock.axis = 'v';
            lock.peakExcursionPx = absDyPx;
          }
        }
        if (lock.axis === 'h') {
          if (absDxPx > lock.peakExcursionPx) lock.peakExcursionPx = absDxPx;
          if (absDyPx > Math.max(22, lock.peakExcursionPx * 0.26)) {
            lock.axis = 'broken';
          } else {
            finalY = prev.y * 0.74 + origin.y * 0.2 + ny * 0.06;
          }
        } else if (lock.axis === 'v') {
          if (absDyPx > lock.peakExcursionPx) lock.peakExcursionPx = absDyPx;
          if (absDxPx > Math.max(22, lock.peakExcursionPx * 0.26)) {
            lock.axis = 'broken';
          } else {
            finalX = prev.x * 0.74 + origin.x * 0.2 + nx * 0.06;
          }
        }
      }

      const rawSampleTs = hasCoalescedSpan
        ? nowTs - Math.min(32, lastSampleTs - ev.timeStamp)
        : nowTs;
      const sampleTs = Math.max(prev.t + 0.25, rawSampleTs);

      draft.points.push({
        x: finalX,
        y: finalY,
        pressure: ev.pointerType === 'pen' && ev.pressure > 0 ? ev.pressure : 0.5,
        t: sampleTs,
      });
      appendedPathPx += Math.sqrt(distSq);
      didAppend = true;
    }

    if (!didAppend) {
      return;
    }

    holdPathAccumRef.current += appendedPathPx;
    const anchor = holdAnchorRef.current;
    if (
      !anchor ||
      holdPathAccumRef.current >= HOLD_PATH_RESET_PX ||
      (mainSx - anchor.x) * (mainSx - anchor.x) +
        (mainSy - anchor.y) * (mainSy - anchor.y) >
        HOLD_MOVE_THRESHOLD_PX * HOLD_MOVE_THRESHOLD_PX
    ) {
      holdPathAccumRef.current = 0;
      armHoldSnapTimer(mainSx, mainSy);
    }

    if (
      draft.kind === 'pen' ||
      draft.kind === 'fountain' ||
      draft.kind === 'pencil' ||
      draft.kind === 'tape'
    ) {
      dirtyLiveRef.current.draft = true;
      renderLiveDraftFrame();
    } else if (draft.kind === 'highlighter') {
      dirtyLiveRef.current.hl = true;
      renderLiveDraftFrame();
    } else {
      scheduleLiveDraw({ draft: true });
    }
  };

  const commitPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    activePointerIdRef.current = null;
    drawGestureStartClientRef.current = null;
    isDrawingBodyClassActiveRef.current = false;
    if (rafRenderRef.current) {
      cancelAnimationFrame(rafRenderRef.current);
      rafRenderRef.current = 0;
    }
    document.body.classList.remove('is-annotation-drawing');
    clearHoldTimer();

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore capture release errors
    }

    if (activeTool === 'eraser') {
      lastEraserPtRef.current = null;
      hasRecordedEraseUndoRef.current = false;
      return;
    }

    if (activeTool === 'lasso') {
      if (groupDragSessionRef.current) {
        const sess = groupDragSessionRef.current;
        const movedMap = new Map(sess.currentStrokes.map((s) => [s.id, s]));
        groupDragSessionRef.current = null;
        const dxTest =
          sess.currentStrokes[0] !== sess.origStrokes[0];
        if (dxTest) {
          updateStrokesBatch(surfaceId, sess.strokeIds, (st) => movedMap.get(st.id) ?? st, true);
        } else {
          rebuildAllCommittedLayers();
        }
        scheduleLiveDraw({ draft: true });
        syncSelectedAnchor(sess.strokeIds[0] ?? null);
        return;
      }

      const loop = lassoLoopRef.current;
      lassoLoopRef.current = null;
      const tf = getTransform();
      const isLassoDrag =
        !!loop &&
        loop.length >= 2 &&
        (lassoSettings.mode === 'rect'
          ? Math.hypot(loop[loop.length - 1].x - loop[0].x, loop[loop.length - 1].y - loop[0].y) >= 8
          : (() => {
              let totalDist = 0;
              for (let i = 1; i < loop.length; i++) {
                totalDist += Math.hypot(loop[i].x - loop[i - 1].x, loop[i].y - loop[i - 1].y);
                if (totalDist >= 8) return true;
              }
              return false;
            })());
      if (loop && isLassoDrag) {
        const foundIds = findStrokesInLasso(loop, strokesRef.current, tf, {
          mode: lassoSettings.mode,
          matchMode: lassoSettings.matchMode,
          includeHighlights: lassoSettings.includeHighlights,
        });
        selectedGroupIdsRef.current = foundIds;
        setSelectedStrokeIds(foundIds.length > 0 ? { surfaceId, strokeIds: foundIds } : null);
        if (foundIds.length > 0) {
          scheduleLiveDraw({ draft: true });
          syncSelectedAnchor(foundIds[0]);
        } else {
          clearDraftOverlay();
        }
        return;
      }
      if (loop && loop.length >= 1) {
        // Quick tap in lasso mode selects the topmost stroke underneath
        const tap = loop[loop.length - 1];
        const list = strokesRef.current;
        let hitId: string | null = null;
        for (let i = list.length - 1; i >= 0; i--) {
          if (hitTestShapeStroke(tap.x, tap.y, list[i], tf, 10)) {
            hitId = list[i].id;
            break;
          }
        }
        if (hitId) {
          selectedGroupIdsRef.current = [hitId];
          setSelectedStrokeIds({ surfaceId, strokeIds: [hitId] });
          scheduleLiveDraw({ draft: true });
          syncSelectedAnchor(hitId);
        } else {
          clearDraftOverlay();
        }
        return;
      }
      clearDraftOverlay();
      return;
    }

    if (editSessionRef.current) {
      const session = editSessionRef.current;
      const finalEdit = editingStrokeRef.current;
      editSessionRef.current = null;
      editingHiddenStrokeIdRef.current = null;
      editingStrokeRef.current = null;
      magneticCueRef.current = null;

      if (finalEdit && finalEdit !== session.origStroke) {
        updateStroke(surfaceId, session.strokeId, () => finalEdit, true);
      } else {
        rebuildAllCommittedLayers();
      }
      if (isDrawSelectionTool(activeTool) && selectedStrokeIdRef.current) {
        scheduleLiveDraw({ draft: true });
        syncSelectedAnchor(selectedStrokeIdRef.current);
      } else {
        selectedStrokeIdRef.current = null;
        clearDraftOverlay();
      }
      return;
    }

    const draft = draftRef.current;
    const mergePrevId = mergePrevStrokeIdRef.current;
    const wasQuickShape = quickShapeActiveRef.current;
    const tapeTapInfo = tapeTapStartRef.current;
    mergePrevStrokeIdRef.current = null;
    quickShapeActiveRef.current = false;
    tapeTapStartRef.current = null;
    draftRef.current = null;
    snapBaseRef.current = null;
    morphAnimRef.current = null;
    magneticCueRef.current = null;

    // Quick tap in Study Tape mode on an existing tape toggles Reveal / Hide instead of creating a dot
    if (draft && draft.kind === 'tape' && tapeTapInfo && tapeTapInfo.maxMove < 7) {
      const tf = getTransform();
      const list = strokesRef.current;
      let hitTape: AnnotationStroke | null = null;
      for (let i = list.length - 1; i >= 0; i--) {
        const st = list[i];
        if (st.kind === 'tape' && hitTestStroke(tapeTapInfo.sx, tapeTapInfo.sy, st, 8, tf)) {
          hitTape = st;
          break;
        }
      }
      if (hitTape) {
        clearDraftOverlay();
        toggleTapeRevealed(surfaceId, hitTape.id);
        return;
      }
    }

    if (wasQuickShape && draft && !draft.shape) {
      // Skip tiny accidental clicks in Quick Shapes mode without committing a dot
      clearDraftOverlay();
      return;
    }

    if (draft && (draft.points.length > 0 || draft.shape)) {
      const scribbleEnabled =
        systemSettings.scribbleErase &&
        (draft.kind === 'pen' || draft.kind === 'fountain' || draft.kind === 'pencil');

      if (scribbleEnabled && !draft.shape && !mergePrevId) {
        const tf = getTransform();
        const erasedIds = findScribbleErasedStrokeIds(draft.points, strokesRef.current, tf);
        if (erasedIds.length > 0) {
          let sumX = 0;
          let sumY = 0;
          for (let i = 0; i < draft.points.length; i++) {
            sumX += draft.points[i].x * tf.scaleX + tf.offsetX;
            sumY += draft.points[i].y * tf.scaleY + tf.offsetY;
          }
          clearDraftOverlay();
          restoreHlDraftArea();
          erasePulseRef.current = {
            x: sumX / draft.points.length,
            y: sumY / draft.points.length,
            startedAt: performance.now(),
          };
          removeStrokes(surfaceId, erasedIds);
          scheduleLiveDraw({ draft: true });
          return;
        }
      }

      // Synchronously stamp ONLY this single finished stroke onto the permanent canvas (O(1), zero blink!)
      if (draft.kind !== 'highlighter') {
        stampCommittedStroke(draft, false);
        clearDraftOverlay();
      } else {
        stampCommittedStroke(draft, true);
        clearDraftOverlay();
      }
      renderedStrokesRef.current = mergePrevId
        ? renderedStrokesRef.current.filter((s) => s.id !== mergePrevId).concat(draft)
        : [...renderedStrokesRef.current, draft];
      addStroke(surfaceId, draft, mergePrevId ? [mergePrevId] : undefined);
    } else {
      if (mergePrevId) {
        rebuildAllCommittedLayers();
      }
      clearDraftOverlay();
      restoreHlDraftArea();
    }
  };

  const tapeHotspots = useMemo(() => {
    if (activeTool !== 'cursor') return [];
    const { w, h } = sizeRef.current;
    if (w <= 0 || h <= 0) return [];
    const tf: RenderTransform = {
      scaleX: w / 1000,
      scaleY: h / 1000,
      offsetX: 0,
      offsetY: 0,
      unitScale: Math.max(0.55, Math.min(1.65, w / 920)),
    };
    const items: Array<{ id: string; revealed: boolean; left: number; top: number; width: number; height: number }> = [];
    for (let i = 0; i < strokes.length; i++) {
      const st = strokes[i];
      if (st.kind !== 'tape') continue;
      const b = getStrokeScreenBounds(st, tf);
      if (!b) continue;
      items.push({
        id: st.id,
        revealed: Boolean(st.revealed),
        left: Math.max(0, b.minX - 2),
        top: Math.max(0, b.minY - 2),
        width: Math.max(22, b.maxX - b.minX + 4),
        height: Math.max(18, b.maxY - b.minY + 4),
      });
    }
    return items;
  }, [activeTool, strokes, sizeTick]);

  const isDrawingActive = activeTool !== 'cursor';

  return (
    <div
      ref={containerRef}
      data-annotation-bounded="true"
      data-surface-id={surfaceId}
      className={`annotation-surface is-tool-${activeTool} ${isDrawingActive ? 'is-interactive' : ''} ${className}`}
      aria-hidden={!isDrawingActive && tapeHotspots.length === 0}
    >
      <canvas
        ref={hlCanvasRef}
        className="annotation-canvas is-highlighter-layer"
        aria-hidden="true"
      />
      <canvas
        ref={penCanvasRef}
        tabIndex={-1}
        aria-label={ariaLabel}
        className="annotation-canvas is-ink-layer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={commitPointer}
        onPointerCancel={commitPointer}
        onPointerLeave={(e) => {
          if (e.currentTarget.style.cursor !== '') {
            e.currentTarget.style.cursor = '';
          }
        }}
        onContextMenu={(e) => {
          if (activeTool !== 'cursor') e.preventDefault();
        }}
      />
      <canvas
        ref={draftCanvasRef}
        className="annotation-canvas is-draft-layer"
        aria-hidden="true"
      />
      {tapeHotspots.map((spot) => (
        <button
          key={spot.id}
          type="button"
          className={`annotation-tape-hotspot ${spot.revealed ? 'is-revealed' : ''}`}
          style={{
            left: `${Math.round(spot.left)}px`,
            top: `${Math.round(spot.top)}px`,
            width: `${Math.round(spot.width)}px`,
            height: `${Math.round(spot.height)}px`,
          }}
          title={spot.revealed ? 'إخفاء شريط التحفيظ مجدداً' : 'اضغط لكشف الكلمة المخفية'}
          aria-label={spot.revealed ? 'إخفاء شريط التحفيظ مجدداً' : 'كشف الكلمة المخفية'}
          aria-pressed={spot.revealed}
          onClick={(e) => {
            e.stopPropagation();
            toggleTapeRevealed(surfaceId, spot.id);
          }}
        />
      ))}
    </div>
  );
};
