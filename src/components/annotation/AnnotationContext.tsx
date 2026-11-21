import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_ANNOTATION_SYSTEM_SETTINGS,
  DEFAULT_ERASER_SETTINGS,
  DEFAULT_FOUNTAIN_SETTINGS,
  DEFAULT_HIGHLIGHTER_SETTINGS,
  DEFAULT_LASER_SETTINGS,
  DEFAULT_LASSO_SETTINGS,
  DEFAULT_PEN_SETTINGS,
  DEFAULT_PENCIL_SETTINGS,
  DEFAULT_SHAPES_SETTINGS,
  DEFAULT_TAPE_SETTINGS,
  SIZE_DIAL_STEP,
  laserSizeLevelToPx,
  pxToLaserSizeLevel,
  pxToSizeLevel,
  sizeLevelToPx,
  snapSizeLevel,
  type AnnotationStroke,
  type AnnotationSystemSettings,
  type AnnotationTool,
  type ColorSlotIndex,
  type EraserSettings,
  type FountainSettings,
  type HighlighterSettings,
  type LaserSettings,
  type LassoSettings,
  type OptionalDockTool,
  type PenSettings,
  type PencilSettings,
  type SelectedStrokeAnchor,
  type SelectedStrokeGroupRef,
  type SelectedStrokeRef,
  type ShapesSettings,
  type SizeSlotIndex,
  type TapeSettings,
} from './types';
import { translateStroke } from './strokeEngine';
import { exportSurfaceToPdf } from './pdfExport';
import { toArabicDigits } from '../../utils/mushafData';

const STORAGE_SETTINGS_KEY = 'mushaf_ann_settings_v1';
const STORAGE_STROKES_KEY = 'mushaf_ann_strokes_v1';

export interface SurfaceExportSnapshot {
  hlCanvas: HTMLCanvasElement;
  penCanvas: HTMLCanvasElement;
  backgroundHex?: string;
  pageElement?: HTMLElement | null;
  overlayElement?: HTMLElement | null;
  isBounded?: boolean;
}

export type SurfaceExportGetter = () => SurfaceExportSnapshot | null;

interface PersistedSettingsPayload {
  pen?: Partial<PenSettings>;
  fountain?: Partial<FountainSettings>;
  pencil?: Partial<PencilSettings>;
  highlighter?: Partial<HighlighterSettings>;
  shapes?: Partial<ShapesSettings>;
  tape?: Partial<TapeSettings>;
  laser?: Partial<LaserSettings>;
  eraser?: Partial<EraserSettings>;
  lasso?: Partial<LassoSettings>;
  system?: Partial<AnnotationSystemSettings>;
}

function loadPersistedSettings(): {
  pen: PenSettings;
  fountain: FountainSettings;
  pencil: PencilSettings;
  highlighter: HighlighterSettings;
  shapes: ShapesSettings;
  tape: TapeSettings;
  laser: LaserSettings;
  eraser: EraserSettings;
  lasso: LassoSettings;
  system: AnnotationSystemSettings;
} {
  const defaults = {
    pen: DEFAULT_PEN_SETTINGS,
    fountain: DEFAULT_FOUNTAIN_SETTINGS,
    pencil: DEFAULT_PENCIL_SETTINGS,
    highlighter: DEFAULT_HIGHLIGHTER_SETTINGS,
    shapes: DEFAULT_SHAPES_SETTINGS,
    tape: DEFAULT_TAPE_SETTINGS,
    laser: DEFAULT_LASER_SETTINGS,
    eraser: DEFAULT_ERASER_SETTINGS,
    lasso: DEFAULT_LASSO_SETTINGS,
    system: DEFAULT_ANNOTATION_SYSTEM_SETTINGS,
  };
  if (typeof window === 'undefined') {
    return defaults;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_SETTINGS_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as PersistedSettingsPayload;
    const pen = { ...DEFAULT_PEN_SETTINGS, ...(parsed.pen ?? {}) };
    const system: AnnotationSystemSettings = {
      smartShapes:
        parsed.system?.smartShapes ??
        parsed.pen?.smartShapes ??
        DEFAULT_ANNOTATION_SYSTEM_SETTINGS.smartShapes,
      scribbleErase:
        parsed.system?.scribbleErase ??
        parsed.pen?.scribbleErase ??
        DEFAULT_ANNOTATION_SYSTEM_SETTINGS.scribbleErase,
      enabledOptionalTools: {
        ...DEFAULT_ANNOTATION_SYSTEM_SETTINGS.enabledOptionalTools,
        ...(parsed.system?.enabledOptionalTools ?? {}),
      },
    };
    return {
      pen,
      fountain: { ...DEFAULT_FOUNTAIN_SETTINGS, ...(parsed.fountain ?? {}) },
      pencil: { ...DEFAULT_PENCIL_SETTINGS, ...(parsed.pencil ?? {}) },
      highlighter: { ...DEFAULT_HIGHLIGHTER_SETTINGS, ...(parsed.highlighter ?? {}) },
      shapes: { ...DEFAULT_SHAPES_SETTINGS, ...(parsed.shapes ?? {}) },
      tape: { ...DEFAULT_TAPE_SETTINGS, ...(parsed.tape ?? {}), opacity: 1 },
      laser: { ...DEFAULT_LASER_SETTINGS, ...(parsed.laser ?? {}) },
      eraser: { ...DEFAULT_ERASER_SETTINGS, ...(parsed.eraser ?? {}) },
      lasso: { ...DEFAULT_LASSO_SETTINGS, ...(parsed.lasso ?? {}) },
      system,
    };
  } catch {
    return defaults;
  }
}

function loadPersistedSurfaces(): Record<string, SurfaceHistory> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_STROKES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, AnnotationStroke[]>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, SurfaceHistory> = {};
    for (const [surfaceId, list] of Object.entries(parsed)) {
      if (Array.isArray(list) && list.length > 0) {
        out[surfaceId] = { strokes: list, past: [], future: [] };
      }
    }
    return out;
  } catch {
    return {};
  }
}

interface SizableSlotSettingsShape {
  size: number;
  sizeSlots: [number, number, number];
  activeSizeSlot: SizeSlotIndex;
}

function mergeToolSizeSettings<T extends SizableSlotSettingsShape>(prev: T, patch: Partial<T>): T {
  const nextSlot: SizeSlotIndex = patch.activeSizeSlot ?? prev.activeSizeSlot;
  const baseSlots = patch.sizeSlots ?? prev.sizeSlots;
  const nextSlots: [number, number, number] = [baseSlots[0], baseSlots[1], baseSlots[2]];
  let nextSize = prev.size;

  if (patch.size !== undefined) {
    nextSlots[nextSlot] = patch.size;
    nextSize = patch.size;
  } else if (patch.activeSizeSlot !== undefined || patch.sizeSlots !== undefined) {
    nextSize = nextSlots[nextSlot];
  }

  return {
    ...prev,
    ...patch,
    sizeSlots: nextSlots,
    activeSizeSlot: nextSlot,
    size: nextSize,
  };
}

interface ColorSlotSettingsShape {
  color: string;
  colorSlots: [string, string, string];
  activeColorSlot: ColorSlotIndex;
}

function mergeToolColorSettings<T extends ColorSlotSettingsShape>(prev: T, patch: Partial<T>): T {
  const nextSlot: ColorSlotIndex = patch.activeColorSlot ?? prev.activeColorSlot;
  const baseSlots = patch.colorSlots ?? prev.colorSlots;
  const nextSlots: [string, string, string] = [baseSlots[0], baseSlots[1], baseSlots[2]];
  let nextColor = prev.color;

  if (patch.color !== undefined) {
    nextSlots[nextSlot] = patch.color;
    nextColor = patch.color;
  } else if (patch.activeColorSlot !== undefined || patch.colorSlots !== undefined) {
    nextColor = nextSlots[nextSlot];
  }

  return {
    ...prev,
    ...patch,
    colorSlots: nextSlots,
    activeColorSlot: nextSlot,
    color: nextColor,
  };
}

interface SurfaceHistory {
  strokes: AnnotationStroke[];
  past: AnnotationStroke[][];
  future: AnnotationStroke[][];
}

export interface ShortcutFeedback {
  label: string;
  keycap: string;
  seq: number;
}

const EMPTY_STROKES: AnnotationStroke[] = [];
const MAX_HISTORY_STEPS = 45;

function isTextTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target.isContentEditable) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    const inputType = (target.type || 'text').toLowerCase();
    return !['range', 'button', 'checkbox', 'radio', 'submit', 'reset', 'color', 'file'].includes(
      inputType
    );
  }
  return false;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (isTextTypingTarget(target)) return true;
  return target instanceof HTMLSelectElement;
}

function releaseTrappedFormFocus(): void {
  if (typeof window.focus === 'function' && !document.hasFocus()) {
    window.focus();
  }
  const activeEl = document.activeElement;
  if (
    activeEl instanceof HTMLElement &&
    (isEditableKeyboardTarget(activeEl) || activeEl instanceof HTMLSelectElement)
  ) {
    activeEl.blur();
  }
}

interface AnnotationContextValue {
  activeTool: AnnotationTool;
  setActiveTool: (tool: AnnotationTool) => void;
  isPaletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  penSettings: PenSettings;
  updatePenSettings: (patch: Partial<PenSettings>) => void;
  fountainSettings: FountainSettings;
  updateFountainSettings: (patch: Partial<FountainSettings>) => void;
  pencilSettings: PencilSettings;
  updatePencilSettings: (patch: Partial<PencilSettings>) => void;
  highlighterSettings: HighlighterSettings;
  updateHighlighterSettings: (patch: Partial<HighlighterSettings>) => void;
  shapesSettings: ShapesSettings;
  updateShapesSettings: (patch: Partial<ShapesSettings>) => void;
  tapeSettings: TapeSettings;
  updateTapeSettings: (patch: Partial<TapeSettings>) => void;
  laserSettings: LaserSettings;
  updateLaserSettings: (patch: Partial<LaserSettings>) => void;
  eraserSettings: EraserSettings;
  updateEraserSettings: (patch: Partial<EraserSettings>) => void;
  lassoSettings: LassoSettings;
  updateLassoSettings: (patch: Partial<LassoSettings>) => void;
  systemSettings: AnnotationSystemSettings;
  updateSystemSettings: (patch: Partial<AnnotationSystemSettings>) => void;
  toggleOptionalTool: (tool: OptionalDockTool, enabled?: boolean) => void;
  activeSurfaceId: string;
  hasBoundedSurface: boolean;
  selectedStroke: SelectedStrokeRef | null;
  setSelectedStroke: (sel: SelectedStrokeRef | null) => void;
  selectedStrokeIds: SelectedStrokeGroupRef | null;
  setSelectedStrokeIds: (group: SelectedStrokeGroupRef | null) => void;
  selectedStrokeObjects: AnnotationStroke[];
  selectedStrokeAnchor: SelectedStrokeAnchor | null;
  setSelectedStrokeAnchor: (anchor: SelectedStrokeAnchor | null) => void;
  setFallbackSurfaceId: (surfaceId: string) => void;
  registerBoundedSurface: (surfaceId: string) => void;
  unregisterBoundedSurface: (surfaceId: string) => void;
  registerSurfaceExporter: (surfaceId: string, getter: SurfaceExportGetter) => () => void;
  exportActiveSurfacePdf: (surfaceId?: string) => Promise<void>;
  isExportingPdf: boolean;
  getStrokes: (surfaceId: string) => AnnotationStroke[];
  addStroke: (surfaceId: string, stroke: AnnotationStroke, replaceIds?: string[]) => void;
  updateStroke: (
    surfaceId: string,
    strokeId: string,
    updater: (stroke: AnnotationStroke) => AnnotationStroke,
    recordHistory?: boolean
  ) => void;
  updateStrokesBatch: (
    surfaceId: string,
    strokeIds: string[],
    updater: (stroke: AnnotationStroke) => AnnotationStroke,
    recordHistory?: boolean
  ) => void;
  toggleTapeRevealed: (surfaceId: string, strokeId: string) => void;
  removeStrokes: (surfaceId: string, strokeIds: string[]) => void;
  applyEraseBatch: (
    surfaceId: string,
    removeIds: string[],
    addStrokes: AnnotationStroke[],
    recordHistory: boolean
  ) => void;
  duplicateStroke: (surfaceId: string, strokeId: string) => void;
  duplicateStrokes: (surfaceId: string, strokeIds: string[]) => void;
  reorderStrokes: (surfaceId: string, strokeIds: string[], direction: 'front' | 'back') => void;
  undo: (surfaceId?: string) => void;
  redo: (surfaceId?: string) => void;
  clearSurface: (surfaceId?: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  activeStrokeCount: number;
  shortcutFeedback: ShortcutFeedback | null;
}

export interface AnnotationActionsValue {
  setActiveTool: (tool: AnnotationTool) => void;
  setPaletteOpen: (open: boolean) => void;
  setSelectedStroke: (sel: SelectedStrokeRef | null) => void;
  setSelectedStrokeIds: (group: SelectedStrokeGroupRef | null) => void;
  setSelectedStrokeAnchor: (anchor: SelectedStrokeAnchor | null) => void;
  updatePenSettings: (patch: Partial<PenSettings>) => void;
  updateFountainSettings: (patch: Partial<FountainSettings>) => void;
  updatePencilSettings: (patch: Partial<PencilSettings>) => void;
  updateHighlighterSettings: (patch: Partial<HighlighterSettings>) => void;
  updateShapesSettings: (patch: Partial<ShapesSettings>) => void;
  updateTapeSettings: (patch: Partial<TapeSettings>) => void;
  updateLaserSettings: (patch: Partial<LaserSettings>) => void;
  updateEraserSettings: (patch: Partial<EraserSettings>) => void;
  updateLassoSettings: (patch: Partial<LassoSettings>) => void;
  updateSystemSettings: (patch: Partial<AnnotationSystemSettings>) => void;
  toggleOptionalTool: (tool: OptionalDockTool, enabled?: boolean) => void;
  setFallbackSurfaceId: (surfaceId: string) => void;
  registerBoundedSurface: (surfaceId: string) => void;
  unregisterBoundedSurface: (surfaceId: string) => void;
  registerSurfaceExporter: (surfaceId: string, getter: SurfaceExportGetter) => () => void;
  exportActiveSurfacePdf: (surfaceId?: string) => Promise<void>;
  addStroke: (surfaceId: string, stroke: AnnotationStroke, replaceIds?: string[]) => void;
  updateStroke: (
    surfaceId: string,
    strokeId: string,
    updater: (stroke: AnnotationStroke) => AnnotationStroke,
    recordHistory?: boolean
  ) => void;
  updateStrokesBatch: (
    surfaceId: string,
    strokeIds: string[],
    updater: (stroke: AnnotationStroke) => AnnotationStroke,
    recordHistory?: boolean
  ) => void;
  toggleTapeRevealed: (surfaceId: string, strokeId: string) => void;
  removeStrokes: (surfaceId: string, strokeIds: string[]) => void;
  applyEraseBatch: (
    surfaceId: string,
    removeIds: string[],
    addStrokes: AnnotationStroke[],
    recordHistory: boolean
  ) => void;
  duplicateStroke: (surfaceId: string, strokeId: string) => void;
  duplicateStrokes: (surfaceId: string, strokeIds: string[]) => void;
  reorderStrokes: (surfaceId: string, strokeIds: string[], direction: 'front' | 'back') => void;
  undo: (surfaceId?: string) => void;
  redo: (surfaceId?: string) => void;
  clearSurface: (surfaceId?: string) => void;
}

export interface AnnotationToolStateValue {
  activeTool: AnnotationTool;
  isPaletteOpen: boolean;
  penSettings: PenSettings;
  fountainSettings: FountainSettings;
  pencilSettings: PencilSettings;
  highlighterSettings: HighlighterSettings;
  shapesSettings: ShapesSettings;
  tapeSettings: TapeSettings;
  laserSettings: LaserSettings;
  eraserSettings: EraserSettings;
  lassoSettings: LassoSettings;
  systemSettings: AnnotationSystemSettings;
  hasBoundedSurface: boolean;
  selectedStroke: SelectedStrokeRef | null;
  selectedStrokeIds: SelectedStrokeGroupRef | null;
  selectedStrokeObjects: AnnotationStroke[];
  selectedStrokeAnchor: SelectedStrokeAnchor | null;
  shortcutFeedback: ShortcutFeedback | null;
}

export interface AnnotationDockStateValue {
  canUndo: boolean;
  canRedo: boolean;
  hasActiveStrokes: boolean;
  isExportingPdf: boolean;
}

const AnnotationContext = createContext<AnnotationContextValue | null>(null);
const AnnotationActionsContext = createContext<AnnotationActionsValue | null>(null);
const AnnotationToolStateContext = createContext<AnnotationToolStateValue | null>(null);
const AnnotationDockStateContext = createContext<AnnotationDockStateValue | null>(null);

interface AnnotationProviderProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export const AnnotationProvider: React.FC<AnnotationProviderProps> = ({
  children,
  defaultOpen = false,
}) => {
  const initialSettings = useMemo(() => loadPersistedSettings(), []);
  const [activeTool, setActiveToolState] = useState<AnnotationTool>('cursor');
  const [isPaletteOpen, setIsPaletteOpenState] = useState<boolean>(defaultOpen);
  const [penSettings, setPenSettings] = useState<PenSettings>(initialSettings.pen);
  const [fountainSettings, setFountainSettings] = useState<FountainSettings>(
    initialSettings.fountain
  );
  const [pencilSettings, setPencilSettings] = useState<PencilSettings>(initialSettings.pencil);
  const [highlighterSettings, setHighlighterSettings] = useState<HighlighterSettings>(
    initialSettings.highlighter
  );
  const [shapesSettings, setShapesSettings] = useState<ShapesSettings>(initialSettings.shapes);
  const [tapeSettings, setTapeSettings] = useState<TapeSettings>(initialSettings.tape);
  const [laserSettings, setLaserSettings] = useState<LaserSettings>(initialSettings.laser);
  const [eraserSettings, setEraserSettings] = useState<EraserSettings>(initialSettings.eraser);
  const [lassoSettings, setLassoSettings] = useState<LassoSettings>(initialSettings.lasso);
  const [systemSettings, setSystemSettings] = useState<AnnotationSystemSettings>(
    initialSettings.system
  );
  const [selectedStroke, setSelectedStrokeState] = useState<SelectedStrokeRef | null>(null);
  const [selectedStrokeIds, setSelectedStrokeIdsState] = useState<SelectedStrokeGroupRef | null>(null);
  const [selectedStrokeAnchor, setSelectedStrokeAnchor] = useState<SelectedStrokeAnchor | null>(null);
  const [shortcutFeedback, setShortcutFeedback] = useState<ShortcutFeedback | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);
  const isExportingPdfRef = useRef<boolean>(false);

  const setSelectedStroke = useCallback((sel: SelectedStrokeRef | null) => {
    setSelectedStrokeState(sel);
    setSelectedStrokeIdsState(sel ? { surfaceId: sel.surfaceId, strokeIds: [sel.strokeId] } : null);
    if (!sel) {
      setSelectedStrokeAnchor(null);
    }
  }, []);

  const setSelectedStrokeIds = useCallback((group: SelectedStrokeGroupRef | null) => {
    const valid = group && group.strokeIds.length > 0 ? group : null;
    setSelectedStrokeIdsState(valid);
    setSelectedStrokeState(
      valid && valid.strokeIds.length === 1
        ? { surfaceId: valid.surfaceId, strokeId: valid.strokeIds[0] }
        : null
    );
    if (!valid) {
      setSelectedStrokeAnchor(null);
    }
  }, []);

  const [fallbackSurfaceId, setFallbackSurfaceId] = useState<string>('global:home');
  const [boundedSurfaces, setBoundedSurfaces] = useState<string[]>([]);
  const [lastTouchedSurfaceId, setLastTouchedSurfaceId] = useState<string | null>(null);
  const [surfaces, setSurfaces] = useState<Record<string, SurfaceHistory>>(() =>
    loadPersistedSurfaces()
  );

  const exportersRef = useRef<Map<string, SurfaceExportGetter>>(new Map());
  const feedbackTimerRef = useRef<number | null>(null);
  const feedbackSeqRef = useRef<number>(0);

  const emitShortcutFeedback = useCallback((label: string, keycap: string) => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackSeqRef.current += 1;
    setShortcutFeedback({ label, keycap, seq: feedbackSeqRef.current });
    feedbackTimerRef.current = window.setTimeout(() => {
      setShortcutFeedback(null);
      feedbackTimerRef.current = null;
    }, 1250);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  // Debounced auto-save for settings
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          STORAGE_SETTINGS_KEY,
          JSON.stringify({
            pen: penSettings,
            fountain: fountainSettings,
            pencil: pencilSettings,
            highlighter: highlighterSettings,
            shapes: shapesSettings,
            tape: tapeSettings,
            laser: laserSettings,
            eraser: eraserSettings,
            lasso: lassoSettings,
            system: systemSettings,
          })
        );
      } catch {
        // Ignore quota / privacy mode errors
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    penSettings,
    fountainSettings,
    pencilSettings,
    highlighterSettings,
    shapesSettings,
    tapeSettings,
    laserSettings,
    eraserSettings,
    lassoSettings,
    systemSettings,
  ]);

  // Debounced auto-save for surface strokes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timer = window.setTimeout(() => {
      try {
        const compact: Record<string, AnnotationStroke[]> = {};
        for (const [id, hist] of Object.entries(surfaces)) {
          if (hist.strokes.length > 0) {
            compact[id] = hist.strokes;
          }
        }
        window.localStorage.setItem(STORAGE_STROKES_KEY, JSON.stringify(compact));
      } catch {
        // Ignore quota / privacy mode errors
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [surfaces]);

  const setActiveTool = useCallback(
    (tool: AnnotationTool) => {
      setActiveToolState(tool);
      const isDrawTool =
        tool === 'pen' ||
        tool === 'fountain' ||
        tool === 'pencil' ||
        tool === 'highlighter' ||
        tool === 'shapes' ||
        tool === 'tape';
      if (!isDrawTool && tool !== 'lasso') {
        setSelectedStroke(null);
      } else if (isDrawTool) {
        setSelectedStrokeIdsState((prev) => {
          if (prev && prev.strokeIds.length > 1) {
            setSelectedStrokeAnchor(null);
            return null;
          }
          return prev;
        });
      }
      if (tool !== 'cursor') {
        releaseTrappedFormFocus();
      }
    },
    [setSelectedStroke]
  );

  const setPaletteOpen = useCallback((open: boolean) => {
    setIsPaletteOpenState(open);
  }, []);

  const updatePenSettings = useCallback((patch: Partial<PenSettings>) => {
    setPenSettings((prev) => mergeToolColorSettings(mergeToolSizeSettings(prev, patch), patch));
  }, []);

  const updateFountainSettings = useCallback((patch: Partial<FountainSettings>) => {
    setFountainSettings((prev) => mergeToolColorSettings(mergeToolSizeSettings(prev, patch), patch));
  }, []);

  const updatePencilSettings = useCallback((patch: Partial<PencilSettings>) => {
    setPencilSettings((prev) => mergeToolColorSettings(mergeToolSizeSettings(prev, patch), patch));
  }, []);

  const updateHighlighterSettings = useCallback((patch: Partial<HighlighterSettings>) => {
    setHighlighterSettings((prev) =>
      mergeToolColorSettings(mergeToolSizeSettings(prev, patch), patch)
    );
  }, []);

  const updateShapesSettings = useCallback((patch: Partial<ShapesSettings>) => {
    setShapesSettings((prev) => mergeToolColorSettings(mergeToolSizeSettings(prev, patch), patch));
  }, []);

  const updateTapeSettings = useCallback((patch: Partial<TapeSettings>) => {
    setTapeSettings((prev) => mergeToolColorSettings(mergeToolSizeSettings(prev, patch), patch));
  }, []);

  const updateLaserSettings = useCallback((patch: Partial<LaserSettings>) => {
    setLaserSettings((prev) => mergeToolColorSettings(prev, patch));
  }, []);

  const updateEraserSettings = useCallback((patch: Partial<EraserSettings>) => {
    setEraserSettings((prev) => mergeToolSizeSettings(prev, patch));
  }, []);

  const updateLassoSettings = useCallback((patch: Partial<LassoSettings>) => {
    setLassoSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateSystemSettings = useCallback((patch: Partial<AnnotationSystemSettings>) => {
    setSystemSettings((prev) => ({
      ...prev,
      ...patch,
      enabledOptionalTools: {
        ...prev.enabledOptionalTools,
        ...(patch.enabledOptionalTools ?? {}),
      },
    }));
  }, []);

  const systemSettingsRef = useRef(systemSettings);
  systemSettingsRef.current = systemSettings;

  const toggleOptionalTool = useCallback(
    (tool: OptionalDockTool, enabled?: boolean) => {
      const nextEnabled =
        enabled !== undefined ? enabled : !systemSettingsRef.current.enabledOptionalTools[tool];
      setSystemSettings((prev) => ({
        ...prev,
        enabledOptionalTools: {
          ...prev.enabledOptionalTools,
          [tool]: nextEnabled,
        },
      }));
      setActiveToolState((cur) => (cur === tool && !nextEnabled ? 'cursor' : cur));
      if (tool === 'lasso' && !nextEnabled) {
        setSelectedStroke(null);
      }
    },
    [setSelectedStroke]
  );

  const registerBoundedSurface = useCallback((surfaceId: string) => {
    setBoundedSurfaces((prev) => (prev.includes(surfaceId) ? prev : [...prev, surfaceId]));
  }, []);

  const unregisterBoundedSurface = useCallback((surfaceId: string) => {
    setBoundedSurfaces((prev) => prev.filter((id) => id !== surfaceId));
  }, []);

  const hasBoundedSurface = boundedSurfaces.length > 0;

  const activeSurfaceId = useMemo(() => {
    if (boundedSurfaces.length > 0) {
      if (lastTouchedSurfaceId && boundedSurfaces.includes(lastTouchedSurfaceId)) {
        return lastTouchedSurfaceId;
      }
      return boundedSurfaces[boundedSurfaces.length - 1];
    }
    return fallbackSurfaceId;
  }, [boundedSurfaces, lastTouchedSurfaceId, fallbackSurfaceId]);

  const activeSurfaceRef = useRef(activeSurfaceId);
  activeSurfaceRef.current = activeSurfaceId;

  const boundedSurfacesRef = useRef(boundedSurfaces);
  boundedSurfacesRef.current = boundedSurfaces;

  const getStrokes = useCallback(
    (surfaceId: string): AnnotationStroke[] => {
      return surfaces[surfaceId]?.strokes ?? EMPTY_STROKES;
    },
    [surfaces]
  );

  const addStroke = useCallback(
    (surfaceId: string, stroke: AnnotationStroke, replaceIds?: string[]) => {
      setLastTouchedSurfaceId(surfaceId);
      const replaceSet = replaceIds && replaceIds.length > 0 ? new Set(replaceIds) : null;
      setSurfaces((prev) => {
        const cur = prev[surfaceId] || { strokes: [], past: [], future: [] };
        const baseStrokes = replaceSet
          ? cur.strokes.filter((s) => !replaceSet.has(s.id))
          : cur.strokes;
        const isReversibleSnappedShape = Boolean(stroke.shape) && stroke.points.length >= 2;
        let nextPast: AnnotationStroke[][];
        if (isReversibleSnappedShape) {
          // Two-step undo for auto-snapped shapes (including 2-stroke arrow merges):
          // 1st Ctrl+Z -> unmerge/freehand, 2nd Ctrl+Z -> erase
          const { shape: _discardShape, ...freehandBase } = stroke;
          const freehandStroke: AnnotationStroke = freehandBase;
          nextPast = [...cur.past, cur.strokes, [...cur.strokes, freehandStroke]].slice(
            -MAX_HISTORY_STEPS
          );
        } else {
          nextPast = [...cur.past.slice(-(MAX_HISTORY_STEPS - 1)), cur.strokes];
        }
        return {
          ...prev,
          [surfaceId]: {
            strokes: [...baseStrokes, stroke],
            past: nextPast,
            future: [],
          },
        };
      });
    },
    []
  );

  const updateStroke = useCallback(
    (
      surfaceId: string,
      strokeId: string,
      updater: (stroke: AnnotationStroke) => AnnotationStroke,
      recordHistory = true
    ) => {
      setLastTouchedSurfaceId(surfaceId);
      setSurfaces((prev) => {
        const cur = prev[surfaceId];
        if (!cur) return prev;
        const idx = cur.strokes.findIndex((s) => s.id === strokeId);
        if (idx === -1) return prev;
        const nextStroke = updater(cur.strokes[idx]);
        if (nextStroke === cur.strokes[idx]) return prev;
        const nextStrokes = cur.strokes.slice();
        nextStrokes[idx] = nextStroke;
        return {
          ...prev,
          [surfaceId]: {
            strokes: nextStrokes,
            past: recordHistory
              ? [...cur.past.slice(-(MAX_HISTORY_STEPS - 1)), cur.strokes]
              : cur.past,
            future: recordHistory ? [] : cur.future,
          },
        };
      });
    },
    []
  );

  const updateStrokesBatch = useCallback(
    (
      surfaceId: string,
      strokeIds: string[],
      updater: (stroke: AnnotationStroke) => AnnotationStroke,
      recordHistory = true
    ) => {
      if (strokeIds.length === 0) return;
      setLastTouchedSurfaceId(surfaceId);
      const idSet = new Set(strokeIds);
      setSurfaces((prev) => {
        const cur = prev[surfaceId];
        if (!cur) return prev;
        let changed = false;
        const nextStrokes = cur.strokes.map((st) => {
          if (!idSet.has(st.id)) return st;
          const updated = updater(st);
          if (updated !== st) changed = true;
          return updated;
        });
        if (!changed) return prev;
        return {
          ...prev,
          [surfaceId]: {
            strokes: nextStrokes,
            past: recordHistory
              ? [...cur.past.slice(-(MAX_HISTORY_STEPS - 1)), cur.strokes]
              : cur.past,
            future: recordHistory ? [] : cur.future,
          },
        };
      });
    },
    []
  );

  const toggleTapeRevealed = useCallback(
    (surfaceId: string, strokeId: string) => {
      updateStroke(
        surfaceId,
        strokeId,
        (st) => (st.kind === 'tape' ? { ...st, revealed: !st.revealed } : st),
        false
      );
    },
    [updateStroke]
  );

  const removeStrokes = useCallback(
    (surfaceId: string, strokeIds: string[]) => {
      if (strokeIds.length === 0) return;
      setLastTouchedSurfaceId(surfaceId);
      const idSet = new Set(strokeIds);
      setSelectedStrokeState((prev) => {
        if (prev && prev.surfaceId === surfaceId && idSet.has(prev.strokeId)) {
          return null;
        }
        return prev;
      });
      setSelectedStrokeIdsState((prev) => {
        if (!prev || prev.surfaceId !== surfaceId) return prev;
        const remaining = prev.strokeIds.filter((id) => !idSet.has(id));
        if (remaining.length === 0) {
          setSelectedStrokeAnchor(null);
          return null;
        }
        return remaining.length === prev.strokeIds.length
          ? prev
          : { surfaceId, strokeIds: remaining };
      });
      setSurfaces((prev) => {
        const cur = prev[surfaceId];
        if (!cur || !cur.strokes.some((s) => idSet.has(s.id))) return prev;
        const nextPast = [...cur.past.slice(-(MAX_HISTORY_STEPS - 1)), cur.strokes];
        return {
          ...prev,
          [surfaceId]: {
            strokes: cur.strokes.filter((s) => !idSet.has(s.id)),
            past: nextPast,
            future: [],
          },
        };
      });
    },
    []
  );

  const applyEraseBatch = useCallback(
    (
      surfaceId: string,
      removeIds: string[],
      addStrokes: AnnotationStroke[],
      recordHistory: boolean
    ) => {
      if (removeIds.length === 0 && addStrokes.length === 0) return;
      setLastTouchedSurfaceId(surfaceId);
      const idSet = new Set(removeIds);
      if (idSet.size > 0) {
        setSelectedStrokeState((prev) => {
          if (prev && prev.surfaceId === surfaceId && idSet.has(prev.strokeId)) {
            return null;
          }
          return prev;
        });
        setSelectedStrokeIdsState((prev) => {
          if (!prev || prev.surfaceId !== surfaceId) return prev;
          const remaining = prev.strokeIds.filter((id) => !idSet.has(id));
          if (remaining.length === 0) {
            setSelectedStrokeAnchor(null);
            return null;
          }
          return remaining.length === prev.strokeIds.length
            ? prev
            : { surfaceId, strokeIds: remaining };
        });
      }
      setSurfaces((prev) => {
        const cur = prev[surfaceId];
        if (!cur) return prev;
        const remaining = idSet.size > 0 ? cur.strokes.filter((s) => !idSet.has(s.id)) : cur.strokes;
        if (remaining.length === cur.strokes.length && addStrokes.length === 0) {
          return prev;
        }
        return {
          ...prev,
          [surfaceId]: {
            strokes: addStrokes.length > 0 ? [...remaining, ...addStrokes] : remaining,
            past: recordHistory
              ? [...cur.past.slice(-(MAX_HISTORY_STEPS - 1)), cur.strokes]
              : cur.past,
            future: recordHistory ? [] : cur.future,
          },
        };
      });
    },
    []
  );

  const duplicateStrokes = useCallback((surfaceId: string, strokeIds: string[]) => {
    if (strokeIds.length === 0) return;
    const idSet = new Set(strokeIds);
    const sources = surfacesRef.current[surfaceId]?.strokes.filter((s) => idSet.has(s.id)) ?? [];
    if (sources.length === 0) return;
    setLastTouchedSurfaceId(surfaceId);
    const isBounded = boundedSurfacesRef.current.includes(surfaceId);
    const offset = isBounded ? 18 : 16;
    const now = Date.now();
    const clones: AnnotationStroke[] = sources.map((source, i) => {
      const cloneId = `st_${now}_${i}_${Math.random().toString(36).slice(2, 6)}`;
      const translated = translateStroke(source, offset, offset);
      return { ...translated, id: cloneId };
    });
    const cloneIds = clones.map((c) => c.id);
    setSurfaces((prev) => {
      const cur = prev[surfaceId] || { strokes: [], past: [], future: [] };
      const nextPast = [...cur.past.slice(-(MAX_HISTORY_STEPS - 1)), cur.strokes];
      return {
        ...prev,
        [surfaceId]: {
          strokes: [...cur.strokes, ...clones],
          past: nextPast,
          future: [],
        },
      };
    });
    setSelectedStrokeIdsState({ surfaceId, strokeIds: cloneIds });
    setSelectedStrokeState(
      cloneIds.length === 1 ? { surfaceId, strokeId: cloneIds[0] } : null
    );
  }, []);

  const duplicateStroke = useCallback(
    (surfaceId: string, strokeId: string) => {
      duplicateStrokes(surfaceId, [strokeId]);
    },
    [duplicateStrokes]
  );

  const reorderStrokes = useCallback(
    (surfaceId: string, strokeIds: string[], direction: 'front' | 'back') => {
      if (strokeIds.length === 0) return;
      const idSet = new Set(strokeIds);
      setLastTouchedSurfaceId(surfaceId);
      setSurfaces((prev) => {
        const cur = prev[surfaceId];
        if (!cur || cur.strokes.length < 2) return prev;
        const picked: AnnotationStroke[] = [];
        const rest: AnnotationStroke[] = [];
        for (const s of cur.strokes) {
          if (idSet.has(s.id)) picked.push(s);
          else rest.push(s);
        }
        if (picked.length === 0 || rest.length === 0) return prev;
        const nextStrokes = direction === 'front' ? [...rest, ...picked] : [...picked, ...rest];
        let sameOrder = true;
        for (let i = 0; i < nextStrokes.length; i++) {
          if (nextStrokes[i] !== cur.strokes[i]) {
            sameOrder = false;
            break;
          }
        }
        if (sameOrder) return prev;
        return {
          ...prev,
          [surfaceId]: {
            strokes: nextStrokes,
            past: [...cur.past.slice(-(MAX_HISTORY_STEPS - 1)), cur.strokes],
            future: [],
          },
        };
      });
    },
    []
  );

  const resolveHistoryTarget = useCallback(
    (
      prev: Record<string, SurfaceHistory>,
      kind: 'past' | 'future',
      explicitSurfaceId?: string
    ): string | null => {
      const primaryId = explicitSurfaceId ?? activeSurfaceRef.current;
      const primary = prev[primaryId];
      if (primary && primary[kind].length > 0) return primaryId;
      if (explicitSurfaceId) return null;

      // In double-page Mushaf spreads, seamlessly fall back to the other visible page
      const mounted = boundedSurfacesRef.current;
      for (let i = mounted.length - 1; i >= 0; i--) {
        const id = mounted[i];
        if (id !== primaryId && prev[id] && prev[id][kind].length > 0) {
          return id;
        }
      }
      return null;
    },
    []
  );

  const undo = useCallback(
    (surfaceId?: string) => {
      setSurfaces((prev) => {
        const targetId = resolveHistoryTarget(prev, 'past', surfaceId);
        if (!targetId) return prev;
        const cur = prev[targetId];
        const previous = cur.past[cur.past.length - 1];
        return {
          ...prev,
          [targetId]: {
            strokes: previous,
            past: cur.past.slice(0, -1),
            future: [cur.strokes, ...cur.future.slice(0, MAX_HISTORY_STEPS - 1)],
          },
        };
      });
    },
    [resolveHistoryTarget]
  );

  const redo = useCallback(
    (surfaceId?: string) => {
      setSurfaces((prev) => {
        const targetId = resolveHistoryTarget(prev, 'future', surfaceId);
        if (!targetId) return prev;
        const cur = prev[targetId];
        const next = cur.future[0];
        return {
          ...prev,
          [targetId]: {
            strokes: next,
            past: [...cur.past.slice(-(MAX_HISTORY_STEPS - 1)), cur.strokes],
            future: cur.future.slice(1),
          },
        };
      });
    },
    [resolveHistoryTarget]
  );

  const clearSurface = useCallback((surfaceId?: string) => {
    const targetId = surfaceId ?? activeSurfaceRef.current;
    setSelectedStrokeState((prev) => {
      if (prev && prev.surfaceId === targetId) {
        return null;
      }
      return prev;
    });
    setSelectedStrokeIdsState((prev) => {
      if (prev && prev.surfaceId === targetId) {
        setSelectedStrokeAnchor(null);
        return null;
      }
      return prev;
    });
    setSurfaces((prev) => {
      const cur = prev[targetId];
      if (!cur || cur.strokes.length === 0) return prev;
      const nextPast = [...cur.past.slice(-(MAX_HISTORY_STEPS - 1)), cur.strokes];
      return {
        ...prev,
        [targetId]: {
          strokes: [],
          past: nextPast,
          future: [],
        },
      };
    });
  }, []);

  const registerSurfaceExporter = useCallback(
    (surfaceId: string, getter: SurfaceExportGetter) => {
      exportersRef.current.set(surfaceId, getter);
      return () => {
        if (exportersRef.current.get(surfaceId) === getter) {
          exportersRef.current.delete(surfaceId);
        }
      };
    },
    []
  );

  const exportActiveSurfacePdf = useCallback(
    async (surfaceId?: string) => {
      if (typeof document === 'undefined' || isExportingPdfRef.current) return;
      const primaryId = surfaceId ?? activeSurfaceRef.current;
      let targetId: string | null = exportersRef.current.has(primaryId) ? primaryId : null;
      if (!targetId) {
        const mounted = boundedSurfacesRef.current;
        for (let i = mounted.length - 1; i >= 0; i--) {
          const id = mounted[i];
          if (exportersRef.current.has(id) && (surfacesRef.current[id]?.strokes.length ?? 0) > 0) {
            targetId = id;
            break;
          }
        }
        if (!targetId && exportersRef.current.size > 0) {
          targetId = exportersRef.current.keys().next().value ?? null;
        }
      }
      if (!targetId) return;
      const getter = exportersRef.current.get(targetId);
      const snap = getter?.();
      if (!snap) return;

      isExportingPdfRef.current = true;
      setIsExportingPdf(true);
      emitShortcutFeedback('جارٍ تجهيز ملف PDF...', 'PDF');
      try {
        const strokes = surfacesRef.current[targetId]?.strokes ?? EMPTY_STROKES;
        await exportSurfaceToPdf({
          surfaceId: targetId,
          strokes,
          pageElement: snap.pageElement ?? null,
          overlayElement: snap.overlayElement ?? null,
          isBounded: snap.isBounded ?? boundedSurfacesRef.current.includes(targetId),
          backgroundHex: snap.backgroundHex,
          fallbackHlCanvas: snap.hlCanvas,
          fallbackPenCanvas: snap.penCanvas,
        });
        emitShortcutFeedback('تم تنزيل الصفحة كملف PDF', 'PDF');
      } catch (err) {
        console.error('[AnnotationContext] PDF export failed:', err);
        emitShortcutFeedback('تعذّر تصدير الصفحة إلى PDF', 'خطأ');
      } finally {
        isExportingPdfRef.current = false;
        setIsExportingPdf(false);
      }
    },
    [emitShortcutFeedback]
  );

  const surfacesRef = useRef(surfaces);
  surfacesRef.current = surfaces;

  const visibleSurfaceIds = boundedSurfaces.length > 0 ? boundedSurfaces : [activeSurfaceId];
  const canUndo = visibleSurfaceIds.some((id) => (surfaces[id]?.past.length ?? 0) > 0);
  const canRedo = visibleSurfaceIds.some((id) => (surfaces[id]?.future.length ?? 0) > 0);
  const activeStrokeCount = visibleSurfaceIds.reduce(
    (sum, id) => sum + (surfaces[id]?.strokes.length ?? 0),
    0
  );

  const selectedStrokeObjects = useMemo<AnnotationStroke[]>(() => {
    const group = selectedStrokeIds;
    if (group && group.strokeIds.length > 0) {
      const list = surfaces[group.surfaceId]?.strokes ?? EMPTY_STROKES;
      const idSet = new Set(group.strokeIds);
      return list.filter((s) => idSet.has(s.id));
    }
    if (selectedStroke) {
      const found = surfaces[selectedStroke.surfaceId]?.strokes.find(
        (s) => s.id === selectedStroke.strokeId
      );
      return found ? [found] : EMPTY_STROKES;
    }
    return EMPTY_STROKES;
  }, [selectedStroke, selectedStrokeIds, surfaces]);

  // Live refs for the capture-phase keyboard listener (avoids listener churn)
  const liveStateRef = useRef({
    activeTool,
    isPaletteOpen,
    canUndo,
    canRedo,
    activeStrokeCount,
    penSettings,
    fountainSettings,
    pencilSettings,
    highlighterSettings,
    shapesSettings,
    tapeSettings,
    laserSettings,
    eraserSettings,
    systemSettings,
  });
  liveStateRef.current = {
    activeTool,
    isPaletteOpen,
    canUndo,
    canRedo,
    activeStrokeCount,
    penSettings,
    fountainSettings,
    pencilSettings,
    highlighterSettings,
    shapesSettings,
    tapeSettings,
    laserSettings,
    eraserSettings,
    systemSettings,
  };

  const stepActiveToolSize = useCallback(
    (delta: -1 | 1) => {
      const state = liveStateRef.current;
      const keycap = delta > 0 ? ']' : '[';
      const step = delta * SIZE_DIAL_STEP;
      if (state.activeTool === 'pen') {
        const curLevel = pxToSizeLevel('pen', state.penSettings.size);
        const nextLevel = snapSizeLevel(curLevel + step);
        updatePenSettings({ size: sizeLevelToPx('pen', nextLevel) });
        emitShortcutFeedback(`سُمك القلم: ${toArabicDigits(nextLevel)}٪`, keycap);
        return true;
      }
      if (state.activeTool === 'fountain') {
        const curLevel = pxToSizeLevel('fountain', state.fountainSettings.size);
        const nextLevel = snapSizeLevel(curLevel + step);
        updateFountainSettings({ size: sizeLevelToPx('fountain', nextLevel) });
        emitShortcutFeedback(`سُمك قلم الخط: ${toArabicDigits(nextLevel)}٪`, keycap);
        return true;
      }
      if (state.activeTool === 'pencil') {
        const curLevel = pxToSizeLevel('pencil', state.pencilSettings.size);
        const nextLevel = snapSizeLevel(curLevel + step);
        updatePencilSettings({ size: sizeLevelToPx('pencil', nextLevel) });
        emitShortcutFeedback(`سُمك الرصاص: ${toArabicDigits(nextLevel)}٪`, keycap);
        return true;
      }
      if (state.activeTool === 'highlighter') {
        const curLevel = pxToSizeLevel('highlighter', state.highlighterSettings.size);
        const nextLevel = snapSizeLevel(curLevel + step);
        updateHighlighterSettings({ size: sizeLevelToPx('highlighter', nextLevel) });
        emitShortcutFeedback(`عرض التظليل: ${toArabicDigits(nextLevel)}٪`, keycap);
        return true;
      }
      if (state.activeTool === 'shapes') {
        const curLevel = pxToSizeLevel('shapes', state.shapesSettings.size);
        const nextLevel = snapSizeLevel(curLevel + step);
        updateShapesSettings({ size: sizeLevelToPx('shapes', nextLevel) });
        emitShortcutFeedback(`سُمك الأشكال: ${toArabicDigits(nextLevel)}٪`, keycap);
        return true;
      }
      if (state.activeTool === 'tape') {
        const curLevel = pxToSizeLevel('tape', state.tapeSettings.size);
        const nextLevel = snapSizeLevel(curLevel + step);
        updateTapeSettings({ size: sizeLevelToPx('tape', nextLevel) });
        emitShortcutFeedback(`عرض شريط التحفيظ: ${toArabicDigits(nextLevel)}٪`, keycap);
        return true;
      }
      if (state.activeTool === 'eraser') {
        const curLevel = pxToSizeLevel('eraser', state.eraserSettings.size);
        const nextLevel = snapSizeLevel(curLevel + step);
        updateEraserSettings({ size: sizeLevelToPx('eraser', nextLevel) });
        emitShortcutFeedback(`حجم الممحاة: ${toArabicDigits(nextLevel)}٪`, keycap);
        return true;
      }
      if (state.activeTool === 'laser') {
        const curLevel = pxToLaserSizeLevel(state.laserSettings.size);
        const nextLevel = snapSizeLevel(curLevel + step);
        updateLaserSettings({ size: laserSizeLevelToPx(nextLevel) });
        emitShortcutFeedback(`حجم الليزر: ${toArabicDigits(nextLevel)}٪`, keycap);
        return true;
      }
      return false;
    },
    [
      updatePenSettings,
      updateFountainSettings,
      updatePencilSettings,
      updateHighlighterSettings,
      updateShapesSettings,
      updateTapeSettings,
      updateEraserSettings,
      updateLaserSettings,
      emitShortcutFeedback,
    ]
  );

  // Release trapped <select>/<input> focus & keep iframe keyboard focus whenever user clicks/draws outside editable inputs
  useEffect(() => {
    const onPointerDownFocus = (e: PointerEvent) => {
      if (!isEditableKeyboardTarget(e.target)) {
        releaseTrappedFormFocus();
      }
    };
    window.addEventListener('pointerdown', onPointerDownFocus, { capture: true, passive: true });
    return () => window.removeEventListener('pointerdown', onPointerDownFocus, { capture: true });
  }, []);

  // Global layout-independent keyboard shortcuts (Arabic + English keyboard layouts)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const state = liveStateRef.current;
      const code = e.code || '';
      const key = (e.key || '').toLowerCase();
      const keyCode = e.keyCode || e.which || 0;
      const isMod = e.metaKey || e.ctrlKey;

      // 1) Undo / Redo / Clear (Ctrl or Cmd modifiers) — only skip inside active text-typing fields (never block on <select> or sliders)
      if (isMod && !e.altKey) {
        if (isTextTypingTarget(e.target)) return;

        const isZ =
          code === 'KeyZ' ||
          keyCode === 90 ||
          key === 'z' ||
          key === 'ئ' ||
          key === 'ظ' ||
          key === 'ز';
        const isY = code === 'KeyY' || keyCode === 89 || key === 'y' || key === 'غ';

        if (isZ) {
          if (e.shiftKey) {
            if (state.canRedo) {
              e.preventDefault();
              e.stopPropagation();
              redo();
              emitShortcutFeedback('إعادة خطوة', 'Ctrl+Shift+Z');
            } else if (state.activeTool !== 'cursor' || state.isPaletteOpen) {
              e.preventDefault();
            }
          } else {
            if (state.canUndo) {
              e.preventDefault();
              e.stopPropagation();
              const willRevertSnap = (() => {
                const curSurfaces = surfacesRef.current;
                const targetId = resolveHistoryTarget(curSurfaces, 'past');
                if (!targetId) return false;
                const cur = curSurfaces[targetId];
                if (!cur || cur.past.length === 0) return false;
                const prev = cur.past[cur.past.length - 1];
                if (prev.length !== cur.strokes.length || prev.length === 0) return false;
                const lastCur = cur.strokes[cur.strokes.length - 1];
                const lastPrev = prev[prev.length - 1];
                return lastCur.id === lastPrev.id && Boolean(lastCur.shape) && !lastPrev.shape;
              })();
              undo();
              emitShortcutFeedback(
                willRevertSnap ? 'الرجوع للرسم الحر' : 'تراجع خطوة',
                'Ctrl+Z'
              );
            } else if (state.activeTool !== 'cursor' || state.isPaletteOpen) {
              e.preventDefault();
            }
          }
          return;
        }

        if (isY && !e.shiftKey) {
          if (state.canRedo) {
            e.preventDefault();
            e.stopPropagation();
            redo();
            emitShortcutFeedback('إعادة خطوة', 'Ctrl+Y');
          } else if (state.activeTool !== 'cursor' || state.isPaletteOpen) {
            e.preventDefault();
          }
          return;
        }

        if (
          e.shiftKey &&
          !e.repeat &&
          (code === 'Delete' ||
            code === 'Backspace' ||
            keyCode === 46 ||
            keyCode === 8 ||
            key === 'delete' ||
            key === 'backspace')
        ) {
          if (state.activeStrokeCount > 0) {
            e.preventDefault();
            e.stopPropagation();
            clearSurface();
            emitShortcutFeedback('مسح رسومات الصفحة', 'Ctrl+Shift+Del');
          }
          return;
        }
        return;
      }

      // 2) Single-key tool & brush shortcuts (skip inside text inputs / selects / IME composition)
      if (e.altKey || e.isComposing || isEditableKeyboardTarget(e.target)) return;

      if (code === 'Escape' || keyCode === 27 || key === 'escape') {
        if (state.activeTool !== 'cursor') {
          e.preventDefault();
          setSelectedStroke(null);
          setActiveToolState('cursor');
          emitShortcutFeedback('وضع التصفح', 'Esc');
        }
        return;
      }

      if (e.shiftKey) return;

      // Brush / Nib size steppers: [ and ] (Arabic ج and د)
      if (code === 'BracketRight' || keyCode === 221 || key === ']' || key === 'د') {
        if (stepActiveToolSize(1)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (code === 'BracketLeft' || keyCode === 219 || key === '[' || key === 'ج') {
        if (stepActiveToolSize(-1)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      // Quick 1 / 2 / 3 slot switching when a sizable drawing tool is active
      if (!isMod && !e.repeat) {
        let slotTarget: SizeSlotIndex | null = null;
        if (code === 'Digit1' || code === 'Numpad1' || key === '1' || key === '١') slotTarget = 0;
        else if (code === 'Digit2' || code === 'Numpad2' || key === '2' || key === '٢') slotTarget = 1;
        else if (code === 'Digit3' || code === 'Numpad3' || key === '3' || key === '٣') slotTarget = 2;

        if (slotTarget !== null) {
          const slotKeycap = String(slotTarget + 1);
          const slotLabelAr = toArabicDigits(slotTarget + 1);
          if (state.activeTool === 'pen') {
            e.preventDefault();
            e.stopPropagation();
            const lvl = pxToSizeLevel('pen', state.penSettings.sizeSlots[slotTarget]);
            updatePenSettings({ activeSizeSlot: slotTarget });
            emitShortcutFeedback(`سُمك القلم ${slotLabelAr}: ${toArabicDigits(lvl)}٪`, slotKeycap);
            return;
          }
          if (state.activeTool === 'fountain') {
            e.preventDefault();
            e.stopPropagation();
            const lvl = pxToSizeLevel('fountain', state.fountainSettings.sizeSlots[slotTarget]);
            updateFountainSettings({ activeSizeSlot: slotTarget });
            emitShortcutFeedback(`سُمك الخطّاط ${slotLabelAr}: ${toArabicDigits(lvl)}٪`, slotKeycap);
            return;
          }
          if (state.activeTool === 'pencil') {
            e.preventDefault();
            e.stopPropagation();
            const lvl = pxToSizeLevel('pencil', state.pencilSettings.sizeSlots[slotTarget]);
            updatePencilSettings({ activeSizeSlot: slotTarget });
            emitShortcutFeedback(`سُمك الرصاص ${slotLabelAr}: ${toArabicDigits(lvl)}٪`, slotKeycap);
            return;
          }
          if (state.activeTool === 'highlighter') {
            e.preventDefault();
            e.stopPropagation();
            const lvl = pxToSizeLevel('highlighter', state.highlighterSettings.sizeSlots[slotTarget]);
            updateHighlighterSettings({ activeSizeSlot: slotTarget });
            emitShortcutFeedback(`سُمك التظليل ${slotLabelAr}: ${toArabicDigits(lvl)}٪`, slotKeycap);
            return;
          }
          if (state.activeTool === 'shapes') {
            e.preventDefault();
            e.stopPropagation();
            const lvl = pxToSizeLevel('shapes', state.shapesSettings.sizeSlots[slotTarget]);
            updateShapesSettings({ activeSizeSlot: slotTarget });
            emitShortcutFeedback(`سُمك الأشكال ${slotLabelAr}: ${toArabicDigits(lvl)}٪`, slotKeycap);
            return;
          }
          if (state.activeTool === 'tape') {
            e.preventDefault();
            e.stopPropagation();
            const lvl = pxToSizeLevel('tape', state.tapeSettings.sizeSlots[slotTarget]);
            updateTapeSettings({ activeSizeSlot: slotTarget });
            emitShortcutFeedback(`عرض الشريط ${slotLabelAr}: ${toArabicDigits(lvl)}٪`, slotKeycap);
            return;
          }
          if (state.activeTool === 'eraser') {
            e.preventDefault();
            e.stopPropagation();
            const lvl = pxToSizeLevel('eraser', state.eraserSettings.sizeSlots[slotTarget]);
            updateEraserSettings({ activeSizeSlot: slotTarget });
            emitShortcutFeedback(`حجم الممحاة ${slotLabelAr}: ${toArabicDigits(lvl)}٪`, slotKeycap);
            return;
          }
        }
      }

      if (e.repeat) return;

      if (code === 'KeyP' || keyCode === 80 || key === 'p' || key === 'ح') {
        e.preventDefault();
        e.stopPropagation();
        setActiveTool('pen');
        emitShortcutFeedback('قلم أبل', 'P');
      } else if (code === 'KeyF' || keyCode === 70 || key === 'f' || key === 'ب') {
        if (state.systemSettings.enabledOptionalTools.fountain) {
          e.preventDefault();
          e.stopPropagation();
          setActiveTool('fountain');
          emitShortcutFeedback('قلم خطّاط', 'F');
        }
      } else if (code === 'KeyG' || keyCode === 71 || key === 'g' || key === 'ل') {
        e.preventDefault();
        e.stopPropagation();
        setActiveTool('pencil');
        emitShortcutFeedback('قلم رصاص', 'G');
      } else if (code === 'KeyH' || keyCode === 72 || key === 'h' || key === 'ا') {
        e.preventDefault();
        e.stopPropagation();
        setActiveTool('highlighter');
        emitShortcutFeedback('تظليل أبل', 'H');
      } else if (code === 'KeyT' || keyCode === 84 || key === 't' || key === 'ف') {
        if (state.systemSettings.enabledOptionalTools.tape) {
          e.preventDefault();
          e.stopPropagation();
          setActiveTool('tape');
          emitShortcutFeedback('شريط التحفيظ', 'T');
        }
      } else if (code === 'KeyL' || keyCode === 76 || key === 'l' || key === 'م') {
        e.preventDefault();
        e.stopPropagation();
        setActiveTool('laser');
        emitShortcutFeedback('ليزر ضوئي', 'L');
      } else if (code === 'KeyE' || keyCode === 69 || key === 'e' || key === 'ث') {
        e.preventDefault();
        e.stopPropagation();
        setActiveTool('eraser');
        emitShortcutFeedback('ممحاة ذكية', 'E');
      } else if (code === 'KeyS' || keyCode === 83 || key === 's' || key === 'س') {
        if (state.systemSettings.enabledOptionalTools.lasso) {
          e.preventDefault();
          e.stopPropagation();
          setActiveTool('lasso');
          emitShortcutFeedback('تحديد حر', 'S');
        }
      } else if (code === 'KeyV' || keyCode === 86 || key === 'v' || key === 'ر') {
        if (state.activeTool !== 'cursor') {
          e.preventDefault();
          e.stopPropagation();
          setActiveTool('cursor');
          emitShortcutFeedback('وضع التصفح', 'V');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [
    undo,
    redo,
    clearSurface,
    resolveHistoryTarget,
    stepActiveToolSize,
    emitShortcutFeedback,
    updatePenSettings,
    updateFountainSettings,
    updatePencilSettings,
    updateHighlighterSettings,
    updateShapesSettings,
    updateTapeSettings,
    updateEraserSettings,
    setSelectedStroke,
    setActiveTool,
  ]);

  const value = useMemo<AnnotationContextValue>(
    () => ({
      activeTool,
      setActiveTool,
      isPaletteOpen,
      setPaletteOpen,
      penSettings,
      updatePenSettings,
      fountainSettings,
      updateFountainSettings,
      pencilSettings,
      updatePencilSettings,
      highlighterSettings,
      updateHighlighterSettings,
      shapesSettings,
      updateShapesSettings,
      tapeSettings,
      updateTapeSettings,
      laserSettings,
      updateLaserSettings,
      eraserSettings,
      updateEraserSettings,
      lassoSettings,
      updateLassoSettings,
      systemSettings,
      updateSystemSettings,
      toggleOptionalTool,
      activeSurfaceId,
      hasBoundedSurface,
      selectedStroke,
      setSelectedStroke,
      selectedStrokeIds,
      setSelectedStrokeIds,
      selectedStrokeObjects,
      selectedStrokeAnchor,
      setSelectedStrokeAnchor,
      setFallbackSurfaceId,
      registerBoundedSurface,
      unregisterBoundedSurface,
      registerSurfaceExporter,
      exportActiveSurfacePdf,
      isExportingPdf,
      getStrokes,
      addStroke,
      updateStroke,
      updateStrokesBatch,
      toggleTapeRevealed,
      removeStrokes,
      applyEraseBatch,
      duplicateStroke,
      duplicateStrokes,
      reorderStrokes,
      undo,
      redo,
      clearSurface,
      canUndo,
      canRedo,
      activeStrokeCount,
      shortcutFeedback,
    }),
    [
      activeTool,
      setActiveTool,
      isPaletteOpen,
      setPaletteOpen,
      penSettings,
      updatePenSettings,
      fountainSettings,
      updateFountainSettings,
      pencilSettings,
      updatePencilSettings,
      highlighterSettings,
      updateHighlighterSettings,
      shapesSettings,
      updateShapesSettings,
      tapeSettings,
      updateTapeSettings,
      laserSettings,
      updateLaserSettings,
      eraserSettings,
      updateEraserSettings,
      lassoSettings,
      updateLassoSettings,
      systemSettings,
      updateSystemSettings,
      toggleOptionalTool,
      activeSurfaceId,
      hasBoundedSurface,
      selectedStroke,
      setSelectedStroke,
      selectedStrokeIds,
      setSelectedStrokeIds,
      selectedStrokeObjects,
      selectedStrokeAnchor,
      registerBoundedSurface,
      unregisterBoundedSurface,
      registerSurfaceExporter,
      exportActiveSurfacePdf,
      isExportingPdf,
      getStrokes,
      addStroke,
      updateStroke,
      updateStrokesBatch,
      toggleTapeRevealed,
      removeStrokes,
      applyEraseBatch,
      duplicateStroke,
      duplicateStrokes,
      reorderStrokes,
      undo,
      redo,
      clearSurface,
      canUndo,
      canRedo,
      activeStrokeCount,
      shortcutFeedback,
    ]
  );

  const actionsValue = useMemo<AnnotationActionsValue>(
    () => ({
      setActiveTool,
      setPaletteOpen,
      setSelectedStroke,
      setSelectedStrokeIds,
      setSelectedStrokeAnchor,
      updatePenSettings,
      updateFountainSettings,
      updatePencilSettings,
      updateHighlighterSettings,
      updateShapesSettings,
      updateTapeSettings,
      updateLaserSettings,
      updateEraserSettings,
      updateLassoSettings,
      updateSystemSettings,
      toggleOptionalTool,
      setFallbackSurfaceId,
      registerBoundedSurface,
      unregisterBoundedSurface,
      registerSurfaceExporter,
      exportActiveSurfacePdf,
      addStroke,
      updateStroke,
      updateStrokesBatch,
      toggleTapeRevealed,
      removeStrokes,
      applyEraseBatch,
      duplicateStroke,
      duplicateStrokes,
      reorderStrokes,
      undo,
      redo,
      clearSurface,
    }),
    [
      setActiveTool,
      setPaletteOpen,
      setSelectedStroke,
      setSelectedStrokeIds,
      updatePenSettings,
      updateFountainSettings,
      updatePencilSettings,
      updateHighlighterSettings,
      updateShapesSettings,
      updateTapeSettings,
      updateLaserSettings,
      updateEraserSettings,
      updateLassoSettings,
      updateSystemSettings,
      toggleOptionalTool,
      registerBoundedSurface,
      unregisterBoundedSurface,
      registerSurfaceExporter,
      exportActiveSurfacePdf,
      addStroke,
      updateStroke,
      updateStrokesBatch,
      toggleTapeRevealed,
      removeStrokes,
      applyEraseBatch,
      duplicateStroke,
      duplicateStrokes,
      reorderStrokes,
      undo,
      redo,
      clearSurface,
    ]
  );

  const hasActiveStrokes = activeStrokeCount > 0;

  const toolStateValue = useMemo<AnnotationToolStateValue>(
    () => ({
      activeTool,
      isPaletteOpen,
      penSettings,
      fountainSettings,
      pencilSettings,
      highlighterSettings,
      shapesSettings,
      tapeSettings,
      laserSettings,
      eraserSettings,
      lassoSettings,
      systemSettings,
      hasBoundedSurface,
      selectedStroke,
      selectedStrokeIds,
      selectedStrokeObjects,
      selectedStrokeAnchor,
      shortcutFeedback,
    }),
    [
      activeTool,
      isPaletteOpen,
      penSettings,
      fountainSettings,
      pencilSettings,
      highlighterSettings,
      shapesSettings,
      tapeSettings,
      laserSettings,
      eraserSettings,
      lassoSettings,
      systemSettings,
      hasBoundedSurface,
      selectedStroke,
      selectedStrokeIds,
      selectedStrokeObjects,
      selectedStrokeAnchor,
      shortcutFeedback,
    ]
  );

  const dockStateValue = useMemo<AnnotationDockStateValue>(
    () => ({
      canUndo,
      canRedo,
      hasActiveStrokes,
      isExportingPdf,
    }),
    [canUndo, canRedo, hasActiveStrokes, isExportingPdf]
  );

  return (
    <AnnotationActionsContext.Provider value={actionsValue}>
      <AnnotationToolStateContext.Provider value={toolStateValue}>
        <AnnotationDockStateContext.Provider value={dockStateValue}>
          <AnnotationContext.Provider value={value}>{children}</AnnotationContext.Provider>
        </AnnotationDockStateContext.Provider>
      </AnnotationToolStateContext.Provider>
    </AnnotationActionsContext.Provider>
  );
};

export function useAnnotation(): AnnotationContextValue {
  const ctx = useContext(AnnotationContext);
  if (!ctx) {
    throw new Error('useAnnotation must be used within an AnnotationProvider');
  }
  return ctx;
}

export function useAnnotationActions(): AnnotationActionsValue {
  const ctx = useContext(AnnotationActionsContext);
  if (!ctx) {
    throw new Error('useAnnotationActions must be used within an AnnotationProvider');
  }
  return ctx;
}

export function useAnnotationToolState(): AnnotationToolStateValue {
  const ctx = useContext(AnnotationToolStateContext);
  if (!ctx) {
    throw new Error('useAnnotationToolState must be used within an AnnotationProvider');
  }
  return ctx;
}

export function useAnnotationDockState(): AnnotationDockStateValue {
  const ctx = useContext(AnnotationDockStateContext);
  if (!ctx) {
    throw new Error('useAnnotationDockState must be used within an AnnotationProvider');
  }
  return ctx;
}
