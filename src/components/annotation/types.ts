export type AnnotationTool =
  | 'cursor'
  | 'lasso'
  | 'pen'
  | 'fountain'
  | 'pencil'
  | 'highlighter'
  | 'shapes'
  | 'tape'
  | 'laser'
  | 'eraser';

export interface AnnotationPoint {
  x: number;
  y: number;
  pressure: number;
  t: number;
}

export type AnnotationShape =
  | {
      type: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | {
      /** Smooth quadratic Bezier curved line / arch / curved underline */
      type: 'arc';
      x1: number;
      y1: number;
      cx: number;
      cy: number;
      x2: number;
      y2: number;
    }
  | {
      /** Circle or optionally rotated ellipse */
      type: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      rotation?: number;
      isCircle?: boolean;
    }
  | {
      /** Triangles, rectangles, squares, diamonds, checkmarks, square brackets, or closed polygons */
      type: 'polygon';
      points: Array<{ x: number; y: number }>;
      closed: boolean;
    }
  | {
      /** Geometric pointer arrow (single or bidirectional `<--->`) with straight or smoothly curved shaft */
      type: 'arrow';
      x1: number;
      y1: number;
      cx?: number;
      cy?: number;
      x2: number;
      y2: number;
      leftX: number;
      leftY: number;
      rightX: number;
      rightY: number;
      bidirectional?: boolean;
      tailLeftX?: number;
      tailLeftY?: number;
      tailRightX?: number;
      tailRightY?: number;
    }
  | {
      /** Calligraphic curly brace `{ }` or horizontal bracket `︷ ︸` */
      type: 'brace';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      depth: number;
    }
  | {
      /** Ultra-smooth idealized freeform curve (e.g. S-curve, wave, tilde, flourish) */
      type: 'curve';
      points: Array<{ x: number; y: number }>;
    };

export type PenLineStyle = 'solid' | 'dashed' | 'dotted';
export type EraserMode = 'stroke' | 'partial';
export type QuickShapeMode = 'auto' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'triangle';
export type TapePattern = 'striped' | 'solid' | 'dots';
export type AnnotationStrokeKind = 'pen' | 'fountain' | 'pencil' | 'highlighter' | 'tape';

export interface SelectedStrokeRef {
  surfaceId: string;
  strokeId: string;
}

export interface SelectedStrokeGroupRef {
  surfaceId: string;
  strokeIds: string[];
}

export interface SelectedStrokeAnchor {
  surfaceId: string;
  strokeId: string;
  strokeIds?: string[];
  count?: number;
  kind: AnnotationStrokeKind | 'mixed';
  centerX: number;
  topY: number;
  bottomY: number;
}

export interface AnnotationStroke {
  id: string;
  kind: AnnotationStrokeKind;
  color: string;
  size: number;
  opacity: number;
  smoothing?: number;
  lineStyle?: PenLineStyle;
  nibAngleDeg?: number;
  revealed?: boolean;
  tapePattern?: TapePattern;
  points: AnnotationPoint[];
  shape?: AnnotationShape;
}

export type SizeSlotIndex = 0 | 1 | 2;
export type ColorSlotIndex = 0 | 1 | 2;

export interface PenSettings {
  color: string;
  colorSlots: [string, string, string];
  activeColorSlot: ColorSlotIndex;
  size: number;
  sizeSlots: [number, number, number];
  activeSizeSlot: SizeSlotIndex;
  opacity: number;
  smoothing: number;
  lineStyle: PenLineStyle;
  smartShapes: boolean;
  scribbleErase: boolean;
}

export interface FountainSettings {
  color: string;
  colorSlots: [string, string, string];
  activeColorSlot: ColorSlotIndex;
  size: number;
  sizeSlots: [number, number, number];
  activeSizeSlot: SizeSlotIndex;
  opacity: number;
  smoothing: number;
  nibAngleDeg: number;
  smartShapes: boolean;
  scribbleErase: boolean;
}

export interface PencilSettings {
  color: string;
  colorSlots: [string, string, string];
  activeColorSlot: ColorSlotIndex;
  size: number;
  sizeSlots: [number, number, number];
  activeSizeSlot: SizeSlotIndex;
  opacity: number;
  smoothing: number;
  smartShapes: boolean;
  scribbleErase: boolean;
}

export interface HighlighterSettings {
  color: string;
  colorSlots: [string, string, string];
  activeColorSlot: ColorSlotIndex;
  size: number;
  sizeSlots: [number, number, number];
  activeSizeSlot: SizeSlotIndex;
  opacity: number;
  smoothing: number;
  straightAssist: boolean;
  holdToSnap: boolean;
}

export interface ShapesSettings {
  color: string;
  colorSlots: [string, string, string];
  activeColorSlot: ColorSlotIndex;
  size: number;
  sizeSlots: [number, number, number];
  activeSizeSlot: SizeSlotIndex;
  opacity: number;
  lineStyle: PenLineStyle;
  shapeMode: QuickShapeMode;
}

export interface TapeSettings {
  color: string;
  colorSlots: [string, string, string];
  activeColorSlot: ColorSlotIndex;
  size: number;
  sizeSlots: [number, number, number];
  activeSizeSlot: SizeSlotIndex;
  opacity: number;
  smoothing: number;
  pattern: TapePattern;
  straightAssist: boolean;
}

export interface LaserSettings {
  color: string;
  colorSlots: [string, string, string];
  activeColorSlot: ColorSlotIndex;
  mode: 'trail' | 'dot';
  size: number;
  fadeDurationMs: number;
  smoothing: number;
}

export interface EraserSettings {
  size: number;
  sizeSlots: [number, number, number];
  activeSizeSlot: SizeSlotIndex;
  mode: EraserMode;
  highlighterOnly?: boolean;
}

export type LassoMode = 'freeform' | 'rect';
export type LassoMatchMode = 'touch' | 'contain';

export interface LassoSettings {
  mode: LassoMode;
  matchMode: LassoMatchMode;
  includeHighlights: boolean;
}

export type OptionalDockTool = 'fountain' | 'tape' | 'lasso';

export interface AnnotationSystemSettings {
  /** Unified smart-shape auto-snap toggle across all pens and highlighter */
  smartShapes: boolean;
  /** Unified quick scribble-to-erase toggle across ink, fountain, and pencil */
  scribbleErase: boolean;
  /** Optional dock tools toggled on/off from the outer system settings */
  enabledOptionalTools: Record<OptionalDockTool, boolean>;
}

export type SizableAnnotationTool =
  | 'pen'
  | 'fountain'
  | 'pencil'
  | 'highlighter'
  | 'shapes'
  | 'tape'
  | 'eraser';

export type ColorableAnnotationTool =
  | 'pen'
  | 'fountain'
  | 'pencil'
  | 'highlighter'
  | 'shapes'
  | 'tape'
  | 'laser';

export const SIZE_DIAL_MIN = 5;
export const SIZE_DIAL_MAX = 100;
export const SIZE_DIAL_STEP = 5;

/** Clamps and rounds any thickness percentage to clean 1% precision within 5%..100%. */
export function clampSizeLevel(level: number): number {
  return Math.max(SIZE_DIAL_MIN, Math.min(SIZE_DIAL_MAX, Math.round(level)));
}

export interface MagneticSnapResult {
  value: number;
  visualValue: number;
  lockedAnchor: number | null;
}

export interface MagneticSnapOptions {
  magnetStep?: number;
  lockedAnchor?: number | null;
  dragSpeedPxPerMs?: number;
}

/**
 * Applies a velocity-aware magnetic detent with entry/exit hysteresis around every multiple of
 * `magnetStep` (default 5) across the entire slider range.
 * - Normal/fast drags catch 5-multiples firmly; ultra-slow micro-drags soften resistance for 1% precision.
 * - Entry vs exit hysteresis gives a crisp mechanical detent feel without jitter.
 */
export function applyMagneticSnap(
  rawVal: number,
  min: number,
  max: number,
  options: number | MagneticSnapOptions = 5
): MagneticSnapResult {
  const {
    magnetStep = 5,
    lockedAnchor = null,
    dragSpeedPxPerMs = 0.25,
  } = typeof options === 'number' ? { magnetStep: options } : options;

  const clampedRaw = Math.max(min, Math.min(max, rawVal));
  const halfGap = magnetStep * 0.5;
  const nearestAnchor = Math.max(
    min,
    Math.min(max, Math.round(clampedRaw / magnetStep) * magnetStep)
  );

  // Slow deliberate drag (< 0.12 px/ms) softens the magnet for easy 1% intermediate picks;
  // brisk drag (> 0.35 px/ms) firms it up slightly so multiples of 5 are caught reliably.
  const slowBlend = Math.max(0, Math.min(1, (0.12 - dragSpeedPxPerMs) / 0.08));
  const fastBlend = Math.max(0, Math.min(1, (dragSpeedPxPerMs - 0.35) / 0.55));
  const entryRadius = 1.32 - 0.34 * slowBlend + 0.14 * fastBlend;
  const exitRadius = 1.62 - 0.42 * slowBlend + 0.12 * fastBlend;

  const hasValidLockedAnchor =
    lockedAnchor !== null && Math.abs(clampedRaw - lockedAnchor) < halfGap;
  const activeAnchor = hasValidLockedAnchor ? lockedAnchor : nearestAnchor;
  const captureRadius = hasValidLockedAnchor ? exitRadius : entryRadius;

  const delta = clampedRaw - activeAnchor;
  const absDelta = Math.abs(delta);

  if (absDelta <= captureRadius) {
    return {
      value: activeAnchor,
      visualValue: activeAnchor,
      lockedAnchor: activeAnchor,
    };
  }

  const span = Math.max(0.001, halfGap - captureRadius);
  const linearT = Math.max(0, Math.min(1, (absDelta - captureRadius) / span));
  const easedT = Math.pow(linearT, 1.18);
  const visualValue = Math.max(
    min,
    Math.min(max, activeAnchor + Math.sign(delta) * easedT * halfGap)
  );
  const value = Math.max(min, Math.min(max, Math.round(visualValue)));

  return {
    value,
    visualValue,
    lockedAnchor: null,
  };
}

/** Snaps any raw thickness percentage to a clean 5% detent within 5%..100%. */
export function snapSizeLevel(level: number): number {
  const snapped = Math.round(level / SIZE_DIAL_STEP) * SIZE_DIAL_STEP;
  return Math.max(SIZE_DIAL_MIN, Math.min(SIZE_DIAL_MAX, snapped));
}

/**
 * Converts a unified 5..100 thickness dial percentage into calibrated canvas pixels per tool.
 * Pen uses a gentle power curve so 5%..35% gives crisp Mushaf precision while 100% reaches bold marker width.
 */
export function sizeLevelToPx(tool: SizableAnnotationTool, level: number): number {
  const clamped = clampSizeLevel(level);
  const t = (clamped - SIZE_DIAL_MIN) / (SIZE_DIAL_MAX - SIZE_DIAL_MIN);
  if (tool === 'pen' || tool === 'shapes') {
    return Math.round((1.3 + Math.pow(t, 1.32) * 16.7) * 100) / 100;
  }
  if (tool === 'fountain') {
    return Math.round((2.2 + Math.pow(t, 1.2) * 21.8) * 100) / 100;
  }
  if (tool === 'pencil') {
    return Math.round((1.4 + Math.pow(t, 1.18) * 12.6) * 100) / 100;
  }
  if (tool === 'highlighter') {
    return Math.round((10 + t * 46) * 100) / 100;
  }
  if (tool === 'tape') {
    return Math.round((14 + t * 42) * 100) / 100;
  }
  return Math.round((12 + t * 52) * 100) / 100;
}

/**
 * Inverse mapping from canvas pixels back to the nearest 1% dial level (5..100).
 */
export function pxToSizeLevel(tool: SizableAnnotationTool, px: number): number {
  let t = 0;
  if (tool === 'pen' || tool === 'shapes') {
    const norm = Math.max(0, Math.min(1, (px - 1.3) / 16.7));
    t = Math.pow(norm, 1 / 1.32);
  } else if (tool === 'fountain') {
    const norm = Math.max(0, Math.min(1, (px - 2.2) / 21.8));
    t = Math.pow(norm, 1 / 1.2);
  } else if (tool === 'pencil') {
    const norm = Math.max(0, Math.min(1, (px - 1.4) / 12.6));
    t = Math.pow(norm, 1 / 1.18);
  } else if (tool === 'highlighter') {
    t = Math.max(0, Math.min(1, (px - 10) / 46));
  } else if (tool === 'tape') {
    t = Math.max(0, Math.min(1, (px - 14) / 42));
  } else {
    t = Math.max(0, Math.min(1, (px - 12) / 52));
  }
  return clampSizeLevel(SIZE_DIAL_MIN + t * (SIZE_DIAL_MAX - SIZE_DIAL_MIN));
}

export function laserSizeLevelToPx(level: number): number {
  const clamped = clampSizeLevel(level);
  const t = (clamped - SIZE_DIAL_MIN) / (SIZE_DIAL_MAX - SIZE_DIAL_MIN);
  return Math.round((2.4 + t * 7.0) * 100) / 100;
}

export function pxToLaserSizeLevel(px: number): number {
  const t = Math.max(0, Math.min(1, (px - 2.4) / 7.0));
  return clampSizeLevel(SIZE_DIAL_MIN + t * (SIZE_DIAL_MAX - SIZE_DIAL_MIN));
}

export interface ColorSwatch {
  id: string;
  hex: string;
  label: string;
}

export const APPLE_PEN_COLORS: readonly ColorSwatch[] = [
  { id: 'crimson', hex: '#FF3B30', label: 'أحمر أبل للتنبيه' },
  { id: 'royal', hex: '#007AFF', label: 'أزرق أبل للشرح' },
  { id: 'ink', hex: '#1C1C1E', label: 'حبر أسود داكن' },
  { id: 'emerald', hex: '#28B84D', label: 'أخضر للإجادة' },
  { id: 'amber', hex: '#FF9500', label: 'برتقالي دافئ' },
  { id: 'plum', hex: '#AF52DE', label: 'بنفسجي هادئ' },
];

export const APPLE_PENCIL_COLORS: readonly ColorSwatch[] = [
  { id: 'graphite', hex: '#4B5563', label: 'رصاص غرافيتي هادئ' },
  { id: 'charcoal', hex: '#1F2937', label: 'رصاص فحمي داكن' },
  { id: 'indigo', hex: '#3B82F6', label: 'رصاص أزرق' },
  { id: 'crimson-lead', hex: '#E11D48', label: 'رصاص قرمزي' },
  { id: 'forest', hex: '#16A34A', label: 'رصاص أخضر' },
  { id: 'sepia', hex: '#92400E', label: 'رصاص بني دافئ' },
];

export const APPLE_HIGHLIGHTER_COLORS: readonly ColorSwatch[] = [
  { id: 'sunbeam', hex: '#FFE84D', label: 'أصفر أبل المشرق' },
  { id: 'mint', hex: '#6CE89B', label: 'أخضر نعناعي' },
  { id: 'sky', hex: '#6AD0FF', label: 'أزرق سماوي' },
  { id: 'rose', hex: '#FF85B8', label: 'وردي ناعم' },
  { id: 'peach', hex: '#FFBA5C', label: 'مشمشي دافئ' },
  { id: 'lilac', hex: '#C89BFF', label: 'بنفسجي فاتح' },
];

export const APPLE_TAPE_COLORS: readonly ColorSwatch[] = [
  { id: 'sand', hex: '#F2E7CF', label: 'شريط رملي هادئ' },
  { id: 'sky-tape', hex: '#DCEEFF', label: 'شريط سماوي' },
  { id: 'mint-tape', hex: '#DDF4E4', label: 'شريط نعناعي' },
  { id: 'rose-tape', hex: '#FCE4EC', label: 'شريط وردي ناعم' },
  { id: 'lavender-tape', hex: '#EDE7FB', label: 'شريط خزامي' },
  { id: 'slate-tape', hex: '#E2E8F0', label: 'شريط رمادي ورقي' },
];

export const APPLE_LASER_COLORS: readonly ColorSwatch[] = [
  { id: 'ruby', hex: '#FF2D55', label: 'ليزر ياقوتي' },
  { id: 'cyan', hex: '#00B8FF', label: 'ليزر أزرق ضوئي' },
  { id: 'emerald', hex: '#10D978', label: 'ليزر زمردي' },
  { id: 'solar', hex: '#FF9F0A', label: 'ليزر ذهبي' },
];

const DEFAULT_PEN_SLOTS: [number, number, number] = [
  sizeLevelToPx('pen', 15),
  sizeLevelToPx('pen', 25),
  sizeLevelToPx('pen', 50),
];

const DEFAULT_FOUNTAIN_SLOTS: [number, number, number] = [
  sizeLevelToPx('fountain', 18),
  sizeLevelToPx('fountain', 32),
  sizeLevelToPx('fountain', 58),
];

const DEFAULT_PENCIL_SLOTS: [number, number, number] = [
  sizeLevelToPx('pencil', 15),
  sizeLevelToPx('pencil', 28),
  sizeLevelToPx('pencil', 50),
];

const DEFAULT_HIGHLIGHTER_SLOTS: [number, number, number] = [
  sizeLevelToPx('highlighter', 20),
  sizeLevelToPx('highlighter', 35),
  sizeLevelToPx('highlighter', 65),
];

const DEFAULT_SHAPES_SLOTS: [number, number, number] = [
  sizeLevelToPx('shapes', 15),
  sizeLevelToPx('shapes', 25),
  sizeLevelToPx('shapes', 45),
];

const DEFAULT_TAPE_SLOTS: [number, number, number] = [
  sizeLevelToPx('tape', 22),
  sizeLevelToPx('tape', 42),
  sizeLevelToPx('tape', 68),
];

const DEFAULT_ERASER_SLOTS: [number, number, number] = [
  sizeLevelToPx('eraser', 15),
  sizeLevelToPx('eraser', 30),
  sizeLevelToPx('eraser', 60),
];

const DEFAULT_PEN_COLOR_SLOTS: [string, string, string] = ['#FF3B30', '#007AFF', '#28B84D'];
const DEFAULT_FOUNTAIN_COLOR_SLOTS: [string, string, string] = ['#1C1C1E', '#007AFF', '#AF52DE'];
const DEFAULT_PENCIL_COLOR_SLOTS: [string, string, string] = ['#4B5563', '#3B82F6', '#E11D48'];
const DEFAULT_HIGHLIGHTER_COLOR_SLOTS: [string, string, string] = ['#FFE84D', '#6CE89B', '#6AD0FF'];
const DEFAULT_SHAPES_COLOR_SLOTS: [string, string, string] = ['#007AFF', '#FF3B30', '#28B84D'];
const DEFAULT_TAPE_COLOR_SLOTS: [string, string, string] = ['#F2E7CF', '#DCEEFF', '#DDF4E4'];
const DEFAULT_LASER_COLOR_SLOTS: [string, string, string] = ['#FF2D55', '#00B8FF', '#10D978'];

export const DEFAULT_PEN_SETTINGS: PenSettings = {
  color: DEFAULT_PEN_COLOR_SLOTS[0],
  colorSlots: DEFAULT_PEN_COLOR_SLOTS,
  activeColorSlot: 0,
  size: DEFAULT_PEN_SLOTS[1],
  sizeSlots: DEFAULT_PEN_SLOTS,
  activeSizeSlot: 1,
  opacity: 0.96,
  smoothing: 0.62,
  lineStyle: 'solid',
  smartShapes: true,
  scribbleErase: true,
};

export const DEFAULT_FOUNTAIN_SETTINGS: FountainSettings = {
  color: DEFAULT_FOUNTAIN_COLOR_SLOTS[0],
  colorSlots: DEFAULT_FOUNTAIN_COLOR_SLOTS,
  activeColorSlot: 0,
  size: DEFAULT_FOUNTAIN_SLOTS[1],
  sizeSlots: DEFAULT_FOUNTAIN_SLOTS,
  activeSizeSlot: 1,
  opacity: 0.96,
  smoothing: 0.68,
  nibAngleDeg: -38,
  smartShapes: true,
  scribbleErase: true,
};

export const DEFAULT_PENCIL_SETTINGS: PencilSettings = {
  color: DEFAULT_PENCIL_COLOR_SLOTS[0],
  colorSlots: DEFAULT_PENCIL_COLOR_SLOTS,
  activeColorSlot: 0,
  size: DEFAULT_PENCIL_SLOTS[1],
  sizeSlots: DEFAULT_PENCIL_SLOTS,
  activeSizeSlot: 1,
  opacity: 0.84,
  smoothing: 0.66,
  smartShapes: true,
  scribbleErase: true,
};

export const DEFAULT_HIGHLIGHTER_SETTINGS: HighlighterSettings = {
  color: DEFAULT_HIGHLIGHTER_COLOR_SLOTS[0],
  colorSlots: DEFAULT_HIGHLIGHTER_COLOR_SLOTS,
  activeColorSlot: 0,
  size: DEFAULT_HIGHLIGHTER_SLOTS[1],
  sizeSlots: DEFAULT_HIGHLIGHTER_SLOTS,
  activeSizeSlot: 1,
  opacity: 0.56,
  smoothing: 0.66,
  straightAssist: true,
  holdToSnap: true,
};

export const DEFAULT_SHAPES_SETTINGS: ShapesSettings = {
  color: DEFAULT_SHAPES_COLOR_SLOTS[0],
  colorSlots: DEFAULT_SHAPES_COLOR_SLOTS,
  activeColorSlot: 0,
  size: DEFAULT_SHAPES_SLOTS[1],
  sizeSlots: DEFAULT_SHAPES_SLOTS,
  activeSizeSlot: 1,
  opacity: 0.95,
  lineStyle: 'solid',
  shapeMode: 'auto',
};

export const DEFAULT_TAPE_SETTINGS: TapeSettings = {
  color: DEFAULT_TAPE_COLOR_SLOTS[0],
  colorSlots: DEFAULT_TAPE_COLOR_SLOTS,
  activeColorSlot: 0,
  size: DEFAULT_TAPE_SLOTS[1],
  sizeSlots: DEFAULT_TAPE_SLOTS,
  activeSizeSlot: 1,
  opacity: 1,
  smoothing: 0.66,
  pattern: 'striped',
  straightAssist: true,
};

export const DEFAULT_LASER_SETTINGS: LaserSettings = {
  color: DEFAULT_LASER_COLOR_SLOTS[0],
  colorSlots: DEFAULT_LASER_COLOR_SLOTS,
  activeColorSlot: 0,
  mode: 'trail',
  size: 4.6,
  fadeDurationMs: 1450,
  smoothing: 0.75,
};

export const DEFAULT_ERASER_SETTINGS: EraserSettings = {
  size: DEFAULT_ERASER_SLOTS[1],
  sizeSlots: DEFAULT_ERASER_SLOTS,
  activeSizeSlot: 1,
  mode: 'stroke',
  highlighterOnly: false,
};

export const DEFAULT_LASSO_SETTINGS: LassoSettings = {
  mode: 'freeform',
  matchMode: 'touch',
  includeHighlights: true,
};

export const DEFAULT_ANNOTATION_SYSTEM_SETTINGS: AnnotationSystemSettings = {
  smartShapes: true,
  scribbleErase: true,
  enabledOptionalTools: {
    fountain: false,
    tape: false,
    lasso: false,
  },
};
