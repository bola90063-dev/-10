import type {
  AnnotationPoint,
  AnnotationShape,
  AnnotationStroke,
  AnnotationStrokeKind,
  EraserMode,
  LassoMatchMode,
  LassoMode,
  QuickShapeMode,
  TapePattern,
} from './types';
import { toArabicDigits } from '../../utils/mushafData';

export interface RenderTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  unitScale: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  pressure: number;
  t: number;
}

export interface CssBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Pt2D {
  x: number;
  y: number;
}

export function cssBoundsToPixelRect(
  bounds: CssBounds | null,
  dprX: number,
  dprY: number,
  maxW: number,
  maxH: number
): PixelRect | null {
  if (!bounds || maxW <= 0 || maxH <= 0) return null;
  const x1 = Math.max(0, Math.floor(bounds.minX * dprX) - 2);
  const y1 = Math.max(0, Math.floor(bounds.minY * dprY) - 2);
  const x2 = Math.min(maxW, Math.ceil(bounds.maxX * dprX) + 2);
  const y2 = Math.min(maxH, Math.ceil(bounds.maxY * dprY) + 2);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return null;
  return { x: x1, y: y1, w, h };
}

export function unionPixelRects(a: PixelRect | null, b: PixelRect | null): PixelRect | null {
  if (!a) return b;
  if (!b) return a;
  const x1 = a.x < b.x ? a.x : b.x;
  const y1 = a.y < b.y ? a.y : b.y;
  const x2 = a.x + a.w > b.x + b.w ? a.x + a.w : b.x + b.w;
  const y2 = a.y + a.h > b.y + b.h ? a.y + a.h : b.y + b.h;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// Reusable module-level typed arrays for ZERO-allocation pen rendering on the 60fps hot path
let penKnotCap = 0;
let knotRawX = new Float32Array(0);
let knotRawY = new Float32Array(0);
let knotRawP = new Float32Array(0);
let knotRawT = new Float64Array(0);
let knotFiltX = new Float32Array(0);
let knotFiltY = new Float32Array(0);
let knotFiltP = new Float32Array(0);
let knotFiltT = new Float64Array(0);
let knotSmAX = new Float32Array(0);
let knotSmAY = new Float32Array(0);
let knotSmBX = new Float32Array(0);
let knotSmBY = new Float32Array(0);

function ensurePenKnotCapacity(needed: number): void {
  if (needed <= penKnotCap) return;
  const next = Math.max(256, needed * 2);
  penKnotCap = next;
  knotRawX = new Float32Array(next);
  knotRawY = new Float32Array(next);
  knotRawP = new Float32Array(next);
  knotRawT = new Float64Array(next);
  knotFiltX = new Float32Array(next);
  knotFiltY = new Float32Array(next);
  knotFiltP = new Float32Array(next);
  knotFiltT = new Float64Array(next);
  knotSmAX = new Float32Array(next);
  knotSmAY = new Float32Array(next);
  knotSmBX = new Float32Array(next);
  knotSmBY = new Float32Array(next);
}

let penDenseCap = 0;
let denseX = new Float32Array(0);
let denseY = new Float32Array(0);
let denseP = new Float32Array(0);
let denseT = new Float64Array(0);
let ribbonDists = new Float32Array(0);
let ribbonRadii = new Float32Array(0);
let ribbonLeftX = new Float32Array(0);
let ribbonLeftY = new Float32Array(0);
let ribbonRightX = new Float32Array(0);
let ribbonRightY = new Float32Array(0);

function ensurePenDenseCapacity(needed: number): void {
  if (needed <= penDenseCap) return;
  const next = Math.max(1024, needed * 2);
  const oldX = denseX;
  const oldY = denseY;
  const oldP = denseP;
  const oldT = denseT;
  penDenseCap = next;
  denseX = new Float32Array(next);
  denseY = new Float32Array(next);
  denseP = new Float32Array(next);
  denseT = new Float64Array(next);
  if (oldX.length > 0) {
    denseX.set(oldX);
    denseY.set(oldY);
    denseP.set(oldP);
    denseT.set(oldT);
  }
  ribbonDists = new Float32Array(next);
  ribbonRadii = new Float32Array(next);
  ribbonLeftX = new Float32Array(next);
  ribbonLeftY = new Float32Array(next);
  ribbonRightX = new Float32Array(next);
  ribbonRightY = new Float32Array(next);
}

function toScreenPoints(points: AnnotationPoint[], tf: RenderTransform): ScreenPoint[] {
  const len = points.length;
  const out: ScreenPoint[] = new Array(len);
  const sx = tf.scaleX;
  const sy = tf.scaleY;
  const ox = tf.offsetX;
  const oy = tf.offsetY;
  for (let i = 0; i < len; i++) {
    const p = points[i];
    out[i] = {
      x: p.x * sx + ox,
      y: p.y * sy + oy,
      pressure: p.pressure,
      t: p.t,
    };
  }
  return out;
}

/**
 * Removes noisy sub-2.5px pixel-staircase micro-jitter knots from mouse/trackpad input
 * while ALWAYS pinning the first point, live tip point, and sharp intentional corners.
 */
function filterMicroJitterKnots(pts: ScreenPoint[], minDistPx: number): ScreenPoint[] {
  const len = pts.length;
  if (len <= 3 || minDistPx <= 0.1) return pts;
  const minDistSq = minDistPx * minDistPx;
  const out: ScreenPoint[] = [pts[0]];
  let lastKept = pts[0];

  for (let i = 1; i < len - 1; i++) {
    const curr = pts[i];
    const dx = curr.x - lastKept.x;
    const dy = curr.y - lastKept.y;
    if (dx * dx + dy * dy >= minDistSq) {
      out.push(curr);
      lastKept = curr;
      continue;
    }

    // Preserve sharp intentional cusps/corners (e.g. Arabic letter teeth & hooks) even at short spacing
    const next = pts[i + 1];
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const l1Sq = dx * dx + dy * dy;
    const l2Sq = v2x * v2x + v2y * v2y;
    if (l1Sq > 0.64 && l2Sq > 0.64) {
      const dot = (dx * v2x + dy * v2y) / Math.sqrt(l1Sq * l2Sq);
      if (dot < 0.25) {
        out.push(curr);
        lastKept = curr;
      }
    }
  }

  out.push(pts[len - 1]);
  return out;
}

/**
 * Apple PencilKit-inspired corner-preserving zero-phase Gaussian smoothing.
 * - First point and live pen tip (last point) stay 100% pinned (0.0px lag/offset).
 * - Smooth curves and straight sweeps are ironed into fluid calligraphy with zero tremor.
 * - Intentional sharp bends (Arabic corners/hooks) automatically damp smoothing to stay crisp.
 */
function smoothControlPolygon(
  pts: ScreenPoint[],
  smoothingAmount: number,
  maxPasses = 4
): ScreenPoint[] {
  const n = pts.length;
  if (n < 3 || smoothingAmount <= 0.02) return pts;

  const clamped = Math.max(0, Math.min(1, smoothingAmount));
  const rawPasses = clamped >= 0.72 ? 4 : clamped >= 0.35 ? 3 : clamped >= 0.08 ? 2 : 0;
  const passes = rawPasses < maxPasses ? rawPasses : maxPasses;
  if (passes <= 0) return pts;
  const strength = 0.2 + clamped * 0.52;

  let curr = pts;
  for (let pass = 0; pass < passes; pass++) {
    const next: ScreenPoint[] = new Array(n);
    next[0] = curr[0];
    next[n - 1] = curr[n - 1];

    for (let i = 1; i < n - 1; i++) {
      const pPrev = curr[i - 1];
      const pCur = curr[i];
      const pNext = curr[i + 1];

      // Multi-scale 5px chord corner preservation keeps crisp turns on Arabic highlights
      let pBack = i - 1;
      while (pBack > 0 && Math.hypot(pCur.x - curr[pBack].x, pCur.y - curr[pBack].y) < 5.0) {
        pBack--;
      }
      let pFwd = i + 1;
      while (pFwd < n - 1 && Math.hypot(curr[pFwd].x - pCur.x, curr[pFwd].y - pCur.y) < 5.0) {
        pFwd++;
      }
      const v1x = pCur.x - curr[pBack].x;
      const v1y = pCur.y - curr[pBack].y;
      const v2x = curr[pFwd].x - pCur.x;
      const v2y = curr[pFwd].y - pCur.y;
      const l1Sq = v1x * v1x + v1y * v1y;
      const l2Sq = v2x * v2x + v2y * v2y;

      let cornerFactor = 1.0;
      if (l1Sq > 0.000001 && l2Sq > 0.000001) {
        const dot = (v1x * v2x + v1y * v2y) / Math.sqrt(l1Sq * l2Sq);
        const cf = (dot + 0.15) / 0.85;
        cornerFactor = cf < 0.08 ? 0.08 : cf > 1.0 ? 1.0 : cf;
      }

      // 5-point Gaussian kernel on interior nodes, 3-point near endpoints
      let targetX: number;
      let targetY: number;
      if (i >= 2 && i <= n - 3) {
        const pPrev2 = curr[i - 2];
        const pNext2 = curr[i + 2];
        targetX =
          0.08 * pPrev2.x +
          0.22 * pPrev.x +
          0.4 * pCur.x +
          0.22 * pNext.x +
          0.08 * pNext2.x;
        targetY =
          0.08 * pPrev2.y +
          0.22 * pPrev.y +
          0.4 * pCur.y +
          0.22 * pNext.y +
          0.08 * pNext2.y;
      } else {
        targetX = 0.25 * pPrev.x + 0.5 * pCur.x + 0.25 * pNext.x;
        targetY = 0.25 * pPrev.y + 0.5 * pCur.y + 0.25 * pNext.y;
      }

      const alpha = strength * cornerFactor;
      next[i] = {
        x: pCur.x + (targetX - pCur.x) * alpha,
        y: pCur.y + (targetY - pCur.y) * alpha,
        pressure: pCur.pressure,
        t: pCur.t,
      };
    }

    curr = next;
  }

  return curr;
}

/**
 * Smooth quadratic midpoint subdivision for glass-smooth Apple PencilKit splines.
 */
function subdivideSpline(pts: ScreenPoint[], maxStepPx = 2.0): ScreenPoint[] {
  const len = pts.length;
  if (len <= 1) return pts;
  if (len === 2) {
    const a = pts[0];
    const b = pts[1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(dist / maxStepPx));
    const res: ScreenPoint[] = new Array(steps + 1);
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      res[s] = {
        x: a.x + dx * u,
        y: a.y + dy * u,
        pressure: a.pressure + (b.pressure - a.pressure) * u,
        t: a.t + (b.t - a.t) * u,
      };
    }
    return res;
  }

  const out: ScreenPoint[] = [pts[0]];
  let prevMidX = pts[0].x;
  let prevMidY = pts[0].y;
  let prevMidP = pts[0].pressure;
  let prevMidT = pts[0].t;

  for (let i = 1; i < len; i++) {
    const ctrl = pts[i - 1];
    const curr = pts[i];
    const isLast = i === len - 1;
    const endX = isLast ? curr.x : (ctrl.x + curr.x) * 0.5;
    const endY = isLast ? curr.y : (ctrl.y + curr.y) * 0.5;
    const endP = isLast ? curr.pressure : (ctrl.pressure + curr.pressure) * 0.5;
    const endT = isLast ? curr.t : (ctrl.t + curr.t) * 0.5;

    const dx1 = ctrl.x - prevMidX;
    const dy1 = ctrl.y - prevMidY;
    const dx2 = endX - ctrl.x;
    const dy2 = endY - ctrl.y;
    const approxLen = Math.sqrt(dx1 * dx1 + dy1 * dy1) + Math.sqrt(dx2 * dx2 + dy2 * dy2);
    const steps = Math.max(1, Math.ceil(approxLen / maxStepPx));

    for (let s = 1; s <= steps; s++) {
      const u = s / steps;
      const inv = 1 - u;
      const x = inv * inv * prevMidX + 2 * inv * u * ctrl.x + u * u * endX;
      const y = inv * inv * prevMidY + 2 * inv * u * ctrl.y + u * u * endY;
      const pressure = inv * prevMidP + u * endP;
      const t = inv * prevMidT + u * endT;
      out.push({ x, y, pressure, t });
    }

    prevMidX = endX;
    prevMidY = endY;
    prevMidP = endP;
    prevMidT = endT;
  }

  return out;
}

/**
 * Resolves visual screen radii for an ellipse (respecting isotropic scaling for rotated ellipses or pure circles).
 */
function resolveEllipseScreenRadii(
  rx: number,
  ry: number,
  rotation: number | undefined,
  tf: RenderTransform,
  isCircle?: boolean
): { rxPx: number; ryPx: number } {
  if (isCircle || (rotation && Math.abs(rotation) > 0.001)) {
    const avgScale = (tf.scaleX + tf.scaleY) * 0.5;
    return {
      rxPx: Math.max(1, rx * avgScale),
      ryPx: Math.max(1, ry * avgScale),
    };
  }
  return {
    rxPx: Math.max(1, rx * tf.scaleX),
    ryPx: Math.max(1, ry * tf.scaleY),
  };
}

/**
 * Traces any snapped AnnotationShape cleanly onto a 2D canvas context.
 * Shared across Apple Pen rendering and Pro-Grade Optical Laser snapping.
 */
function sampleBracePointsPx(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  depth: number,
  stepsPerHalf = 18
): Pt2D[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 4) return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  const ux = dx / len;
  const uy = dy / len;
  // Normal pointing toward depth sign (CCW of chord * sign)
  const nx = -uy;
  const ny = ux;
  const midX = (x1 + x2) * 0.5;
  const midY = (y1 + y2) * 0.5;
  const half = len * 0.5;
  const shoulder = Math.min(Math.abs(depth) * 0.65, half * 0.28);

  const P0 = { x: x1, y: y1 };
  const P1 = { x: x1 + nx * (depth * 0.52), y: y1 + ny * (depth * 0.52) };
  const P2 = { x: x1 + ux * shoulder + nx * (depth * 0.52), y: y1 + uy * shoulder + ny * (depth * 0.52) };
  const Q1 = { x: midX - ux * (shoulder * 0.85) + nx * (depth * 0.52), y: midY - uy * (shoulder * 0.85) + ny * (depth * 0.52) };
  const Q2 = { x: midX + nx * (depth * 0.68), y: midY + ny * (depth * 0.68) };
  const Peak = { x: midX + nx * depth, y: midY + ny * depth };
  const R1 = { x: midX + ux * (shoulder * 0.85) + nx * (depth * 0.52), y: midY + uy * (shoulder * 0.85) + ny * (depth * 0.52) };
  const S1 = { x: x2 - ux * shoulder + nx * (depth * 0.52), y: y2 - uy * shoulder + ny * (depth * 0.52) };
  const S2 = { x: x2 + nx * (depth * 0.52), y: y2 + ny * (depth * 0.52) };
  const End = { x: x2, y: y2 };

  const sampleCubic = (a: Pt2D, b: Pt2D, c: Pt2D, d: Pt2D, steps: number, skipFirst: boolean): Pt2D[] => {
    const seg: Pt2D[] = [];
    for (let i = skipFirst ? 1 : 0; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const mt2 = mt * mt;
      const t2 = t * t;
      seg.push({
        x: mt2 * mt * a.x + 3 * mt2 * t * b.x + 3 * mt * t2 * c.x + t2 * t * d.x,
        y: mt2 * mt * a.y + 3 * mt2 * t * b.y + 3 * mt * t2 * c.y + t2 * t * d.y,
      });
    }
    return seg;
  };

  return [
    ...sampleCubic(P0, P1, P2, { x: (P2.x + Q1.x) * 0.5, y: (P2.y + Q1.y) * 0.5 }, Math.max(6, Math.round(stepsPerHalf * 0.5)), false),
    ...sampleCubic({ x: (P2.x + Q1.x) * 0.5, y: (P2.y + Q1.y) * 0.5 }, Q1, Q2, Peak, Math.max(6, Math.round(stepsPerHalf * 0.5)), true),
    ...sampleCubic(Peak, Q2, R1, { x: (R1.x + S1.x) * 0.5, y: (R1.y + S1.y) * 0.5 }, Math.max(6, Math.round(stepsPerHalf * 0.5)), true),
    ...sampleCubic({ x: (R1.x + S1.x) * 0.5, y: (R1.y + S1.y) * 0.5 }, S1, S2, End, Math.max(6, Math.round(stepsPerHalf * 0.5)), true),
  ];
}

function traceBracePath(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  depth: number
): void {
  const pts = sampleBracePointsPx(x1, y1, x2, y2, depth, 16);
  if (pts.length < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
}

export function traceShapePath(
  ctx: CanvasRenderingContext2D,
  shape: AnnotationShape,
  tf: RenderTransform
): void {
  ctx.beginPath();

  if (shape.type === 'line') {
    ctx.moveTo(shape.x1 * tf.scaleX + tf.offsetX, shape.y1 * tf.scaleY + tf.offsetY);
    ctx.lineTo(shape.x2 * tf.scaleX + tf.offsetX, shape.y2 * tf.scaleY + tf.offsetY);
    return;
  }

  if (shape.type === 'arc') {
    ctx.moveTo(shape.x1 * tf.scaleX + tf.offsetX, shape.y1 * tf.scaleY + tf.offsetY);
    ctx.quadraticCurveTo(
      shape.cx * tf.scaleX + tf.offsetX,
      shape.cy * tf.scaleY + tf.offsetY,
      shape.x2 * tf.scaleX + tf.offsetX,
      shape.y2 * tf.scaleY + tf.offsetY
    );
    return;
  }

  if (shape.type === 'brace') {
    const x1 = shape.x1 * tf.scaleX + tf.offsetX;
    const y1 = shape.y1 * tf.scaleY + tf.offsetY;
    const x2 = shape.x2 * tf.scaleX + tf.offsetX;
    const y2 = shape.y2 * tf.scaleY + tf.offsetY;
    traceBracePath(ctx, x1, y1, x2, y2, shape.depth * tf.unitScale);
    return;
  }

  if (shape.type === 'ellipse') {
    const cx = shape.cx * tf.scaleX + tf.offsetX;
    const cy = shape.cy * tf.scaleY + tf.offsetY;
    const { rxPx, ryPx } = resolveEllipseScreenRadii(
      shape.rx,
      shape.ry,
      shape.rotation,
      tf,
      shape.isCircle
    );
    ctx.ellipse(cx, cy, rxPx, ryPx, shape.rotation ?? 0, 0, Math.PI * 2);
    return;
  }

  if (shape.type === 'polygon') {
    const pts = shape.points;
    if (pts.length < 2) return;
    ctx.moveTo(pts[0].x * tf.scaleX + tf.offsetX, pts[0].y * tf.scaleY + tf.offsetY);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x * tf.scaleX + tf.offsetX, pts[i].y * tf.scaleY + tf.offsetY);
    }
    if (shape.closed) {
      ctx.closePath();
    }
    return;
  }

  if (shape.type === 'arrow') {
    const x1 = shape.x1 * tf.scaleX + tf.offsetX;
    const y1 = shape.y1 * tf.scaleY + tf.offsetY;
    const x2 = shape.x2 * tf.scaleX + tf.offsetX;
    const y2 = shape.y2 * tf.scaleY + tf.offsetY;
    const lx = shape.leftX * tf.scaleX + tf.offsetX;
    const ly = shape.leftY * tf.scaleY + tf.offsetY;
    const rx = shape.rightX * tf.scaleX + tf.offsetX;
    const ry = shape.rightY * tf.scaleY + tf.offsetY;
    const head = computeAppleArrowGeometry(x2, y2, lx, ly, rx, ry, 0);
    const tuck = Math.min(head.axisLen * 0.24, 2.2);
    const endX = x2 - head.ux * tuck;
    const endY = y2 - head.uy * tuck;

    const hasTailHead =
      shape.bidirectional &&
      shape.tailLeftX !== undefined &&
      shape.tailLeftY !== undefined &&
      shape.tailRightX !== undefined &&
      shape.tailRightY !== undefined;

    let startX = x1;
    let startY = y1;
    let tailHead: ReturnType<typeof computeAppleArrowGeometry> | null = null;
    if (hasTailHead) {
      tailHead = computeAppleArrowGeometry(
        x1,
        y1,
        shape.tailLeftX! * tf.scaleX + tf.offsetX,
        shape.tailLeftY! * tf.scaleY + tf.offsetY,
        shape.tailRightX! * tf.scaleX + tf.offsetX,
        shape.tailRightY! * tf.scaleY + tf.offsetY,
        0
      );
      const tuckTail = Math.min(tailHead.axisLen * 0.24, 2.2);
      startX = x1 - tailHead.ux * tuckTail;
      startY = y1 - tailHead.uy * tuckTail;
    }

    ctx.moveTo(startX, startY);
    if (shape.cx !== undefined && shape.cy !== undefined) {
      const cx = shape.cx * tf.scaleX + tf.offsetX;
      const cy = shape.cy * tf.scaleY + tf.offsetY;
      const split = splitQuadraticShaftAtTuck(startX, startY, cx, cy, x2, y2, tuck);
      ctx.quadraticCurveTo(split.cx, split.cy, split.ex, split.ey);
    } else {
      ctx.lineTo(endX, endY);
    }
    ctx.moveTo(head.lx, head.ly);
    ctx.quadraticCurveTo(head.lCtrlX, head.lCtrlY, x2, y2);
    ctx.quadraticCurveTo(head.rCtrlX, head.rCtrlY, head.rx, head.ry);

    if (tailHead) {
      ctx.moveTo(tailHead.lx, tailHead.ly);
      ctx.quadraticCurveTo(tailHead.lCtrlX, tailHead.lCtrlY, x1, y1);
      ctx.quadraticCurveTo(tailHead.rCtrlX, tailHead.rCtrlY, tailHead.rx, tailHead.ry);
    }
    return;
  }

  if (shape.type === 'curve') {
    const pts = shape.points;
    if (pts.length < 2) return;
    const sx = (p: Pt2D) => p.x * tf.scaleX + tf.offsetX;
    const sy = (p: Pt2D) => p.y * tf.scaleY + tf.offsetY;
    ctx.moveTo(sx(pts[0]), sy(pts[0]));
    if (pts.length === 2) {
      ctx.lineTo(sx(pts[1]), sy(pts[1]));
      return;
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (sx(pts[i]) + sx(pts[i + 1])) * 0.5;
      const midY = (sy(pts[i]) + sy(pts[i + 1])) * 0.5;
      ctx.quadraticCurveTo(sx(pts[i]), sy(pts[i]), midX, midY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(sx(last), sy(last));
  }
}

/**
 * Samples any snapped AnnotationShape into dense screen-space polyline(s).
 * Enables authentic angled chisel-tip highlighter sweeps and exact hit-testing on EVERY shape.
 */
export function sampleShapeToPolylines(
  shape: AnnotationShape,
  tf: RenderTransform,
  stepPx = 2.6
): ScreenPoint[][] {
  const mkPt = (x: number, y: number, idx = 0): ScreenPoint => ({
    x,
    y,
    pressure: 0.5,
    t: idx,
  });

  if (shape.type === 'line') {
    const x1 = shape.x1 * tf.scaleX + tf.offsetX;
    const y1 = shape.y1 * tf.scaleY + tf.offsetY;
    const x2 = shape.x2 * tf.scaleX + tf.offsetX;
    const y2 = shape.y2 * tf.scaleY + tf.offsetY;
    return [[mkPt(x1, y1, 0), mkPt(x2, y2, 1)]];
  }

  if (shape.type === 'arc') {
    const x1 = shape.x1 * tf.scaleX + tf.offsetX;
    const y1 = shape.y1 * tf.scaleY + tf.offsetY;
    const cx = shape.cx * tf.scaleX + tf.offsetX;
    const cy = shape.cy * tf.scaleY + tf.offsetY;
    const x2 = shape.x2 * tf.scaleX + tf.offsetX;
    const y2 = shape.y2 * tf.scaleY + tf.offsetY;
    const approxLen = Math.hypot(cx - x1, cy - y1) + Math.hypot(x2 - cx, y2 - cy);
    const steps = Math.max(12, Math.min(120, Math.ceil(approxLen / stepPx)));
    const out: ScreenPoint[] = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const inv = 1 - u;
      out.push(
        mkPt(
          inv * inv * x1 + 2 * inv * u * cx + u * u * x2,
          inv * inv * y1 + 2 * inv * u * cy + u * u * y2,
          i
        )
      );
    }
    return [out];
  }

  if (shape.type === 'brace') {
    const x1 = shape.x1 * tf.scaleX + tf.offsetX;
    const y1 = shape.y1 * tf.scaleY + tf.offsetY;
    const x2 = shape.x2 * tf.scaleX + tf.offsetX;
    const y2 = shape.y2 * tf.scaleY + tf.offsetY;
    const chord = Math.hypot(x2 - x1, y2 - y1);
    const stepsPerHalf = Math.max(10, Math.min(36, Math.ceil((chord * 0.7) / stepPx)));
    return [sampleBracePointsPx(x1, y1, x2, y2, shape.depth * tf.unitScale, stepsPerHalf).map((p, idx) => mkPt(p.x, p.y, idx))];
  }

  if (shape.type === 'ellipse') {
    const cx = shape.cx * tf.scaleX + tf.offsetX;
    const cy = shape.cy * tf.scaleY + tf.offsetY;
    const { rxPx, ryPx } = resolveEllipseScreenRadii(
      shape.rx,
      shape.ry,
      shape.rotation,
      tf,
      shape.isCircle
    );
    const rot = shape.rotation ?? 0;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const perim = Math.PI * (3 * (rxPx + ryPx) - Math.sqrt((3 * rxPx + ryPx) * (rxPx + 3 * ryPx)));
    const steps = Math.max(24, Math.min(140, Math.ceil(perim / stepPx)));
    const out: ScreenPoint[] = [];
    for (let i = 0; i <= steps; i++) {
      const ang = (i / steps) * Math.PI * 2;
      const lx = Math.cos(ang) * rxPx;
      const ly = Math.sin(ang) * ryPx;
      out.push(mkPt(cx + lx * cosR - ly * sinR, cy + lx * sinR + ly * cosR, i));
    }
    return [out];
  }

  if (shape.type === 'polygon') {
    const pts = shape.points.map((p, idx) =>
      mkPt(p.x * tf.scaleX + tf.offsetX, p.y * tf.scaleY + tf.offsetY, idx)
    );
    if (pts.length < 2) return [pts];
    if (shape.closed) {
      pts.push(mkPt(pts[0].x, pts[0].y, pts.length));
    }
    return [pts];
  }

  if (shape.type === 'arrow') {
    const x1 = shape.x1 * tf.scaleX + tf.offsetX;
    const y1 = shape.y1 * tf.scaleY + tf.offsetY;
    const x2 = shape.x2 * tf.scaleX + tf.offsetX;
    const y2 = shape.y2 * tf.scaleY + tf.offsetY;
    let shaft: ScreenPoint[];
    if (shape.cx !== undefined && shape.cy !== undefined) {
      const cx = shape.cx * tf.scaleX + tf.offsetX;
      const cy = shape.cy * tf.scaleY + tf.offsetY;
      const approxLen = Math.hypot(cx - x1, cy - y1) + Math.hypot(x2 - cx, y2 - cy);
      const steps = Math.max(10, Math.min(96, Math.ceil(approxLen / stepPx)));
      shaft = [];
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const inv = 1 - u;
        shaft.push(
          mkPt(
            inv * inv * x1 + 2 * inv * u * cx + u * u * x2,
            inv * inv * y1 + 2 * inv * u * cy + u * u * y2,
            i
          )
        );
      }
    } else {
      shaft = [mkPt(x1, y1, 0), mkPt(x2, y2, 1)];
    }

    const buildHeadPolyline = (
      tx: number,
      ty: number,
      hlx: number,
      hly: number,
      hrx: number,
      hry: number
    ): ScreenPoint[] => {
      const g = computeAppleArrowGeometry(tx, ty, hlx, hly, hrx, hry, 0);
      const wingSteps = Math.max(5, Math.min(18, Math.ceil(g.axisLen / stepPx)));
      const head: ScreenPoint[] = [];
      for (let i = 0; i <= wingSteps; i++) {
        const u = i / wingSteps;
        const inv = 1 - u;
        head.push(
          mkPt(
            inv * inv * g.lx + 2 * inv * u * g.lCtrlX + u * u * tx,
            inv * inv * g.ly + 2 * inv * u * g.lCtrlY + u * u * ty,
            i
          )
        );
      }
      for (let i = 1; i <= wingSteps; i++) {
        const u = i / wingSteps;
        const inv = 1 - u;
        head.push(
          mkPt(
            inv * inv * tx + 2 * inv * u * g.rCtrlX + u * u * g.rx,
            inv * inv * ty + 2 * inv * u * g.rCtrlY + u * u * g.ry,
            wingSteps + i
          )
        );
      }
      return head;
    };

    const result: ScreenPoint[][] = [
      shaft,
      buildHeadPolyline(
        x2,
        y2,
        shape.leftX * tf.scaleX + tf.offsetX,
        shape.leftY * tf.scaleY + tf.offsetY,
        shape.rightX * tf.scaleX + tf.offsetX,
        shape.rightY * tf.scaleY + tf.offsetY
      ),
    ];

    if (
      shape.bidirectional &&
      shape.tailLeftX !== undefined &&
      shape.tailLeftY !== undefined &&
      shape.tailRightX !== undefined &&
      shape.tailRightY !== undefined
    ) {
      result.push(
        buildHeadPolyline(
          x1,
          y1,
          shape.tailLeftX * tf.scaleX + tf.offsetX,
          shape.tailLeftY * tf.scaleY + tf.offsetY,
          shape.tailRightX * tf.scaleX + tf.offsetX,
          shape.tailRightY * tf.scaleY + tf.offsetY
        )
      );
    }

    return result;
  }

  if (shape.type === 'curve') {
    const screenKnots = shape.points.map((p, idx) =>
      mkPt(p.x * tf.scaleX + tf.offsetX, p.y * tf.scaleY + tf.offsetY, idx)
    );
    return [subdivideSpline(screenKnots, stepPx)];
  }

  return [];
}

export function computeShapeCssBounds(
  shape: AnnotationShape,
  tf: RenderTransform,
  pad: number
): CssBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  const sx = tf.scaleX;
  const sy = tf.scaleY;
  const ox = tf.offsetX;
  const oy = tf.offsetY;

  if (shape.type === 'line') {
    include(shape.x1 * sx + ox, shape.y1 * sy + oy);
    include(shape.x2 * sx + ox, shape.y2 * sy + oy);
  } else if (shape.type === 'arc') {
    include(shape.x1 * sx + ox, shape.y1 * sy + oy);
    include(shape.cx * sx + ox, shape.cy * sy + oy);
    include(shape.x2 * sx + ox, shape.y2 * sy + oy);
  } else if (shape.type === 'ellipse') {
    const cx = shape.cx * sx + ox;
    const cy = shape.cy * sy + oy;
    const { rxPx, ryPx } = resolveEllipseScreenRadii(
      shape.rx,
      shape.ry,
      shape.rotation,
      tf,
      shape.isCircle
    );
    const rot = shape.rotation ?? 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const ex = Math.sqrt(rxPx * rxPx * cos * cos + ryPx * ryPx * sin * sin);
    const ey = Math.sqrt(rxPx * rxPx * sin * sin + ryPx * ryPx * cos * cos);
    minX = cx - ex;
    maxX = cx + ex;
    minY = cy - ey;
    maxY = cy + ey;
  } else if (shape.type === 'brace') {
    const pts = sampleBracePointsPx(
      shape.x1 * sx + ox,
      shape.y1 * sy + oy,
      shape.x2 * sx + ox,
      shape.y2 * sy + oy,
      shape.depth * tf.unitScale,
      10
    );
    for (let i = 0; i < pts.length; i++) include(pts[i].x, pts[i].y);
  } else if (shape.type === 'polygon' || shape.type === 'curve') {
    const pts = shape.points;
    for (let i = 0; i < pts.length; i++) {
      include(pts[i].x * sx + ox, pts[i].y * sy + oy);
    }
  } else if (shape.type === 'arrow') {
    include(shape.x1 * sx + ox, shape.y1 * sy + oy);
    include(shape.x2 * sx + ox, shape.y2 * sy + oy);
    include(shape.leftX * sx + ox, shape.leftY * sy + oy);
    include(shape.rightX * sx + ox, shape.rightY * sy + oy);
    if (shape.cx !== undefined && shape.cy !== undefined) {
      include(shape.cx * sx + ox, shape.cy * sy + oy);
    }
    if (
      shape.bidirectional &&
      shape.tailLeftX !== undefined &&
      shape.tailLeftY !== undefined &&
      shape.tailRightX !== undefined &&
      shape.tailRightY !== undefined
    ) {
      include(shape.tailLeftX * sx + ox, shape.tailLeftY * sy + oy);
      include(shape.tailRightX * sx + ox, shape.tailRightY * sy + oy);
    }
  }

  if (!Number.isFinite(minX)) return null;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/**
 * Apple PencilKit-inspired variable-width calligraphic ink pen renderer.
 *
 * Ultra-low-latency hot-path design:
 * - Zero JS object or TypedArray allocations per frame (reusable flat Float32Array scratch buffers).
 * - Single Skia hardware-antialiased `ctx.fill()` pass (zero expensive multi-thousand-vertex round-join `ctx.stroke()`).
 * - Returns the tight CSS-space bounding box so live draft canvases clear ONLY the dirty region.
 */
function applyPenLineDash(
  ctx: CanvasRenderingContext2D,
  lineStyle: AnnotationStroke['lineStyle'],
  baseWidth: number
): void {
  if (lineStyle === 'dashed') {
    ctx.setLineDash([Math.max(4, baseWidth * 2.5), Math.max(4, baseWidth * 2.0)]);
  } else if (lineStyle === 'dotted') {
    ctx.setLineDash([0.01, Math.max(3.5, baseWidth * 2.05)]);
  } else {
    ctx.setLineDash([]);
  }
}

const tapePatternTileCache = new Map<string, HTMLCanvasElement>();

function getTapeStrokeStyle(
  ctx: CanvasRenderingContext2D,
  color: string,
  pattern: TapePattern | undefined
): string | CanvasPattern {
  if (!pattern || pattern === 'solid') return color;
  const key = `${pattern}|${color}`;
  let tile = tapePatternTileCache.get(key);
  if (!tile) {
    if (tapePatternTileCache.size > 48) {
      tapePatternTileCache.clear();
    }
    tile = document.createElement('canvas');
    const size = pattern === 'striped' ? 14 : 12;
    tile.width = size;
    tile.height = size;
    const tCtx = tile.getContext('2d');
    if (tCtx) {
      tCtx.fillStyle = color;
      tCtx.fillRect(0, 0, size, size);
      if (pattern === 'striped') {
        tCtx.strokeStyle = 'rgba(15, 23, 42, 0.11)';
        tCtx.lineWidth = 2.2;
        tCtx.beginPath();
        // Exact multiples of tile size (14px) guarantee seamless diagonal tiling
        tCtx.moveTo(-7, 7);
        tCtx.lineTo(7, -7);
        tCtx.moveTo(0, 14);
        tCtx.lineTo(14, 0);
        tCtx.moveTo(7, 21);
        tCtx.lineTo(21, 7);
        tCtx.stroke();

        tCtx.strokeStyle = 'rgba(255, 255, 255, 0.36)';
        tCtx.lineWidth = 1.4;
        tCtx.beginPath();
        tCtx.moveTo(-7, 9);
        tCtx.lineTo(9, -7);
        tCtx.moveTo(0, 16);
        tCtx.lineTo(16, 0);
        tCtx.moveTo(7, 23);
        tCtx.lineTo(23, 7);
        tCtx.stroke();
      } else {
        tCtx.fillStyle = 'rgba(15, 23, 42, 0.13)';
        tCtx.beginPath();
        tCtx.arc(3, 3, 1.35, 0, Math.PI * 2);
        tCtx.arc(9, 9, 1.35, 0, Math.PI * 2);
        tCtx.fill();
      }
    }
    tapePatternTileCache.set(key, tile);
  }
  return ctx.createPattern(tile, 'repeat') ?? color;
}

let revealedTapeScratchCanvas: HTMLCanvasElement | null = null;
let revealedTapeScratchCtx: CanvasRenderingContext2D | null = null;

function drawRevealedTapeOuterOutline(
  ctx: CanvasRenderingContext2D,
  bounds: CssBounds,
  tapeW: number,
  tracePath: (targetCtx: CanvasRenderingContext2D) => void
): void {
  const boxW = Math.max(1, bounds.maxX - bounds.minX);
  const boxH = Math.max(1, bounds.maxY - bounds.minY);
  const mat = ctx.getTransform();
  const sx = Math.max(1, Math.hypot(mat.a, mat.b));
  const sy = Math.max(1, Math.hypot(mat.c, mat.d));
  const pxW = Math.max(2, Math.min(4096, Math.ceil(boxW * sx)));
  const pxH = Math.max(2, Math.min(4096, Math.ceil(boxH * sy)));

  if (!revealedTapeScratchCanvas) {
    revealedTapeScratchCanvas = document.createElement('canvas');
    revealedTapeScratchCtx = revealedTapeScratchCanvas.getContext('2d');
  }
  const scratch = revealedTapeScratchCanvas;
  const sCtx = revealedTapeScratchCtx;
  if (!sCtx) return;

  if (scratch.width < pxW || scratch.height < pxH) {
    scratch.width = Math.max(scratch.width, pxW);
    scratch.height = Math.max(scratch.height, pxH);
  }

  sCtx.save();
  sCtx.setTransform(1, 0, 0, 1, 0, 0);
  sCtx.clearRect(0, 0, pxW, pxH);

  sCtx.setTransform(pxW / boxW, 0, 0, pxH / boxH, 0, 0);
  sCtx.translate(-bounds.minX, -bounds.minY);
  sCtx.lineCap = 'round';
  sCtx.lineJoin = 'round';
  sCtx.setLineDash([]);

  // Outer perimeter shell of the tape capsule
  sCtx.globalCompositeOperation = 'source-over';
  sCtx.globalAlpha = 1;
  sCtx.lineWidth = tapeW;
  sCtx.strokeStyle = '#64748B';
  tracePath(sCtx);
  sCtx.stroke();

  // Hollow out the entire interior so ZERO line ever crosses over the revealed letters
  const borderThickness = 1.3;
  const innerCutW = Math.max(1, tapeW - borderThickness * 2);
  sCtx.globalCompositeOperation = 'destination-out';
  sCtx.lineWidth = innerCutW;
  sCtx.strokeStyle = '#000000';
  tracePath(sCtx);
  sCtx.stroke();
  sCtx.restore();

  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.drawImage(scratch, 0, 0, pxW, pxH, bounds.minX, bounds.minY, boxW, boxH);
  ctx.restore();
}

const graphitePatternTileCache = new Map<string, HTMLCanvasElement>();

function getGraphiteStrokeStyle(
  ctx: CanvasRenderingContext2D,
  color: string
): string | CanvasPattern {
  const key = color.toLowerCase();
  let tile = graphitePatternTileCache.get(key);
  if (!tile) {
    if (graphitePatternTileCache.size > 48) {
      graphitePatternTileCache.clear();
    }
    const size = 128;
    tile = document.createElement('canvas');
    tile.width = size;
    tile.height = size;
    const tCtx = tile.getContext('2d');
    if (tCtx) {
      tCtx.fillStyle = color;
      tCtx.fillRect(0, 0, size, size);
      try {
        const img = tCtx.getImageData(0, 0, size, size);
        const data = img.data;
        const twoPiOverSize = (Math.PI * 2) / size;
        for (let y = 0; y < size; y++) {
          const v = y * twoPiOverSize;
          const vWaveA = Math.cos(v * 5);
          const vWaveB = Math.cos(v * 7);
          const vWaveC = v * 11;
          const vWaveD = v * 19;
          for (let x = 0; x < size; x++) {
            const u = x * twoPiOverSize;
            const macro =
              0.5 +
              0.25 * Math.sin(u * 6 + vWaveA) +
              0.25 * (vWaveB * Math.cos(u * 4) + Math.sin(v * 7) * Math.sin(u * 4));
            const med =
              0.5 +
              0.28 * Math.sin(u * 17 + vWaveC) +
              0.22 * Math.cos(u * 13 - vWaveD);
            // Fast integer hash micro-grain (period = 128 -> seamless tiling)
            let h = ((x * 374761393) ^ (y * 668265263)) >>> 0;
            h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
            const micro = ((h ^ (h >>> 16)) & 0xff) / 255;

            const grain = micro * 0.52 + med * 0.28 + macro * 0.2;
            const tooth = Math.max(0.24, Math.min(1.0, (grain - 0.16) * 1.36));
            const idx = (y * size + x) * 4 + 3;
            data[idx] = Math.round(data[idx] * tooth);
          }
        }
        tCtx.putImageData(img, 0, 0);
      } catch {
        // Fallback if canvas pixel readback is restricted
      }
    }
    graphitePatternTileCache.set(key, tile);
  }
  return ctx.createPattern(tile, 'repeat') ?? color;
}

function drawPencilDot(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  baseWidth: number,
  color: string,
  baseAlpha: number
): CssBounds {
  const r = Math.max(1.15, baseWidth * 0.56);
  ctx.save();
  ctx.globalAlpha = baseAlpha * 0.3;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py, Math.max(0.7, r * 0.58), 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = baseAlpha * 0.92;
  ctx.fillStyle = getGraphiteStrokeStyle(ctx, color);
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const pad = r + 3;
  return { minX: px - pad, minY: py - pad, maxX: px + pad, maxY: py + pad };
}

function drawFountainDot(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  baseWidth: number,
  nibAngleDeg?: number
): CssBounds {
  const nibRad = ((nibAngleDeg ?? -38) * Math.PI) / 180;
  const halfA = Math.max(1.4, baseWidth * 0.56);
  const halfB = Math.max(0.85, Math.min(3.2, halfA * 0.36));
  const cornerR = Math.min(halfB * 0.48, 1.35);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(nibRad);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(-halfA, -halfB, halfA * 2, halfB * 2, cornerR);
  } else {
    ctx.rect(-halfA, -halfB, halfA * 2, halfB * 2);
  }
  ctx.fill();
  ctx.restore();
  const pad = halfA + 3;
  return { minX: px - pad, minY: py - pad, maxX: px + pad, maxY: py + pad };
}

/**
 * Renders a genuine angled Qalam / Fountain Calligraphy nib sweep along dense points `[startIdx..endIdx]`
 * in ONE single non-zero winding `ctx.fill()` call (strictly positive winding everywhere so overlapping
 * joints and translucent ink opacities never darken or form cutout seams).
 */
function emitFountainQalamSweep(
  ctx: CanvasRenderingContext2D,
  xs: Float32Array | ArrayLike<number>,
  ys: Float32Array | ArrayLike<number>,
  halfMajors: Float32Array | ArrayLike<number>,
  startIdx: number,
  endIdx: number,
  nibRad: number,
  minorRatio: number,
  includeStartCap: boolean,
  includeEndCap: boolean
): CssBounds | null {
  if (endIdx <= startIdx) return null;

  const nibUx = Math.cos(nibRad);
  const nibUy = Math.sin(nibRad);
  const nibVx = -nibUy;
  const nibVy = nibUx;

  const getMinor = (a: number) => Math.max(0.62, Math.min(2.6, a * minorRatio));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxR = 0;

  ctx.beginPath();

  const stampNib = (cx: number, cy: number, a: number) => {
    const b = getMinor(a);
    ctx.moveTo(cx + a * nibUx, cy + a * nibUy);
    ctx.ellipse(cx, cy, a, b, nibRad, 0, Math.PI * 2, false);
    ctx.closePath();
  };

  if (includeStartCap) {
    stampNib(xs[startIdx], ys[startIdx], halfMajors[startIdx]);
  }

  let prevTx = 0;
  let prevTy = 0;
  let hasPrevDir = false;

  for (let i = startIdx; i < endIdx; i++) {
    const x0 = xs[i];
    const y0 = ys[i];
    const x1 = xs[i + 1];
    const y1 = ys[i + 1];
    const a0 = halfMajors[i];
    const a1 = halfMajors[i + 1];

    if (a0 > maxR) maxR = a0;
    if (a1 > maxR) maxR = a1;
    if (x0 < minX) minX = x0;
    if (x0 > maxX) maxX = x0;
    if (y0 < minY) minY = y0;
    if (y0 > maxY) maxY = y0;
    if (x1 < minX) minX = x1;
    if (x1 > maxX) maxX = x1;
    if (y1 < minY) minY = y1;
    if (y1 > maxY) maxY = y1;

    const dx = x1 - x0;
    const dy = y1 - y0;
    const segLenSq = dx * dx + dy * dy;
    if (segLenSq < 0.00001) {
      if (i > startIdx) {
        stampNib(x0, y0, a0);
      }
      continue;
    }

    const invLen = 1 / Math.sqrt(segLenSq);
    const tx = dx * invLen;
    const ty = dy * invLen;

    if (i > startIdx) {
      if (!hasPrevDir || prevTx * tx + prevTy * ty < 0.9985) {
        stampNib(x0, y0, a0);
      }
    } else if (!includeStartCap) {
      stampNib(x0, y0, a0);
    }

    prevTx = tx;
    prevTy = ty;
    hasPrevDir = true;

    const nx = -ty;
    const ny = tx;
    const nu = nx * nibUx + ny * nibUy;
    const nv = nx * nibVx + ny * nibVy;

    const b0 = getMinor(a0);
    const denom0 = Math.hypot(a0 * nu, b0 * nv) || 1;
    const e0x = ((a0 * a0 * nu) * nibUx + (b0 * b0 * nv) * nibVx) / denom0;
    const e0y = ((a0 * a0 * nu) * nibUy + (b0 * b0 * nv) * nibVy) / denom0;

    const b1 = getMinor(a1);
    const denom1 = Math.hypot(a1 * nu, b1 * nv) || 1;
    const e1x = ((a1 * a1 * nu) * nibUx + (b1 * b1 * nv) * nibVx) / denom1;
    const e1y = ((a1 * a1 * nu) * nibUy + (b1 * b1 * nv) * nibVy) / denom1;

    // Strictly positive winding in Canvas Y-down coords: Right0 -> Right1 -> Left1 -> Left0
    ctx.moveTo(x0 - e0x, y0 - e0y);
    ctx.lineTo(x1 - e1x, y1 - e1y);
    ctx.lineTo(x1 + e1x, y1 + e1y);
    ctx.lineTo(x0 + e0x, y0 + e0y);
    ctx.closePath();
  }

  if (includeEndCap || endIdx > startIdx) {
    stampNib(xs[endIdx], ys[endIdx], halfMajors[endIdx]);
  }

  ctx.fill();
  if (!Number.isFinite(minX)) return null;
  const pad = maxR + 3;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function drawFountainPolylineSweep(
  ctx: CanvasRenderingContext2D,
  pts: ReadonlyArray<{ x: number; y: number }>,
  halfWidth: number,
  nibRad: number,
  minorRatio = 0.27
): void {
  const count = pts.length;
  if (count < 2) return;
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  const majors = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    xs[i] = pts[i].x;
    ys[i] = pts[i].y;
    majors[i] = halfWidth;
  }
  emitFountainQalamSweep(ctx, xs, ys, majors, 0, count - 1, nibRad, minorRatio, true, true);
}

export function drawApplePenStroke(
  ctx: CanvasRenderingContext2D,
  stroke: AnnotationStroke,
  tf: RenderTransform,
  isLiveDraft = false,
  overrideOpacity?: number
): CssBounds | null {
  const baseWidth = Math.max(1.2, stroke.size * tf.unitScale);
  ctx.save();
  ctx.globalAlpha = overrideOpacity ?? stroke.opacity;
  ctx.fillStyle = stroke.color;
  ctx.strokeStyle = stroke.color;

  // Study Tape (100% opaque memorization cover / tap-to-reveal band)
  if (stroke.kind === 'tape') {
    const tapeW = Math.max(8, stroke.size * tf.unitScale);
    const pts = stroke.points;
    if (pts.length === 0 && !stroke.shape) {
      ctx.restore();
      return null;
    }

    let denseTape: ScreenPoint[] | null = null;
    if (!stroke.shape) {
      const rawScreen = toScreenPoints(pts, tf);
      if (rawScreen.length <= 1) {
        denseTape = rawScreen;
      } else {
        const smoothLevel = stroke.smoothing ?? 0.66;
        const filtered = filterMicroJitterKnots(
          rawScreen,
          smoothLevel > 0.05 ? 0.85 + smoothLevel * 1.15 : 0
        );
        const smoothed = smoothControlPolygon(filtered, smoothLevel, 4);
        denseTape = subdivideSpline(smoothed, isLiveDraft ? 2.4 : 2.0);
      }
    }

    const traceTapePathOn = (targetCtx: CanvasRenderingContext2D) => {
      if (stroke.shape) {
        traceShapePath(targetCtx, stroke.shape, tf);
        return;
      }
      if (!denseTape || denseTape.length === 0) return;
      targetCtx.beginPath();
      targetCtx.moveTo(denseTape[0].x, denseTape[0].y);
      if (denseTape.length === 1) {
        targetCtx.lineTo(denseTape[0].x + 0.5, denseTape[0].y);
        return;
      }
      for (let i = 1; i < denseTape.length; i++) {
        targetCtx.lineTo(denseTape[i].x, denseTape[i].y);
      }
    };

    let tapeBounds: CssBounds | null = null;
    if (stroke.shape) {
      tapeBounds = computeShapeCssBounds(stroke.shape, tf, tapeW * 0.65 + 4);
    } else {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const boundPts = denseTape ?? [];
      for (let i = 0; i < boundPts.length; i++) {
        const px = boundPts[i].x;
        const py = boundPts[i].y;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
      const pad = tapeW * 0.55 + 4;
      tapeBounds = Number.isFinite(minX)
        ? { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
        : null;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);

    if (stroke.revealed) {
      // Soft translucent pastel wash + hollow outer capsule frame (zero center line over letters)
      traceTapePathOn(ctx);
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = tapeW;
      ctx.strokeStyle = stroke.color;
      ctx.stroke();

      if (tapeBounds) {
        drawRevealedTapeOuterOutline(ctx, tapeBounds, tapeW, traceTapePathOn);
      }
    } else {
      // Completely opaque cover so hidden text never bleeds through
      ctx.globalAlpha = 1;
      traceTapePathOn(ctx);
      ctx.lineWidth = tapeW;
      ctx.strokeStyle = getTapeStrokeStyle(ctx, stroke.color, stroke.tapePattern ?? 'striped');
      ctx.stroke();
    }

    ctx.restore();
    return tapeBounds;
  }

  // Snapped crisp Universal Apple Smart Shape (line, curved arc, ellipse, triangle/rect/polygon, arrow, smooth curve)
  if (stroke.shape) {
    if (stroke.shape.type === 'arrow') {
      const shape = stroke.shape;
      const x1 = shape.x1 * tf.scaleX + tf.offsetX;
      const y1 = shape.y1 * tf.scaleY + tf.offsetY;
      const x2 = shape.x2 * tf.scaleX + tf.offsetX;
      const y2 = shape.y2 * tf.scaleY + tf.offsetY;
      const lx = shape.leftX * tf.scaleX + tf.offsetX;
      const ly = shape.leftY * tf.scaleY + tf.offsetY;
      const rx = shape.rightX * tf.scaleX + tf.offsetX;
      const ry = shape.rightY * tf.scaleY + tf.offsetY;

      const head = computeAppleArrowGeometry(x2, y2, lx, ly, rx, ry, baseWidth);
      const tuck = Math.min(head.axisLen * 0.34, Math.max(1.2, baseWidth * 0.78));

      const hasTailHead =
        shape.bidirectional &&
        shape.tailLeftX !== undefined &&
        shape.tailLeftY !== undefined &&
        shape.tailRightX !== undefined &&
        shape.tailRightY !== undefined;

      let tailHead: ReturnType<typeof computeAppleArrowGeometry> | null = null;
      let startX = x1;
      let startY = y1;
      if (hasTailHead) {
        tailHead = computeAppleArrowGeometry(
          x1,
          y1,
          shape.tailLeftX! * tf.scaleX + tf.offsetX,
          shape.tailLeftY! * tf.scaleY + tf.offsetY,
          shape.tailRightX! * tf.scaleX + tf.offsetX,
          shape.tailRightY! * tf.scaleY + tf.offsetY,
          baseWidth
        );
        const tuckTail = Math.min(tailHead.axisLen * 0.34, Math.max(1.2, baseWidth * 0.78));
        startX = x1 - tailHead.ux * tuckTail;
        startY = y1 - tailHead.uy * tuckTail;
      }

      const shaftEndX = x2 - head.ux * tuck;
      const shaftEndY = y2 - head.uy * tuck;

      ctx.lineWidth = baseWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 1. Sleek shaft tucked cleanly inside arrowhead apexes
      if (stroke.kind === 'fountain') {
        const nibRad = ((stroke.nibAngleDeg ?? -38) * Math.PI) / 180;
        const shaftHalfW = Math.max(0.95, baseWidth * 0.5 + 0.18);
        const wingHalfW = Math.max(0.85, baseWidth * 0.43);
        const shaftPts: Pt2D[] = [];
        if (shape.cx !== undefined && shape.cy !== undefined) {
          const cx = shape.cx * tf.scaleX + tf.offsetX;
          const cy = shape.cy * tf.scaleY + tf.offsetY;
          const split = splitQuadraticShaftAtTuck(startX, startY, cx, cy, x2, y2, tuck);
          const approxLen =
            Math.hypot(split.cx - startX, split.cy - startY) +
            Math.hypot(split.ex - split.cx, split.ey - split.cy);
          const steps = Math.max(8, Math.min(72, Math.ceil(approxLen / 2.4)));
          for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            const inv = 1 - u;
            shaftPts.push({
              x: inv * inv * startX + 2 * inv * u * split.cx + u * u * split.ex,
              y: inv * inv * startY + 2 * inv * u * split.cy + u * u * split.ey,
            });
          }
        } else {
          shaftPts.push({ x: startX, y: startY }, { x: shaftEndX, y: shaftEndY });
        }
        drawFountainPolylineSweep(ctx, shaftPts, shaftHalfW, nibRad, 0.27);

        const buildFountainWingPts = (
          tx: number,
          ty: number,
          g: ReturnType<typeof computeAppleArrowGeometry>
        ): Pt2D[] => {
          const steps = Math.max(5, Math.min(18, Math.ceil(g.axisLen / 2.2)));
          const out: Pt2D[] = [];
          for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            const inv = 1 - u;
            out.push({
              x: inv * inv * g.lx + 2 * inv * u * g.lCtrlX + u * u * tx,
              y: inv * inv * g.ly + 2 * inv * u * g.lCtrlY + u * u * ty,
            });
          }
          for (let i = 1; i <= steps; i++) {
            const u = i / steps;
            const inv = 1 - u;
            out.push({
              x: inv * inv * tx + 2 * inv * u * g.rCtrlX + u * u * g.rx,
              y: inv * inv * ty + 2 * inv * u * g.rCtrlY + u * u * g.ry,
            });
          }
          return out;
        };

        drawFountainPolylineSweep(ctx, buildFountainWingPts(x2, y2, head), wingHalfW, nibRad, 0.34);
        if (tailHead) {
          drawFountainPolylineSweep(ctx, buildFountainWingPts(x1, y1, tailHead), wingHalfW, nibRad, 0.34);
        }
        ctx.restore();
        return computeShapeCssBounds(stroke.shape, tf, Math.max(baseWidth * 0.75 + 4, baseWidth * 2.5 + 8));
      }

      const strokeCurrentArrow = () => {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        if (shape.cx !== undefined && shape.cy !== undefined) {
          const cx = shape.cx * tf.scaleX + tf.offsetX;
          const cy = shape.cy * tf.scaleY + tf.offsetY;
          const split = splitQuadraticShaftAtTuck(startX, startY, cx, cy, x2, y2, tuck);
          ctx.quadraticCurveTo(split.cx, split.cy, split.ex, split.ey);
        } else {
          ctx.lineTo(shaftEndX, shaftEndY);
        }
        ctx.stroke();

        // 2. Gracefully swept Apple curved-chevron wings (always crisp solid)
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(head.lx, head.ly);
        ctx.quadraticCurveTo(head.lCtrlX, head.lCtrlY, x2, y2);
        ctx.quadraticCurveTo(head.rCtrlX, head.rCtrlY, head.rx, head.ry);
        if (tailHead) {
          ctx.moveTo(tailHead.lx, tailHead.ly);
          ctx.quadraticCurveTo(tailHead.lCtrlX, tailHead.lCtrlY, x1, y1);
          ctx.quadraticCurveTo(tailHead.rCtrlX, tailHead.rCtrlY, tailHead.rx, tailHead.ry);
        }
        ctx.stroke();
      };

      if (stroke.kind === 'pencil') {
        const baseAlpha = overrideOpacity ?? stroke.opacity;
        ctx.setLineDash([]);
        ctx.globalAlpha = baseAlpha * 0.28;
        ctx.lineWidth = Math.max(0.75, baseWidth * 0.46);
        ctx.strokeStyle = stroke.color;
        strokeCurrentArrow();

        ctx.globalAlpha = baseAlpha * 0.94;
        ctx.lineWidth = baseWidth;
        ctx.strokeStyle = getGraphiteStrokeStyle(ctx, stroke.color);
        strokeCurrentArrow();
      } else {
        applyPenLineDash(ctx, stroke.lineStyle, baseWidth);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        if (shape.cx !== undefined && shape.cy !== undefined) {
          const cx = shape.cx * tf.scaleX + tf.offsetX;
          const cy = shape.cy * tf.scaleY + tf.offsetY;
          const split = splitQuadraticShaftAtTuck(startX, startY, cx, cy, x2, y2, tuck);
          ctx.quadraticCurveTo(split.cx, split.cy, split.ex, split.ey);
        } else {
          ctx.lineTo(shaftEndX, shaftEndY);
        }
        ctx.stroke();

        // 2. Gracefully swept Apple curved-chevron wings (always crisp solid)
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(head.lx, head.ly);
        ctx.quadraticCurveTo(head.lCtrlX, head.lCtrlY, x2, y2);
        ctx.quadraticCurveTo(head.rCtrlX, head.rCtrlY, head.rx, head.ry);
        if (tailHead) {
          ctx.moveTo(tailHead.lx, tailHead.ly);
          ctx.quadraticCurveTo(tailHead.lCtrlX, tailHead.lCtrlY, x1, y1);
          ctx.quadraticCurveTo(tailHead.rCtrlX, tailHead.rCtrlY, tailHead.rx, tailHead.ry);
        }
        ctx.stroke();
      }

      ctx.restore();
      return computeShapeCssBounds(stroke.shape, tf, Math.max(baseWidth * 0.75 + 4, baseWidth * 2.5 + 8));
    }

    if (stroke.kind === 'fountain') {
      const nibRad = ((stroke.nibAngleDeg ?? -38) * Math.PI) / 180;
      const halfW = Math.max(0.95, baseWidth * 0.5 + 0.18);
      const polylines = sampleShapeToPolylines(stroke.shape, tf, 2.0);
      for (const poly of polylines) {
        drawFountainPolylineSweep(ctx, poly, halfW, nibRad, 0.27);
      }
      ctx.restore();
      return computeShapeCssBounds(stroke.shape, tf, halfW + 4);
    }

    if (stroke.kind === 'pencil') {
      const baseAlpha = overrideOpacity ?? stroke.opacity;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);

      traceShapePath(ctx, stroke.shape, tf);
      ctx.globalAlpha = baseAlpha * 0.28;
      ctx.lineWidth = Math.max(0.75, baseWidth * 0.46);
      ctx.strokeStyle = stroke.color;
      ctx.stroke();

      traceShapePath(ctx, stroke.shape, tf);
      ctx.globalAlpha = baseAlpha * 0.94;
      ctx.lineWidth = baseWidth;
      ctx.strokeStyle = getGraphiteStrokeStyle(ctx, stroke.color);
      ctx.stroke();

      ctx.restore();
      return computeShapeCssBounds(stroke.shape, tf, baseWidth * 0.75 + 4);
    }

    traceShapePath(ctx, stroke.shape, tf);
    ctx.lineWidth = baseWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    applyPenLineDash(ctx, stroke.lineStyle, baseWidth);
    ctx.stroke();
    ctx.restore();
    return computeShapeCssBounds(stroke.shape, tf, baseWidth * 0.75 + 4);
  }

  const pts = stroke.points;
  const rawLen = pts.length;
  if (rawLen === 0) {
    ctx.restore();
    return null;
  }

  const sx = tf.scaleX;
  const sy = tf.scaleY;
  const ox = tf.offsetX;
  const oy = tf.offsetY;

  // Single tap / dot -> clean ink dot (or angled Qalam Nuqta / matte graphite dot)
  if (rawLen === 1) {
    const px = pts[0].x * sx + ox;
    const py = pts[0].y * sy + oy;
    if (stroke.kind === 'fountain') {
      const dotBounds = drawFountainDot(ctx, px, py, baseWidth, stroke.nibAngleDeg);
      ctx.restore();
      return dotBounds;
    }
    if (stroke.kind === 'pencil') {
      const dotBounds = drawPencilDot(
        ctx,
        px,
        py,
        baseWidth,
        stroke.color,
        overrideOpacity ?? stroke.opacity
      );
      ctx.restore();
      return dotBounds;
    }
    const r = Math.max(1.1, baseWidth * 0.56);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const pad = r + 3;
    return { minX: px - pad, minY: py - pad, maxX: px + pad, maxY: py + pad };
  }

  ensurePenKnotCapacity(rawLen);

  let hasStylusPressure = false;
  for (let i = 0; i < rawLen; i++) {
    const p = pts[i];
    knotRawX[i] = p.x * sx + ox;
    knotRawY[i] = p.y * sy + oy;
    const pr = p.pressure;
    knotRawP[i] = pr;
    knotRawT[i] = p.t;
    if (!hasStylusPressure && pr > 0.01 && Math.abs(pr - 0.5) > 0.04) {
      hasStylusPressure = true;
    }
  }

  // 1. Corner-preserving micro-jitter filter into knotFilt*
  const smoothLevel =
    stroke.smoothing ??
    (stroke.kind === 'fountain' ? 0.68 : stroke.kind === 'pencil' ? 0.66 : 0.62);
  const isSmoothInkFamily =
    stroke.kind === 'pen' || stroke.kind === 'fountain' || stroke.kind === 'pencil';
  const minDistPx =
    smoothLevel > 0.03
      ? isSmoothInkFamily
        ? 0.5 + smoothLevel * 2.0
        : 1.4 + smoothLevel * 1.8
      : 0;
  let filtLen = 0;

  if (rawLen <= 3 || minDistPx <= 0.1) {
    filtLen = rawLen;
    for (let i = 0; i < rawLen; i++) {
      knotFiltX[i] = knotRawX[i];
      knotFiltY[i] = knotRawY[i];
      knotFiltP[i] = knotRawP[i];
      knotFiltT[i] = knotRawT[i];
    }
  } else {
    const minDistSq = minDistPx * minDistPx;
    knotFiltX[0] = knotRawX[0];
    knotFiltY[0] = knotRawY[0];
    knotFiltP[0] = knotRawP[0];
    knotFiltT[0] = knotRawT[0];
    filtLen = 1;
    let lastX = knotRawX[0];
    let lastY = knotRawY[0];

    for (let i = 1; i < rawLen - 1; i++) {
      const cx = knotRawX[i];
      const cy = knotRawY[i];
      const dx = cx - lastX;
      const dy = cy - lastY;
      const l1Sq = dx * dx + dy * dy;
      if (l1Sq >= minDistSq) {
        knotFiltX[filtLen] = cx;
        knotFiltY[filtLen] = cy;
        knotFiltP[filtLen] = knotRawP[i];
        knotFiltT[filtLen] = knotRawT[i];
        filtLen++;
        lastX = cx;
        lastY = cy;
        continue;
      }

      if (l1Sq > 0.64) {
        const v2x = knotRawX[i + 1] - cx;
        const v2y = knotRawY[i + 1] - cy;
        const l2Sq = v2x * v2x + v2y * v2y;
        if (l2Sq > 0.64 && (dx * v2x + dy * v2y) / Math.sqrt(l1Sq * l2Sq) < 0.25) {
          knotFiltX[filtLen] = cx;
          knotFiltY[filtLen] = cy;
          knotFiltP[filtLen] = knotRawP[i];
          knotFiltT[filtLen] = knotRawT[i];
          filtLen++;
          lastX = cx;
          lastY = cy;
        }
      }
    }

    knotFiltX[filtLen] = knotRawX[rawLen - 1];
    knotFiltY[filtLen] = knotRawY[rawLen - 1];
    knotFiltP[filtLen] = knotRawP[rawLen - 1];
    knotFiltT[filtLen] = knotRawT[rawLen - 1];
    filtLen++;
  }

  // 2. Zero-phase multi-scale corner-preserving Gaussian smoothing (zero heap allocations via ping-pong buffers)
  let srcX = knotFiltX;
  let srcY = knotFiltY;
  if (filtLen >= 3 && smoothLevel > 0.02) {
    const clamped = smoothLevel < 0 ? 0 : smoothLevel > 1 ? 1 : smoothLevel;
    const passes = isSmoothInkFamily
      ? clamped >= 0.72
        ? 4
        : clamped >= 0.35
        ? 3
        : clamped >= 0.08
        ? 2
        : 0
      : isLiveDraft
      ? 2
      : clamped >= 0.72
      ? 4
      : clamped >= 0.4
      ? 3
      : 2;
    const strength = isSmoothInkFamily ? 0.2 + clamped * 0.52 : 0.28 + clamped * 0.44;

    let dstX = knotSmAX;
    let dstY = knotSmAY;
    for (let pass = 0; pass < passes; pass++) {
      dstX[0] = srcX[0];
      dstY[0] = srcY[0];
      dstX[filtLen - 1] = srcX[filtLen - 1];
      dstY[filtLen - 1] = srcY[filtLen - 1];

      for (let i = 1; i < filtLen - 1; i++) {
        const prevX = srcX[i - 1];
        const prevY = srcY[i - 1];
        const curX = srcX[i];
        const curY = srcY[i];
        const nextX = srcX[i + 1];
        const nextY = srcY[i + 1];

        let v1x = curX - prevX;
        let v1y = curY - prevY;
        let v2x = nextX - curX;
        let v2y = nextY - curY;
        if (isSmoothInkFamily) {
          let pBack = i - 1;
          while (pBack > 0 && Math.hypot(curX - srcX[pBack], curY - srcY[pBack]) < 5.0) {
            pBack--;
          }
          let pFwd = i + 1;
          while (pFwd < filtLen - 1 && Math.hypot(srcX[pFwd] - curX, srcY[pFwd] - curY) < 5.0) {
            pFwd++;
          }
          v1x = curX - srcX[pBack];
          v1y = curY - srcY[pBack];
          v2x = srcX[pFwd] - curX;
          v2y = srcY[pFwd] - curY;
        }
        const l1Sq = v1x * v1x + v1y * v1y;
        const l2Sq = v2x * v2x + v2y * v2y;

        let cornerFactor = 1.0;
        if (l1Sq > 0.000001 && l2Sq > 0.000001) {
          const dot = (v1x * v2x + v1y * v2y) / Math.sqrt(l1Sq * l2Sq);
          const cf = (dot + 0.15) / 0.85;
          cornerFactor = cf < 0.08 ? 0.08 : cf > 1.0 ? 1.0 : cf;
        }

        let targetX: number;
        let targetY: number;
        if (i >= 2 && i <= filtLen - 3) {
          targetX =
            0.08 * srcX[i - 2] +
            0.22 * prevX +
            0.4 * curX +
            0.22 * nextX +
            0.08 * srcX[i + 2];
          targetY =
            0.08 * srcY[i - 2] +
            0.22 * prevY +
            0.4 * curY +
            0.22 * nextY +
            0.08 * srcY[i + 2];
        } else {
          targetX = 0.25 * prevX + 0.5 * curX + 0.25 * nextX;
          targetY = 0.25 * prevY + 0.5 * curY + 0.25 * nextY;
        }

        const alpha = strength * cornerFactor;
        dstX[i] = curX + (targetX - curX) * alpha;
        dstY[i] = curY + (targetY - curY) * alpha;
      }

      srcX = dstX;
      srcY = dstY;
      dstX = srcX === knotSmAX ? knotSmBX : knotSmAX;
      dstY = srcY === knotSmAY ? knotSmBY : knotSmAY;
    }
  }

  // 3. Quadratic midpoint spline subdivision directly into dense* Float32Arrays
  const maxStepPx =
    stroke.kind === 'fountain' || stroke.kind === 'pencil'
      ? isLiveDraft
        ? 2.4
        : 1.9
      : isLiveDraft
      ? 3.8
      : 2.2;
  let n = 0;

  if (filtLen === 2) {
    const ax = srcX[0];
    const ay = srcY[0];
    const bx = srcX[1];
    const by = srcY[1];
    const dx = bx - ax;
    const dy = by - ay;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(dist / maxStepPx));
    ensurePenDenseCapacity(steps + 2);
    const ap = knotFiltP[0];
    const dp = knotFiltP[1] - ap;
    const at = knotFiltT[0];
    const dt = knotFiltT[1] - at;
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      denseX[s] = ax + dx * u;
      denseY[s] = ay + dy * u;
      denseP[s] = ap + dp * u;
      denseT[s] = at + dt * u;
    }
    n = steps + 1;
  } else {
    ensurePenDenseCapacity(filtLen * 4 + 16);
    denseX[0] = srcX[0];
    denseY[0] = srcY[0];
    denseP[0] = knotFiltP[0];
    denseT[0] = knotFiltT[0];
    n = 1;

    let prevMidX = srcX[0];
    let prevMidY = srcY[0];
    let prevMidP = knotFiltP[0];
    let prevMidT = knotFiltT[0];

    for (let i = 1; i < filtLen; i++) {
      const ctrlX = srcX[i - 1];
      const ctrlY = srcY[i - 1];
      const ctrlP = knotFiltP[i - 1];
      const ctrlT = knotFiltT[i - 1];
      const curX = srcX[i];
      const curY = srcY[i];
      const curP = knotFiltP[i];
      const curT = knotFiltT[i];
      const isLast = i === filtLen - 1;
      const endX = isLast ? curX : (ctrlX + curX) * 0.5;
      const endY = isLast ? curY : (ctrlY + curY) * 0.5;
      const endP = isLast ? curP : (ctrlP + curP) * 0.5;
      const endT = isLast ? curT : (ctrlT + curT) * 0.5;

      const d1x = ctrlX - prevMidX;
      const d1y = ctrlY - prevMidY;
      const d2x = endX - ctrlX;
      const d2y = endY - ctrlY;
      const approxLen = Math.sqrt(d1x * d1x + d1y * d1y) + Math.sqrt(d2x * d2x + d2y * d2y);
      const steps = Math.max(1, Math.ceil(approxLen / maxStepPx));

      if (n + steps + 2 > penDenseCap) {
        ensurePenDenseCapacity(n + steps + 64);
      }

      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        const inv = 1 - u;
        denseX[n] = inv * inv * prevMidX + 2 * inv * u * ctrlX + u * u * endX;
        denseY[n] = inv * inv * prevMidY + 2 * inv * u * ctrlY + u * u * endY;
        denseP[n] = inv * prevMidP + u * endP;
        denseT[n] = inv * prevMidT + u * endT;
        n++;
      }

      prevMidX = endX;
      prevMidY = endY;
      prevMidP = endP;
      prevMidT = endT;
    }
  }

  if (n < 2) {
    ctx.restore();
    return null;
  }

  // 4. Compute cumulative arc length & velocity/pressure calligraphy radii
  ribbonDists[0] = 0;
  let totalLen = 0;
  for (let i = 1; i < n; i++) {
    const dx = denseX[i] - denseX[i - 1];
    const dy = denseY[i] - denseY[i - 1];
    totalLen += Math.sqrt(dx * dx + dy * dy);
    ribbonDists[i] = totalLen;
  }

  if (totalLen < 0.8) {
    const px = denseX[0];
    const py = denseY[0];
    if (stroke.kind === 'fountain') {
      const dotBounds = drawFountainDot(ctx, px, py, baseWidth, stroke.nibAngleDeg);
      ctx.restore();
      return dotBounds;
    }
    if (stroke.kind === 'pencil') {
      const dotBounds = drawPencilDot(
        ctx,
        px,
        py,
        baseWidth,
        stroke.color,
        overrideOpacity ?? stroke.opacity
      );
      ctx.restore();
      return dotBounds;
    }
    const r = Math.max(1.1, baseWidth * 0.56);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const pad = r + 3;
    return { minX: px - pad, minY: py - pad, maxX: px + pad, maxY: py + pad };
  }

  // Dashed / Dotted Pen Path Mode (clean uniform dashes/dots along smoothed centerline)
  if (stroke.kind !== 'pencil' && (stroke.lineStyle === 'dashed' || stroke.lineStyle === 'dotted')) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    ctx.lineWidth = baseWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    applyPenLineDash(ctx, stroke.lineStyle, baseWidth);
    ctx.beginPath();
    ctx.moveTo(denseX[0], denseY[0]);
    for (let i = 0; i < n; i++) {
      const px = denseX[i];
      const py = denseY[i];
      if (i > 0) ctx.lineTo(px, py);
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
    ctx.stroke();
    ctx.restore();
    const pad = baseWidth * 0.65 + 3;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  // +0.18px compensates exactly for replacing the costly 0.4px round-join outline stroke with pure Skia AA fill
  const halfW = baseWidth * 0.5 + 0.18;
  const isFountain = stroke.kind === 'fountain';
  const isPencil = stroke.kind === 'pencil';
  const nibRad = ((stroke.nibAngleDeg ?? -38) * Math.PI) / 180;
  const shortStrokeBlend = Math.min(1, Math.max(0, (totalLen / Math.max(0.5, tf.unitScale) - 6) / 14));
  const startTaperLen = isFountain
    ? Math.min(3.8 * tf.unitScale, totalLen * 0.1)
    : isPencil
    ? Math.min(7.0 * tf.unitScale, totalLen * 0.14)
    : Math.min(8.5 * tf.unitScale, totalLen * 0.16);
  const endTaperLen = isFountain
    ? Math.min(6.5 * tf.unitScale, totalLen * 0.13)
    : isPencil
    ? Math.min(10 * tf.unitScale, totalLen * 0.18)
    : Math.min(12 * tf.unitScale, totalLen * 0.2);
  const startMin = isFountain
    ? 0.94 - shortStrokeBlend * 0.08
    : isPencil
    ? 0.88 - shortStrokeBlend * 0.1
    : 0.86 - shortStrokeBlend * 0.14;
  const endMin = isFountain
    ? 0.92 - shortStrokeBlend * 0.12
    : isPencil
    ? 0.84 - shortStrokeBlend * 0.18
    : 0.84 - shortStrokeBlend * 0.24;
  let smoothedFactor = 1.0;

  for (let i = 0; i < n; i++) {
    let targetFactor = 1.0;
    if (isFountain) {
      if (hasStylusPressure) {
        const p = denseP[i] < 0.08 ? 0.08 : denseP[i] > 1 ? 1 : denseP[i];
        targetFactor = 0.68 + p * 0.56;
      } else {
        const prevIdx = i > 4 ? i - 4 : 0;
        const nextIdx = i + 4 < n ? i + 4 : n - 1;
        const segDist = ribbonDists[nextIdx] - ribbonDists[prevIdx];
        const dt = Math.max(4, denseT[nextIdx] - denseT[prevIdx]);
        const velocity = segDist / dt;
        const speedNorm = velocity > 2.2 ? 1 : velocity / 2.2;
        targetFactor = 1.04 - speedNorm * 0.14;
      }
      const ds = i > 0 ? ribbonDists[i] - ribbonDists[i - 1] : 0;
      const arcAlpha = i === 0 ? 0.45 : 1 - Math.exp(-ds / Math.max(4, 10 * tf.unitScale));
      smoothedFactor += (targetFactor - smoothedFactor) * arcAlpha;
    } else if (isPencil) {
      if (hasStylusPressure) {
        const p = denseP[i] < 0.08 ? 0.08 : denseP[i] > 1 ? 1 : denseP[i];
        targetFactor = 0.58 + p * 0.62;
      } else {
        const prevIdx = i > 4 ? i - 4 : 0;
        const nextIdx = i + 4 < n ? i + 4 : n - 1;
        const segDist = ribbonDists[nextIdx] - ribbonDists[prevIdx];
        const dt = Math.max(4, denseT[nextIdx] - denseT[prevIdx]);
        const velocity = segDist / dt;
        const speedNorm = velocity > 2.2 ? 1 : velocity / 2.2;
        targetFactor = 1.03 - speedNorm * 0.14;
      }
      const ds = i > 0 ? ribbonDists[i] - ribbonDists[i - 1] : 0;
      const arcAlpha = i === 0 ? 0.4 : 1 - Math.exp(-ds / Math.max(4, 11 * tf.unitScale));
      smoothedFactor += (targetFactor - smoothedFactor) * arcAlpha;
    } else if (hasStylusPressure) {
      const p = denseP[i] < 0.08 ? 0.08 : denseP[i] > 1 ? 1 : denseP[i];
      targetFactor = 0.44 + p * 0.84;
      const ds = i > 0 ? ribbonDists[i] - ribbonDists[i - 1] : 0;
      const arcAlpha = i === 0 ? 0.35 : 1 - Math.exp(-ds / Math.max(4, 12 * tf.unitScale));
      smoothedFactor += (targetFactor - smoothedFactor) * arcAlpha;
    } else {
      const prevIdx = i > 4 ? i - 4 : 0;
      const nextIdx = i + 4 < n ? i + 4 : n - 1;
      const segDist = ribbonDists[nextIdx] - ribbonDists[prevIdx];
      const dt = Math.max(4, denseT[nextIdx] - denseT[prevIdx]);
      const velocity = segDist / dt;
      const speedNorm = velocity > 2.1 ? 1 : velocity / 2.1;
      targetFactor = 1.04 - speedNorm * 0.18;
      const ds = i > 0 ? ribbonDists[i] - ribbonDists[i - 1] : 0;
      const arcAlpha = i === 0 ? 0.35 : 1 - Math.exp(-ds / Math.max(4, 12 * tf.unitScale));
      smoothedFactor += (targetFactor - smoothedFactor) * arcAlpha;
    }

    let taper = 1.0;
    const dist = ribbonDists[i];
    if (startTaperLen > 0 && dist < startTaperLen) {
      const u = dist / startTaperLen;
      const ease = 1 - (1 - u) * (1 - u);
      taper *= startMin + (1 - startMin) * ease;
    }
    const rem = totalLen - dist;
    if (endTaperLen > 0 && rem < endTaperLen) {
      const u = rem / endTaperLen;
      const ease = 1 - (1 - u) * (1 - u);
      taper *= endMin + (1 - endMin) * ease;
    }

    const r = halfW * smoothedFactor * taper;
    const minRadius = isFountain ? 0.85 : 0.6;
    ribbonRadii[i] = r > minRadius ? r : minRadius;
  }

  // Two-pass symmetric radius blur eliminates any micro-pinch kinks along tight loops
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < n - 1; i++) {
      ribbonRadii[i] = 0.25 * ribbonRadii[i - 1] + 0.5 * ribbonRadii[i] + 0.25 * ribbonRadii[i + 1];
    }
  }

  if (isFountain) {
    const bounds = emitFountainQalamSweep(ctx, denseX, denseY, ribbonRadii, 0, n - 1, nibRad, 0.21, true, true);
    ctx.restore();
    return bounds;
  }

  // 5. Build left & right envelope edges + tight CSS bounds in one single pass
  let lastNx = 0;
  let lastNy = -1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxR = 0;

  for (let i = 0; i < n; i++) {
    const prevIdx = i > 2 ? i - 2 : 0;
    const nextIdx = i + 2 < n ? i + 2 : n - 1;
    const dx = denseX[nextIdx] - denseX[prevIdx];
    const dy = denseY[nextIdx] - denseY[prevIdx];
    const lenSq = dx * dx + dy * dy;
    if (lenSq > 0.000001) {
      const invLen = 1 / Math.sqrt(lenSq);
      lastNx = -dy * invLen;
      lastNy = dx * invLen;
    }
    const cx = denseX[i];
    const cy = denseY[i];
    const r = ribbonRadii[i];
    if (r > maxR) maxR = r;
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
    ribbonLeftX[i] = cx + lastNx * r;
    ribbonLeftY[i] = cy + lastNy * r;
    ribbonRightX[i] = cx - lastNx * r;
    ribbonRightY[i] = cy - lastNy * r;
  }

  if (isPencil) {
    const baseAlpha = overrideOpacity ?? stroke.opacity;
    ctx.save();
    ctx.globalAlpha = baseAlpha * 0.28;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(0.75, baseWidth * 0.44);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(denseX[0], denseY[0]);
    for (let i = 1; i < n; i++) {
      ctx.lineTo(denseX[i], denseY[i]);
    }
    ctx.stroke();
    ctx.restore();

    ctx.globalAlpha = baseAlpha * 0.94;
    ctx.fillStyle = getGraphiteStrokeStyle(ctx, stroke.color);
  }

  // Single continuous hardware-antialiased smooth quadratic ribbon + rounded caps + tight-turn corner union
  ctx.beginPath();
  ctx.moveTo(ribbonLeftX[0], ribbonLeftY[0]);
  if (n === 2) {
    ctx.lineTo(ribbonLeftX[1], ribbonLeftY[1]);
  } else {
    for (let i = 1; i < n - 1; i++) {
      ctx.quadraticCurveTo(
        ribbonLeftX[i],
        ribbonLeftY[i],
        (ribbonLeftX[i] + ribbonLeftX[i + 1]) * 0.5,
        (ribbonLeftY[i] + ribbonLeftY[i + 1]) * 0.5
      );
    }
    ctx.lineTo(ribbonLeftX[n - 1], ribbonLeftY[n - 1]);
  }

  const endAngle = Math.atan2(ribbonLeftY[n - 1] - denseY[n - 1], ribbonLeftX[n - 1] - denseX[n - 1]);
  ctx.arc(denseX[n - 1], denseY[n - 1], ribbonRadii[n - 1], endAngle, endAngle - Math.PI, true);

  if (n === 2) {
    ctx.lineTo(ribbonRightX[0], ribbonRightY[0]);
  } else {
    for (let i = n - 2; i > 0; i--) {
      ctx.quadraticCurveTo(
        ribbonRightX[i],
        ribbonRightY[i],
        (ribbonRightX[i] + ribbonRightX[i - 1]) * 0.5,
        (ribbonRightY[i] + ribbonRightY[i - 1]) * 0.5
      );
    }
    ctx.lineTo(ribbonRightX[0], ribbonRightY[0]);
  }

  const startAngle = Math.atan2(ribbonRightY[0] - denseY[0], ribbonRightX[0] - denseX[0]);
  ctx.arc(denseX[0], denseY[0], ribbonRadii[0], startAngle, startAngle - Math.PI, true);
  ctx.closePath();

  // Fill tight-bend inner circles with matching CCW winding so sharp corners never pinch or show cutouts
  if (n >= 3) {
    for (let i = 1; i < n - 1; i++) {
      const v1x = denseX[i] - denseX[i - 1];
      const v1y = denseY[i] - denseY[i - 1];
      const v2x = denseX[i + 1] - denseX[i];
      const v2y = denseY[i + 1] - denseY[i];
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      if (l1 > 0.05 && l2 > 0.05) {
        const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
        if (dot < 0.72) {
          const r = ribbonRadii[i];
          ctx.moveTo(denseX[i] + r, denseY[i]);
          ctx.arc(denseX[i], denseY[i], r, 0, Math.PI * 2, true);
        }
      }
    }
  }

  ctx.fill();
  ctx.restore();

  const pad = maxR + 3;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export interface LivePenDraftSession {
  frozenCanvas: HTMLCanvasElement;
  frozenCtx: CanvasRenderingContext2D | null;
  strokeId: string;
  kind: AnnotationStrokeKind | '';
  nibAngleDeg: number;
  color: string;
  size: number;
  smoothing: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  unitScale: number;
  pw: number;
  ph: number;
  hasPressure: boolean;
  rawProcessed: number;
  filtLen: number;
  filtCap: number;
  filtX: Float32Array;
  filtY: Float32Array;
  filtP: Float32Array;
  filtT: Float64Array;
  frozenFiltEnd: number;
  frozenBounds: PixelRect | null;
  prevTailRect: PixelRect | null;
  lastFullRect: PixelRect | null;
}

export function createLivePenDraftSession(): LivePenDraftSession {
  const frozenCanvas = document.createElement('canvas');
  const cap = 512;
  return {
    frozenCanvas,
    frozenCtx: frozenCanvas.getContext('2d'),
    strokeId: '',
    kind: '',
    nibAngleDeg: -38,
    color: '',
    size: 0,
    smoothing: 0,
    scaleX: 0,
    scaleY: 0,
    offsetX: 0,
    offsetY: 0,
    unitScale: 1,
    pw: 0,
    ph: 0,
    hasPressure: false,
    rawProcessed: 0,
    filtLen: 0,
    filtCap: cap,
    filtX: new Float32Array(cap),
    filtY: new Float32Array(cap),
    filtP: new Float32Array(cap),
    filtT: new Float64Array(cap),
    frozenFiltEnd: 0,
    frozenBounds: null,
    prevTailRect: null,
    lastFullRect: null,
  };
}

function ensureSessionFiltCapacity(session: LivePenDraftSession, needed: number): void {
  if (needed <= session.filtCap) return;
  const next = Math.max(512, needed * 2);
  const nextX = new Float32Array(next);
  const nextY = new Float32Array(next);
  const nextP = new Float32Array(next);
  const nextT = new Float64Array(next);
  nextX.set(session.filtX.subarray(0, session.filtLen));
  nextY.set(session.filtY.subarray(0, session.filtLen));
  nextP.set(session.filtP.subarray(0, session.filtLen));
  nextT.set(session.filtT.subarray(0, session.filtLen));
  session.filtX = nextX;
  session.filtY = nextY;
  session.filtP = nextP;
  session.filtT = nextT;
  session.filtCap = next;
}

export function resetLivePenDraftSession(session: LivePenDraftSession): void {
  if (session.frozenCtx && session.pw > 0 && session.ph > 0) {
    const fb = session.frozenBounds;
    session.frozenCtx.save();
    session.frozenCtx.setTransform(1, 0, 0, 1, 0, 0);
    if (fb) {
      session.frozenCtx.clearRect(fb.x, fb.y, fb.w, fb.h);
    } else {
      session.frozenCtx.clearRect(0, 0, session.pw, session.ph);
    }
    session.frozenCtx.restore();
  }
  session.strokeId = '';
  session.kind = '';
  session.nibAngleDeg = -38;
  session.rawProcessed = 0;
  session.filtLen = 0;
  session.frozenFiltEnd = 0;
  session.frozenBounds = null;
  session.prevTailRect = null;
  session.lastFullRect = null;
  session.hasPressure = false;
}

function renderPenWindowSlice(
  ctx: CanvasRenderingContext2D,
  filtX: Float32Array,
  filtY: Float32Array,
  filtP: Float32Array,
  filtT: Float64Array,
  totalFiltLen: number,
  smoothLevel: number,
  baseWidth: number,
  unitScale: number,
  hasStylusPressure: boolean,
  color: string,
  emitStartFilt: number,
  emitEndFilt: number,
  includeStartCap: boolean,
  includeEndCap: boolean,
  applyStartTaper: boolean,
  applyEndTaper: boolean,
  isFountain = false,
  nibAngleDeg = -38
): CssBounds | null {
  const winStart = emitStartFilt > 14 ? emitStartFilt - 14 : 0;
  const winEnd = emitEndFilt + 12 < totalFiltLen ? emitEndFilt + 12 : totalFiltLen - 1;
  const winLen = winEnd - winStart + 1;
  if (winLen < 2) return null;

  ensurePenKnotCapacity(winLen);
  for (let i = 0; i < winLen; i++) {
    knotRawX[i] = filtX[winStart + i];
    knotRawY[i] = filtY[winStart + i];
    knotRawP[i] = filtP[winStart + i];
    knotRawT[i] = filtT[winStart + i];
  }

  let srcX = knotRawX;
  let srcY = knotRawY;
  if (winLen >= 3 && smoothLevel > 0.02) {
    const clamped = smoothLevel < 0 ? 0 : smoothLevel > 1 ? 1 : smoothLevel;
    const passes = clamped >= 0.72 ? 4 : clamped >= 0.35 ? 3 : clamped >= 0.08 ? 2 : 0;
    const strength = 0.2 + clamped * 0.52;
    let dstX = knotSmAX;
    let dstY = knotSmAY;

    for (let pass = 0; pass < passes; pass++) {
      dstX[0] = srcX[0];
      dstY[0] = srcY[0];
      dstX[winLen - 1] = srcX[winLen - 1];
      dstY[winLen - 1] = srcY[winLen - 1];

      for (let i = 1; i < winLen - 1; i++) {
        const prevX = srcX[i - 1];
        const prevY = srcY[i - 1];
        const curX = srcX[i];
        const curY = srcY[i];
        const nextX = srcX[i + 1];
        const nextY = srcY[i + 1];

        let pBack = i - 1;
        while (pBack > 0 && Math.hypot(curX - srcX[pBack], curY - srcY[pBack]) < 5.0) {
          pBack--;
        }
        let pFwd = i + 1;
        while (pFwd < winLen - 1 && Math.hypot(srcX[pFwd] - curX, srcY[pFwd] - curY) < 5.0) {
          pFwd++;
        }
        const v1x = curX - srcX[pBack];
        const v1y = curY - srcY[pBack];
        const v2x = srcX[pFwd] - curX;
        const v2y = srcY[pFwd] - curY;
        const l1Sq = v1x * v1x + v1y * v1y;
        const l2Sq = v2x * v2x + v2y * v2y;

        let cornerFactor = 1.0;
        if (l1Sq > 0.000001 && l2Sq > 0.000001) {
          const dot = (v1x * v2x + v1y * v2y) / Math.sqrt(l1Sq * l2Sq);
          const cf = (dot + 0.15) / 0.85;
          cornerFactor = cf < 0.08 ? 0.08 : cf > 1.0 ? 1.0 : cf;
        }

        let targetX: number;
        let targetY: number;
        if (i >= 2 && i <= winLen - 3) {
          targetX =
            0.08 * srcX[i - 2] +
            0.22 * prevX +
            0.4 * curX +
            0.22 * nextX +
            0.08 * srcX[i + 2];
          targetY =
            0.08 * srcY[i - 2] +
            0.22 * prevY +
            0.4 * curY +
            0.22 * nextY +
            0.08 * srcY[i + 2];
        } else {
          targetX = 0.25 * prevX + 0.5 * curX + 0.25 * nextX;
          targetY = 0.25 * prevY + 0.5 * curY + 0.25 * nextY;
        }

        const alpha = strength * cornerFactor;
        dstX[i] = curX + (targetX - curX) * alpha;
        dstY[i] = curY + (targetY - curY) * alpha;
      }

      srcX = dstX;
      srcY = dstY;
      dstX = srcX === knotSmAX ? knotSmBX : knotSmAX;
      dstY = srcY === knotSmAY ? knotSmBY : knotSmAY;
    }
  }

  const maxStepPx = isFountain ? 2.4 : 3.8;
  ensurePenDenseCapacity(winLen * 4 + 16);
  denseX[0] = srcX[0];
  denseY[0] = srcY[0];
  denseP[0] = knotRawP[0];
  denseT[0] = knotRawT[0];
  let n = 1;

  let prevMidX = srcX[0];
  let prevMidY = srcY[0];
  let prevMidP = knotRawP[0];
  let prevMidT = knotRawT[0];

  const relEmitStart = emitStartFilt - winStart;
  const relEmitEnd = emitEndFilt - winStart;
  let splitStartDense = relEmitStart <= 0 ? 0 : -1;
  let splitEndDense = -1;

  for (let i = 1; i < winLen; i++) {
    const ctrlX = srcX[i - 1];
    const ctrlY = srcY[i - 1];
    const ctrlP = knotRawP[i - 1];
    const ctrlT = knotRawT[i - 1];
    const curX = srcX[i];
    const curY = srcY[i];
    const curP = knotRawP[i];
    const curT = knotRawT[i];
    const isGlobalLast = winStart + i === totalFiltLen - 1;
    const endX = isGlobalLast ? curX : (ctrlX + curX) * 0.5;
    const endY = isGlobalLast ? curY : (ctrlY + curY) * 0.5;
    const endP = isGlobalLast ? curP : (ctrlP + curP) * 0.5;
    const endT = isGlobalLast ? curT : (ctrlT + curT) * 0.5;

    const d1x = ctrlX - prevMidX;
    const d1y = ctrlY - prevMidY;
    const d2x = endX - ctrlX;
    const d2y = endY - ctrlY;
    const approxLen = Math.sqrt(d1x * d1x + d1y * d1y) + Math.sqrt(d2x * d2x + d2y * d2y);
    const steps = Math.max(1, Math.ceil(approxLen / maxStepPx));

    if (n + steps + 2 > penDenseCap) {
      ensurePenDenseCapacity(n + steps + 64);
    }

    for (let s = 1; s <= steps; s++) {
      const u = s / steps;
      const inv = 1 - u;
      denseX[n] = inv * inv * prevMidX + 2 * inv * u * ctrlX + u * u * endX;
      denseY[n] = inv * inv * prevMidY + 2 * inv * u * ctrlY + u * u * endY;
      denseP[n] = inv * prevMidP + u * endP;
      denseT[n] = inv * prevMidT + u * endT;
      n++;
    }

    if (i === relEmitStart) {
      splitStartDense = n - 1;
    }
    if (i === relEmitEnd) {
      splitEndDense = n - 1;
    }

    prevMidX = endX;
    prevMidY = endY;
    prevMidP = endP;
    prevMidT = endT;
  }

  if (splitStartDense < 0) splitStartDense = 0;
  if (splitEndDense < 0) splitEndDense = n - 1;
  if (splitEndDense <= splitStartDense || n < 2) return null;

  ribbonDists[0] = 0;
  let totalLen = 0;
  for (let i = 1; i < n; i++) {
    const dx = denseX[i] - denseX[i - 1];
    const dy = denseY[i] - denseY[i - 1];
    totalLen += Math.sqrt(dx * dx + dy * dy);
    ribbonDists[i] = totalLen;
  }

  const endDist = ribbonDists[splitEndDense];
  const halfW = baseWidth * 0.5 + 0.18;
  const startTaperLen = applyStartTaper
    ? isFountain
      ? Math.min(3.8 * unitScale, endDist * 0.1)
      : Math.min(8.5 * unitScale, endDist * 0.16)
    : 0;
  const endTaperLen = applyEndTaper
    ? isFountain
      ? Math.min(6.5 * unitScale, endDist * 0.13)
      : Math.min(12 * unitScale, endDist * 0.2)
    : 0;
  const shortStrokeBlend = Math.min(1, Math.max(0, (endDist / Math.max(0.5, unitScale) - 6) / 14));
  const startMin = isFountain ? 0.94 - shortStrokeBlend * 0.08 : 0.86 - shortStrokeBlend * 0.14;
  const endMin = isFountain ? 0.92 - shortStrokeBlend * 0.12 : 0.84 - shortStrokeBlend * 0.24;
  let smoothedFactor = 1.0;

  for (let i = 0; i < n; i++) {
    let targetFactor = 1.0;
    if (isFountain) {
      if (hasStylusPressure) {
        const p = denseP[i] < 0.08 ? 0.08 : denseP[i] > 1 ? 1 : denseP[i];
        targetFactor = 0.68 + p * 0.56;
      } else {
        const prevIdx = i > 4 ? i - 4 : 0;
        const nextIdx = i + 4 < n ? i + 4 : n - 1;
        const segDist = ribbonDists[nextIdx] - ribbonDists[prevIdx];
        const dt = Math.max(4, denseT[nextIdx] - denseT[prevIdx]);
        const velocity = segDist / dt;
        const speedNorm = velocity > 2.2 ? 1 : velocity / 2.2;
        targetFactor = 1.04 - speedNorm * 0.14;
      }
      const ds = i > 0 ? ribbonDists[i] - ribbonDists[i - 1] : 0;
      const arcAlpha = i === 0 ? 0.45 : 1 - Math.exp(-ds / Math.max(4, 10 * unitScale));
      smoothedFactor += (targetFactor - smoothedFactor) * arcAlpha;
    } else if (hasStylusPressure) {
      const p = denseP[i] < 0.08 ? 0.08 : denseP[i] > 1 ? 1 : denseP[i];
      targetFactor = 0.44 + p * 0.84;
      const ds = i > 0 ? ribbonDists[i] - ribbonDists[i - 1] : 0;
      const arcAlpha = i === 0 ? 0.35 : 1 - Math.exp(-ds / Math.max(4, 12 * unitScale));
      smoothedFactor += (targetFactor - smoothedFactor) * arcAlpha;
    } else {
      const prevIdx = i > 4 ? i - 4 : 0;
      const nextIdx = i + 4 < n ? i + 4 : n - 1;
      const segDist = ribbonDists[nextIdx] - ribbonDists[prevIdx];
      const dt = Math.max(4, denseT[nextIdx] - denseT[prevIdx]);
      const velocity = segDist / dt;
      const speedNorm = velocity > 2.1 ? 1 : velocity / 2.1;
      targetFactor = 1.04 - speedNorm * 0.18;
      const ds = i > 0 ? ribbonDists[i] - ribbonDists[i - 1] : 0;
      const arcAlpha = i === 0 ? 0.35 : 1 - Math.exp(-ds / Math.max(4, 12 * unitScale));
      smoothedFactor += (targetFactor - smoothedFactor) * arcAlpha;
    }

    let taper = 1.0;
    const dist = ribbonDists[i];
    if (startTaperLen > 0 && dist < startTaperLen) {
      const u = dist / startTaperLen;
      const ease = 1 - (1 - u) * (1 - u);
      taper *= startMin + (1 - startMin) * ease;
    }
    if (endTaperLen > 0) {
      const rem = endDist - dist;
      if (rem >= 0 && rem < endTaperLen) {
        const u = rem / endTaperLen;
        const ease = 1 - (1 - u) * (1 - u);
        taper *= endMin + (1 - endMin) * ease;
      }
    }

    const r = halfW * smoothedFactor * taper;
    const minRadius = isFountain ? 0.85 : 0.6;
    ribbonRadii[i] = r > minRadius ? r : minRadius;
  }

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < n - 1; i++) {
      ribbonRadii[i] = 0.25 * ribbonRadii[i - 1] + 0.5 * ribbonRadii[i] + 0.25 * ribbonRadii[i + 1];
    }
  }

  const drawStart = emitStartFilt > 0 && splitStartDense > 0 ? splitStartDense - 1 : splitStartDense;
  const drawEnd = splitEndDense;

  if (isFountain) {
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = color;
    const bounds = emitFountainQalamSweep(
      ctx,
      denseX,
      denseY,
      ribbonRadii,
      drawStart,
      drawEnd,
      (nibAngleDeg * Math.PI) / 180,
      0.21,
      includeStartCap,
      includeEndCap
    );
    ctx.restore();
    return bounds;
  }

  let lastNx = 0;
  let lastNy = -1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxR = 0;

  for (let i = drawStart; i <= drawEnd; i++) {
    const prevIdx = i > 2 ? i - 2 : 0;
    const nextIdx = i + 2 < n ? i + 2 : n - 1;
    const dx = denseX[nextIdx] - denseX[prevIdx];
    const dy = denseY[nextIdx] - denseY[prevIdx];
    const lenSq = dx * dx + dy * dy;
    if (lenSq > 0.000001) {
      const invLen = 1 / Math.sqrt(lenSq);
      lastNx = -dy * invLen;
      lastNy = dx * invLen;
    }
    const cx = denseX[i];
    const cy = denseY[i];
    const r = ribbonRadii[i];
    if (r > maxR) maxR = r;
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
    ribbonLeftX[i] = cx + lastNx * r;
    ribbonLeftY[i] = cy + lastNy * r;
    ribbonRightX[i] = cx - lastNx * r;
    ribbonRightY[i] = cy - lastNy * r;
  }

  ctx.save();
  ctx.globalAlpha = 1.0;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(ribbonLeftX[drawStart], ribbonLeftY[drawStart]);
  if (drawEnd - drawStart <= 1) {
    ctx.lineTo(ribbonLeftX[drawEnd], ribbonLeftY[drawEnd]);
  } else {
    for (let i = drawStart + 1; i < drawEnd; i++) {
      ctx.quadraticCurveTo(
        ribbonLeftX[i],
        ribbonLeftY[i],
        (ribbonLeftX[i] + ribbonLeftX[i + 1]) * 0.5,
        (ribbonLeftY[i] + ribbonLeftY[i + 1]) * 0.5
      );
    }
    ctx.lineTo(ribbonLeftX[drawEnd], ribbonLeftY[drawEnd]);
  }

  if (includeEndCap) {
    const endAngle = Math.atan2(
      ribbonLeftY[drawEnd] - denseY[drawEnd],
      ribbonLeftX[drawEnd] - denseX[drawEnd]
    );
    ctx.arc(denseX[drawEnd], denseY[drawEnd], ribbonRadii[drawEnd], endAngle, endAngle - Math.PI, true);
  } else {
    ctx.lineTo(ribbonRightX[drawEnd], ribbonRightY[drawEnd]);
  }

  if (drawEnd - drawStart <= 1) {
    ctx.lineTo(ribbonRightX[drawStart], ribbonRightY[drawStart]);
  } else {
    for (let i = drawEnd - 1; i > drawStart; i--) {
      ctx.quadraticCurveTo(
        ribbonRightX[i],
        ribbonRightY[i],
        (ribbonRightX[i] + ribbonRightX[i - 1]) * 0.5,
        (ribbonRightY[i] + ribbonRightY[i - 1]) * 0.5
      );
    }
    ctx.lineTo(ribbonRightX[drawStart], ribbonRightY[drawStart]);
  }

  if (includeStartCap) {
    const startAngle = Math.atan2(
      ribbonRightY[drawStart] - denseY[drawStart],
      ribbonRightX[drawStart] - denseX[drawStart]
    );
    ctx.arc(
      denseX[drawStart],
      denseY[drawStart],
      ribbonRadii[drawStart],
      startAngle,
      startAngle - Math.PI,
      true
    );
  }

  ctx.closePath();

  for (let i = Math.max(1, drawStart); i < Math.min(n - 1, drawEnd + 1); i++) {
    const v1x = denseX[i] - denseX[i - 1];
    const v1y = denseY[i] - denseY[i - 1];
    const v2x = denseX[i + 1] - denseX[i];
    const v2y = denseY[i + 1] - denseY[i];
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 > 0.05 && l2 > 0.05) {
      const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
      if (dot < 0.72) {
        const r = ribbonRadii[i];
        ctx.moveTo(denseX[i] + r, denseY[i]);
        ctx.arc(denseX[i], denseY[i], r, 0, Math.PI * 2, true);
      }
    }
  }

  ctx.fill();
  ctx.restore();

  const pad = maxR + 3;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/**
 * O(1) constant-time live Apple Pen renderer with offscreen prefix baking:
 * - Short/snapped strokes (< 38 pts or snapped shapes) render directly in < 0.2ms.
 * - Longer strokes freeze settled chunks onto an offscreen canvas and only clear/fill the ~16-knot tip tail.
 * - Uses CSS opacity on `draftCanvas` during chunked live drag so overlapping alpha=1 fills have zero seam darkening.
 */
export function renderLivePenDraftWithSession(
  dCtx: CanvasRenderingContext2D,
  draftCanvas: HTMLCanvasElement,
  session: LivePenDraftSession,
  stroke: AnnotationStroke,
  tf: RenderTransform,
  dprX: number,
  dprY: number,
  pw: number,
  ph: number,
  prevOtherRect: PixelRect | null
): PixelRect | null {
  const clearFullRect = (rect: PixelRect | null) => {
    if (!rect) return;
    dCtx.save();
    dCtx.setTransform(1, 0, 0, 1, 0, 0);
    dCtx.clearRect(rect.x, rect.y, rect.w, rect.h);
    dCtx.restore();
  };

  const targetCssOpacity = stroke.opacity < 0.999 ? String(stroke.opacity) : '';

  // 1. Snapped Smart Shapes, pencil/tape, dashed/dotted strokes, or short strokes -> direct path
  if (
    (stroke.kind !== 'pen' && stroke.kind !== 'fountain') ||
    stroke.shape ||
    stroke.points.length < 22 ||
    (stroke.lineStyle && stroke.lineStyle !== 'solid')
  ) {
    if (draftCanvas.style.opacity !== '') {
      draftCanvas.style.opacity = '';
    }
    if (session.frozenFiltEnd > 0 || session.frozenBounds || session.strokeId) {
      clearFullRect(unionPixelRects(session.lastFullRect, prevOtherRect));
      resetLivePenDraftSession(session);
    } else {
      clearFullRect(prevOtherRect);
    }
    dCtx.save();
    dCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
    const bounds = drawApplePenStroke(dCtx, stroke, tf, true, stroke.opacity);
    dCtx.restore();
    const pxRect = cssBoundsToPixelRect(bounds, dprX, dprY, pw, ph);
    session.lastFullRect = pxRect;
    return pxRect;
  }

  const pts = stroke.points;
  const rawLen = pts.length;
  const sx = tf.scaleX;
  const sy = tf.scaleY;
  const ox = tf.offsetX;
  const oy = tf.offsetY;
  const isFountain = stroke.kind === 'fountain';
  const nibAngleDeg = stroke.nibAngleDeg ?? -38;
  const smoothLevel = stroke.smoothing ?? (isFountain ? 0.68 : 0.62);
  const baseWidth = Math.max(1.2, stroke.size * tf.unitScale);

  // Sync offscreen frozen canvas dimensions if needed
  if (session.frozenCanvas.width !== pw || session.frozenCanvas.height !== ph) {
    session.frozenCanvas.width = pw;
    session.frozenCanvas.height = ph;
    session.frozenCtx = session.frozenCanvas.getContext('2d');
    session.pw = pw;
    session.ph = ph;
    session.frozenFiltEnd = 0;
    session.frozenBounds = null;
    session.prevTailRect = null;
  }

  // Detect any stroke/transform/style reset
  const needsReset =
    session.strokeId !== stroke.id ||
    session.kind !== stroke.kind ||
    session.nibAngleDeg !== nibAngleDeg ||
    session.color !== stroke.color ||
    session.size !== stroke.size ||
    session.smoothing !== smoothLevel ||
    session.scaleX !== sx ||
    session.scaleY !== sy ||
    session.offsetX !== ox ||
    session.offsetY !== oy;

  if (needsReset) {
    if (prevOtherRect || session.lastFullRect) {
      clearFullRect(unionPixelRects(prevOtherRect, session.lastFullRect));
    }
    resetLivePenDraftSession(session);
    session.strokeId = stroke.id;
    session.kind = stroke.kind;
    session.nibAngleDeg = nibAngleDeg;
    session.color = stroke.color;
    session.size = stroke.size;
    session.smoothing = smoothLevel;
    session.scaleX = sx;
    session.scaleY = sy;
    session.offsetX = ox;
    session.offsetY = oy;
    session.unitScale = tf.unitScale;
    session.pw = pw;
    session.ph = ph;
  }

  // Incrementally update filtered knot array (O(new points))
  const minDistPx = smoothLevel > 0.03 ? 0.5 + smoothLevel * 2.0 : 0;
  const minDistSq = minDistPx * minDistPx;

  if (session.rawProcessed === 0 && rawLen > 0) {
    ensureSessionFiltCapacity(session, rawLen + 4);
    const p0 = pts[0];
    session.filtX[0] = p0.x * sx + ox;
    session.filtY[0] = p0.y * sy + oy;
    session.filtP[0] = p0.pressure;
    session.filtT[0] = p0.t;
    if (!session.hasPressure && p0.pressure > 0.01 && Math.abs(p0.pressure - 0.5) > 0.04) {
      session.hasPressure = true;
    }
    session.filtLen = 1;
    session.rawProcessed = 1;
  }

  while (session.rawProcessed < rawLen - 1) {
    const i = session.rawProcessed;
    const p = pts[i];
    const cx = p.x * sx + ox;
    const cy = p.y * sy + oy;
    const pr = p.pressure;
    if (!session.hasPressure && pr > 0.01 && Math.abs(pr - 0.5) > 0.04) {
      session.hasPressure = true;
    }

    let keep = false;
    if (minDistPx <= 0.1) {
      keep = true;
    } else {
      const lastX = session.filtX[session.filtLen - 1];
      const lastY = session.filtY[session.filtLen - 1];
      const dx = cx - lastX;
      const dy = cy - lastY;
      const l1Sq = dx * dx + dy * dy;
      if (l1Sq >= minDistSq) {
        keep = true;
      } else if (l1Sq > 0.64) {
        const np = pts[i + 1];
        const v2x = np.x * sx + ox - cx;
        const v2y = np.y * sy + oy - cy;
        const l2Sq = v2x * v2x + v2y * v2y;
        if (l2Sq > 0.64 && (dx * v2x + dy * v2y) / Math.sqrt(l1Sq * l2Sq) < 0.25) {
          keep = true;
        }
      }
    }

    if (keep) {
      ensureSessionFiltCapacity(session, session.filtLen + 4);
      session.filtX[session.filtLen] = cx;
      session.filtY[session.filtLen] = cy;
      session.filtP[session.filtLen] = pr;
      session.filtT[session.filtLen] = p.t;
      session.filtLen++;
    }
    session.rawProcessed = i + 1;
  }

  // Temporarily append current live tip at filt[filtLen]
  const tip = pts[rawLen - 1];
  if (!session.hasPressure && tip.pressure > 0.01 && Math.abs(tip.pressure - 0.5) > 0.04) {
    session.hasPressure = true;
  }
  ensureSessionFiltCapacity(session, session.filtLen + 2);
  session.filtX[session.filtLen] = tip.x * sx + ox;
  session.filtY[session.filtLen] = tip.y * sy + oy;
  session.filtP[session.filtLen] = tip.pressure;
  session.filtT[session.filtLen] = tip.t;
  const totalFiltLen = session.filtLen + 1;

  // If stroke has very few filtered knots (tight scribble), use fast direct draw without CSS opacity
  if (totalFiltLen < 20 || !session.frozenCtx) {
    if (draftCanvas.style.opacity !== '') {
      draftCanvas.style.opacity = '';
    }
    clearFullRect(prevOtherRect);
    dCtx.save();
    dCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
    const bounds = drawApplePenStroke(dCtx, stroke, tf, true, stroke.opacity);
    dCtx.restore();
    const pxRect = cssBoundsToPixelRect(bounds, dprX, dprY, pw, ph);
    session.lastFullRect = pxRect;
    return pxRect;
  }

  if (session.frozenFiltEnd === 0) {
    clearFullRect(unionPixelRects(prevOtherRect, session.lastFullRect));
  }

  // Check if we can freeze a new settled prefix chunk safely away from start/end tapers
  const targetFreezeEnd = totalFiltLen - 10;
  if (
    targetFreezeEnd > session.frozenFiltEnd &&
    (session.frozenFiltEnd === 0 || targetFreezeEnd - session.frozenFiltEnd >= 10)
  ) {
    // Verify start & tail margins so tapers stay strictly away from split points
    let tailChord = 0;
    for (let k = targetFreezeEnd + 1; k < totalFiltLen; k++) {
      const dx = session.filtX[k] - session.filtX[k - 1];
      const dy = session.filtY[k] - session.filtY[k - 1];
      tailChord += Math.hypot(dx, dy);
      if (tailChord >= 22 * tf.unitScale) break;
    }

    let headOk = session.frozenFiltEnd > 0;
    if (!headOk) {
      let headChord = 0;
      for (let k = 1; k <= targetFreezeEnd; k++) {
        const dx = session.filtX[k] - session.filtX[k - 1];
        const dy = session.filtY[k] - session.filtY[k - 1];
        headChord += Math.hypot(dx, dy);
        if (headChord >= 18 * tf.unitScale) {
          headOk = true;
          break;
        }
      }
    }

    if (headOk && tailChord >= 22 * tf.unitScale) {
      const fCtx = session.frozenCtx;
      fCtx.save();
      fCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
      const chunkBounds = renderPenWindowSlice(
        fCtx,
        session.filtX,
        session.filtY,
        session.filtP,
        session.filtT,
        totalFiltLen,
        smoothLevel,
        baseWidth,
        tf.unitScale,
        session.hasPressure,
        stroke.color,
        session.frozenFiltEnd,
        targetFreezeEnd,
        session.frozenFiltEnd === 0,
        false,
        session.frozenFiltEnd === 0,
        false,
        isFountain,
        nibAngleDeg
      );
      fCtx.restore();

      const chunkRect = cssBoundsToPixelRect(chunkBounds, dprX, dprY, pw, ph);
      if (chunkRect) {
        session.frozenBounds = unionPixelRects(session.frozenBounds, chunkRect);
        dCtx.save();
        dCtx.setTransform(1, 0, 0, 1, 0, 0);
        dCtx.clearRect(chunkRect.x, chunkRect.y, chunkRect.w, chunkRect.h);
        dCtx.drawImage(
          session.frozenCanvas,
          chunkRect.x,
          chunkRect.y,
          chunkRect.w,
          chunkRect.h,
          chunkRect.x,
          chunkRect.y,
          chunkRect.w,
          chunkRect.h
        );
        dCtx.restore();
      }
      session.frozenFiltEnd = targetFreezeEnd;
    }
  }

  // If chunking couldn't start yet (tight cluster), fall back to direct draw with canvas opacity = 1
  if (session.frozenFiltEnd === 0) {
    if (draftCanvas.style.opacity !== '') {
      draftCanvas.style.opacity = '';
    }
    clearFullRect(prevOtherRect);
    dCtx.save();
    dCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
    const bounds = drawApplePenStroke(dCtx, stroke, tf, true, stroke.opacity);
    dCtx.restore();
    const pxRect = cssBoundsToPixelRect(bounds, dprX, dprY, pw, ph);
    session.lastFullRect = pxRect;
    return pxRect;
  }

  // Apply CSS opacity strictly while chunked frozen rendering is active so overlapping fills stay seam-free
  if (draftCanvas.style.opacity !== targetCssOpacity) {
    draftCanvas.style.opacity = targetCssOpacity;
  }

  // Draw ONLY the active ~16-knot tail over a dirty-rect restore from frozenCanvas
  dCtx.save();
  dCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
  // First clear previous tail region & restore settled prefix pixels from frozenCanvas
  const prevTail = session.prevTailRect;
  if (prevTail) {
    dCtx.save();
    dCtx.setTransform(1, 0, 0, 1, 0, 0);
    dCtx.clearRect(prevTail.x, prevTail.y, prevTail.w, prevTail.h);
    dCtx.drawImage(
      session.frozenCanvas,
      prevTail.x,
      prevTail.y,
      prevTail.w,
      prevTail.h,
      prevTail.x,
      prevTail.y,
      prevTail.w,
      prevTail.h
    );
    dCtx.restore();
  }

  const tailBounds = renderPenWindowSlice(
    dCtx,
    session.filtX,
    session.filtY,
    session.filtP,
    session.filtT,
    totalFiltLen,
    smoothLevel,
    baseWidth,
    tf.unitScale,
    session.hasPressure,
    stroke.color,
    session.frozenFiltEnd,
    totalFiltLen - 1,
    false,
    true,
    false,
    true,
    isFountain,
    nibAngleDeg
  );
  dCtx.restore();

  const nextTailRect = cssBoundsToPixelRect(tailBounds, dprX, dprY, pw, ph);
  session.prevTailRect = nextTailRect;
  const fullRect = unionPixelRects(session.frozenBounds, nextTailRect);
  session.lastFullRect = fullRect;
  return fullRect;
}

/**
 * Draws a single angled Apple chisel-tip nib polygon at (x, y).
 * Tilted at -22 deg with crisp softened corners, just like Apple PencilKit's Highlighter.
 */
const CHISEL_ANGLE = (-22 * Math.PI) / 180;
const CHISEL_COS = Math.cos(CHISEL_ANGLE);
const CHISEL_SIN = Math.sin(CHISEL_ANGLE);

function drawChiselNib(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  halfThick: number,
  halfHeight: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(CHISEL_ANGLE);
  const w = halfThick * 2;
  const h = halfHeight * 2;
  const r = Math.min(halfThick * 0.9, 2.6);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(-halfThick, -halfHeight, w, h, r);
  } else {
    ctx.rect(-halfThick, -halfHeight, w, h);
  }
  ctx.fill();
  ctx.restore();
}

function sweepChiselPolyline(
  sCtx: CanvasRenderingContext2D,
  dense: ScreenPoint[],
  halfThick: number,
  halfHeight: number,
  stampVertices = false
): void {
  const len = dense.length;
  if (len === 0) return;

  if (len === 1) {
    drawChiselNib(sCtx, dense[0].x, dense[0].y, halfThick, halfHeight);
    return;
  }

  const ux = -CHISEL_SIN * halfHeight;
  const uy = CHISEL_COS * halfHeight;

  // Draw crisp angled chisel start & end caps
  drawChiselNib(sCtx, dense[0].x, dense[0].y, halfThick, halfHeight);
  drawChiselNib(sCtx, dense[len - 1].x, dense[len - 1].y, halfThick, halfHeight);

  // Batch ALL chisel quads into a single GPU fill call instead of hundreds of separate beginPath/fill passes
  sCtx.beginPath();
  let hasVerticalSegments = false;
  for (let i = 0; i < len - 1; i++) {
    const a = dense[i];
    const b = dense[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    if (dx * uy - dy * ux >= 0) {
      sCtx.moveTo(a.x + ux, a.y + uy);
      sCtx.lineTo(b.x + ux, b.y + uy);
      sCtx.lineTo(b.x - ux, b.y - uy);
      sCtx.lineTo(a.x - ux, a.y - uy);
    } else {
      sCtx.moveTo(a.x - ux, a.y - uy);
      sCtx.lineTo(b.x - ux, b.y - uy);
      sCtx.lineTo(b.x + ux, b.y + uy);
      sCtx.lineTo(a.x + ux, a.y + uy);
    }
    sCtx.closePath();

    if (!hasVerticalSegments) {
      const segLenSq = dx * dx + dy * dy;
      if (segLenSq > 0.0001) {
        const cross = Math.abs(dx * uy - dy * ux) / (Math.sqrt(segLenSq) * halfHeight);
        if (cross < 0.38) hasVerticalSegments = true;
      }
    }
  }
  sCtx.fill();

  if (stampVertices) {
    for (let i = 1; i < len - 1; i++) {
      drawChiselNib(sCtx, dense[i].x, dense[i].y, halfThick, halfHeight);
    }
  } else if (len >= 3) {
    for (let i = 1; i < len - 1; i++) {
      const v1x = dense[i].x - dense[i - 1].x;
      const v1y = dense[i].y - dense[i - 1].y;
      const v2x = dense[i + 1].x - dense[i].x;
      const v2y = dense[i + 1].y - dense[i].y;
      const l1Sq = v1x * v1x + v1y * v1y;
      const l2Sq = v2x * v2x + v2y * v2y;
      if (l1Sq > 0.0001 && l2Sq > 0.0001) {
        const dot = (v1x * v2x + v1y * v2y) / Math.sqrt(l1Sq * l2Sq);
        const s1 = v1x * uy - v1y * ux;
        const s2 = v2x * uy - v2y * ux;
        if (dot < 0.72 || s1 * s2 <= 0) {
          drawChiselNib(sCtx, dense[i].x, dense[i].y, halfThick, halfHeight);
        }
      }
    }
  }

  // Batch vertical sweeps where movement aligns with the chisel edge into one stroke call
  if (hasVerticalSegments) {
    sCtx.beginPath();
    for (let i = 0; i < len - 1; i++) {
      const a = dense[i];
      const b = dense[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segLenSq = dx * dx + dy * dy;
      if (segLenSq > 0.0001) {
        const cross = Math.abs(dx * uy - dy * ux) / (Math.sqrt(segLenSq) * halfHeight);
        if (cross < 0.38) {
          sCtx.moveTo(a.x, a.y);
          sCtx.lineTo(b.x, b.y);
        }
      }
    }
    sCtx.lineWidth = halfThick * 2.05;
    sCtx.lineCap = 'round';
    sCtx.stroke();
  }
}

/**
 * Renders a single chisel-tip highlighter stroke into `scratchCanvas` strictly within its
 * tight device-pixel bounding box and returns that `PixelRect` for dirty-rect compositing.
 */
export function renderHighlighterToScratch(
  scratchCanvas: HTMLCanvasElement,
  stroke: AnnotationStroke,
  tf: RenderTransform,
  dprX: number,
  dprY: number,
  wPx: number,
  hPx: number,
  isLiveDraft = false
): PixelRect | null {
  if (wPx <= 0 || hPx <= 0) return null;
  if (scratchCanvas.width !== wPx || scratchCanvas.height !== hPx) {
    scratchCanvas.width = wPx;
    scratchCanvas.height = hPx;
  }
  const sCtx = scratchCanvas.getContext('2d');
  if (!sCtx) return null;

  const nibHeight = Math.max(8, stroke.size * tf.unitScale);
  const halfHeight = nibHeight * 0.5;
  const halfThick = Math.max(1.8, nibHeight * 0.13);

  let polylines: ScreenPoint[][];
  let stampVertices = false;

  if (stroke.shape) {
    polylines = sampleShapeToPolylines(stroke.shape, tf, isLiveDraft ? 2.6 : 2.0);
    stampVertices = stroke.shape.type === 'polygon' || stroke.shape.type === 'arrow';
  } else {
    const rawScreen = toScreenPoints(stroke.points, tf);
    if (rawScreen.length === 0) return null;
    if (rawScreen.length === 1) {
      polylines = [rawScreen];
    } else {
      const smoothLevel = stroke.smoothing ?? 0.66;
      const filteredHl = filterMicroJitterKnots(
        rawScreen,
        smoothLevel > 0.05 ? 0.85 + smoothLevel * 1.15 : 0
      );
      const smoothedHl = smoothControlPolygon(filteredHl, smoothLevel, 4);
      polylines = [subdivideSpline(smoothedHl, isLiveDraft ? 2.4 : 2.0)];
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let pIdx = 0; pIdx < polylines.length; pIdx++) {
    const poly = polylines[pIdx];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return null;

  const padCss = halfHeight + halfThick + 4;
  const bx = Math.max(0, Math.floor((minX - padCss) * dprX));
  const by = Math.max(0, Math.floor((minY - padCss) * dprY));
  const bx2 = Math.min(wPx, Math.ceil((maxX + padCss) * dprX));
  const by2 = Math.min(hPx, Math.ceil((maxY + padCss) * dprY));
  const bw = bx2 - bx;
  const bh = by2 - by;
  if (bw <= 0 || bh <= 0) return null;

  sCtx.save();
  sCtx.setTransform(1, 0, 0, 1, 0, 0);
  sCtx.clearRect(bx, by, bw, bh);
  sCtx.scale(dprX, dprY);
  sCtx.fillStyle = stroke.color;
  sCtx.strokeStyle = stroke.color;
  sCtx.globalAlpha = 1;

  for (let pIdx = 0; pIdx < polylines.length; pIdx++) {
    sweepChiselPolyline(sCtx, polylines[pIdx], halfThick, halfHeight, stampVertices);
  }

  // Authentic real-marker ink meniscus on final commit (skipped during live drag for 2x GPU speed)
  if (!isLiveDraft && nibHeight >= 13) {
    const innerHalfHeight = halfHeight * 0.62;
    const innerUx = -CHISEL_SIN * innerHalfHeight;
    const innerUy = CHISEL_COS * innerHalfHeight;
    sCtx.save();
    sCtx.globalCompositeOperation = 'destination-out';
    sCtx.globalAlpha = 0.1;
    sCtx.fillStyle = '#000000';
    sCtx.beginPath();
    let hasInner = false;
    for (let pIdx = 0; pIdx < polylines.length; pIdx++) {
      const poly = polylines[pIdx];
      if (poly.length < 2) continue;
      hasInner = true;
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i];
        const b = poly[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (dx * innerUy - dy * innerUx >= 0) {
          sCtx.moveTo(a.x + innerUx, a.y + innerUy);
          sCtx.lineTo(b.x + innerUx, b.y + innerUy);
          sCtx.lineTo(b.x - innerUx, b.y - innerUy);
          sCtx.lineTo(a.x - innerUx, a.y - innerUy);
        } else {
          sCtx.moveTo(a.x - innerUx, a.y - innerUy);
          sCtx.lineTo(b.x - innerUx, b.y - innerUy);
          sCtx.lineTo(b.x + innerUx, b.y + innerUy);
          sCtx.lineTo(a.x + innerUx, a.y + innerUy);
        }
        sCtx.closePath();
      }
    }
    if (hasInner) {
      sCtx.fill();
    }
    sCtx.restore();
  }

  sCtx.restore();
  return { x: bx, y: by, w: bw, h: bh };
}

/**
 * O(1) constant-time incremental live Highlighter renderer reusing the session's offscreen
 * prefix canvas (`alpha = 1.0` opaque chunks -> `scratchCanvas` -> tight `dirty` multiply composite).
 */
export function renderLiveHighlighterWithSession(
  scratchCanvas: HTMLCanvasElement,
  session: LivePenDraftSession,
  stroke: AnnotationStroke,
  tf: RenderTransform,
  dprX: number,
  dprY: number,
  pw: number,
  ph: number
): PixelRect | null {
  if (pw <= 0 || ph <= 0) return null;

  // Short strokes or smart shapes -> fast direct scratch path (zero destination-out during drag)
  if (stroke.shape || stroke.points.length < 20) {
    if (session.strokeId) {
      resetLivePenDraftSession(session);
    }
    return renderHighlighterToScratch(scratchCanvas, stroke, tf, dprX, dprY, pw, ph, true);
  }

  if (scratchCanvas.width !== pw || scratchCanvas.height !== ph) {
    scratchCanvas.width = pw;
    scratchCanvas.height = ph;
  }
  const sCtx = scratchCanvas.getContext('2d');
  if (!sCtx) return null;

  if (session.frozenCanvas.width !== pw || session.frozenCanvas.height !== ph) {
    session.frozenCanvas.width = pw;
    session.frozenCanvas.height = ph;
    session.frozenCtx = session.frozenCanvas.getContext('2d');
    session.pw = pw;
    session.ph = ph;
    session.frozenFiltEnd = 0;
    session.frozenBounds = null;
    session.prevTailRect = null;
  }

  const pts = stroke.points;
  const rawLen = pts.length;
  const sx = tf.scaleX;
  const sy = tf.scaleY;
  const ox = tf.offsetX;
  const oy = tf.offsetY;
  const smoothLevel = stroke.smoothing ?? 0.66;
  const nibHeight = Math.max(8, stroke.size * tf.unitScale);
  const halfHeight = nibHeight * 0.5;
  const halfThick = Math.max(1.8, nibHeight * 0.13);
  const ux = -CHISEL_SIN * halfHeight;
  const uy = CHISEL_COS * halfHeight;
  const padCss = halfHeight + halfThick + 4;

  const needsReset =
    session.strokeId !== stroke.id ||
    session.color !== stroke.color ||
    session.size !== stroke.size ||
    session.smoothing !== smoothLevel ||
    session.scaleX !== sx ||
    session.scaleY !== sy ||
    session.offsetX !== ox ||
    session.offsetY !== oy;

  if (needsReset) {
    resetLivePenDraftSession(session);
    session.strokeId = stroke.id;
    session.color = stroke.color;
    session.size = stroke.size;
    session.smoothing = smoothLevel;
    session.scaleX = sx;
    session.scaleY = sy;
    session.offsetX = ox;
    session.offsetY = oy;
    session.unitScale = tf.unitScale;
    session.pw = pw;
    session.ph = ph;
    sCtx.save();
    sCtx.setTransform(1, 0, 0, 1, 0, 0);
    sCtx.clearRect(0, 0, pw, ph);
    sCtx.restore();
  }

  const minDistPx = smoothLevel > 0.05 ? 0.85 + smoothLevel * 1.15 : 0;
  const minDistSq = minDistPx * minDistPx;

  if (session.rawProcessed === 0 && rawLen > 0) {
    ensureSessionFiltCapacity(session, rawLen + 4);
    const p0 = pts[0];
    session.filtX[0] = p0.x * sx + ox;
    session.filtY[0] = p0.y * sy + oy;
    session.filtLen = 1;
    session.rawProcessed = 1;
  }

  while (session.rawProcessed < rawLen - 1) {
    const i = session.rawProcessed;
    const p = pts[i];
    const cx = p.x * sx + ox;
    const cy = p.y * sy + oy;
    let keep = false;
    if (minDistPx <= 0.1) {
      keep = true;
    } else {
      const lastX = session.filtX[session.filtLen - 1];
      const lastY = session.filtY[session.filtLen - 1];
      const dx = cx - lastX;
      const dy = cy - lastY;
      const l1Sq = dx * dx + dy * dy;
      if (l1Sq >= minDistSq) {
        keep = true;
      } else if (l1Sq > 0.64) {
        const np = pts[i + 1];
        const v2x = np.x * sx + ox - cx;
        const v2y = np.y * sy + oy - cy;
        const l2Sq = v2x * v2x + v2y * v2y;
        if (l2Sq > 0.64 && (dx * v2x + dy * v2y) / Math.sqrt(l1Sq * l2Sq) < 0.25) {
          keep = true;
        }
      }
    }
    if (keep) {
      ensureSessionFiltCapacity(session, session.filtLen + 4);
      session.filtX[session.filtLen] = cx;
      session.filtY[session.filtLen] = cy;
      session.filtLen++;
    }
    session.rawProcessed = i + 1;
  }

  const tip = pts[rawLen - 1];
  ensureSessionFiltCapacity(session, session.filtLen + 2);
  session.filtX[session.filtLen] = tip.x * sx + ox;
  session.filtY[session.filtLen] = tip.y * sy + oy;
  const totalFiltLen = session.filtLen + 1;

  if (totalFiltLen < 24 || !session.frozenCtx) {
    return renderHighlighterToScratch(scratchCanvas, stroke, tf, dprX, dprY, pw, ph, true);
  }

  const renderChiselSlice = (
    destCtx: CanvasRenderingContext2D,
    emitStartFilt: number,
    emitEndFilt: number,
    includeEndCaps: boolean
  ): PixelRect | null => {
    const winStart = emitStartFilt > 14 ? emitStartFilt - 14 : 0;
    const winEnd = emitEndFilt + 12 < totalFiltLen ? emitEndFilt + 12 : totalFiltLen - 1;
    const winLen = winEnd - winStart + 1;
    if (winLen < 2) return null;

    ensurePenKnotCapacity(winLen);
    for (let i = 0; i < winLen; i++) {
      knotRawX[i] = session.filtX[winStart + i];
      knotRawY[i] = session.filtY[winStart + i];
    }

    let srcX = knotRawX;
    let srcY = knotRawY;
    if (winLen >= 3 && smoothLevel > 0.02) {
      const clamped = smoothLevel < 0 ? 0 : smoothLevel > 1 ? 1 : smoothLevel;
      const passes = clamped >= 0.72 ? 4 : clamped >= 0.35 ? 3 : clamped >= 0.08 ? 2 : 0;
      const strength = 0.2 + clamped * 0.52;
      let dstX = knotSmAX;
      let dstY = knotSmAY;
      for (let pass = 0; pass < passes; pass++) {
        dstX[0] = srcX[0];
        dstY[0] = srcY[0];
        dstX[winLen - 1] = srcX[winLen - 1];
        dstY[winLen - 1] = srcY[winLen - 1];
        for (let i = 1; i < winLen - 1; i++) {
          const prevX = srcX[i - 1];
          const prevY = srcY[i - 1];
          const curX = srcX[i];
          const curY = srcY[i];
          const nextX = srcX[i + 1];
          const nextY = srcY[i + 1];

          let pBack = i - 1;
          while (pBack > 0 && Math.hypot(curX - srcX[pBack], curY - srcY[pBack]) < 5.0) {
            pBack--;
          }
          let pFwd = i + 1;
          while (pFwd < winLen - 1 && Math.hypot(srcX[pFwd] - curX, srcY[pFwd] - curY) < 5.0) {
            pFwd++;
          }
          const v1x = curX - srcX[pBack];
          const v1y = curY - srcY[pBack];
          const v2x = srcX[pFwd] - curX;
          const v2y = srcY[pFwd] - curY;
          const l1Sq = v1x * v1x + v1y * v1y;
          const l2Sq = v2x * v2x + v2y * v2y;
          let cf = 1.0;
          if (l1Sq > 0.000001 && l2Sq > 0.000001) {
            const dot = (v1x * v2x + v1y * v2y) / Math.sqrt(l1Sq * l2Sq);
            cf = Math.max(0.08, Math.min(1.0, (dot + 0.15) / 0.85));
          }

          let tx: number;
          let ty: number;
          if (i >= 2 && i <= winLen - 3) {
            tx =
              0.08 * srcX[i - 2] +
              0.22 * prevX +
              0.4 * curX +
              0.22 * nextX +
              0.08 * srcX[i + 2];
            ty =
              0.08 * srcY[i - 2] +
              0.22 * prevY +
              0.4 * curY +
              0.22 * nextY +
              0.08 * srcY[i + 2];
          } else {
            tx = 0.25 * prevX + 0.5 * curX + 0.25 * nextX;
            ty = 0.25 * prevY + 0.5 * curY + 0.25 * nextY;
          }
          const alpha = strength * cf;
          dstX[i] = curX + (tx - curX) * alpha;
          dstY[i] = curY + (ty - curY) * alpha;
        }
        srcX = dstX;
        srcY = dstY;
        dstX = srcX === knotSmAX ? knotSmBX : knotSmAX;
        dstY = srcY === knotSmAY ? knotSmBY : knotSmAY;
      }
    }

    ensurePenDenseCapacity(winLen * 4 + 16);
    denseX[0] = srcX[0];
    denseY[0] = srcY[0];
    let n = 1;
    let prevMidX = srcX[0];
    let prevMidY = srcY[0];
    const relEmitStart = emitStartFilt - winStart;
    const relEmitEnd = emitEndFilt - winStart;
    let splitStart = relEmitStart <= 0 ? 0 : -1;
    let splitEnd = -1;

    for (let i = 1; i < winLen; i++) {
      const ctrlX = srcX[i - 1];
      const ctrlY = srcY[i - 1];
      const curX = srcX[i];
      const curY = srcY[i];
      const isGlobalLast = winStart + i === totalFiltLen - 1;
      const endX = isGlobalLast ? curX : (ctrlX + curX) * 0.5;
      const endY = isGlobalLast ? curY : (ctrlY + curY) * 0.5;
      const approxLen =
        Math.hypot(ctrlX - prevMidX, ctrlY - prevMidY) + Math.hypot(endX - ctrlX, endY - ctrlY);
      const steps = Math.max(1, Math.ceil(approxLen / 2.4));
      if (n + steps + 2 > penDenseCap) {
        ensurePenDenseCapacity(n + steps + 64);
      }
      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        const inv = 1 - u;
        denseX[n] = inv * inv * prevMidX + 2 * inv * u * ctrlX + u * u * endX;
        denseY[n] = inv * inv * prevMidY + 2 * inv * u * ctrlY + u * u * endY;
        n++;
      }
      if (i === relEmitStart) splitStart = n - 1;
      if (i === relEmitEnd) splitEnd = n - 1;
      prevMidX = endX;
      prevMidY = endY;
    }

    if (splitStart < 0) splitStart = 0;
    if (splitEnd < 0) splitEnd = n - 1;
    if (splitEnd <= splitStart || n < 2) return null;

    const drawStart = emitStartFilt > 0 && splitStart > 0 ? splitStart - 1 : splitStart;
    const drawEnd = splitEnd;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    destCtx.save();
    destCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
    destCtx.fillStyle = stroke.color;
    destCtx.strokeStyle = stroke.color;
    destCtx.globalAlpha = 1;

    if (emitStartFilt === 0) {
      drawChiselNib(destCtx, denseX[drawStart], denseY[drawStart], halfThick, halfHeight);
    }
    if (includeEndCaps) {
      drawChiselNib(destCtx, denseX[drawEnd], denseY[drawEnd], halfThick, halfHeight);
    }

    destCtx.beginPath();
    let hasVert = false;
    for (let i = drawStart; i < drawEnd; i++) {
      const ax = denseX[i];
      const ay = denseY[i];
      const bx = denseX[i + 1];
      const by = denseY[i + 1];
      if (ax < minX) minX = ax;
      if (ax > maxX) maxX = ax;
      if (ay < minY) minY = ay;
      if (ay > maxY) maxY = ay;
      if (bx < minX) minX = bx;
      if (bx > maxX) maxX = bx;
      if (by < minY) minY = by;
      if (by > maxY) maxY = by;

      const dx = bx - ax;
      const dy = by - ay;
      if (dx * uy - dy * ux >= 0) {
        destCtx.moveTo(ax + ux, ay + uy);
        destCtx.lineTo(bx + ux, by + uy);
        destCtx.lineTo(bx - ux, by - uy);
        destCtx.lineTo(ax - ux, ay - uy);
      } else {
        destCtx.moveTo(ax - ux, ay - uy);
        destCtx.lineTo(bx - ux, by - uy);
        destCtx.lineTo(bx + ux, by + uy);
        destCtx.lineTo(ax + ux, ay + uy);
      }
      destCtx.closePath();

      if (!hasVert) {
        const lenSq = dx * dx + dy * dy;
        if (lenSq > 0.0001 && Math.abs(dx * uy - dy * ux) / (Math.sqrt(lenSq) * halfHeight) < 0.38) {
          hasVert = true;
        }
      }
    }
    destCtx.fill();

    // Fill tight bends / chisel-axis reversals cleanly without bevel notches
    if (drawEnd - drawStart >= 2) {
      for (let i = drawStart + 1; i < drawEnd; i++) {
        const v1x = denseX[i] - denseX[i - 1];
        const v1y = denseY[i] - denseY[i - 1];
        const v2x = denseX[i + 1] - denseX[i];
        const v2y = denseY[i + 1] - denseY[i];
        const l1Sq = v1x * v1x + v1y * v1y;
        const l2Sq = v2x * v2x + v2y * v2y;
        if (l1Sq > 0.0001 && l2Sq > 0.0001) {
          const dot = (v1x * v2x + v1y * v2y) / Math.sqrt(l1Sq * l2Sq);
          const s1 = v1x * uy - v1y * ux;
          const s2 = v2x * uy - v2y * ux;
          if (dot < 0.72 || s1 * s2 <= 0) {
            drawChiselNib(destCtx, denseX[i], denseY[i], halfThick, halfHeight);
          }
        }
      }
    }

    if (hasVert) {
      destCtx.beginPath();
      for (let i = drawStart; i < drawEnd; i++) {
        const ax = denseX[i];
        const ay = denseY[i];
        const bx = denseX[i + 1];
        const by = denseY[i + 1];
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (lenSq > 0.0001 && Math.abs(dx * uy - dy * ux) / (Math.sqrt(lenSq) * halfHeight) < 0.38) {
          destCtx.moveTo(ax, ay);
          destCtx.lineTo(bx, by);
        }
      }
      destCtx.lineWidth = halfThick * 2.05;
      destCtx.lineCap = 'round';
      destCtx.stroke();
    }
    destCtx.restore();

    if (!Number.isFinite(minX)) return null;
    return cssBoundsToPixelRect(
      { minX: minX - padCss, minY: minY - padCss, maxX: maxX + padCss, maxY: maxY + padCss },
      dprX,
      dprY,
      pw,
      ph
    );
  };

  // Freeze new settled prefix chunks incrementally
  const targetFreezeEnd = totalFiltLen - 13;
  if (
    targetFreezeEnd > session.frozenFiltEnd &&
    (session.frozenFiltEnd === 0 || targetFreezeEnd - session.frozenFiltEnd >= 10)
  ) {
    if (session.frozenFiltEnd === 0) {
      sCtx.save();
      sCtx.setTransform(1, 0, 0, 1, 0, 0);
      sCtx.clearRect(0, 0, pw, ph);
      sCtx.restore();
    }
    const chunkRect = renderChiselSlice(session.frozenCtx, session.frozenFiltEnd, targetFreezeEnd, false);
    if (chunkRect) {
      session.frozenBounds = unionPixelRects(session.frozenBounds, chunkRect);
      sCtx.save();
      sCtx.setTransform(1, 0, 0, 1, 0, 0);
      sCtx.clearRect(chunkRect.x, chunkRect.y, chunkRect.w, chunkRect.h);
      sCtx.drawImage(
        session.frozenCanvas,
        chunkRect.x,
        chunkRect.y,
        chunkRect.w,
        chunkRect.h,
        chunkRect.x,
        chunkRect.y,
        chunkRect.w,
        chunkRect.h
      );
      sCtx.restore();
    }
    session.frozenFiltEnd = targetFreezeEnd;
  }

  if (session.frozenFiltEnd === 0) {
    return renderHighlighterToScratch(scratchCanvas, stroke, tf, dprX, dprY, pw, ph, true);
  }

  // Restore ONLY prevTailRect from frozenCanvas onto scratchCanvas and paint ~9-knot tail
  const prevTail = session.prevTailRect;
  if (prevTail) {
    sCtx.save();
    sCtx.setTransform(1, 0, 0, 1, 0, 0);
    sCtx.clearRect(prevTail.x, prevTail.y, prevTail.w, prevTail.h);
    sCtx.drawImage(
      session.frozenCanvas,
      prevTail.x,
      prevTail.y,
      prevTail.w,
      prevTail.h,
      prevTail.x,
      prevTail.y,
      prevTail.w,
      prevTail.h
    );
    sCtx.restore();
  }

  const nextTailRect = renderChiselSlice(sCtx, session.frozenFiltEnd, totalFiltLen - 1, true);
  session.prevTailRect = nextTailRect;
  return unionPixelRects(session.frozenBounds, nextTailRect);
}

/**
 * Apple PencilKit-inspired Chisel-Tip Highlighter Renderer (High-Performance Studio Materiality).
 * Returns the tight device-pixel `PixelRect` dirtied by this stroke.
 */
export function drawAppleHighlighterStroke(
  destCtx: CanvasRenderingContext2D,
  scratchCanvas: HTMLCanvasElement,
  stroke: AnnotationStroke,
  tf: RenderTransform,
  dprX: number,
  dprY: number = dprX,
  isLiveDraft = false
): PixelRect | null {
  const wPx = destCtx.canvas.width;
  const hPx = destCtx.canvas.height;
  const rect = renderHighlighterToScratch(
    scratchCanvas,
    stroke,
    tf,
    dprX,
    dprY,
    wPx,
    hPx,
    isLiveDraft
  );
  if (!rect) return null;

  destCtx.save();
  destCtx.setTransform(1, 0, 0, 1, 0, 0);
  destCtx.globalCompositeOperation = 'multiply';
  destCtx.globalAlpha = stroke.opacity;
  destCtx.drawImage(scratchCanvas, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
  destCtx.restore();
  return rect;
}

/* ============================================================================
 * UNIVERSAL APPLE PENCILKIT HOLD-TO-SNAP SHAPE & CURVE RECOGNITION ENGINE
 * Recognizes:
 *   1. Straight Lines (with gentle H / V / 45° lock)
 *   2. Closed Shapes: Triangles, Rectangles / Squares / Diamonds, Pentagons / Hexagons,
 *      Circles & Rotated Ellipses (with rigorous geometric error competition!)
 *   3. Pointer Arrows (straight OR smoothly curved shafts!)
 *   4. Smooth Curved Lines / Arches / Curved Underlines (exact least-squares quadratic Bezier)
 *   5. Crisp Open Polylines (L-brackets, V-chevrons, checkmarks, Z-zig-zags)
 *   6. Idealized Smooth Freeform Curves (S-curves, waves, Arabic Mad flourishes)
 * ============================================================================ */

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function polylineLength(pts: Pt2D[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return total;
}

function resamplePolyline(pts: Pt2D[], count: number): Pt2D[] {
  if (pts.length <= 1 || count <= 1) return pts.slice();
  const totalLen = polylineLength(pts);
  if (totalLen < 0.001) return [pts[0]];

  const step = totalLen / (count - 1);
  const out: Pt2D[] = [{ x: pts[0].x, y: pts[0].y }];
  let accum = 0;
  let i = 1;
  let prev = pts[0];

  while (i < pts.length && out.length < count) {
    const curr = pts[i];
    const d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (accum + d >= step && d > 0.0001) {
      const ratio = (step - accum) / d;
      const nx = prev.x + (curr.x - prev.x) * ratio;
      const ny = prev.y + (curr.y - prev.y) * ratio;
      const np = { x: nx, y: ny };
      out.push(np);
      prev = np;
      accum = 0;
    } else {
      accum += d;
      prev = curr;
      i++;
    }
  }

  while (out.length < count) {
    const last = pts[pts.length - 1];
    out.push({ x: last.x, y: last.y });
  }
  return out;
}

function douglasPeucker(pts: Pt2D[], epsilon: number): Pt2D[] {
  if (pts.length <= 2) return pts.slice();
  const first = pts[0];
  const last = pts[pts.length - 1];
  let maxDist = -1;
  let maxIdx = 0;

  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i].x, pts[i].y, first.x, first.y, last.x, last.y);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(pts.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(pts.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function interiorAngleDeg(prev: Pt2D, curr: Pt2D, next: Pt2D): number {
  const v1x = prev.x - curr.x;
  const v1y = prev.y - curr.y;
  const v2x = next.x - curr.x;
  const v2y = next.y - curr.y;
  const l1 = Math.hypot(v1x, v1y);
  const l2 = Math.hypot(v2x, v2y);
  if (l1 < 0.001 || l2 < 0.001) return 180;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function cleanClosedVertices(rawVerts: Pt2D[], minEdgePx: number): Pt2D[] {
  let verts = rawVerts.slice();
  if (verts.length < 3) return verts;

  // Drop duplicate closing endpoint if present
  if (Math.hypot(verts[0].x - verts[verts.length - 1].x, verts[0].y - verts[verts.length - 1].y) < minEdgePx * 0.7) {
    verts.pop();
  }

  let changed = true;
  let guard = 0;
  while (changed && verts.length > 3 && guard < 12) {
    changed = false;
    guard++;

    // Merge short stub edges
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) < minEdgePx && verts.length > 3) {
        verts[i] = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
        verts.splice((i + 1) % verts.length, 1);
        changed = true;
        break;
      }
    }
    if (changed) continue;

    // Remove nearly collinear interior vertices (angle > 154 deg)
    for (let i = 0; i < verts.length; i++) {
      const prev = verts[(i - 1 + verts.length) % verts.length];
      const curr = verts[i];
      const next = verts[(i + 1) % verts.length];
      if (interiorAngleDeg(prev, curr, next) > 154 && verts.length > 3) {
        verts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return verts;
}

function measurePolylineFitError(
  samples: Pt2D[],
  vertices: Pt2D[],
  closed: boolean
): { mean: number; max: number } {
  let sum = 0;
  let max = 0;
  const segCount = closed ? vertices.length : vertices.length - 1;
  if (segCount <= 0) return { mean: Infinity, max: Infinity };

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    let best = Infinity;
    for (let j = 0; j < segCount; j++) {
      const a = vertices[j];
      const b = vertices[(j + 1) % vertices.length];
      const d = distToSegment(s.x, s.y, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
    }
    sum += best;
    if (best > max) max = best;
  }
  return { mean: sum / samples.length, max };
}

/**
 * Fits an exact closed-form least-squares quadratic Bezier B(t) = (1-t)^2 P0 + 2(1-t)t C + t^2 P2
 * with endpoints pinned at first & last points, plus gentle symmetry leveling for balanced arches.
 */
function fitQuadraticArc(samples: Pt2D[]): {
  p0: Pt2D;
  ctrl: Pt2D;
  p2: Pt2D;
  meanErr: number;
  maxErr: number;
  bow: number;
} {
  const n = samples.length;
  const p0 = samples[0];
  const p2 = samples[n - 1];

  const cumLen = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cumLen[i] = cumLen[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
  }
  const totalLen = Math.max(0.001, cumLen[n - 1]);

  let sumW2 = 0;
  let sumWX = 0;
  let sumWY = 0;

  for (let i = 1; i < n - 1; i++) {
    const t = cumLen[i] / totalLen;
    const inv = 1 - t;
    const w = 2 * inv * t;
    const rx = samples[i].x - inv * inv * p0.x - t * t * p2.x;
    const ry = samples[i].y - inv * inv * p0.y - t * t * p2.y;
    sumW2 += w * w;
    sumWX += w * rx;
    sumWY += w * ry;
  }

  let ctrl: Pt2D =
    sumW2 > 0.0001
      ? { x: sumWX / sumW2, y: sumWY / sumW2 }
      : { x: (p0.x + p2.x) * 0.5, y: (p0.y + p2.y) * 0.5 };

  const evalFit = (candidateCtrl: Pt2D): { meanErr: number; maxErr: number } => {
    const curvePts: Pt2D[] = [];
    const curveSteps = 44;
    for (let i = 0; i <= curveSteps; i++) {
      const t = i / curveSteps;
      const inv = 1 - t;
      curvePts.push({
        x: inv * inv * p0.x + 2 * inv * t * candidateCtrl.x + t * t * p2.x,
        y: inv * inv * p0.y + 2 * inv * t * candidateCtrl.y + t * t * p2.y,
      });
    }
    let errSum = 0;
    let errMax = 0;
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      let best = Infinity;
      for (let j = 0; j < curvePts.length - 1; j++) {
        const d = distToSegment(s.x, s.y, curvePts[j].x, curvePts[j].y, curvePts[j + 1].x, curvePts[j + 1].y);
        if (d < best) best = d;
      }
      errSum += best;
      if (best > errMax) errMax = best;
    }
    return { meanErr: errSum / n, maxErr: errMax };
  };

  let bestFit = evalFit(ctrl);

  // If the control point is nearly centered along the chord, prefer a clean symmetric arch
  const chordDx = p2.x - p0.x;
  const chordDy = p2.y - p0.y;
  const chordLen = Math.hypot(chordDx, chordDy);
  if (chordLen >= 18) {
    const ux = chordDx / chordLen;
    const uy = chordDy / chordLen;
    const midX = (p0.x + p2.x) * 0.5;
    const midY = (p0.y + p2.y) * 0.5;
    const cdx = ctrl.x - midX;
    const cdy = ctrl.y - midY;
    const parallel = cdx * ux + cdy * uy;
    const perp = -cdx * uy + cdy * ux;
    if (Math.abs(parallel) <= chordLen * 0.14 && Math.abs(perp) >= 4) {
      const symCtrl = { x: midX - uy * perp, y: midY + ux * perp };
      const symFit = evalFit(symCtrl);
      if (symFit.meanErr <= bestFit.meanErr * 1.12 + 0.85 && symFit.maxErr <= bestFit.maxErr * 1.16 + 1.5) {
        ctrl = symCtrl;
        bestFit = symFit;
      }
    }
  }

  // Midpoint bow perpendicular to chord P0 -> P2
  const midX = 0.25 * p0.x + 0.5 * ctrl.x + 0.25 * p2.x;
  const midY = 0.25 * p0.y + 0.5 * ctrl.y + 0.25 * p2.y;
  const bow = distToSegment(midX, midY, p0.x, p0.y, p2.x, p2.y);

  return {
    p0,
    ctrl,
    p2,
    meanErr: bestFit.meanErr,
    maxErr: bestFit.maxErr,
    bow,
  };
}

/**
 * Regularizes a 4-vertex closed polygon into a razor-sharp Rectangle / Square or Diamond
 * whenever the user's hand-drawn angles clearly intend one.
 */
function regularizeQuad(verts: Pt2D[], samples: Pt2D[]): Pt2D[] | null {
  const angles = [0, 1, 2, 3].map((i) =>
    interiorAngleDeg(verts[(i + 3) % 4], verts[i], verts[(i + 1) % 4])
  );
  const allNearRight = angles.every((a) => Math.abs(a - 90) <= 24);

  if (allNearRight) {
    // Dominant orientation of the longest edge
    let bestAngle = 0;
    let bestLen = -1;
    for (let i = 0; i < 4; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % 4];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > bestLen) {
        bestLen = len;
        bestAngle = Math.atan2(b.y - a.y, b.x - a.x);
      }
    }

    // Normalize orientation modulo 90° and snap gently to pure H/V (within 11°) or 45° (within 8°)
    let deg = ((bestAngle * 180) / Math.PI) % 90;
    if (deg < -45) deg += 90;
    if (deg > 45) deg -= 90;
    if (Math.abs(deg) <= 11) {
      deg = 0;
    } else if (Math.abs(Math.abs(deg) - 45) <= 8) {
      deg = deg > 0 ? 45 : -45;
    }
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of samples) {
      const u = p.x * cos + p.y * sin;
      const v = -p.x * sin + p.y * cos;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    let w = maxU - minU;
    let h = maxV - minV;
    const cu = (minU + maxU) * 0.5;
    const cv = (minV + maxV) * 0.5;

    // Snap near-squares to exact visual square
    if (Math.abs(w - h) / Math.max(w, h) < 0.14) {
      const side = (w + h) * 0.5;
      w = side;
      h = side;
    }

    const hw = w * 0.5;
    const hh = h * 0.5;
    const localCorners: Pt2D[] = [
      { x: cu - hw, y: cv - hh },
      { x: cu + hw, y: cv - hh },
      { x: cu + hw, y: cv + hh },
      { x: cu - hw, y: cv + hh },
    ];
    return localCorners.map((c) => ({
      x: c.x * cos - c.y * sin,
      y: c.x * sin + c.y * cos,
    }));
  }

  // Check for clean Diamond / Rhombus (nearly orthogonal diagonals, aligned or tilted cleanly)
  const d1x = verts[2].x - verts[0].x;
  const d1y = verts[2].y - verts[0].y;
  const d2x = verts[3].x - verts[1].x;
  const d2y = verts[3].y - verts[1].y;
  const l1 = Math.hypot(d1x, d1y);
  const l2 = Math.hypot(d2x, d2y);
  if (l1 > 12 && l2 > 12) {
    const diagDot = Math.abs((d1x * d2x + d1y * d2y) / (l1 * l2));
    if (diagDot < 0.22) {
      let cx = 0;
      let cy = 0;
      for (const v of verts) {
        cx += v.x;
        cy += v.y;
      }
      cx *= 0.25;
      cy *= 0.25;

      let uAngle = Math.atan2(d1y, d1x);
      // Softly level nearly H/V diagonals within 11°
      let deg = ((uAngle * 180) / Math.PI) % 90;
      if (deg < -45) deg += 90;
      if (deg > 45) deg -= 90;
      if (Math.abs(deg) <= 11) {
        uAngle -= (deg * Math.PI) / 180;
      }
      const ux = Math.cos(uAngle);
      const uy = Math.sin(uAngle);
      const vSign = d2x * -uy + d2y * ux >= 0 ? 1 : -1;
      const vx = -uy * vSign;
      const vy = ux * vSign;

      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (const p of samples) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const pu = dx * ux + dy * uy;
        const pv = dx * vx + dy * vy;
        if (pu < minU) minU = pu;
        if (pu > maxU) maxU = pu;
        if (pv < minV) minV = pv;
        if (pv > maxV) maxV = pv;
      }
      const ncx = cx + ux * ((minU + maxU) * 0.5) + vx * ((minV + maxV) * 0.5);
      const ncy = cy + uy * ((minU + maxU) * 0.5) + vy * ((minV + maxV) * 0.5);
      let rx = (maxU - minU) * 0.5;
      let ry = (maxV - minV) * 0.5;
      if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.13) {
        const eq = (rx + ry) * 0.5;
        rx = eq;
        ry = eq;
      }
      const cand: Pt2D[] = [
        { x: ncx - ux * rx, y: ncy - uy * rx },
        { x: ncx + vx * ry, y: ncy + vy * ry },
        { x: ncx + ux * rx, y: ncy + uy * rx },
        { x: ncx - vx * ry, y: ncy - vy * ry },
      ];
      const rawErr = measurePolylineFitError(samples, verts, true).mean;
      const diaErr = measurePolylineFitError(samples, cand, true).mean;
      if (diaErr <= rawErr * 1.18) {
        return cand;
      }
    }
  }

  // Reject arbitrary irregular/skewed 4-gons so we never invent weird shapes
  return null;
}

function arePolylineEdgesStraight(
  samples: Pt2D[],
  vertices: Pt2D[],
  closed: boolean,
  maxEdgeDevRatio = 0.14
): boolean {
  const segCount = closed ? vertices.length : vertices.length - 1;
  if (segCount <= 0) return false;
  const maxDevs = new Array<number>(segCount).fill(0);
  const counts = new Array<number>(segCount).fill(0);

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let j = 0; j < segCount; j++) {
      const a = vertices[j];
      const b = vertices[(j + 1) % vertices.length];
      const d = distToSegment(s.x, s.y, a.x, a.y, b.x, b.y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = j;
      }
    }
    counts[bestIdx]++;
    if (bestDist > maxDevs[bestIdx]) maxDevs[bestIdx] = bestDist;
  }

  for (let j = 0; j < segCount; j++) {
    const a = vertices[j];
    const b = vertices[(j + 1) % vertices.length];
    const edgeLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (edgeLen < 12 || counts[j] === 0) return false;
    if (maxDevs[j] > Math.max(7.0, edgeLen * maxEdgeDevRatio)) return false;
  }
  return true;
}

/**
 * Levels near-horizontal/vertical edges, snaps clean equilateral (60-60-60) & right-angle triangles,
 * and balances near-isosceles triangles when two legs are clearly close in length.
 */
function regularizeTriangle(verts: Pt2D[]): Pt2D[] {
  const out = verts.map((v) => ({ ...v }));
  const sideLens = [0, 1, 2].map((i) =>
    Math.hypot(out[(i + 1) % 3].x - out[i].x, out[(i + 1) % 3].y - out[i].y)
  );
  const avgSide = (sideLens[0] + sideLens[1] + sideLens[2]) / 3;
  const maxSide = Math.max(sideLens[0], sideLens[1], sideLens[2]);
  const minSide = Math.min(sideLens[0], sideLens[1], sideLens[2]);
  const triAngles = [0, 1, 2].map((i) =>
    interiorAngleDeg(out[(i + 2) % 3], out[i], out[(i + 1) % 3])
  );

  // 1. Equilateral Triangle (60-60-60) detent
  if (
    avgSide >= 16 &&
    (maxSide - minSide) / avgSide <= 0.18 &&
    triAngles.every((a) => Math.abs(a - 60) <= 13)
  ) {
    const cx = (out[0].x + out[1].x + out[2].x) / 3;
    const cy = (out[0].y + out[1].y + out[2].y) / 3;
    let signedArea2 = 0;
    for (let i = 0; i < 3; i++) {
      const a = out[i];
      const b = out[(i + 1) % 3];
      signedArea2 += a.x * b.y - b.x * a.y;
    }
    const dir = signedArea2 >= 0 ? 1 : -1;
    const r =
      (Math.hypot(out[0].x - cx, out[0].y - cy) +
        Math.hypot(out[1].x - cx, out[1].y - cy) +
        Math.hypot(out[2].x - cx, out[2].y - cy)) /
      3;
    const step = (Math.PI * 2) / 3;
    let sumC = 0;
    let sumS = 0;
    for (let i = 0; i < 3; i++) {
      const ang = Math.atan2(out[i].y - cy, out[i].x - cx) - dir * i * step;
      sumC += Math.cos(ang);
      sumS += Math.sin(ang);
    }
    let theta0 = Math.atan2(sumS, sumC);
    const edgeShift = dir * (step * 0.5 + Math.PI * 0.5);
    let bestErr = Infinity;
    for (let i = 0; i < 3; i++) {
      const eAng = theta0 + dir * i * step + edgeShift;
      const nearest90 = Math.round(eAng / (Math.PI / 2)) * (Math.PI / 2);
      const err = normalizeAngleRad(nearest90 - eAng);
      if (Math.abs(err) < Math.abs(bestErr)) bestErr = err;
    }
    if (Math.abs(bestErr) <= (8.5 * Math.PI) / 180) {
      theta0 += bestErr;
    }
    return [0, 1, 2].map((i) => {
      const ang = theta0 + dir * i * step;
      return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
    });
  }

  let leveledEdgeIdx = -1;
  for (let i = 0; i < 3; i++) {
    const a = out[i];
    const b = out[(i + 1) % 3];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 10) continue;
    const deg = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
    if (deg <= 8.5 || Math.abs(deg - 180) <= 8.5) {
      const avgY = (a.y + b.y) * 0.5;
      a.y = avgY;
      b.y = avgY;
      leveledEdgeIdx = i;
      break;
    }
    if (Math.abs(deg - 90) <= 8.5) {
      const avgX = (a.x + b.x) * 0.5;
      a.x = avgX;
      b.x = avgX;
      leveledEdgeIdx = i;
      break;
    }
  }

  // 2. Check if any vertex is clearly intended as a 90° corner or isosceles apex
  for (let i = 0; i < 3; i++) {
    const prev = out[(i + 2) % 3];
    const curr = out[i];
    const next = out[(i + 1) % 3];
    const l1 = Math.hypot(prev.x - curr.x, prev.y - curr.y);
    const l2 = Math.hypot(next.x - curr.x, next.y - curr.y);
    if (l1 < 12 || l2 < 12) continue;

    const ang = interiorAngleDeg(prev, curr, next);
    if (Math.abs(ang - 90) <= 8.5) {
      // If one leg of the right corner was already H/V leveled, keep that leg straight & align the other leg cleanly
      const prevEdgeIdx = (i + 2) % 3;
      if (leveledEdgeIdx === i || leveledEdgeIdx === prevEdgeIdx) {
        const fixedOther = leveledEdgeIdx === i ? next : prev;
        const movingOther = leveledEdgeIdx === i ? prev : next;
        const legDx = fixedOther.x - curr.x;
        const legDy = fixedOther.y - curr.y;
        const legLen = Math.hypot(legDx, legDy);
        if (legLen >= 10) {
          const ux = legDx / legLen;
          const uy = legDy / legLen;
          const nx = -uy;
          const ny = ux;
          const projPerp = (movingOther.x - curr.x) * nx + (movingOther.y - curr.y) * ny;
          const mIdx = leveledEdgeIdx === i ? (i + 2) % 3 : (i + 1) % 3;
          out[mIdx] = { x: curr.x + nx * projPerp, y: curr.y + ny * projPerp };
          break;
        }
      }

      // Snap right-triangle legs perpendicular while preserving hypotenuse endpoints
      const bx = next.x - prev.x;
      const by = next.y - prev.y;
      const bLen = Math.hypot(bx, by);
      if (bLen > 12) {
        const mx = (prev.x + next.x) * 0.5;
        const my = (prev.y + next.y) * 0.5;
        const ux = bx / bLen;
        const uy = by / bLen;
        const r = bLen * 0.5;
        const cx = curr.x - mx;
        const cy = curr.y - my;
        const cAngle = Math.atan2(cy, cx);
        const legRatio = l1 / l2;
        if (legRatio >= 0.84 && legRatio <= 1.19) {
          const side = cx * -uy + cy * ux >= 0 ? 1 : -1;
          out[i] = { x: mx - uy * side * r, y: my + ux * side * r };
        } else {
          out[i] = { x: mx + Math.cos(cAngle) * r, y: my + Math.sin(cAngle) * r };
        }
      }
      break;
    }

    if (Math.abs(l1 - l2) / Math.max(l1, l2) <= 0.16) {
      const bx = next.x - prev.x;
      const by = next.y - prev.y;
      const bLen = Math.hypot(bx, by);
      if (bLen > 12) {
        const ux = bx / bLen;
        const uy = by / bLen;
        const nx = -uy;
        const ny = ux;
        const mx = (prev.x + next.x) * 0.5;
        const my = (prev.y + next.y) * 0.5;
        const projPerp = (curr.x - mx) * nx + (curr.y - my) * ny;
        out[i] = { x: mx + nx * projPerp, y: my + ny * projPerp };
        break;
      }
    }
  }

  return out;
}

/**
 * Corner-curvature oriented bounding box candidate for quick rectangles with rounded corners
 * where pure Douglas-Peucker distance thresholding might miss or round corners into polygons/ovals.
 * Uses trimmed wall fitting so outward single-bump hand noise doesn't bloat the rectangle.
 */
function buildCornerCurvatureQuadCandidate(contour: Pt2D[]): Pt2D[] | null {
  const n = contour.length;
  if (n < 16) return null;

  let sumCos = 0;
  let sumSin = 0;
  let totalLen = 0;
  const stride = Math.max(2, Math.floor(n / 24));
  for (let i = 0; i < n; i++) {
    const a = contour[i];
    const b = contour[(i + stride) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) continue;
    const theta4 = Math.atan2(dy, dx) * 4;
    sumCos += Math.cos(theta4) * len;
    sumSin += Math.sin(theta4) * len;
    totalLen += len;
  }
  if (totalLen < 12) return null;

  const strength = Math.hypot(sumCos, sumSin) / totalLen;
  if (strength < 0.56) return null;

  let deg = ((Math.atan2(sumSin, sumCos) / 4) * 180) / Math.PI;
  if (deg < -45) deg += 90;
  if (deg > 45) deg -= 90;
  if (Math.abs(deg) <= 10) deg = 0;
  else if (Math.abs(Math.abs(deg) - 45) <= 7.5) deg = deg > 0 ? 45 : -45;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const uVals = new Array<number>(n);
  const vVals = new Array<number>(n);
  let rawMinU = Infinity;
  let rawMaxU = -Infinity;
  let rawMinV = Infinity;
  let rawMaxV = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = contour[i];
    const u = p.x * cos + p.y * sin;
    const v = -p.x * sin + p.y * cos;
    uVals[i] = u;
    vVals[i] = v;
    if (u < rawMinU) rawMinU = u;
    if (u > rawMaxU) rawMaxU = u;
    if (v < rawMinV) rawMinV = v;
    if (v > rawMaxV) rawMaxV = v;
  }

  const rawW = rawMaxU - rawMinU;
  const rawH = rawMaxV - rawMinV;
  if (rawW < 14 || rawH < 14) return null;

  // Mean along each wall band (middle 60% of perpendicular span) avoids corner-rounding & outer-bump bias
  const avgWall = (vals: number[], perpVals: number[], perpMid: number, perpHalf: number, isMin: boolean, extremum: number, span: number) => {
    const band = Math.max(4, span * 0.16);
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < vals.length; i++) {
      if (Math.abs(perpVals[i] - perpMid) > perpHalf * 0.72) continue;
      if (isMin ? vals[i] <= extremum + band : vals[i] >= extremum - band) {
        sum += vals[i];
        cnt++;
      }
    }
    return cnt >= 3 ? sum / cnt : extremum;
  };

  const midU = (rawMinU + rawMaxU) * 0.5;
  const midV = (rawMinV + rawMaxV) * 0.5;
  const minU = avgWall(uVals, vVals, midV, rawH * 0.5, true, rawMinU, rawW);
  const maxU = avgWall(uVals, vVals, midV, rawH * 0.5, false, rawMaxU, rawW);
  const minV = avgWall(vVals, uVals, midU, rawW * 0.5, true, rawMinV, rawH);
  const maxV = avgWall(vVals, uVals, midU, rawW * 0.5, false, rawMaxV, rawH);

  let w = maxU - minU;
  let h = maxV - minV;
  const cu = (minU + maxU) * 0.5;
  const cv = (minV + maxV) * 0.5;
  if (w < 14 || h < 14) return null;

  if (Math.abs(w - h) / Math.max(w, h) < 0.14) {
    const side = (w + h) * 0.5;
    w = side;
    h = side;
  }
  const hw = w * 0.5;
  const hh = h * 0.5;
  const local: Pt2D[] = [
    { x: cu - hw, y: cv - hh },
    { x: cu + hw, y: cv - hh },
    { x: cu + hw, y: cv + hh },
    { x: cu - hw, y: cv + hh },
  ];
  return local.map((c) => ({
    x: c.x * cos - c.y * sin,
    y: c.x * sin + c.y * cos,
  }));
}

/**
 * Recognizes a hand-drawn calligraphic curly brace (`{`, `}`, `︷`, `︸`).
 */
function tryDetectCurlyBrace(rawPts: Pt2D[], uniform: Pt2D[], scaleX: number, scaleY: number): AnnotationShape | null {
  const first = rawPts[0];
  const last = rawPts[rawPts.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 34) return null;

  const ux = dx / chord;
  const uy = dy / chord;
  const nx = -uy;
  const ny = ux;

  // Measure signed perpendicular excursions & peak cusp near the middle
  let maxPos = 0;
  let maxNeg = 0;
  let absMaxVal = 0;
  let absMaxIdx = -1;

  for (let i = 0; i < uniform.length; i++) {
    const px = uniform[i].x - first.x;
    const py = uniform[i].y - first.y;
    const perp = px * nx + py * ny;
    if (perp > maxPos) maxPos = perp;
    if (perp < maxNeg) maxNeg = perp;
    if (Math.abs(perp) > absMaxVal) {
      absMaxVal = Math.abs(perp);
      absMaxIdx = i;
    }
  }

  // Must lean predominantly to ONE side of the chord with significant depth
  if (absMaxVal < Math.max(10, chord * 0.1) || absMaxVal > chord * 0.65) return null;
  const oppSide = maxPos >= Math.abs(maxNeg) ? Math.abs(maxNeg) : maxPos;
  if (oppSide > absMaxVal * 0.32) return null;

  const signedDepth = maxPos >= Math.abs(maxNeg) ? absMaxVal : -absMaxVal;
  const peakProj = ((uniform[absMaxIdx].x - first.x) * ux + (uniform[absMaxIdx].y - first.y) * uy) / chord;
  if (peakProj < 0.30 || peakProj > 0.70) return null;

  // Check waist concavity on both shoulders (a curly brace dips slightly inward before flaring to middle cusp)
  let p0x = first.x;
  let p0y = first.y;
  let p2x = last.x;
  let p2y = last.y;
  const deg = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
  if (deg <= 6.5 || Math.abs(deg - 180) <= 6.5) {
    const avgY = (p0y + p2y) * 0.5;
    p0y = avgY;
    p2y = avgY;
  } else if (Math.abs(deg - 90) <= 6.5) {
    const avgX = (p0x + p2x) * 0.5;
    p0x = avgX;
    p2x = avgX;
  }

  const ideal = sampleBracePointsPx(p0x, p0y, p2x, p2y, signedDepth, 16);
  const arcFit = fitQuadraticArc(uniform);
  const braceErr = measurePolylineFitError(uniform, ideal, false);

  // Curly brace must fit significantly closer than a simple rounded C-arch
  if (
    braceErr.mean <= Math.max(6.5, chord * 0.08) &&
    braceErr.max <= Math.max(14, chord * 0.18) &&
    braceErr.mean < arcFit.meanErr * 0.76
  ) {
    const unitScale = (scaleX + scaleY) * 0.5 || 1;
    const clampedDepth = Math.sign(signedDepth) * Math.max(11, Math.min(chord * 0.42, Math.abs(signedDepth)));
    return {
      type: 'brace',
      x1: p0x / scaleX,
      y1: p0y / scaleY,
      x2: p2x / scaleX,
      y2: p2y / scaleY,
      depth: clampedDepth / unitScale,
    };
  }
  return null;
}

/**
 * Recognizes a balanced hand-drawn checkmark (`✓` or mirrored RTL `✓`) when paused briefly.
 */
function tryDetectCheckmark(rawPts: Pt2D[], uniform: Pt2D[], scaleX: number, scaleY: number): AnnotationShape | null {
  const first = rawPts[0];
  const last = rawPts[rawPts.length - 1];
  const n = uniform.length;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of rawPts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  if (diag < 24 || diag > 260) return null;

  // Find lowest valley point (largest Y)
  let valleyIdx = -1;
  let maxPy = -Infinity;
  for (let i = Math.floor(n * 0.14); i <= Math.floor(n * 0.62); i++) {
    if (uniform[i].y > maxPy) {
      maxPy = uniform[i].y;
      valleyIdx = i;
    }
  }
  if (valleyIdx === -1) return null;

  const valley = uniform[valleyIdx];
  const leg1 = uniform.slice(0, valleyIdx + 1);
  const leg2 = uniform.slice(valleyIdx);
  const leg1Direct = Math.hypot(valley.x - first.x, valley.y - first.y);
  const leg2Direct = Math.hypot(last.x - valley.x, last.y - valley.y);

  // Checkmark: goes down into valley, then rises taller to finish near or above start height
  if (valley.y - first.y < 8 || valley.y - last.y < 14) return null;
  if (leg1Direct < 9 || leg2Direct < 18) return null;
  const ratio = leg1Direct / leg2Direct;
  if (ratio < 0.20 || ratio > 0.72) return null;

  // Must progress monotonically in X cleanly (either LTR or RTL mirror checkmark)
  const dx1 = valley.x - first.x;
  const dx2 = last.x - valley.x;
  if (dx1 * dx2 < -4) return null;
  if (Math.abs(last.x - first.x) < diag * 0.32) return null;

  const ang = interiorAngleDeg(first, valley, last);
  if (ang < 32 || ang > 112) return null;

  const fit = measurePolylineFitError(uniform, [first, valley, last], false);
  if (fit.mean > Math.max(5.5, diag * 0.055) || fit.max > Math.max(11, diag * 0.115)) {
    return null;
  }

  // Regularize wings softly for an Apple-crisp balanced checkmark
  const l1MaxErr = leg1.reduce((m, p) => Math.max(m, distToSegment(p.x, p.y, first.x, first.y, valley.x, valley.y)), 0);
  const l2MaxErr = leg2.reduce((m, p) => Math.max(m, distToSegment(p.x, p.y, valley.x, valley.y, last.x, last.y)), 0);
  if (l1MaxErr > Math.max(7, leg1Direct * 0.22) || l2MaxErr > Math.max(9, leg2Direct * 0.16)) {
    return null;
  }

  return {
    type: 'polygon',
    points: [
      { x: first.x / scaleX, y: first.y / scaleY },
      { x: valley.x / scaleX, y: valley.y / scaleY },
      { x: last.x / scaleX, y: last.y / scaleY },
    ],
    closed: false,
  };
}

function splitQuadraticShaftAtTuck(
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  tuckPx: number
): { cx: number; cy: number; ex: number; ey: number } {
  const approxLen = Math.hypot(cx - x1, cy - y1) + Math.hypot(x2 - cx, y2 - cy);
  if (approxLen <= 4 || tuckPx <= 0.1) {
    return { cx, cy, ex: x2, ey: y2 };
  }
  const u = Math.max(0.62, Math.min(0.995, 1 - tuckPx / approxLen));
  const inv = 1 - u;
  return {
    cx: inv * x1 + u * cx,
    cy: inv * y1 + u * cy,
    ex: inv * inv * x1 + 2 * inv * u * cx + u * u * x2,
    ey: inv * inv * y1 + 2 * inv * u * cy + u * u * y2,
  };
}

function computeAppleArrowGeometry(
  tipX: number,
  tipY: number,
  leftX: number,
  leftY: number,
  rightX: number,
  rightY: number,
  strokeWidth: number
): {
  ux: number;
  uy: number;
  axisLen: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  lCtrlX: number;
  lCtrlY: number;
  rCtrlX: number;
  rCtrlY: number;
} {
  const rawMidX = (leftX + rightX) * 0.5;
  const rawMidY = (leftY + rightY) * 0.5;
  const axisX = tipX - rawMidX;
  const axisY = tipY - rawMidY;
  const rawAxisLen = Math.hypot(axisX, axisY) || 1;
  const ux = axisX / rawAxisLen;
  const uy = axisY / rawAxisLen;

  const storedWingLen = Math.hypot(leftX - tipX, leftY - tipY) || 1;
  const minVisualWingLen = strokeWidth > 0 ? Math.min(36, Math.max(13, strokeWidth * 3.1)) : storedWingLen;
  const scale = Math.max(1, Math.min(1.85, minVisualWingLen / storedWingLen));

  const lx = tipX + (leftX - tipX) * scale;
  const ly = tipY + (leftY - tipY) * scale;
  const rx = tipX + (rightX - tipX) * scale;
  const ry = tipY + (rightY - tipY) * scale;
  const baseMidX = (lx + rx) * 0.5;
  const baseMidY = (ly + ry) * 0.5;
  const axisLen = rawAxisLen * scale;

  return {
    ux,
    uy,
    axisLen,
    lx,
    ly,
    rx,
    ry,
    lCtrlX: tipX + (lx - tipX) * 0.46 + (baseMidX - lx) * 0.16 + ux * (axisLen * 0.03),
    lCtrlY: tipY + (ly - tipY) * 0.46 + (baseMidY - ly) * 0.16 + uy * (axisLen * 0.03),
    rCtrlX: tipX + (rx - tipX) * 0.46 + (baseMidX - rx) * 0.16 + ux * (axisLen * 0.03),
    rCtrlY: tipY + (ry - tipY) * 0.46 + (baseMidY - ry) * 0.16 + uy * (axisLen * 0.03),
  };
}

function calibrateArrowHeadLen(shaftLen: number, rawHookSpan: number): number {
  const ideal = Math.max(14, Math.min(28, shaftLen * 0.21));
  const raw = rawHookSpan > 0 ? rawHookSpan : ideal;
  return Math.max(13, Math.min(30, ideal * 0.62 + raw * 0.38));
}

function buildArrowWings(
  tip: Pt2D,
  inTangentX: number,
  inTangentY: number,
  headLen: number
): { left: Pt2D; right: Pt2D } {
  const len = Math.hypot(inTangentX, inTangentY) || 1;
  const ux = inTangentX / len;
  const uy = inTangentY / len;
  const wingAngle = (28.5 * Math.PI) / 180;
  const cos = Math.cos(wingAngle);
  const sin = Math.sin(wingAngle);
  // Reverse direction pointing backward along incoming shaft
  const rx = -ux;
  const ry = -uy;
  return {
    left: {
      x: tip.x + (rx * cos - ry * sin) * headLen,
      y: tip.y + (rx * sin + ry * cos) * headLen,
    },
    right: {
      x: tip.x + (rx * cos + ry * sin) * headLen,
      y: tip.y + (-rx * sin + ry * cos) * headLen,
    },
  };
}

function tryBuildArrowFromShaftAndHead(
  shaftPts: Pt2D[],
  headPts: Pt2D[],
  tip: Pt2D,
  requireTwoSidesOrAcuteStart: boolean,
  scaleX: number,
  scaleY: number
): AnnotationShape | null {
  if (shaftPts.length < 3 || headPts.length < 3) return null;

  const tail = shaftPts[0];
  const shaftLen = polylineLength(shaftPts);
  const shaftDirect = Math.hypot(tip.x - tail.x, tip.y - tail.y);
  if (shaftLen < 26 || shaftDirect < 24) return null;
  // Tightly curled/looping shafts are organic spirals/circles, never curved arrows
  if (shaftLen > shaftDirect * 1.48) return null;

  let shaftMaxLineDev = 0;
  for (let i = 1; i < shaftPts.length - 1; i++) {
    const d = distToSegment(shaftPts[i].x, shaftPts[i].y, tail.x, tail.y, tip.x, tip.y);
    if (d > shaftMaxLineDev) shaftMaxLineDev = d;
  }

  const isStraightShaft = shaftMaxLineDev <= Math.max(10.5, shaftDirect * 0.085);
  let shaftArc: ReturnType<typeof fitQuadraticArc> | null = null;
  if (!isStraightShaft) {
    shaftArc = fitQuadraticArc(shaftPts);
    if (
      shaftArc.maxErr > Math.max(16.5, shaftLen * 0.135) ||
      shaftArc.meanErr > Math.max(8, shaftLen * 0.062)
    ) {
      return null;
    }
  }

  const tanX = isStraightShaft ? tip.x - tail.x : tip.x - shaftArc!.ctrl.x;
  const tanY = isStraightShaft ? tip.y - tail.y : tip.y - shaftArc!.ctrl.y;
  const tanLen = Math.hypot(tanX, tanY);
  if (tanLen < 2) return null;
  const ux = tanX / tanLen;
  const uy = tanY / tanLen;

  const headPathLen = polylineLength(headPts);
  let maxHeadDist = 0;
  let maxBackExtent = 0;
  let maxPerpExtent = 0;
  let hasLeftSide = false;
  let hasRightSide = false;

  for (let i = 0; i < headPts.length; i++) {
    const vx = headPts[i].x - tip.x;
    const vy = headPts[i].y - tip.y;
    const d = Math.hypot(vx, vy);
    if (d > maxHeadDist) maxHeadDist = d;
    const back = -(vx * ux + vy * uy);
    if (back > maxBackExtent) maxBackExtent = back;
    const perp = -vx * uy + vy * ux;
    const absPerp = Math.abs(perp);
    if (absPerp > maxPerpExtent) maxPerpExtent = absPerp;
    if (d >= 4) {
      if (perp >= 2.8) hasLeftSide = true;
      if (perp <= -2.8) hasRightSide = true;
    }
  }

  if (maxHeadDist < 9 || maxHeadDist > Math.min(72, shaftLen * 0.55)) return null;
  if (headPathLen > maxHeadDist * 3.6 + 12) return null;
  if (maxBackExtent < maxHeadDist * 0.5) return null;

  const hasBothSides = hasLeftSide && hasRightSide;
  if (!hasBothSides) {
    if (maxPerpExtent < maxHeadDist * 0.22) return null;
    if (requireTwoSidesOrAcuteStart && maxBackExtent < maxHeadDist * 0.66) return null;
  }

  const headLen = calibrateArrowHeadLen(shaftDirect, maxHeadDist * 0.9);

  if (isStraightShaft) {
    let tipX = tip.x;
    let tipY = tip.y;
    const deg = Math.abs((Math.atan2(tip.y - tail.y, tip.x - tail.x) * 180) / Math.PI);
    if (deg <= 4.5 || Math.abs(deg - 180) <= 4.5) tipY = tail.y;
    else if (Math.abs(deg - 90) <= 4.5) tipX = tail.x;
    const adjTip = { x: tipX, y: tipY };
    const wings = buildArrowWings(adjTip, tipX - tail.x, tipY - tail.y, headLen);
    return {
      type: 'arrow',
      x1: tail.x / scaleX,
      y1: tail.y / scaleY,
      x2: adjTip.x / scaleX,
      y2: adjTip.y / scaleY,
      leftX: wings.left.x / scaleX,
      leftY: wings.left.y / scaleY,
      rightX: wings.right.x / scaleX,
      rightY: wings.right.y / scaleY,
    };
  }

  const wings = buildArrowWings(tip, tanX, tanY, headLen);
  return {
    type: 'arrow',
    x1: tail.x / scaleX,
    y1: tail.y / scaleY,
    cx: shaftArc!.ctrl.x / scaleX,
    cy: shaftArc!.ctrl.y / scaleY,
    x2: tip.x / scaleX,
    y2: tip.y / scaleY,
    leftX: wings.left.x / scaleX,
    leftY: wings.left.y / scaleY,
    rightX: wings.right.x / scaleX,
    rightY: wings.right.y / scaleY,
  };
}

/**
 * Recognizes a continuous single-stroke bidirectional arrow (`<--->`).
 */
function tryDetectSingleStrokeBidirectionalArrow(
  uniform: Pt2D[],
  scaleX: number,
  scaleY: number
): AnnotationShape | null {
  const n = uniform.length;
  if (n < 18) return null;

  const findTurnCandidates = (minIdx: number, maxIdx: number): number[] => {
    const out: Array<{ idx: number; ang: number }> = [];
    for (let i = minIdx; i <= maxIdx; i++) {
      const curr = uniform[i];
      const angWide = interiorAngleDeg(
        uniform[Math.max(0, i - 3)],
        curr,
        uniform[Math.min(n - 1, i + 3)]
      );
      const angTight = interiorAngleDeg(
        uniform[Math.max(0, i - 2)],
        curr,
        uniform[Math.min(n - 1, i + 2)]
      );
      const ang = Math.min(angWide, angTight);
      if (ang <= 104) {
        out.push({ idx: i, ang });
      }
    }
    out.sort((a, b) => a.ang - b.ang);
    return out.slice(0, 4).map((c) => c.idx);
  };

  const headStarts = findTurnCandidates(Math.floor(n * 0.06), Math.floor(n * 0.36));
  const headEnds = findTurnCandidates(Math.floor(n * 0.64), Math.floor(n * 0.94));
  if (headStarts.length === 0 || headEnds.length === 0) return null;

  for (const idx1 of headStarts) {
    for (const idx2 of headEnds) {
      if (idx2 - idx1 < Math.max(8, Math.floor(n * 0.34))) continue;
      const shaftPts = uniform.slice(idx1, idx2 + 1);
      const head1Pts = uniform.slice(0, idx1 + 1);
      const head2Pts = uniform.slice(idx2);
      const tip1 = uniform[idx1];
      const tip2 = uniform[idx2];

      const shaftLen = polylineLength(shaftPts);
      const shaftDirect = Math.hypot(tip2.x - tip1.x, tip2.y - tip1.y);
      if (shaftLen < 38 || shaftDirect < 34) continue;

      let shaftMaxDev = 0;
      for (let i = 1; i < shaftPts.length - 1; i++) {
        const d = distToSegment(shaftPts[i].x, shaftPts[i].y, tip1.x, tip1.y, tip2.x, tip2.y);
        if (d > shaftMaxDev) shaftMaxDev = d;
      }
      const isStraight = shaftMaxDev <= Math.max(10, shaftDirect * 0.085);
      let shaftArc: ReturnType<typeof fitQuadraticArc> | null = null;
      if (!isStraight) {
        shaftArc = fitQuadraticArc(shaftPts);
        if (
          shaftArc.maxErr > Math.max(16, shaftLen * 0.13) ||
          shaftArc.meanErr > Math.max(7.5, shaftLen * 0.06)
        ) {
          continue;
        }
      }

      const validateHeadAtTip = (
        pts: Pt2D[],
        tip: Pt2D,
        outUx: number,
        outUy: number
      ): number | null => {
        let maxD = 0;
        let maxBack = 0;
        let maxPerp = 0;
        for (const p of pts) {
          const vx = p.x - tip.x;
          const vy = p.y - tip.y;
          const d = Math.hypot(vx, vy);
          if (d > maxD) maxD = d;
          const back = -(vx * outUx + vy * outUy);
          if (back > maxBack) maxBack = back;
          const perp = Math.abs(-vx * outUy + vy * outUx);
          if (perp > maxPerp) maxPerp = perp;
        }
        const pathL = polylineLength(pts);
        if (maxD < 7 || maxD > Math.min(70, shaftLen * 0.48)) return null;
        if (pathL > maxD * 3.8 + 12) return null;
        if (maxBack < maxD * 0.42 || maxPerp < maxD * 0.16) return null;
        return maxD;
      };

      const out2X = isStraight ? tip2.x - tip1.x : tip2.x - shaftArc!.ctrl.x;
      const out2Y = isStraight ? tip2.y - tip1.y : tip2.y - shaftArc!.ctrl.y;
      const out2Len = Math.hypot(out2X, out2Y);
      const out1X = isStraight ? tip1.x - tip2.x : tip1.x - shaftArc!.ctrl.x;
      const out1Y = isStraight ? tip1.y - tip2.y : tip1.y - shaftArc!.ctrl.y;
      const out1Len = Math.hypot(out1X, out1Y);
      if (out1Len < 2 || out2Len < 2) continue;

      const d1 = validateHeadAtTip(head1Pts, tip1, out1X / out1Len, out1Y / out1Len);
      const d2 = validateHeadAtTip(head2Pts, tip2, out2X / out2Len, out2Y / out2Len);
      if (d1 === null || d2 === null) continue;

      const headSize = calibrateArrowHeadLen(shaftDirect, ((d1 + d2) * 0.5) * 0.9);
      let p1 = { x: tip1.x, y: tip1.y };
      let p2 = { x: tip2.x, y: tip2.y };
      if (isStraight) {
        const deg = Math.abs((Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI);
        if (deg <= 4.5 || Math.abs(deg - 180) <= 4.5) p2.y = p1.y;
        else if (Math.abs(deg - 90) <= 4.5) p2.x = p1.x;
      }

      const tan2X = isStraight ? p2.x - p1.x : out2X;
      const tan2Y = isStraight ? p2.y - p1.y : out2Y;
      const tan1X = isStraight ? p1.x - p2.x : out1X;
      const tan1Y = isStraight ? p1.y - p2.y : out1Y;
      const endWings = buildArrowWings(p2, tan2X, tan2Y, headSize);
      const tailWings = buildArrowWings(p1, tan1X, tan1Y, headSize);

      return {
        type: 'arrow',
        x1: p1.x / scaleX,
        y1: p1.y / scaleY,
        ...(isStraight ? {} : { cx: shaftArc!.ctrl.x / scaleX, cy: shaftArc!.ctrl.y / scaleY }),
        x2: p2.x / scaleX,
        y2: p2.y / scaleY,
        leftX: endWings.left.x / scaleX,
        leftY: endWings.left.y / scaleY,
        rightX: endWings.right.x / scaleX,
        rightY: endWings.right.y / scaleY,
        bidirectional: true,
        tailLeftX: tailWings.left.x / scaleX,
        tailLeftY: tailWings.left.y / scaleY,
        tailRightX: tailWings.right.x / scaleX,
        tailRightY: tailWings.right.y / scaleY,
      };
    }
  }

  return null;
}

function extractWaveExtrema(
  dSmoothed: number[],
  prominence: number
): Array<{ idx: number; val: number; sign: 1 | -1 }> {
  const n = dSmoothed.length;
  const extrema: Array<{ idx: number; val: number; sign: 1 | -1 }> = [];
  if (n < 5) return extrema;

  let mode: 0 | 1 | -1 = 0;
  let candIdx = 0;
  let candVal = dSmoothed[0];
  let anchorVal = dSmoothed[0];

  for (let i = 1; i < n; i++) {
    const v = dSmoothed[i];
    if (mode === 0) {
      if (v - anchorVal >= prominence) {
        mode = 1;
        candIdx = i;
        candVal = v;
      } else if (anchorVal - v >= prominence) {
        mode = -1;
        candIdx = i;
        candVal = v;
      } else if (Math.abs(v) < Math.abs(anchorVal)) {
        anchorVal = v;
      }
      continue;
    }

    if (mode === 1) {
      if (v > candVal) {
        candVal = v;
        candIdx = i;
      } else if (candVal - v >= prominence) {
        extrema.push({ idx: candIdx, val: candVal, sign: 1 });
        mode = -1;
        candIdx = i;
        candVal = v;
      }
    } else {
      if (v < candVal) {
        candVal = v;
        candIdx = i;
      } else if (v - candVal >= prominence) {
        extrema.push({ idx: candIdx, val: candVal, sign: -1 });
        mode = 1;
        candIdx = i;
        candVal = v;
      }
    }
  }

  if (mode !== 0 && candIdx >= 3 && candIdx <= n - 4 && candVal * mode >= prominence * 0.6) {
    extrema.push({ idx: candIdx, val: candVal, sign: mode });
  }

  return extrema;
}

function smoothScalarSeries(vals: number[], passes: number): number[] {
  let cur = vals.slice();
  const n = cur.length;
  if (n < 3) return cur;
  for (let pass = 0; pass < passes; pass++) {
    const next = cur.slice();
    for (let i = 1; i < n - 1; i++) {
      next[i] = 0.25 * cur[i - 1] + 0.5 * cur[i] + 0.25 * cur[i + 1];
    }
    cur = next;
  }
  return cur;
}

function hasMultiCycleGentleWave(uniform: Pt2D[]): boolean {
  const n = uniform.length;
  if (n < 16) return false;
  const first = uniform[0];
  const last = uniform[n - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 90) return false;
  const ux = dx / chord;
  const uy = dy / chord;
  const nx = -uy;
  const ny = ux;

  const dRaw = new Array<number>(n);
  let meanD = 0;
  for (let i = 0; i < n; i++) {
    const v = (uniform[i].x - first.x) * nx + (uniform[i].y - first.y) * ny;
    dRaw[i] = v;
    meanD += v;
  }
  meanD /= n;
  for (let i = 0; i < n; i++) dRaw[i] -= meanD;

  const dSmoothed = smoothScalarSeries(dRaw, 2);
  let maxPos = 0;
  let absNeg = 0;
  for (let i = 0; i < n; i++) {
    if (dSmoothed[i] > maxPos) maxPos = dSmoothed[i];
    if (-dSmoothed[i] > absNeg) absNeg = -dSmoothed[i];
  }
  const ampBound = Math.max(maxPos, absNeg);
  const oppRatio = Math.min(maxPos, absNeg) / Math.max(1e-6, ampBound);
  if (ampBound < 5.2 || oppRatio < 0.42) return false;

  const extrema = extractWaveExtrema(dSmoothed, Math.max(4.6, ampBound * 0.36));
  const interior = extrema.filter((e) => e.idx >= 3 && e.idx <= n - 4);
  return interior.length >= 3;
}

/**
 * Non-shrinking Taubin (lambda/mu) curve fairing with pinned endpoints.
 * Removes hand jitter & roughness cleanly while preserving exact wave crests, peaks, and path fidelity.
 */
function smoothCurvePointsTaubin(pts: Pt2D[], cycles = 4): Pt2D[] {
  const n = pts.length;
  if (n < 3) return pts.map((p) => ({ x: p.x, y: p.y }));
  let cur = pts.map((p) => ({ x: p.x, y: p.y }));

  const applyStep = (src: Pt2D[], weight: number): Pt2D[] => {
    const next: Pt2D[] = new Array(n);
    next[0] = src[0];
    next[n - 1] = src[n - 1];
    for (let i = 1; i < n - 1; i++) {
      const avgX = 0.5 * (src[i - 1].x + src[i + 1].x);
      const avgY = 0.5 * (src[i - 1].y + src[i + 1].y);
      next[i] = {
        x: src[i].x + weight * (avgX - src[i].x),
        y: src[i].y + weight * (avgY - src[i].y),
      };
    }
    return next;
  };

  for (let c = 0; c < cycles; c++) {
    cur = applyStep(cur, 0.52);
    cur = applyStep(cur, -0.50);
  }
  // Light final pass to ensure silky curvature continuity without flattening crests
  cur = applyStep(cur, 0.24);
  return cur;
}

/**
 * Trims stationary hand-jitter accumulated during the hold-still pause before Hold-to-Snap
 * and applies a single light corner-preserving denoise pass so micro-tremor never skews geometry.
 */
function prepareStrokePtsForRecognition(
  points: AnnotationPoint[],
  scaleX: number,
  scaleY: number
): Pt2D[] {
  const scaled: Pt2D[] = points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
  const n = scaled.length;
  if (n < 5) return scaled;

  // Collapse final hold-pause dwell cluster (trailing points hovering within 3.6px over <= 360ms)
  const endPt = scaled[n - 1];
  const endT = points[n - 1].t;
  const startT = points[0].t;
  let trimEndIdx = n - 1;

  if (endT > startT) {
    let sumX = endPt.x;
    let sumY = endPt.y;
    let cnt = 1;
    let candidate = n - 1;
    for (let i = n - 2; i >= 2; i--) {
      const dt = endT - points[i].t;
      const d = Math.hypot(scaled[i].x - endPt.x, scaled[i].y - endPt.y);
      if (dt <= 380 && d <= 3.6) {
        candidate = i;
        sumX += scaled[i].x;
        sumY += scaled[i].y;
        cnt++;
      } else {
        break;
      }
    }
    if (cnt >= 2 && candidate >= 3) {
      scaled[candidate] = { x: sumX / cnt, y: sumY / cnt };
      trimEndIdx = candidate;
    }
  }

  const trimmed = scaled.slice(0, trimEndIdx + 1);
  if (trimmed.length < 5) return trimmed;

  // Single corner-preserving 3-tap denoise pass (vertices with sharp turns keep cf -> 0)
  const out: Pt2D[] = new Array(trimmed.length);
  out[0] = trimmed[0];
  out[trimmed.length - 1] = trimmed[trimmed.length - 1];
  for (let i = 1; i < trimmed.length - 1; i++) {
    const prev = trimmed[i - 1];
    const cur = trimmed[i];
    const next = trimmed[i + 1];
    const v1x = cur.x - prev.x;
    const v1y = cur.y - prev.y;
    const v2x = next.x - cur.x;
    const v2y = next.y - cur.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    let cf = 0;
    if (l1 > 0.1 && l2 > 0.1) {
      const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
      cf = Math.max(0, Math.min(1, (dot + 0.15) / 0.85));
    }
    const alpha = 0.34 * cf;
    const tx = 0.25 * prev.x + 0.5 * cur.x + 0.25 * next.x;
    const ty = 0.25 * prev.y + 0.5 * cur.y + 0.25 * next.y;
    out[i] = {
      x: cur.x + (tx - cur.x) * alpha,
      y: cur.y + (ty - cur.y) * alpha,
    };
  }
  return out;
}

/**
 * Fits both a moment-refined rotated/axis-aligned ellipse and a least-squares circle to a uniform
 * closed contour, returning whichever fits more cleanly without outer-bump bias.
 */
function fitClosedEllipseAndCircle(
  closedContour: Pt2D[],
  avgRadius: number
): {
  valid: boolean;
  score: number;
  meanErr: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  theta: number;
} {
  const n = closedContour.length;
  let meanX = 0;
  let meanY = 0;
  for (const p of closedContour) {
    meanX += p.x;
    meanY += p.y;
  }
  meanX /= n;
  meanY /= n;

  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const p of closedContour) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  cxx /= n;
  cyy /= n;
  cxy /= n;

  let theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  let degMod = ((theta * 180) / Math.PI + 180) % 90;
  if (degMod <= 14 || degMod >= 76) {
    theta = 0;
  } else if (Math.abs(degMod - 45) <= 7.5) {
    const shift = ((45 - degMod) * Math.PI) / 180;
    theta += shift;
  }
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Compute BOTH bbox radii and noise-immune moment radii sqrt(2 * variance) in rotated frame
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  let varU = 0;
  let varV = 0;
  for (const p of closedContour) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    const u = dx * cosT + dy * sinT;
    const v = -dx * sinT + dy * cosT;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
    varU += u * u;
    varV += v * v;
  }
  varU /= n;
  varV /= n;

  const bboxCx = meanX + ((minU + maxU) * 0.5) * cosT - ((minV + maxV) * 0.5) * sinT;
  const bboxCy = meanY + ((minU + maxU) * 0.5) * sinT + ((minV + maxV) * 0.5) * cosT;
  const bboxRx = (maxU - minU) * 0.5;
  const bboxRy = (maxV - minV) * 0.5;

  const momRx = Math.sqrt(Math.max(1, 2 * varU));
  const momRy = Math.sqrt(Math.max(1, 2 * varV));
  const blendCx = meanX * 0.65 + bboxCx * 0.35;
  const blendCy = meanY * 0.65 + bboxCy * 0.35;

  const evalEllipse = (cx: number, cy: number, rx: number, ry: number, rot: number) => {
    if (rx < 10 || ry < 10) return { meanErr: Infinity, maxErr: Infinity, score: Infinity };
    const cosE = Math.cos(rot);
    const sinE = Math.sin(rot);
    let errSum = 0;
    let errMax = 0;
    for (const p of closedContour) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const lx = dx * cosE + dy * sinE;
      const ly = -dx * sinE + dy * cosE;
      const ang = Math.atan2(ly / ry, lx / rx);
      const ex = Math.cos(ang) * rx;
      const ey = Math.sin(ang) * ry;
      const d = Math.hypot(lx - ex, ly - ey) / avgRadius;
      errSum += d;
      if (d > errMax) errMax = d;
    }
    const meanErr = errSum / n;
    return { meanErr, maxErr: errMax, score: meanErr + 0.35 * errMax };
  };

  let bestCx = meanX;
  let bestCy = meanY;
  let bestRx = momRx;
  let bestRy = momRy;
  let bestTheta = theta;
  let bestEval = evalEllipse(bestCx, bestCy, bestRx, bestRy, bestTheta);

  const bboxEval = evalEllipse(bboxCx, bboxCy, bboxRx, bboxRy, theta);
  if (bboxEval.score < bestEval.score) {
    bestCx = bboxCx;
    bestCy = bboxCy;
    bestRx = bboxRx;
    bestRy = bboxRy;
    bestEval = bboxEval;
  }
  const blendEval = evalEllipse(blendCx, blendCy, (momRx + bboxRx) * 0.5, (momRy + bboxRy) * 0.5, theta);
  if (blendEval.score < bestEval.score) {
    bestCx = blendCx;
    bestCy = blendCy;
    bestRx = (momRx + bboxRx) * 0.5;
    bestRy = (momRy + bboxRy) * 0.5;
    bestEval = blendEval;
  }

  // Exact Kåsa least-squares circle check when nearly circular (locks crisp circles cleanly)
  if (bestRx >= 10 && bestRy >= 10 && Math.abs(bestRx - bestRy) / Math.max(bestRx, bestRy) < 0.175) {
    let suu = 0;
    let suv = 0;
    let svv = 0;
    let suuu = 0;
    let svvv = 0;
    let suvv = 0;
    let svuu = 0;
    for (const p of closedContour) {
      const u = p.x - meanX;
      const v = p.y - meanY;
      suu += u * u;
      svv += v * v;
      suv += u * v;
      suuu += u * u * u;
      svvv += v * v * v;
      suvv += u * v * v;
      svuu += v * u * u;
    }
    const det = 2 * (suu * svv - suv * suv);
    let circCx = meanX;
    let circCy = meanY;
    if (Math.abs(det) > 1e-4) {
      const rhs1 = suuu + suvv;
      const rhs2 = svvv + svuu;
      const uc = (rhs1 * svv - rhs2 * suv) / det;
      const vc = (suu * rhs2 - suv * rhs1) / det;
      if (Math.hypot(uc, vc) < avgRadius * 0.35) {
        circCx = meanX + uc;
        circCy = meanY + vc;
      }
    }
    let rSum = 0;
    for (const p of closedContour) {
      rSum += Math.hypot(p.x - circCx, p.y - circCy);
    }
    const circR = rSum / n;
    const circEval = evalEllipse(circCx, circCy, circR, circR, 0);
    if (circEval.meanErr <= 0.155 && circEval.maxErr <= 0.32 && circEval.score <= bestEval.score * 1.12) {
      return {
        valid: true,
        score: circEval.score,
        meanErr: circEval.meanErr,
        cx: circCx,
        cy: circCy,
        rx: circR,
        ry: circR,
        theta: 0,
      };
    }
  }

  // If aspect ratio is tight even if Kåsa didn't win, normalize slight tilt cleanly to circle
  if (bestRx >= 10 && bestRy >= 10 && Math.abs(bestRx - bestRy) / Math.max(bestRx, bestRy) < 0.135) {
    const avg = (bestRx + bestRy) * 0.5;
    const cEval = evalEllipse(bestCx, bestCy, avg, avg, 0);
    if (cEval.meanErr <= 0.16 && cEval.maxErr <= 0.34) {
      return {
        valid: true,
        score: cEval.score,
        meanErr: cEval.meanErr,
        cx: bestCx,
        cy: bestCy,
        rx: avg,
        ry: avg,
        theta: 0,
      };
    }
  }

  if (bestEval.meanErr <= 0.16 && bestEval.maxErr <= 0.34) {
    return {
      valid: true,
      score: bestEval.score,
      meanErr: bestEval.meanErr,
      cx: bestCx,
      cy: bestCy,
      rx: bestRx,
      ry: bestRy,
      theta: bestTheta,
    };
  }

  return {
    valid: false,
    score: Infinity,
    meanErr: Infinity,
    cx: bestCx,
    cy: bestCy,
    rx: bestRx,
    ry: bestRy,
    theta: bestTheta,
  };
}

/**
 * Recognizes an undulating wavy stroke (`~`, `~ ~`, `~ ~ ~`) and snaps it into a silky,
 * balanced path-hugging curve using Taubin non-shrinking fairing (never sharp-cornered polyline angles).
 */
function tryDetectSmoothWave(
  rawPts: Pt2D[],
  uniform: Pt2D[],
  pathLen: number,
  diag: number,
  directDist: number,
  scaleX: number,
  scaleY: number
): AnnotationShape | null {
  const n = uniform.length;
  if (n < 16 || pathLen < 42 || directDist < 22) return null;

  const first = rawPts[0];
  const last = rawPts[rawPts.length - 1];

  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += uniform[i].x;
    my += uniform[i].y;
  }
  mx /= n;
  my /= n;

  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = uniform[i].x - mx;
    const dy = uniform[i].y - my;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }

  let theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  let ux = Math.cos(theta);
  let uy = Math.sin(theta);
  if ((last.x - first.x) * ux + (last.y - first.y) * uy < 0) {
    ux = -ux;
    uy = -uy;
    theta = Math.atan2(uy, ux);
  }
  const nx = -uy;
  const ny = ux;

  const sRaw = new Array<number>(n);
  const dRaw = new Array<number>(n);
  let minS = Infinity;
  let maxS = -Infinity;
  let maxSSeen = -Infinity;
  let maxBacktrack = 0;
  for (let i = 0; i < n; i++) {
    const dx = uniform[i].x - mx;
    const dy = uniform[i].y - my;
    const sVal = dx * ux + dy * uy;
    const dVal = dx * nx + dy * ny;
    sRaw[i] = sVal;
    dRaw[i] = dVal;
    if (sVal < minS) minS = sVal;
    if (sVal > maxS) maxS = sVal;
    if (i === 0) {
      maxSSeen = sVal;
    } else {
      if (maxSSeen - sVal > maxBacktrack) maxBacktrack = maxSSeen - sVal;
      if (sVal > maxSSeen) maxSSeen = sVal;
    }
  }

  const sSpan = maxS - minS;
  if (sSpan < Math.max(28, diag * 0.64)) return null;
  if (maxBacktrack > sSpan * 0.16) return null;
  if (sRaw[n - 1] - sRaw[0] < sSpan * 0.66) return null;

  const dSmoothed = smoothScalarSeries(dRaw, 2);
  let maxPos = 0;
  let absNeg = 0;
  for (let i = 0; i < n; i++) {
    if (dSmoothed[i] > maxPos) maxPos = dSmoothed[i];
    if (-dSmoothed[i] > absNeg) absNeg = -dSmoothed[i];
  }
  const ampBound = Math.max(maxPos, absNeg);
  const oppRatio = Math.min(maxPos, absNeg) / Math.max(1e-6, ampBound);

  if (ampBound < Math.max(4.6, sSpan * 0.018) || ampBound > sSpan * 0.48) return null;
  if (oppRatio < 0.36) return null;

  const prominence = Math.max(4.0, ampBound * 0.34);
  const extrema = extractWaveExtrema(dSmoothed, prominence);
  const interior = extrema.filter((e) => e.idx >= 3 && e.idx <= n - 4);
  if (interior.length < 2) return null;

  // Preserve crisp 90-degree rectangular stair-steps (exactly 2 corners, razor-straight legs)
  if (interior.length === 2) {
    const dp4 = douglasPeucker(uniform, Math.max(7.5, diag * 0.065));
    if (dp4.length === 4) {
      const a1 = interiorAngleDeg(dp4[0], dp4[1], dp4[2]);
      const a2 = interiorAngleDeg(dp4[1], dp4[2], dp4[3]);
      if (Math.abs(a1 - 90) <= 18 && Math.abs(a2 - 90) <= 18) {
        const stairFit = measurePolylineFitError(uniform, dp4, false);
        if (stairFit.mean <= 2.6 && stairFit.max <= 5.5) {
          return null;
        }
      }
    }
  }

  // Non-shrinking Taubin fairing along user's OWN hand-drawn path (preserves full wave crests!)
  const cur = smoothCurvePointsTaubin(uniform, 4);

  // Subtle horizontal/vertical baseline leveling ONLY if endpoints are already nearly aligned
  const spanX = Math.abs(last.x - first.x);
  const spanY = Math.abs(last.y - first.y);
  const endDeg = Math.abs((Math.atan2(last.y - first.y, last.x - first.x) * 180) / Math.PI);
  if (spanX >= 28 && (endDeg <= 4.5 || Math.abs(endDeg - 180) <= 4.5)) {
    const shift = (cur[0].y - cur[cur.length - 1].y) * 0.5;
    for (let i = 0; i < cur.length; i++) {
      const u = i / (cur.length - 1);
      cur[i].y += shift * (2 * u - 1);
    }
  } else if (spanY >= 28 && Math.abs(endDeg - 90) <= 4.5) {
    const shift = (cur[0].x - cur[cur.length - 1].x) * 0.5;
    for (let i = 0; i < cur.length; i++) {
      const u = i / (cur.length - 1);
      cur[i].x += shift * (2 * u - 1);
    }
  }

  const knots = douglasPeucker(cur, Math.max(0.95, pathLen * 0.0036));
  if (knots.length >= 3) {
    return {
      type: 'curve',
      points: knots.map((p) => ({ x: p.x / scaleX, y: p.y / scaleY })),
    };
  }

  return null;
}

/**
 * Universal Apple PencilKit "Hold to Snap" recognizer.
 * Reacts intelligently to ANY drawn gesture when the user pauses briefly at stroke end:
 * - Straight lines (with clean H/V/45° lock)
 * - Smooth curved lines & arches ("سطر منحني")
 * - Clean basic Closed Shapes ONLY: Triangles (Equilateral/Right/Isosceles), Rectangles, Squares, Diamonds,
 *   vs Circles & rotated Ellipses (strictly rejecting weird irregular polygons)
 * - Straight or curved pointer Arrows (1-stroke, bidirectional, or 2-stroke merged)
 * - Crisp open Polylines (L/V/U brackets, checkmarks, square brackets `[ ]`)
 * - Silky non-shrinking path-hugging smooth curves (S-curves / waves / Arabic Mad flourishes)
 */
export function detectHoldShape(
  points: AnnotationPoint[],
  scaleX: number,
  scaleY: number,
  allowComplexShapes: boolean
): AnnotationShape | null {
  if (points.length < 4 || scaleX <= 0 || scaleY <= 0) return null;

  const rawPts = prepareStrokePtsForRecognition(points, scaleX, scaleY);
  if (rawPts.length < 4) return null;

  const first = rawPts[0];
  const last = rawPts[rawPts.length - 1];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < rawPts.length; i++) {
    const p = rawPts[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const pathLen = polylineLength(rawPts);
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;
  const diag = Math.hypot(bboxW, bboxH);
  const directDist = Math.hypot(last.x - first.x, last.y - first.y);

  if (pathLen < 38 || diag < 26) return null;

  const toNorm = (p: Pt2D): Pt2D => ({ x: p.x / scaleX, y: p.y / scaleY });

  const uniform = resamplePolyline(rawPts, 72);

  // -------------------------------------------------------------------------
  // 1. STRAIGHT LINE (strict enough that intentional gentle curves & waves stay curvy!)
  // -------------------------------------------------------------------------
  if (directDist >= 28 && pathLen <= directDist * 1.15) {
    let maxDev = 0;
    for (let i = 1; i < rawPts.length - 1; i++) {
      const dev = distToSegment(rawPts[i].x, rawPts[i].y, first.x, first.y, last.x, last.y);
      if (dev > maxDev) maxDev = dev;
    }

    const allowedLineDev = Math.max(7.0, directDist * 0.055);
    if (maxDev <= allowedLineDev && !(maxDev > 5.0 && hasMultiCycleGentleWave(uniform))) {
      let x2Px = last.x;
      let y2Px = last.y;
      const angleDeg = Math.abs((Math.atan2(last.y - first.y, last.x - first.x) * 180) / Math.PI);
      if (angleDeg <= 4.8 || Math.abs(angleDeg - 180) <= 4.8) {
        y2Px = first.y;
      } else if (Math.abs(angleDeg - 90) <= 4.8) {
        x2Px = first.x;
      } else if (Math.abs(angleDeg - 45) <= 3.0 || Math.abs(angleDeg - 135) <= 3.0) {
        const signX = last.x >= first.x ? 1 : -1;
        const signY = last.y >= first.y ? 1 : -1;
        const proj = (Math.abs(last.x - first.x) + Math.abs(last.y - first.y)) * 0.5;
        x2Px = first.x + signX * proj;
        y2Px = first.y + signY * proj;
      }
      return {
        type: 'line',
        x1: first.x / scaleX,
        y1: first.y / scaleY,
        x2: x2Px / scaleX,
        y2: y2Px / scaleY,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 2. CLOSED SHAPES COMPETITION: Clean Triangle / Rectangle / Square / Diamond
  //    vs Circle / Rotated Ellipse (NEVER invent weird irregular polygons!)
  // -------------------------------------------------------------------------
  let signedArea2 = 0;
  for (let i = 0; i < uniform.length; i++) {
    const a = uniform[i];
    const b = uniform[(i + 1) % uniform.length];
    signedArea2 += a.x * b.y - b.x * a.y;
  }
  const enclosedArea = Math.abs(signedArea2) * 0.5;
  const areaFillRatio = bboxW > 0 && bboxH > 0 ? enclosedArea / (bboxW * bboxH) : 0;

  const isLikelyClosedLoop =
    directDist <= Math.max(22, pathLen * 0.22) && pathLen >= diag * 1.96 && areaFillRatio >= 0.18;

  let closedContour: Pt2D[] | null = null;
  if (bboxW >= 26 && bboxH >= 26 && areaFillRatio >= 0.18) {
    const closeThreshold = Math.max(24, Math.min(diag * 0.28, pathLen * 0.18));
    if (directDist <= closeThreshold && pathLen >= diag * 1.96) {
      closedContour = uniform;
    } else if (pathLen >= diag * 2.15) {
      const startSliceEnd = Math.floor(uniform.length * 0.18);
      const endSliceStart = Math.floor(uniform.length * 0.82);
      let bestGap = Infinity;
      let bestStart = 0;
      let bestEnd = uniform.length - 1;
      for (let i = 0; i <= startSliceEnd; i++) {
        for (let j = endSliceStart; j < uniform.length; j++) {
          const g = Math.hypot(uniform[j].x - uniform[i].x, uniform[j].y - uniform[i].y);
          if (g < bestGap) {
            bestGap = g;
            bestStart = i;
            bestEnd = j;
          }
        }
      }
      if (bestGap <= Math.max(16, diag * 0.14) && bestEnd - bestStart >= uniform.length * 0.68) {
        closedContour = resamplePolyline(uniform.slice(bestStart, bestEnd + 1), 72);
      }
    }
  } else if (isLikelyClosedLoop) {
    return null;
  }

  if (closedContour) {
    const avgRadius = Math.max(13, (bboxW + bboxH) * 0.25);

    let meanX = 0;
    let meanY = 0;
    for (const p of closedContour) {
      meanX += p.x;
      meanY += p.y;
    }
    meanX /= closedContour.length;
    meanY /= closedContour.length;

    // ---- Candidate A: Moment-Refined Circle / Rotated Ellipse ----
    const ellipseFit = fitClosedEllipseAndCircle(closedContour, avgRadius);

    // ---- Candidate B: Clean Basic Closed Polygons ONLY (Triangle 3, Rect/Square/Diamond 4) ----
    let polyValid = false;
    let polyScore = Infinity;
    let polyVerts: Pt2D[] = [];

    let idxA = 0;
    let bestDA = -1;
    for (let i = 0; i < closedContour.length; i++) {
      const d = Math.hypot(closedContour[i].x - meanX, closedContour[i].y - meanY);
      if (d > bestDA) {
        bestDA = d;
        idxA = i;
      }
    }
    let idxB = idxA;
    let bestDB = -1;
    for (let i = 0; i < closedContour.length; i++) {
      const d = Math.hypot(closedContour[i].x - closedContour[idxA].x, closedContour[i].y - closedContour[idxA].y);
      if (d > bestDB) {
        bestDB = d;
        idxB = i;
      }
    }

    const rotated = closedContour.slice(idxA).concat(closedContour.slice(0, idxA));
    const splitPos = (idxB - idxA + closedContour.length) % closedContour.length;
    const half1 = rotated.slice(0, splitPos + 1);
    const half2 = rotated.slice(splitPos).concat([rotated[0]]);

    const epsMultipliers = [0.068, 0.09, 0.115];
    for (const mult of epsMultipliers) {
      const eps = Math.max(7.5, diag * mult);
      const v1 = douglasPeucker(half1, eps);
      const v2 = douglasPeucker(half2, eps);
      const merged = v1.slice(0, -1).concat(v2.slice(0, -1));
      const cleaned = cleanClosedVertices(merged, Math.max(14, diag * 0.14));

      if (cleaned.length === 3 || cleaned.length === 4) {
        const candidateVerts =
          cleaned.length === 3
            ? regularizeTriangle(cleaned)
            : regularizeQuad(cleaned, closedContour);
        if (!candidateVerts) continue;
        if (!arePolylineEdgesStraight(closedContour, candidateVerts, true, 0.15)) continue;

        const fit = measurePolylineFitError(closedContour, candidateVerts, true);
        const normMean = fit.mean / avgRadius;
        const normMax = fit.max / avgRadius;
        const score = normMean + 0.35 * normMax;

        if (normMean <= 0.125 && normMax <= 0.26 && score < polyScore) {
          polyValid = true;
          polyScore = score;
          polyVerts = candidateVerts;
        }
      }
    }

    // Corner-curvature OBB quad check for quick rectangles with rounded corners (skip if ultra-clean oval)
    if (!ellipseFit.valid || ellipseFit.meanErr > 0.055) {
      const obbQuad = buildCornerCurvatureQuadCandidate(closedContour);
      if (obbQuad && arePolylineEdgesStraight(closedContour, obbQuad, true, 0.155)) {
        const obbFit = measurePolylineFitError(closedContour, obbQuad, true);
        const obbMean = obbFit.mean / avgRadius;
        const obbMax = obbFit.max / avgRadius;
        const obbScore = obbMean + 0.32 * obbMax;
        if (obbMean <= 0.12 && obbMax <= 0.25 && (!polyValid || obbScore <= polyScore * 1.02)) {
          polyValid = true;
          polyScore = obbScore;
          polyVerts = obbQuad;
        }
      }
    }

    const choosePolygon =
      polyValid && (!ellipseFit.valid || polyScore <= ellipseFit.score * 0.90);

    if (choosePolygon) {
      return {
        type: 'polygon',
        points: polyVerts.map(toNorm),
        closed: true,
      };
    }

    if (ellipseFit.valid) {
      const isRotated = Math.abs(ellipseFit.theta) > 0.001;
      const isCircle = !isRotated && Math.abs(ellipseFit.rx - ellipseFit.ry) < 0.01;
      const avgScale = (scaleX + scaleY) * 0.5;
      const isotropic = isRotated || isCircle;
      return {
        type: 'ellipse',
        cx: ellipseFit.cx / scaleX,
        cy: ellipseFit.cy / scaleY,
        rx: isotropic ? ellipseFit.rx / avgScale : ellipseFit.rx / scaleX,
        ry: isotropic ? ellipseFit.ry / avgScale : ellipseFit.ry / scaleY,
        rotation: isRotated ? ellipseFit.theta : undefined,
        ...(isCircle ? { isCircle: true } : {}),
      };
    }

    // Do not deform an unrecognized closed loop into a weird geometric polygon
    return null;
  }

  // -------------------------------------------------------------------------
  // 3. POINTER ARROW (single/bidirectional, 1-wing hook, 2-wing head, or head-first)
  // -------------------------------------------------------------------------
  if (allowComplexShapes && pathLen >= 38) {
    if (pathLen >= 68) {
      const bidirArrow = tryDetectSingleStrokeBidirectionalArrow(uniform, scaleX, scaleY);
      if (bidirArrow) return bidirArrow;
    }

    const n = uniform.length;

    // 3A. Tail -> Tip -> Head flourish (most common casual hand-drawn arrows)
    const minTipIdx = Math.floor(n * 0.40);
    const maxTipIdx = Math.floor(n * 0.94);
    const tailCandidates: Array<{ idx: number; score: number }> = [];

    for (let i = minTipIdx; i <= maxTipIdx; i++) {
      const curr = uniform[i];
      const angWide = interiorAngleDeg(
        uniform[Math.max(0, i - 3)],
        curr,
        uniform[Math.min(n - 1, i + 3)]
      );
      const angTight = interiorAngleDeg(
        uniform[Math.max(0, i - 2)],
        curr,
        uniform[Math.min(n - 1, i + 2)]
      );
      const minAng = Math.min(angWide, angTight);
      if (minAng <= 94) {
        tailCandidates.push({ idx: i, score: minAng });
      }
    }

    if (tailCandidates.length === 0) {
      const roughX = last.x - first.x;
      const roughY = last.y - first.y;
      const roughLen = Math.hypot(roughX, roughY);
      if (roughLen >= 20) {
        let bestProj = -Infinity;
        let reachIdx = -1;
        for (let i = minTipIdx; i <= maxTipIdx; i++) {
          const proj = ((uniform[i].x - first.x) * roughX + (uniform[i].y - first.y) * roughY) / roughLen;
          if (proj > bestProj) {
            bestProj = proj;
            reachIdx = i;
          }
        }
        if (reachIdx !== -1 && reachIdx < n - 3) {
          tailCandidates.push({ idx: reachIdx, score: 115 });
        }
      }
    }

    tailCandidates.sort((a, b) => a.idx - b.idx);
    for (let c = 0; c < tailCandidates.length; c++) {
      const idx = tailCandidates[c].idx;
      const arrow = tryBuildArrowFromShaftAndHead(
        uniform.slice(0, idx + 1),
        uniform.slice(idx),
        uniform[idx],
        false,
        scaleX,
        scaleY
      );
      if (arrow) return arrow;
    }

    // 3B. Head-first -> Tail
    const minHeadEnd = Math.floor(n * 0.06);
    const maxHeadEnd = Math.floor(n * 0.48);
    const headCandidates: Array<{ idx: number; score: number }> = [];
    for (let i = minHeadEnd; i <= maxHeadEnd; i++) {
      const curr = uniform[i];
      const ang = Math.min(
        interiorAngleDeg(uniform[Math.max(0, i - 3)], curr, uniform[Math.min(n - 1, i + 3)]),
        interiorAngleDeg(uniform[Math.max(0, i - 2)], curr, uniform[Math.min(n - 1, i + 2)])
      );
      if (ang <= 95) {
        headCandidates.push({ idx: i, score: ang });
      }
    }
    headCandidates.sort((a, b) => b.idx - a.idx);
    for (let c = 0; c < headCandidates.length; c++) {
      const idx = headCandidates[c].idx;
      const arrow = tryBuildArrowFromShaftAndHead(
        uniform.slice(idx).reverse(),
        uniform.slice(0, idx + 1).reverse(),
        uniform[idx],
        true,
        scaleX,
        scaleY
      );
      if (arrow) return arrow;
    }
  }

  // -------------------------------------------------------------------------
  // 3.5. CHECKMARK & CALLIGRAPHIC CURLY BRACE (`✓`, `{ }`)
  // -------------------------------------------------------------------------
  if (allowComplexShapes) {
    const brace = tryDetectCurlyBrace(rawPts, uniform, scaleX, scaleY);
    if (brace) return brace;

    const checkmark = tryDetectCheckmark(rawPts, uniform, scaleX, scaleY);
    if (checkmark) return checkmark;
  }

  // -------------------------------------------------------------------------
  // 3.75. SMOOTH WAVY LINE (`~`, `~ ~`, `~ ~ ~`) BEFORE OPEN POLYGON CORNERS
  // -------------------------------------------------------------------------
  const smoothWave = tryDetectSmoothWave(rawPts, uniform, pathLen, diag, directDist, scaleX, scaleY);
  if (smoothWave) return smoothWave;

  // -------------------------------------------------------------------------
  // 4. OPEN SHAPES: Smooth Curved Arc ("سطر منحني") vs Crisp Open Polyline (L / V / [ ])
  // -------------------------------------------------------------------------
  const arcFit = fitQuadraticArc(uniform);
  const openDp = douglasPeucker(uniform, Math.max(7.5, diag * 0.065));

  const openVerts: Pt2D[] = [openDp[0]];
  for (let i = 1; i < openDp.length - 1; i++) {
    const prev = openVerts[openVerts.length - 1];
    const curr = openDp[i];
    const next = openDp[i + 1];
    if (interiorAngleDeg(prev, curr, next) <= 140) {
      openVerts.push(curr);
    }
  }
  openVerts.push(openDp[openDp.length - 1]);

  let openPolyValid = false;
  let openPolyMean = Infinity;
  if (openVerts.length >= 3 && openVerts.length <= 4) {
    let maxCorner = 0;
    for (let i = 1; i < openVerts.length - 1; i++) {
      const ang = interiorAngleDeg(openVerts[i - 1], openVerts[i], openVerts[i + 1]);
      if (ang > maxCorner) maxCorner = ang;
    }
    const fit = measurePolylineFitError(uniform, openVerts, false);
    if (
      maxCorner <= 116 &&
      fit.mean <= Math.max(4.4, pathLen * 0.022) &&
      fit.max <= Math.max(9.2, pathLen * 0.048) &&
      arePolylineEdgesStraight(uniform, openVerts, false, 0.085)
    ) {
      openPolyValid = true;
      openPolyMean = fit.mean;
    }
  }

  const arcValid =
    arcFit.meanErr <= Math.max(7.5, pathLen * 0.04) &&
    arcFit.maxErr <= Math.max(17, pathLen * 0.095) &&
    arcFit.bow >= Math.max(5, directDist * 0.04);

  if (openPolyValid && (!arcValid || openPolyMean < arcFit.meanErr * 0.72)) {
    const leveled = openVerts.map((v) => ({ ...v }));
    for (let i = 0; i < leveled.length - 1; i++) {
      const a = leveled[i];
      const b = leveled[i + 1];
      const deg = Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
      if (deg <= 6 || Math.abs(deg - 180) <= 6) {
        b.y = a.y;
      } else if (Math.abs(deg - 90) <= 6) {
        b.x = a.x;
      }
    }

    if (leveled.length === 4) {
      const a = leveled[0];
      const b = leveled[1];
      const c = leveled[2];
      const d = leveled[3];
      const midDx = c.x - b.x;
      const midDy = c.y - b.y;
      const midLen = Math.hypot(midDx, midDy);
      const tick1 = Math.hypot(b.x - a.x, b.y - a.y);
      const tick2 = Math.hypot(d.x - c.x, d.y - c.y);
      if (midLen >= 18 && tick1 >= 6 && tick2 >= 6 && Math.max(tick1, tick2) <= midLen * 0.58) {
        const ang1 = interiorAngleDeg(a, b, c);
        const ang2 = interiorAngleDeg(b, c, d);
        if (Math.abs(ang1 - 90) <= 22 && Math.abs(ang2 - 90) <= 22) {
          const ux = midDx / midLen;
          const uy = midDy / midLen;
          const nx = -uy;
          const ny = ux;
          const s1 = (a.x - b.x) * nx + (a.y - b.y) * ny;
          const s2 = (d.x - c.x) * nx + (d.y - c.y) * ny;
          if (s1 * s2 > 0) {
            const symDepth = (Math.abs(s1) + Math.abs(s2)) * 0.5 * Math.sign(s1);
            leveled[0] = { x: b.x + nx * symDepth, y: b.y + ny * symDepth };
            leveled[3] = { x: c.x + nx * symDepth, y: c.y + ny * symDepth };
          }
        }
      }
    }

    return {
      type: 'polygon',
      points: leveled.map(toNorm),
      closed: false,
    };
  }

  // Smooth Curved Arc / Arch / Curved Underline ("سطر منحني")
  if (arcValid) {
    let p0 = { ...arcFit.p0 };
    let p2 = { ...arcFit.p2 };
    let ctrl = { ...arcFit.ctrl };

    if (directDist >= 26) {
      const dy = Math.abs(p2.y - p0.y);
      const dx = Math.abs(p2.x - p0.x);
      if (dy <= directDist * 0.08) {
        const avgY = (p0.y + p2.y) * 0.5;
        p0.y = avgY;
        p2.y = avgY;
        const midX = (p0.x + p2.x) * 0.5;
        if (Math.abs(ctrl.x - midX) <= dx * 0.14) {
          ctrl.x = midX;
        }
      } else if (dx <= directDist * 0.08) {
        const avgX = (p0.x + p2.x) * 0.5;
        p0.x = avgX;
        p2.x = avgX;
        const midY = (p0.y + p2.y) * 0.5;
        if (Math.abs(ctrl.y - midY) <= dy * 0.14) {
          ctrl.y = midY;
        }
      }
    }

    return {
      type: 'arc',
      x1: p0.x / scaleX,
      y1: p0.y / scaleY,
      cx: ctrl.x / scaleX,
      cy: ctrl.y / scaleY,
      x2: p2.x / scaleX,
      y2: p2.y / scaleY,
    };
  }

  // -------------------------------------------------------------------------
  // 5. SILKY PATH-HUGGING SMOOTH CURVE (Taubin non-shrinking fairing: S-curves, waves, flourishes)
  // -------------------------------------------------------------------------
  if (pathLen >= 48 && directDist >= 20) {
    const resampled = resamplePolyline(rawPts, 48);
    const faired = smoothCurvePointsTaubin(resampled, 4);
    const knots = douglasPeucker(faired, Math.max(0.95, pathLen * 0.0036));
    if (knots.length >= 3) {
      return {
        type: 'curve',
        points: knots.map(toNorm),
      };
    }
  }

  return null;
}

/**
 * Recognizes a two-stroke casual arrow: user draws a line/arc first, then draws a `<` / `^` / `v`
 * arrowhead chevron near either endpoint of that shaft and holds briefly.
 */
export function tryMergeTwoStrokeArrow(
  prevStroke: AnnotationStroke,
  headPoints: AnnotationPoint[],
  scaleX: number,
  scaleY: number
): AnnotationShape | null {
  if (prevStroke.kind !== 'pen' || headPoints.length < 4 || scaleX <= 0 || scaleY <= 0) {
    return null;
  }

  // 1. Validate headPoints as a clean open 2-wing chevron (< / > / ^ / v)
  const rawHead: Pt2D[] = headPoints.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
  const headLenPx = polylineLength(rawHead);
  let hMinX = Infinity;
  let hMaxX = -Infinity;
  let hMinY = Infinity;
  let hMaxY = -Infinity;
  for (let i = 0; i < rawHead.length; i++) {
    const p = rawHead[i];
    if (p.x < hMinX) hMinX = p.x;
    if (p.x > hMaxX) hMaxX = p.x;
    if (p.y < hMinY) hMinY = p.y;
    if (p.y > hMaxY) hMaxY = p.y;
  }
  const hDiag = Math.hypot(hMaxX - hMinX, hMaxY - hMinY);
  const hDirect = Math.hypot(
    rawHead[rawHead.length - 1].x - rawHead[0].x,
    rawHead[rawHead.length - 1].y - rawHead[0].y
  );
  if (headLenPx < 16 || headLenPx > 160 || hDiag < 12) return null;
  if (hDirect < Math.max(8, hDiag * 0.28)) return null; // closed loop is not an open chevron

  const resHead = resamplePolyline(rawHead, 24);
  let apexIdx = -1;
  let sharpest = 132;
  const startIdx = Math.floor(resHead.length * 0.2);
  const endIdx = Math.floor(resHead.length * 0.8);
  for (let i = startIdx; i <= endIdx; i++) {
    const ang = interiorAngleDeg(
      resHead[Math.max(0, i - 2)],
      resHead[i],
      resHead[Math.min(resHead.length - 1, i + 2)]
    );
    if (ang < sharpest) {
      sharpest = ang;
      apexIdx = i;
    }
  }
  if (apexIdx === -1 || sharpest < 26 || sharpest > 128) return null;

  const leg1 = resHead.slice(0, apexIdx + 1);
  const leg2 = resHead.slice(apexIdx);
  const leg1Len = polylineLength(leg1);
  const leg2Len = polylineLength(leg2);
  if (Math.min(leg1Len, leg2Len) < 7) return null;
  if (Math.min(leg1Len, leg2Len) / Math.max(leg1Len, leg2Len) < 0.36) return null;

  const apex = resHead[apexIdx];
  for (let i = 1; i < leg1.length - 1; i++) {
    if (distToSegment(leg1[i].x, leg1[i].y, leg1[0].x, leg1[0].y, apex.x, apex.y) > Math.max(6.5, leg1Len * 0.18)) {
      return null;
    }
  }
  for (let i = 1; i < leg2.length - 1; i++) {
    if (distToSegment(leg2[i].x, leg2[i].y, apex.x, apex.y, leg2[leg2.length - 1].x, leg2[leg2.length - 1].y) > Math.max(6.5, leg2Len * 0.18)) {
      return null;
    }
  }

  const baseMidX = (resHead[0].x + resHead[resHead.length - 1].x) * 0.5;
  const baseMidY = (resHead[0].y + resHead[resHead.length - 1].y) * 0.5;
  const chevVecX = apex.x - baseMidX;
  const chevVecY = apex.y - baseMidY;
  const chevLen = Math.hypot(chevVecX, chevVecY);
  if (chevLen < 4) return null;
  const chevUx = chevVecX / chevLen;
  const chevUy = chevVecY / chevLen;

  // Upgrade an existing single-headed arrow into a clean Bidirectional `<--->` Arrow!
  if (prevStroke.shape && prevStroke.shape.type === 'arrow' && !prevStroke.shape.bidirectional) {
    const arr = prevStroke.shape;
    const ax1 = arr.x1 * scaleX;
    const ay1 = arr.y1 * scaleY;
    const ax2 = arr.x2 * scaleX;
    const ay2 = arr.y2 * scaleY;
    const sLen = Math.hypot(ax2 - ax1, ay2 - ay1);
    const dTail = Math.hypot(apex.x - ax1, apex.y - ay1);
    const maxGap = Math.max(26, Math.min(48, sLen * 0.3));
    if (sLen >= 24 && dTail <= maxGap) {
      const outX = arr.cx !== undefined ? arr.x1 * scaleX - arr.cx * scaleX : ax1 - ax2;
      const outY = arr.cy !== undefined ? arr.y1 * scaleY - arr.cy * scaleY : ay1 - ay2;
      const outLen = Math.hypot(outX, outY) || 1;
      if ((outX / outLen) * chevUx + (outY / outLen) * chevUy >= 0.58) {
        const tailHeadLen = calibrateArrowHeadLen(sLen, (leg1Len + leg2Len) * 0.5);
        const tWings = buildArrowWings({ x: ax1, y: ay1 }, outX, outY, tailHeadLen);
        return {
          ...arr,
          bidirectional: true,
          tailLeftX: tWings.left.x / scaleX,
          tailLeftY: tWings.left.y / scaleY,
          tailRightX: tWings.right.x / scaleX,
          tailRightY: tWings.right.y / scaleY,
        };
      }
    }
  }

  // 2. Extract shaft descriptor from prevStroke (line, arc, or freehand line/arc)
  let p0: Pt2D;
  let p2: Pt2D;
  let ctrl: Pt2D | null = null;

  if (prevStroke.shape) {
    if (prevStroke.shape.type === 'line') {
      p0 = { x: prevStroke.shape.x1 * scaleX, y: prevStroke.shape.y1 * scaleY };
      p2 = { x: prevStroke.shape.x2 * scaleX, y: prevStroke.shape.y2 * scaleY };
    } else if (prevStroke.shape.type === 'arc') {
      p0 = { x: prevStroke.shape.x1 * scaleX, y: prevStroke.shape.y1 * scaleY };
      ctrl = { x: prevStroke.shape.cx * scaleX, y: prevStroke.shape.cy * scaleY };
      p2 = { x: prevStroke.shape.x2 * scaleX, y: prevStroke.shape.y2 * scaleY };
    } else {
      return null;
    }
  } else {
    if (prevStroke.points.length < 2) return null;
    const prevPts: Pt2D[] = prevStroke.points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
    const prevLen = polylineLength(prevPts);
    const prevDirect = Math.hypot(
      prevPts[prevPts.length - 1].x - prevPts[0].x,
      prevPts[prevPts.length - 1].y - prevPts[0].y
    );
    if (prevLen < 26 || prevDirect < 22) return null;

    p0 = prevPts[0];
    p2 = prevPts[prevPts.length - 1];
    let maxDev = 0;
    for (let i = 1; i < prevPts.length - 1; i++) {
      const d = distToSegment(prevPts[i].x, prevPts[i].y, p0.x, p0.y, p2.x, p2.y);
      if (d > maxDev) maxDev = d;
    }
    if (maxDev > Math.max(10.5, prevDirect * 0.085)) {
      const uniPrev = resamplePolyline(prevPts, 36);
      const arc = fitQuadraticArc(uniPrev);
      if (arc.maxErr > Math.max(15, prevLen * 0.11) || arc.meanErr > Math.max(7.5, prevLen * 0.05)) {
        return null;
      }
      ctrl = arc.ctrl;
    }
  }

  const shaftLen = Math.hypot(p2.x - p0.x, p2.y - p0.y);
  if (shaftLen < 24) return null;

  // 3. Match chevron apex to either endpoint of prevStroke
  const distStart = Math.hypot(apex.x - p0.x, apex.y - p0.y);
  const distEnd = Math.hypot(apex.x - p2.x, apex.y - p2.y);
  const maxSnapGap = Math.max(26, Math.min(48, shaftLen * 0.28));
  if (Math.min(distStart, distEnd) > maxSnapGap) return null;

  const tail = distEnd <= distStart ? p0 : p2;
  const tip = distEnd <= distStart ? p2 : p0;
  const tanX = ctrl ? tip.x - ctrl.x : tip.x - tail.x;
  const tanY = ctrl ? tip.y - ctrl.y : tip.y - tail.y;
  const tanLen = Math.hypot(tanX, tanY);
  if (tanLen < 2) return null;
  const tanUx = tanX / tanLen;
  const tanUy = tanY / tanLen;

  if (tanUx * chevUx + tanUy * chevUy < 0.62) return null;

  const headSize = calibrateArrowHeadLen(shaftLen, (leg1Len + leg2Len) * 0.5);
  const wings = buildArrowWings(tip, tanX, tanY, headSize);

  return {
    type: 'arrow',
    x1: tail.x / scaleX,
    y1: tail.y / scaleY,
    ...(ctrl ? { cx: ctrl.x / scaleX, cy: ctrl.y / scaleY } : {}),
    x2: tip.x / scaleX,
    y2: tip.y / scaleY,
    leftX: wings.left.x / scaleX,
    leftY: wings.left.y / scaleY,
    rightX: wings.right.x / scaleX,
    rightY: wings.right.y / scaleY,
  };
}

export interface SnapDragBase {
  shape: AnnotationShape;
  anchorX: number;
  anchorY: number;
}

function normalizeAngleRad(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function isAxisAlignedRect(points: ReadonlyArray<{ x: number; y: number }>, scaleX: number, scaleY: number): boolean {
  if (points.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const dx = Math.abs((b.x - a.x) * scaleX);
    const dy = Math.abs((b.y - a.y) * scaleY);
    const len = Math.hypot(dx, dy);
    if (len < 4) return false;
    const minor = Math.min(dx, dy);
    if (minor / len > 0.06) return false;
  }
  return true;
}

function applyRopeFalloffPoints(
  points: ReadonlyArray<{ x: number; y: number }>,
  anchorX: number,
  anchorY: number,
  targetX: number,
  targetY: number,
  scaleX: number,
  scaleY: number
): Array<{ x: number; y: number }> {
  const n = points.length;
  if (n < 2) return points.map((p) => ({ x: p.x, y: p.y }));

  // Compute cumulative arc length in screen pixels for smooth rope parameterization
  const cumLen = new Float64Array(n);
  let totalLen = 0;
  for (let i = 1; i < n; i++) {
    const dx = (points[i].x - points[i - 1].x) * scaleX;
    const dy = (points[i].y - points[i - 1].y) * scaleY;
    totalLen += Math.hypot(dx, dy);
    cumLen[i] = totalLen;
  }

  const p0x = points[0].x;
  const p0y = points[0].y;
  const p0PxX = p0x * scaleX;
  const p0PxY = p0y * scaleY;

  const oldDx = (anchorX - p0x) * scaleX;
  const oldDy = (anchorY - p0y) * scaleY;
  const oldChordLen = Math.hypot(oldDx, oldDy);

  const newDx = (targetX - p0x) * scaleX;
  const newDy = (targetY - p0y) * scaleY;
  const newChordLen = Math.hypot(newDx, newDy);

  // Measure compression vs chord to add natural gentle rope slack belly when pushed inward
  let slackPxX = 0;
  let slackPxY = 0;
  if (oldChordLen >= 10 && newChordLen < oldChordLen) {
    const compression = Math.min(oldChordLen * 0.55, oldChordLen - newChordLen);
    let signedArea = 0;
    const invChord = 1 / oldChordLen;
    const ux = oldDx * invChord;
    const uy = oldDy * invChord;
    for (let i = 1; i < n - 1; i++) {
      const rx = (points[i].x - p0x) * scaleX;
      const ry = (points[i].y - p0y) * scaleY;
      signedArea += ux * ry - uy * rx;
    }
    const side = signedArea >= 0 ? 1 : -1;
    const dirLen = Math.max(4, newChordLen);
    const nx = (-newDy / dirLen) * side;
    const ny = (newDx / dirLen) * side;
    const slackMag = compression * 0.22;
    slackPxX = nx * slackMag;
    slackPxY = ny * slackMag;
  }

  const out: Array<{ x: number; y: number }> = new Array(n);
  out[0] = { x: p0x, y: p0y };

  // Chord-frame similarity transform: scales & rotates ALL wave crests/zigzags cohesively around p0
  // instead of freezing the initial 35% of the curve.
  if (oldChordLen >= 10 && newChordLen >= 4) {
    const uxOld = oldDx / oldChordLen;
    const uyOld = oldDy / oldChordLen;
    const uxNew = newDx / newChordLen;
    const uyNew = newDy / newChordLen;
    const nxNew = -uyNew;
    const nyNew = uxNew;

    const lenRatio = newChordLen / oldChordLen;
    const ampScale = Math.max(0.55, Math.min(1.75, 0.65 + 0.35 * lenRatio));
    const dAngle = normalizeAngleRad(Math.atan2(newDy, newDx) - Math.atan2(oldDy, oldDx));

    // Exact endpoint reconciliation if lastPt differs slightly from snap anchor
    const lastPt = points[n - 1];
    const ldx = lastPt.x * scaleX - p0PxX;
    const ldy = lastPt.y * scaleY - p0PxY;
    const cosF = Math.cos(dAngle);
    const sinF = Math.sin(dAngle);
    const rotTipX = p0PxX + (ldx * cosF - ldy * sinF) * lenRatio;
    const rotTipY = p0PxY + (ldx * sinF + ldy * cosF) * lenRatio;
    const tipErrX = targetX * scaleX - rotTipX;
    const tipErrY = targetY * scaleY - rotTipY;

    for (let i = 1; i < n - 1; i++) {
      const u = totalLen > 1 ? cumLen[i] / totalLen : i / (n - 1);
      const rx = points[i].x * scaleX - p0PxX;
      const ry = points[i].y * scaleY - p0PxY;
      const along = rx * uxOld + ry * uyOld;
      const perp = -rx * uyOld + ry * uxOld;
      const alongFrac = along / oldChordLen;

      const sNew = alongFrac * newChordLen;
      const hNew = perp * ampScale;
      const belly = Math.sin(Math.PI * u);

      const finalPxX = p0PxX + uxNew * sNew + nxNew * hNew + tipErrX * u + slackPxX * belly;
      const finalPxY = p0PxY + uyNew * sNew + nyNew * hNew + tipErrY * u + slackPxY * belly;
      out[i] = { x: finalPxX / scaleX, y: finalPxY / scaleY };
    }
    out[n - 1] = { x: targetX, y: targetY };
    return out;
  }

  // Fallback for looped curves where start & end meet near the same point:
  // rotate & scale cohesively using the farthest point from p0 as reference axis
  let farIdx = -1;
  let farDist = 0;
  for (let i = 1; i < n - 1; i++) {
    const d = Math.hypot(points[i].x * scaleX - p0PxX, points[i].y * scaleY - p0PxY);
    if (d > farDist) {
      farDist = d;
      farIdx = i;
    }
  }

  const dispX = targetX - anchorX;
  const dispY = targetY - anchorY;
  const dispPxX = dispX * scaleX;
  const dispPxY = dispY * scaleY;

  if (farIdx > 0 && farDist >= 12) {
    const fdx = points[farIdx].x * scaleX - p0PxX;
    const fdy = points[farIdx].y * scaleY - p0PxY;
    const tdx = fdx + dispPxX * 0.5;
    const tdy = fdy + dispPxY * 0.5;
    const newFarDist = Math.hypot(tdx, tdy);
    if (newFarDist >= 6) {
      const dAng = normalizeAngleRad(Math.atan2(tdy, tdx) - Math.atan2(fdy, fdx));
      const sc = Math.max(0.35, Math.min(3.0, newFarDist / farDist));
      const cos = Math.cos(dAng);
      const sin = Math.sin(dAng);
      for (let i = 1; i < n - 1; i++) {
        const u = totalLen > 1 ? cumLen[i] / totalLen : i / (n - 1);
        const rx = points[i].x * scaleX - p0PxX;
        const ry = points[i].y * scaleY - p0PxY;
        const rPxX = p0PxX + (rx * cos - ry * sin) * sc + dispPxX * u * 0.5;
        const rPxY = p0PxY + (rx * sin + ry * cos) * sc + dispPxY * u * 0.5;
        out[i] = { x: rPxX / scaleX, y: rPxY / scaleY };
      }
      out[n - 1] = { x: targetX, y: targetY };
      return out;
    }
  }

  for (let i = 1; i < n - 1; i++) {
    const u = totalLen > 1 ? cumLen[i] / totalLen : i / (n - 1);
    const belly = Math.sin(Math.PI * u);
    out[i] = {
      x: points[i].x + dispX * u + (slackPxX * belly) / scaleX,
      y: points[i].y + dispY * u + (slackPxY * belly) / scaleY,
    };
  }
  out[n - 1] = {
    x: targetX,
    y: targetY,
  };
  return out;
}

/**
 * Returns the CSS-pixel coordinates of the anchored pivot point while dragging a snapped shape,
 * so a subtle live pin indicator can show where the rope/shape is anchored.
 */
export function getSnappedShapePinPoint(
  shape: AnnotationShape,
  base: SnapDragBase | null | undefined,
  tf: RenderTransform,
  lockPerfect = false
): { x: number; y: number } | null {
  if (shape.type === 'line' || shape.type === 'arc' || shape.type === 'arrow' || shape.type === 'brace') {
    return { x: shape.x1 * tf.scaleX + tf.offsetX, y: shape.y1 * tf.scaleY + tf.offsetY };
  }
  if ((shape.type === 'curve' || (shape.type === 'polygon' && !shape.closed)) && shape.points.length >= 2) {
    return {
      x: shape.points[0].x * tf.scaleX + tf.offsetX,
      y: shape.points[0].y * tf.scaleY + tf.offsetY,
    };
  }
  if (shape.type === 'polygon' && shape.closed && shape.points.length >= 3) {
    if (lockPerfect && !isAxisAlignedRect(shape.points, tf.scaleX, tf.scaleY)) {
      let mx = 0;
      let my = 0;
      for (const p of shape.points) {
        mx += p.x * tf.scaleX + tf.offsetX;
        my += p.y * tf.scaleY + tf.offsetY;
      }
      return { x: mx / shape.points.length, y: my / shape.points.length };
    }
    const src = base?.shape.type === 'polygon' ? base.shape : shape;
    const ax = base ? base.anchorX : src.points[0].x;
    const ay = base ? base.anchorY : src.points[0].y;
    let grabIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < src.points.length; i++) {
      const d = Math.hypot((src.points[i].x - ax) * tf.scaleX, (src.points[i].y - ay) * tf.scaleY);
      if (d < bestD) {
        bestD = d;
        grabIdx = i;
      }
    }
    let oppIdx = 0;
    let maxOppD = -1;
    if (isAxisAlignedRect(src.points, tf.scaleX, tf.scaleY)) {
      oppIdx = (grabIdx + 2) % 4;
    } else {
      for (let i = 0; i < src.points.length; i++) {
        const d = Math.hypot(
          (src.points[i].x - src.points[grabIdx].x) * tf.scaleX,
          (src.points[i].y - src.points[grabIdx].y) * tf.scaleY
        );
        if (d > maxOppD) {
          maxOppD = d;
          oppIdx = i;
        }
      }
    }
    return {
      x: src.points[oppIdx].x * tf.scaleX + tf.offsetX,
      y: src.points[oppIdx].y * tf.scaleY + tf.offsetY,
    };
  }
  if (shape.type === 'ellipse' && base?.shape.type === 'ellipse') {
    if (lockPerfect) {
      return {
        x: shape.cx * tf.scaleX + tf.offsetX,
        y: shape.cy * tf.scaleY + tf.offsetY,
      };
    }
    const cxPx = base.shape.cx * tf.scaleX + tf.offsetX;
    const cyPx = base.shape.cy * tf.scaleY + tf.offsetY;
    const axPx = base.anchorX * tf.scaleX + tf.offsetX;
    const ayPx = base.anchorY * tf.scaleY + tf.offsetY;
    if (Math.hypot(axPx - cxPx, ayPx - cyPx) >= 6) {
      return { x: cxPx * 2 - axPx, y: cyPx * 2 - ayPx };
    }
    return { x: cxPx, y: cyPx };
  }
  return null;
}

function snapAngle45Rad(dx: number, dy: number): number {
  const raw = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  return Math.round(raw / step) * step;
}

function snapAngleSoftMultipleRad(angleRad: number, stepRad: number, thresholdDeg: number): number {
  const nearest = Math.round(angleRad / stepRad) * stepRad;
  const diff = normalizeAngleRad(nearest - angleRad);
  if (Math.abs(diff) <= (thresholdDeg * Math.PI) / 180) {
    return angleRad + diff;
  }
  return angleRad;
}

interface PerfectPolygonData {
  cxPx: number;
  cyPx: number;
  pointsPx: Array<{ x: number; y: number }>;
  detentEdgesPx: number[];
}

function buildPerfectPolygonData(
  points: ReadonlyArray<{ x: number; y: number }>,
  scaleX: number,
  scaleY: number
): PerfectPolygonData {
  const n = points.length;
  const ptsPx = points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));

  let cxPx = 0;
  let cyPx = 0;
  for (let i = 0; i < n; i++) {
    cxPx += ptsPx[i].x;
    cyPx += ptsPx[i].y;
  }
  cxPx /= n;
  cyPx /= n;

  // Quad specialization: cleanly preserve Rectangles (distinct width/height) vs Squares vs Diamonds
  if (n === 4) {
    const angles = [0, 1, 2, 3].map((i) =>
      interiorAngleDeg(ptsPx[(i + 3) % 4], ptsPx[i], ptsPx[(i + 1) % 4])
    );
    const allNearRight = angles.every((a) => Math.abs(a - 90) <= 26);

    if (allNearRight) {
      let uxRaw = ptsPx[1].x - ptsPx[0].x + (ptsPx[2].x - ptsPx[3].x);
      let uyRaw = ptsPx[1].y - ptsPx[0].y + (ptsPx[2].y - ptsPx[3].y);
      if (Math.hypot(uxRaw, uyRaw) < 1e-3) {
        uxRaw = ptsPx[1].x - ptsPx[0].x;
        uyRaw = ptsPx[1].y - ptsPx[0].y;
      }
      const uAngle = snapAngleSoftMultipleRad(Math.atan2(uyRaw, uxRaw), Math.PI / 4, 9);
      const ux = Math.cos(uAngle);
      const uy = Math.sin(uAngle);

      const vxRaw = ptsPx[3].x - ptsPx[0].x + (ptsPx[2].x - ptsPx[1].x);
      const vyRaw = ptsPx[3].y - ptsPx[0].y + (ptsPx[2].y - ptsPx[1].y);
      const vSign = vxRaw * -uy + vyRaw * ux >= 0 ? 1 : -1;
      const vx = -uy * vSign;
      const vy = ux * vSign;

      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (const p of ptsPx) {
        const dx = p.x - cxPx;
        const dy = p.y - cyPx;
        const pu = dx * ux + dy * uy;
        const pv = dx * vx + dy * vy;
        if (pu < minU) minU = pu;
        if (pu > maxU) maxU = pu;
        if (pv < minV) minV = pv;
        if (pv > maxV) maxV = pv;
      }

      let wPx = Math.max(12, maxU - minU);
      let hPx = Math.max(12, maxV - minV);
      // Only snap to equal-sided Square if clearly drawn as a square; elongated shapes stay true Rectangles
      if (Math.abs(wPx - hPx) / Math.max(wPx, hPx) <= 0.15) {
        const side = Math.max(12, (wPx + hPx) * 0.5);
        wPx = side;
        hPx = side;
      }

      const hw = wPx * 0.5;
      const hh = hPx * 0.5;
      const pointsPx = [
        { x: cxPx - ux * hw - vx * hh, y: cyPx - uy * hw - vy * hh },
        { x: cxPx + ux * hw - vx * hh, y: cyPx + uy * hw - vy * hh },
        { x: cxPx + ux * hw + vx * hh, y: cyPx + uy * hw + vy * hh },
        { x: cxPx - ux * hw + vx * hh, y: cyPx - uy * hw + vy * hh },
      ];
      return {
        cxPx,
        cyPx,
        pointsPx,
        detentEdgesPx: [uAngle, uAngle + Math.PI * 0.25],
      };
    }

    // Check Diamond / Rhombus (nearly orthogonal diagonals)
    const d1x = ptsPx[2].x - ptsPx[0].x;
    const d1y = ptsPx[2].y - ptsPx[0].y;
    const d2x = ptsPx[3].x - ptsPx[1].x;
    const d2y = ptsPx[3].y - ptsPx[1].y;
    const l1 = Math.hypot(d1x, d1y);
    const l2 = Math.hypot(d2x, d2y);
    if (l1 > 10 && l2 > 10 && Math.abs((d1x * d2x + d1y * d2y) / (l1 * l2)) < 0.28) {
      const uAngle = snapAngleSoftMultipleRad(Math.atan2(d1y, d1x), Math.PI / 4, 9);
      const ux = Math.cos(uAngle);
      const uy = Math.sin(uAngle);
      const vSign = d2x * -uy + d2y * ux >= 0 ? 1 : -1;
      const vx = -uy * vSign;
      const vy = ux * vSign;
      let rx = Math.max(8, l1 * 0.5);
      let ry = Math.max(8, l2 * 0.5);
      if (Math.abs(rx - ry) / Math.max(rx, ry) <= 0.15) {
        const equalR = (rx + ry) * 0.5;
        rx = equalR;
        ry = equalR;
      }
      const pointsPx = [
        { x: cxPx - ux * rx, y: cyPx - uy * rx },
        { x: cxPx - vx * ry, y: cyPx - vy * ry },
        { x: cxPx + ux * rx, y: cyPx + uy * rx },
        { x: cxPx + vx * ry, y: cyPx + vy * ry },
      ];
      return {
        cxPx,
        cyPx,
        pointsPx,
        detentEdgesPx: [uAngle, uAngle + Math.PI * 0.25],
      };
    }
  }

  // Regular n-gon (Equilateral Triangle, Pentagon, Hexagon, fallback Square) preserving orientation & winding
  let rSum = 0;
  for (let i = 0; i < n; i++) {
    rSum += Math.hypot(ptsPx[i].x - cxPx, ptsPx[i].y - cyPx);
  }
  const radiusPx = Math.max(10, rSum / n);

  let signedArea2 = 0;
  for (let i = 0; i < n; i++) {
    const a = ptsPx[i];
    const b = ptsPx[(i + 1) % n];
    signedArea2 += a.x * b.y - b.x * a.y;
  }
  const dir = signedArea2 >= 0 ? 1 : -1;

  const step = (Math.PI * 2) / n;
  let sumC = 0;
  let sumS = 0;
  for (let i = 0; i < n; i++) {
    const ang = Math.atan2(ptsPx[i].y - cyPx, ptsPx[i].x - cxPx) - dir * i * step;
    sumC += Math.cos(ang);
    sumS += Math.sin(ang);
  }
  let theta0 = Math.atan2(sumS, sumC);

  // Soft initial level snap if an edge is already within 9° of crisp H/V
  const edgeShift = dir * (step * 0.5 + Math.PI * 0.5);
  let bestErr = Infinity;
  for (let i = 0; i < n; i++) {
    const eAng = theta0 + dir * i * step + edgeShift;
    const nearest90 = Math.round(eAng / (Math.PI / 2)) * (Math.PI / 2);
    const err = normalizeAngleRad(nearest90 - eAng);
    if (Math.abs(err) < Math.abs(bestErr)) {
      bestErr = err;
    }
  }
  if (Math.abs(bestErr) <= (9 * Math.PI) / 180) {
    theta0 += bestErr;
  }

  const pointsPx: Array<{ x: number; y: number }> = new Array(n);
  const detentEdgesPx: number[] = [];
  for (let i = 0; i < n; i++) {
    const ang = theta0 + dir * i * step;
    pointsPx[i] = {
      x: cxPx + Math.cos(ang) * radiusPx,
      y: cyPx + Math.sin(ang) * radiusPx,
    };
    detentEdgesPx.push(ang + edgeShift);
  }
  return { cxPx, cyPx, pointsPx, detentEdgesPx };
}

/**
 * Enforces exact geometric regularity on any snapped shape (used when Ctrl/Shift is held).
 */
export function enforcePerfectShape(
  shape: AnnotationShape,
  scaleX: number,
  scaleY: number
): AnnotationShape {
  if (scaleX <= 0 || scaleY <= 0) return shape;

  if (shape.type === 'line') {
    const dx = (shape.x2 - shape.x1) * scaleX;
    const dy = (shape.y2 - shape.y1) * scaleY;
    const len = Math.hypot(dx, dy);
    if (len < 2) return shape;
    const ang = snapAngle45Rad(dx, dy);
    return {
      ...shape,
      x2: shape.x1 + (Math.cos(ang) * len) / scaleX,
      y2: shape.y1 + (Math.sin(ang) * len) / scaleY,
    };
  }

  if (shape.type === 'brace') {
    const dx = (shape.x2 - shape.x1) * scaleX;
    const dy = (shape.y2 - shape.y1) * scaleY;
    const len = Math.hypot(dx, dy);
    if (len < 10) return shape;
    const ang = snapAngle45Rad(dx, dy);
    return {
      ...shape,
      x2: shape.x1 + (Math.cos(ang) * len) / scaleX,
      y2: shape.y1 + (Math.sin(ang) * len) / scaleY,
    };
  }

  if (shape.type === 'arrow') {
    const dx = (shape.x2 - shape.x1) * scaleX;
    const dy = (shape.y2 - shape.y1) * scaleY;
    const len = Math.hypot(dx, dy);
    if (len < 4) return shape;
    const ang = snapAngle45Rad(dx, dy);
    const p1x = shape.x1 * scaleX;
    const p1y = shape.y1 * scaleY;
    const tipX = p1x + Math.cos(ang) * len;
    const tipY = p1y + Math.sin(ang) * len;
    const headLen = Math.max(
      13,
      Math.min(28, Math.hypot((shape.leftX - shape.x2) * scaleX, (shape.leftY - shape.y2) * scaleY))
    );
    const wings = buildArrowWings({ x: tipX, y: tipY }, tipX - p1x, tipY - p1y, headLen);
    const tailWings = shape.bidirectional
      ? buildArrowWings({ x: p1x, y: p1y }, p1x - tipX, p1y - tipY, headLen)
      : null;
    return {
      type: 'arrow',
      x1: shape.x1,
      y1: shape.y1,
      x2: tipX / scaleX,
      y2: tipY / scaleY,
      leftX: wings.left.x / scaleX,
      leftY: wings.left.y / scaleY,
      rightX: wings.right.x / scaleX,
      rightY: wings.right.y / scaleY,
      ...(tailWings
        ? {
            bidirectional: true,
            tailLeftX: tailWings.left.x / scaleX,
            tailLeftY: tailWings.left.y / scaleY,
            tailRightX: tailWings.right.x / scaleX,
            tailRightY: tailWings.right.y / scaleY,
          }
        : {}),
    };
  }

  if (shape.type === 'ellipse') {
    const isRotated = Boolean(shape.rotation && Math.abs(shape.rotation) > 0.001);
    const isotropic = Boolean(shape.isCircle) || isRotated;
    const avgScale = (scaleX + scaleY) * 0.5;
    const rxPx = isotropic ? shape.rx * avgScale : shape.rx * scaleX;
    const ryPx = isotropic ? shape.ry * avgScale : shape.ry * scaleY;
    const rPx = Math.max(8, (rxPx + ryPx) * 0.5);
    return {
      type: 'ellipse',
      cx: shape.cx,
      cy: shape.cy,
      rx: rPx / avgScale,
      ry: rPx / avgScale,
      isCircle: true,
    };
  }

  if (shape.type === 'polygon' && shape.closed && shape.points.length >= 3) {
    const { pointsPx } = buildPerfectPolygonData(shape.points, scaleX, scaleY);
    return {
      ...shape,
      points: pointsPx.map((p) => ({ x: p.x / scaleX, y: p.y / scaleY })),
    };
  }

  return shape;
}

function isNearOrthogonalQuad(
  points: ReadonlyArray<{ x: number; y: number }>,
  scaleX: number,
  scaleY: number
): boolean {
  if (points.length !== 4) return false;
  const pts = points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
  for (let i = 0; i < 4; i++) {
    const ang = interiorAngleDeg(pts[(i + 3) % 4], pts[i], pts[(i + 1) % 4]);
    if (Math.abs(ang - 90) > 12) return false;
  }
  return true;
}

/**
 * Live post-snap shape adjustment while the user keeps pressing & dragging after Hold-to-Snap.
 * Keeps every shape fluid and elastic ("like a loose rope / rubber band") pinned to the pen:
 * - Curves, open polylines, and curved arcs/arrows drape and bend smoothly like a rope.
 * - Circles/ellipses squash, elongate, and swing freely around the opposite pinned edge.
 * - Rectangles stretch width/height independently; triangles & polygons flex elastically from the grabbed corner.
 * - Lines swing freely 360° with minimal H/V friction.
 */
export function adjustSnappedShapeOnDrag(
  shape: AnnotationShape,
  rawPt: AnnotationPoint,
  scaleX: number,
  scaleY: number,
  base?: SnapDragBase | null,
  lockPerfect = false
): AnnotationShape {
  if (scaleX <= 0 || scaleY <= 0) return shape;

  if (shape.type === 'line') {
    const src = base?.shape.type === 'line' ? base.shape : shape;
    let x2 = rawPt.x;
    let y2 = rawPt.y;
    const dxPx = (x2 - src.x1) * scaleX;
    const dyPx = (y2 - src.y1) * scaleY;
    const lenPx = Math.hypot(dxPx, dyPx);
    if (lockPerfect && lenPx >= 2) {
      const ang = snapAngle45Rad(dxPx, dyPx);
      x2 = src.x1 + (Math.cos(ang) * lenPx) / scaleX;
      y2 = src.y1 + (Math.sin(ang) * lenPx) / scaleY;
      return { ...src, x2, y2 };
    }
    const angleDeg = Math.abs((Math.atan2(dyPx, dxPx) * 180) / Math.PI);
    // Light 1.8 deg detent only so the line feels fluid and unrestricted like a string
    if (angleDeg < 1.8 || Math.abs(angleDeg - 180) < 1.8) {
      y2 = src.y1;
    } else if (Math.abs(angleDeg - 90) < 1.8) {
      x2 = src.x1;
    }
    return { ...src, x2, y2 };
  }

  if (shape.type === 'arc') {
    const src = base?.shape.type === 'arc' ? base.shape : shape;
    const p0x = src.x1 * scaleX;
    const p0y = src.y1 * scaleY;
    const oldEndX = src.x2 * scaleX;
    const oldEndY = src.y2 * scaleY;
    let newEndX = rawPt.x * scaleX;
    let newEndY = rawPt.y * scaleY;

    const oldDx = oldEndX - p0x;
    const oldDy = oldEndY - p0y;
    const oldLen = Math.hypot(oldDx, oldDy);
    const rawNewDx = newEndX - p0x;
    const rawNewDy = newEndY - p0y;
    const newLen = Math.hypot(rawNewDx, rawNewDy);
    if (oldLen < 2.5 || newLen < 2.5) return shape;

    if (lockPerfect) {
      const ang = snapAngle45Rad(rawNewDx, rawNewDy);
      newEndX = p0x + Math.cos(ang) * newLen;
      newEndY = p0y + Math.sin(ang) * newLen;
    }
    const newDx = newEndX - p0x;
    const newDy = newEndY - p0y;

    // Decompose control point into chord-aligned (t) and perpendicular rope bow (bow)
    const oldMidX = (p0x + oldEndX) * 0.5;
    const oldMidY = (p0y + oldEndY) * 0.5;
    const cdx = src.cx * scaleX - oldMidX;
    const cdy = src.cy * scaleY - oldMidY;
    const oldUx = oldDx / oldLen;
    const oldUy = oldDy / oldLen;
    const parallelFrac = lockPerfect ? 0 : (cdx * oldUx + cdy * oldUy) / oldLen;
    const perpBow = -cdx * oldUy + cdy * oldUx;

    const newMidX = (p0x + newEndX) * 0.5;
    const newMidY = (p0y + newEndY) * 0.5;
    const newUx = newDx / newLen;
    const newUy = newDy / newLen;
    // Elastic bow: retains natural bend when pushed inward (slack rope) & tightens gracefully when pulled taut
    const lenRatio = Math.max(0.25, Math.min(2.6, newLen / oldLen));
    const elasticBow = perpBow * (0.65 + 0.35 * lenRatio);
    const ncx = newMidX + newUx * (parallelFrac * newLen) - newUy * elasticBow;
    const ncy = newMidY + newUy * (parallelFrac * newLen) + newUx * elasticBow;

    return {
      ...src,
      cx: ncx / scaleX,
      cy: ncy / scaleY,
      x2: newEndX / scaleX,
      y2: newEndY / scaleY,
    };
  }

  if (shape.type === 'ellipse') {
    const src = base?.shape.type === 'ellipse' ? base.shape : shape;
    const cxPx = src.cx * scaleX;
    const cyPx = src.cy * scaleY;
    const isRotated = Boolean(src.rotation && Math.abs(src.rotation) > 0.001);
    const avgScale = (scaleX + scaleY) * 0.5;
    const isotropicSrc = Boolean(src.isCircle) || isRotated;
    const baseRxPx = isotropicSrc ? src.rx * avgScale : src.rx * scaleX;
    const baseRyPx = isotropicSrc ? src.ry * avgScale : src.ry * scaleY;

    const px = rawPt.x * scaleX;
    const py = rawPt.y * scaleY;

    if (lockPerfect) {
      // Lock into a 100% pure concentric circle centered at (cx, cy) so it never wobbles or goes oval
      const baseR = Math.max(8, (baseRxPx + baseRyPx) * 0.5);
      const rNow = Math.hypot(px - cxPx, py - cyPx);
      let nextR = baseR;
      if (base) {
        const r0 = Math.hypot(base.anchorX * scaleX - cxPx, base.anchorY * scaleY - cyPx);
        if (r0 >= 6) {
          const scale = Math.max(0.25, Math.min(5, rNow / r0));
          nextR = Math.max(8, baseR * scale);
        }
      } else if (rNow >= 8) {
        nextR = rNow;
      }
      return {
        type: 'ellipse',
        cx: src.cx,
        cy: src.cy,
        rx: nextR / avgScale,
        ry: nextR / avgScale,
        isCircle: true,
      };
    }

    if (base) {
      const ax = base.anchorX * scaleX - cxPx;
      const ay = base.anchorY * scaleY - cyPx;
      const r0 = Math.hypot(ax, ay);
      if (r0 >= 6) {
        const isCircle = Math.abs(baseRxPx - baseRyPx) <= 1.5;
        const dragFromAnchor = Math.hypot(px - base.anchorX * scaleX, py - base.anchorY * scaleY);

        // Gentle stability deadzone: small hand micro-jitter right after snapping stays a clean stable circle
        if (isCircle && dragFromAnchor < 12) {
          const rNow = Math.max(8, (baseRxPx + baseRyPx) * 0.5);
          return {
            type: 'ellipse',
            cx: src.cx,
            cy: src.cy,
            rx: rNow / avgScale,
            ry: rNow / avgScale,
            isCircle: true,
          };
        }

        // Elastic lasso: far opposite side stays pinned while your pen pulls, squashes, elongates & pivots
        const oppX = cxPx - ax;
        const oppY = cyPx - ay;
        const vx = px - oppX;
        const vy = py - oppY;
        const vLen = Math.max(10, Math.hypot(vx, vy));
        const newCxPx = oppX + vx * 0.5;
        const newCyPx = oppY + vy * 0.5;
        const stretchScale = Math.max(0.16, Math.min(6, (vLen * 0.5) / r0));
        const crossScale = Math.max(0.45, Math.min(2.2, 0.72 + 0.28 * stretchScale));

        let nextRxPx: number;
        let nextRyPx: number;
        let nextRot: number | undefined;

        if (isCircle) {
          nextRxPx = Math.max(5, baseRxPx * stretchScale);
          nextRyPx = Math.max(5, baseRyPx * crossScale);
          nextRot = Math.abs(nextRxPx - nextRyPx) > 1.2 ? Math.atan2(vy, vx) : undefined;
        } else {
          const rot0 = src.rotation ?? 0;
          const cos0 = Math.cos(-rot0);
          const sin0 = Math.sin(-rot0);
          const locX = ax * cos0 - ay * sin0;
          const locY = ax * sin0 + ay * cos0;
          const pullAlongMajor = Math.abs(locX / Math.max(1, baseRxPx)) >= Math.abs(locY / Math.max(1, baseRyPx));
          nextRxPx = Math.max(5, baseRxPx * (pullAlongMajor ? stretchScale : crossScale));
          nextRyPx = Math.max(5, baseRyPx * (pullAlongMajor ? crossScale : stretchScale));
          const dAngle = normalizeAngleRad(Math.atan2(vy, vx) - Math.atan2(ay, ax));
          nextRot = rot0 + dAngle;
        }

        const nextIsRotated = Boolean(nextRot && Math.abs(nextRot) > 0.001);
        const nextIsCircle = !nextIsRotated && Math.abs(nextRxPx - nextRyPx) <= 1.2;
        const nextIsotropic = nextIsRotated || nextIsCircle;
        return {
          type: 'ellipse',
          cx: newCxPx / scaleX,
          cy: newCyPx / scaleY,
          rx: nextIsotropic ? nextRxPx / avgScale : nextRxPx / scaleX,
          ry: nextIsotropic ? nextRyPx / avgScale : nextRyPx / scaleY,
          rotation: nextIsRotated ? nextRot : undefined,
          ...(nextIsCircle ? { isCircle: true } : {}),
        };
      }
    }

    // Fallback if no anchor: center-based elastic stretch
    const dx = Math.abs(px - cxPx);
    const dy = Math.abs(py - cyPx);
    const nextRxPx = Math.max(6, dx > 6 ? dx : baseRxPx);
    const nextRyPx = Math.max(6, dy > 6 ? dy : baseRyPx);
    const fallbackCircle = !isRotated && Math.abs(nextRxPx - nextRyPx) <= 1.2;
    const fallbackIso = isRotated || fallbackCircle;
    return {
      type: 'ellipse',
      cx: src.cx,
      cy: src.cy,
      rx: fallbackIso ? nextRxPx / avgScale : nextRxPx / scaleX,
      ry: fallbackIso ? nextRyPx / avgScale : nextRyPx / scaleY,
      ...(isRotated ? { rotation: src.rotation } : {}),
      ...(fallbackCircle ? { isCircle: true } : {}),
    };
  }

  if (shape.type === 'polygon' && shape.points.length >= 2) {
    const src = base?.shape.type === 'polygon' ? base.shape : shape;
    if (src.closed) {
      const n = src.points.length;
      const ax = base ? base.anchorX : src.points[0].x;
      const ay = base ? base.anchorY : src.points[0].y;

      let grabIdx = 0;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot((src.points[i].x - ax) * scaleX, (src.points[i].y - ay) * scaleY);
        if (d < bestD) {
          bestD = d;
          grabIdx = i;
        }
      }

      if (lockPerfect && n >= 3) {
        const { cxPx, cyPx, pointsPx, detentEdgesPx } = buildPerfectPolygonData(
          src.points,
          scaleX,
          scaleY
        );
        const axPx = ax * scaleX;
        const ayPx = ay * scaleY;
        const px = rawPt.x * scaleX;
        const py = rawPt.y * scaleY;

        const dx0 = axPx - cxPx;
        const dy0 = ayPx - cyPx;
        const dx1 = px - cxPx;
        const dy1 = py - cyPx;
        const r0 = Math.hypot(dx0, dy0);
        const rNow = Math.hypot(dx1, dy1);
        const scale = r0 >= 6 ? Math.max(0.25, Math.min(5, rNow / r0)) : 1;

        let deltaAngle =
          r0 >= 6 && rNow >= 6
            ? normalizeAngleRad(Math.atan2(dy1, dx1) - Math.atan2(dy0, dx0))
            : 0;

        // Subtle ±3.5° settle on horizontal/vertical (and 45° for quads) while allowing smooth 360° orbiting
        if (Math.abs(deltaAngle) > 0.001 && detentEdgesPx.length > 0) {
          let bestErr = Infinity;
          for (const eAng of detentEdgesPx) {
            const curAng = eAng + deltaAngle;
            const nearest90 = Math.round(curAng / (Math.PI / 2)) * (Math.PI / 2);
            const err = normalizeAngleRad(nearest90 - curAng);
            if (Math.abs(err) < Math.abs(bestErr)) {
              bestErr = err;
            }
          }
          if (Math.abs(bestErr) <= (3.5 * Math.PI) / 180) {
            deltaAngle = normalizeAngleRad(deltaAngle + bestErr);
          }
        }

        const cos = Math.cos(deltaAngle);
        const sin = Math.sin(deltaAngle);
        return {
          ...src,
          points: pointsPx.map((p) => {
            const vx = p.x - cxPx;
            const vy = p.y - cyPx;
            return {
              x: (cxPx + (vx * cos - vy * sin) * scale) / scaleX,
              y: (cyPx + (vx * sin + vy * cos) * scale) / scaleY,
            };
          }),
        };
      }

      if (isAxisAlignedRect(src.points, scaleX, scaleY)) {
        const oppIdx = (grabIdx + 2) % 4;
        const ox = src.points[oppIdx].x;
        const oy = src.points[oppIdx].y;
        const gx = src.points[grabIdx].x;
        const gy = src.points[grabIdx].y;
        const spanX = gx - ox;
        const spanY = gy - oy;
        const dispX = rawPt.x - ax;
        const dispY = rawPt.y - ay;

        const clampAxisScale = (val: number, spanPx: number): number => {
          const minAbs = 8 / Math.max(8, Math.abs(spanPx));
          if (Math.abs(val) < minAbs) return val >= 0 ? minAbs : -minAbs;
          return Math.max(-5, Math.min(5, val));
        };

        const sx =
          Math.abs(spanX * scaleX) >= 6
            ? clampAxisScale((gx + dispX - ox) / spanX, spanX * scaleX)
            : 1;
        const sy =
          Math.abs(spanY * scaleY) >= 6
            ? clampAxisScale((gy + dispY - oy) / spanY, spanY * scaleY)
            : 1;

        return {
          ...src,
          points: src.points.map((p) => ({
            x: ox + (p.x - ox) * sx,
            y: oy + (p.y - oy) * sy,
          })),
        };
      }

      // Tilted orthogonal rectangles preserve crisp 90° corners when stretching along local frame
      if (isNearOrthogonalQuad(src.points, scaleX, scaleY)) {
        const oppIdx = (grabIdx + 2) % 4;
        const n1Idx = (oppIdx + 1) % 4;
        const n2Idx = (oppIdx + 3) % 4;
        const ox = src.points[oppIdx].x * scaleX;
        const oy = src.points[oppIdx].y * scaleY;
        const uRawX = src.points[n1Idx].x * scaleX - ox;
        const uRawY = src.points[n1Idx].y * scaleY - oy;
        const uLen = Math.hypot(uRawX, uRawY) || 1;
        const ux = uRawX / uLen;
        const uy = uRawY / uLen;
        const vRawX = src.points[n2Idx].x * scaleX - ox;
        const vRawY = src.points[n2Idx].y * scaleY - oy;
        const vSign = vRawX * -uy + vRawY * ux >= 0 ? 1 : -1;
        const vx = -uy * vSign;
        const vy = ux * vSign;

        const targetX = (src.points[grabIdx].x + (rawPt.x - ax)) * scaleX - ox;
        const targetY = (src.points[grabIdx].y + (rawPt.y - ay)) * scaleY - oy;
        let w = targetX * ux + targetY * uy;
        let h = targetX * vx + targetY * vy;
        if (Math.abs(w) < 8) w = w >= 0 ? 8 : -8;
        if (Math.abs(h) < 8) h = h >= 0 ? 8 : -8;

        const outPx: Pt2D[] = new Array(4);
        outPx[oppIdx] = { x: ox, y: oy };
        outPx[n1Idx] = { x: ox + ux * w, y: oy + uy * w };
        outPx[grabIdx] = { x: ox + ux * w + vx * h, y: oy + uy * w + vy * h };
        outPx[n2Idx] = { x: ox + vx * h, y: oy + vy * h };
        return {
          ...src,
          points: outPx.map((p) => ({ x: p.x / scaleX, y: p.y / scaleY })),
        };
      }

      let oppIdx = 0;
      let maxOppD = -1;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(
          (src.points[i].x - src.points[grabIdx].x) * scaleX,
          (src.points[i].y - src.points[grabIdx].y) * scaleY
        );
        if (d > maxOppD) {
          maxOppD = d;
          oppIdx = i;
        }
      }
      const oxPx = src.points[oppIdx].x * scaleX;
      const oyPx = src.points[oppIdx].y * scaleY;
      const v0x = ax * scaleX - oxPx;
      const v0y = ay * scaleY - oyPx;
      const v1x = rawPt.x * scaleX - oxPx;
      const v1y = rawPt.y * scaleY - oyPx;
      const r0 = Math.hypot(v0x, v0y);
      const r1 = Math.hypot(v1x, v1y);

      if (r0 >= 8 && r1 >= 8) {
        const dAngle = normalizeAngleRad(Math.atan2(v1y, v1x) - Math.atan2(v0y, v0x));
        const sc = Math.max(0.25, Math.min(5, r1 / r0));
        const cos = Math.cos(dAngle);
        const sin = Math.sin(dAngle);
        return {
          ...src,
          points: src.points.map((p, i) => {
            if (i === oppIdx) return { x: p.x, y: p.y };
            const px = p.x * scaleX - oxPx;
            const py = p.y * scaleY - oyPx;
            return {
              x: (oxPx + (px * cos - py * sin) * sc) / scaleX,
              y: (oyPx + (px * sin + py * cos) * sc) / scaleY,
            };
          }),
        };
      }

      const ox = src.points[oppIdx].x;
      const oy = src.points[oppIdx].y;
      const maxSpan = Math.max(12, maxOppD);
      const dispX = rawPt.x - ax;
      const dispY = rawPt.y - ay;

      return {
        ...src,
        points: src.points.map((p, i) => {
          if (i === oppIdx) return { x: p.x, y: p.y };
          const d = Math.hypot((p.x - ox) * scaleX, (p.y - oy) * scaleY);
          const w = i === grabIdx ? 1 : Math.pow(Math.max(0, Math.min(1, d / maxSpan)), 1.25);
          return {
            x: p.x + dispX * w,
            y: p.y + dispY * w,
          };
        }),
      };
    }

    const lastPt = src.points[src.points.length - 1];
    const ax = base ? base.anchorX : lastPt.x;
    const ay = base ? base.anchorY : lastPt.y;
    return {
      ...src,
      points: applyRopeFalloffPoints(src.points, ax, ay, rawPt.x, rawPt.y, scaleX, scaleY),
    };
  }

  if (shape.type === 'curve' && shape.points.length >= 2) {
    const src = base?.shape.type === 'curve' ? base.shape : shape;
    const lastPt = src.points[src.points.length - 1];
    const ax = base ? base.anchorX : lastPt.x;
    const ay = base ? base.anchorY : lastPt.y;
    return {
      ...src,
      points: applyRopeFalloffPoints(src.points, ax, ay, rawPt.x, rawPt.y, scaleX, scaleY),
    };
  }

  if (shape.type === 'brace') {
    const src = base?.shape.type === 'brace' ? base.shape : shape;
    const p0x = src.x1 * scaleX;
    const p0y = src.y1 * scaleY;
    const oldLen = Math.max(12, Math.hypot(src.x2 * scaleX - p0x, src.y2 * scaleY - p0y));
    let newEndX = rawPt.x * scaleX;
    let newEndY = rawPt.y * scaleY;
    const dx = newEndX - p0x;
    const dy = newEndY - p0y;
    const newLen = Math.hypot(dx, dy);
    if (newLen < 12) return shape;

    if (lockPerfect) {
      const ang = snapAngle45Rad(dx, dy);
      newEndX = p0x + Math.cos(ang) * newLen;
      newEndY = p0y + Math.sin(ang) * newLen;
    } else {
      const deg = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
      if (deg < 1.8 || Math.abs(deg - 180) < 1.8) newEndY = p0y;
      else if (Math.abs(deg - 90) < 1.8) newEndX = p0x;
    }

    const scaleDepth = Math.max(0.45, Math.min(2.2, 0.45 + 0.55 * (newLen / oldLen)));
    const nextDepth =
      Math.sign(src.depth || 1) *
      Math.max(8, Math.min((newLen * 0.44) / (((scaleX + scaleY) * 0.5) || 1), Math.abs(src.depth) * scaleDepth));
    return {
      type: 'brace',
      x1: src.x1,
      y1: src.y1,
      x2: newEndX / scaleX,
      y2: newEndY / scaleY,
      depth: nextDepth,
    };
  }

  if (shape.type === 'arrow') {
    const src = base?.shape.type === 'arrow' ? base.shape : shape;
    const p0x = src.x1 * scaleX;
    const p0y = src.y1 * scaleY;
    const oldEndX = src.x2 * scaleX;
    const oldEndY = src.y2 * scaleY;

    // Smoothly blend out initial arrowhead-hook offset over the first 28px so pixel-1 drag never jumps
    let newEndX = rawPt.x * scaleX;
    let newEndY = rawPt.y * scaleY;
    if (base) {
      const offX = oldEndX - base.anchorX * scaleX;
      const offY = oldEndY - base.anchorY * scaleY;
      const dMove = Math.hypot(newEndX - base.anchorX * scaleX, newEndY - base.anchorY * scaleY);
      const blend = Math.max(0, 1 - dMove / 28);
      newEndX += offX * blend;
      newEndY += offY * blend;
    }

    if (lockPerfect) {
      const dx = newEndX - p0x;
      const dy = newEndY - p0y;
      const len = Math.hypot(dx, dy);
      if (len >= 4) {
        const ang = snapAngle45Rad(dx, dy);
        newEndX = p0x + Math.cos(ang) * len;
        newEndY = p0y + Math.sin(ang) * len;
      }
    }

    const headLen = Math.max(
      11,
      Math.min(24, Math.hypot(src.leftX * scaleX - oldEndX, src.leftY * scaleY - oldEndY))
    );

    if (src.cx !== undefined && src.cy !== undefined && !lockPerfect) {
      const oldDx = oldEndX - p0x;
      const oldDy = oldEndY - p0y;
      const oldLen = Math.hypot(oldDx, oldDy);
      const newDx = newEndX - p0x;
      const newDy = newEndY - p0y;
      const newLen = Math.hypot(newDx, newDy);
      if (oldLen < 4 || newLen < 4) return shape;

      const oldMidX = (p0x + oldEndX) * 0.5;
      const oldMidY = (p0y + oldEndY) * 0.5;
      const cdx = src.cx * scaleX - oldMidX;
      const cdy = src.cy * scaleY - oldMidY;
      const oldUx = oldDx / oldLen;
      const oldUy = oldDy / oldLen;
      const parallelFrac = (cdx * oldUx + cdy * oldUy) / oldLen;
      const perpBow = -cdx * oldUy + cdy * oldUx;

      const newMidX = (p0x + newEndX) * 0.5;
      const newMidY = (p0y + newEndY) * 0.5;
      const newUx = newDx / newLen;
      const newUy = newDy / newLen;
      const lenRatio = Math.max(0.25, Math.min(2.6, newLen / oldLen));
      const elasticBow = perpBow * (0.65 + 0.35 * lenRatio);
      const ncx = newMidX + newUx * (parallelFrac * newLen) - newUy * elasticBow;
      const ncy = newMidY + newUy * (parallelFrac * newLen) + newUx * elasticBow;

      const wings = buildArrowWings({ x: newEndX, y: newEndY }, newEndX - ncx, newEndY - ncy, headLen);
      const tailWings = src.bidirectional
        ? buildArrowWings({ x: p0x, y: p0y }, p0x - ncx, p0y - ncy, headLen)
        : null;
      return {
        ...src,
        cx: ncx / scaleX,
        cy: ncy / scaleY,
        x2: newEndX / scaleX,
        y2: newEndY / scaleY,
        leftX: wings.left.x / scaleX,
        leftY: wings.left.y / scaleY,
        rightX: wings.right.x / scaleX,
        rightY: wings.right.y / scaleY,
        ...(tailWings
          ? {
              bidirectional: true,
              tailLeftX: tailWings.left.x / scaleX,
              tailLeftY: tailWings.left.y / scaleY,
              tailRightX: tailWings.right.x / scaleX,
              tailRightY: tailWings.right.y / scaleY,
            }
          : {}),
      };
    }

    if (!lockPerfect) {
      const deg = Math.abs((Math.atan2(newEndY - p0y, newEndX - p0x) * 180) / Math.PI);
      if (deg < 1.8 || Math.abs(deg - 180) < 1.8) newEndY = p0y;
      else if (Math.abs(deg - 90) < 1.8) newEndX = p0x;
    }
    if (Math.hypot(newEndX - p0x, newEndY - p0y) < 4) return shape;

    const wings = buildArrowWings({ x: newEndX, y: newEndY }, newEndX - p0x, newEndY - p0y, headLen);
    const tailWings = src.bidirectional
      ? buildArrowWings({ x: p0x, y: p0y }, p0x - newEndX, p0y - newEndY, headLen)
      : null;
    return {
      type: 'arrow',
      x1: src.x1,
      y1: src.y1,
      x2: newEndX / scaleX,
      y2: newEndY / scaleY,
      leftX: wings.left.x / scaleX,
      leftY: wings.left.y / scaleY,
      rightX: wings.right.x / scaleX,
      rightY: wings.right.y / scaleY,
      ...(tailWings
        ? {
            bidirectional: true,
            tailLeftX: tailWings.left.x / scaleX,
            tailLeftY: tailWings.left.y / scaleY,
            tailRightX: tailWings.right.x / scaleX,
            tailRightY: tailWings.right.y / scaleY,
          }
        : {}),
    };
  }

  return shape;
}

/**
 * High-precision stroke hit test in screen pixels (supports freehand strokes AND every universal snapped shape).
 */
export function hitTestStroke(
  screenX: number,
  screenY: number,
  stroke: AnnotationStroke,
  eraserRadiusPx: number,
  tf: RenderTransform
): boolean {
  const strokePad = Math.max(2, stroke.size * tf.unitScale * 0.5);
  const threshold = eraserRadiusPx + strokePad;

  if (stroke.shape) {
    if (stroke.shape.type === 'line') {
      const x1 = stroke.shape.x1 * tf.scaleX + tf.offsetX;
      const y1 = stroke.shape.y1 * tf.scaleY + tf.offsetY;
      const x2 = stroke.shape.x2 * tf.scaleX + tf.offsetX;
      const y2 = stroke.shape.y2 * tf.scaleY + tf.offsetY;
      return distToSegment(screenX, screenY, x1, y1, x2, y2) <= threshold;
    }

    if (stroke.shape.type === 'ellipse') {
      const cx = stroke.shape.cx * tf.scaleX + tf.offsetX;
      const cy = stroke.shape.cy * tf.scaleY + tf.offsetY;
      const { rxPx, ryPx } = resolveEllipseScreenRadii(
        stroke.shape.rx,
        stroke.shape.ry,
        stroke.shape.rotation,
        tf,
        stroke.shape.isCircle
      );
      const rot = stroke.shape.rotation ?? 0;
      const dx = screenX - cx;
      const dy = screenY - cy;
      const cos = Math.cos(-rot);
      const sin = Math.sin(-rot);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      const angle = Math.atan2(ly / ryPx, lx / rxPx);
      const ex = Math.cos(angle) * rxPx;
      const ey = Math.sin(angle) * ryPx;
      return Math.hypot(lx - ex, ly - ey) <= threshold;
    }

    // Arc, Polygon (open or closed), Arrow, and Smooth Curve
    const polylines = sampleShapeToPolylines(stroke.shape, tf, 6);
    for (const poly of polylines) {
      for (let i = 0; i < poly.length - 1; i++) {
        if (
          distToSegment(screenX, screenY, poly[i].x, poly[i].y, poly[i + 1].x, poly[i + 1].y) <=
          threshold
        ) {
          return true;
        }
      }
    }
    return false;
  }

  const pts = stroke.points;
  if (pts.length === 0) return false;
  if (pts.length === 1) {
    const px = pts[0].x * tf.scaleX + tf.offsetX;
    const py = pts[0].y * tf.scaleY + tf.offsetY;
    return Math.hypot(screenX - px, screenY - py) <= threshold;
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x * tf.scaleX + tf.offsetX;
    const ay = pts[i].y * tf.scaleY + tf.offsetY;
    const bx = pts[i + 1].x * tf.scaleX + tf.offsetX;
    const by = pts[i + 1].y * tf.scaleY + tf.offsetY;
    if (distToSegment(screenX, screenY, ax, ay, bx, by) <= threshold) {
      return true;
    }
  }
  return false;
}

function segmentsIntersect2D(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  const ccw = (p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number) =>
    (p3y - p1y) * (p2x - p1x) - (p2y - p1y) * (p3x - p1x);
  const d1 = ccw(cx, cy, dx, dy, ax, ay);
  const d2 = ccw(cx, cy, dx, dy, bx, by);
  const d3 = ccw(ax, ay, bx, by, cx, cy);
  const d4 = ccw(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function distSegmentToSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): number {
  if (segmentsIntersect2D(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distToSegment(ax, ay, cx, cy, dx, dy),
    distToSegment(bx, by, cx, cy, dx, dy),
    distToSegment(cx, cy, ax, ay, bx, by),
    distToSegment(dx, dy, ax, ay, bx, by)
  );
}

/**
 * Capsule sweep hit test between segment (x1,y1)->(x2,y2) and any stroke or shape.
 * Prevents fast eraser drags from skipping over thin strokes.
 */
export function hitTestStrokeSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: AnnotationStroke,
  eraserRadiusPx: number,
  tf: RenderTransform
): boolean {
  if (Math.hypot(x2 - x1, y2 - y1) < 0.5) {
    return hitTestStroke(x2, y2, stroke, eraserRadiusPx, tf);
  }
  const strokePad = Math.max(2, stroke.size * tf.unitScale * 0.5);
  const threshold = eraserRadiusPx + strokePad;

  if (stroke.shape) {
    if (stroke.shape.type === 'line') {
      const lx1 = stroke.shape.x1 * tf.scaleX + tf.offsetX;
      const ly1 = stroke.shape.y1 * tf.scaleY + tf.offsetY;
      const lx2 = stroke.shape.x2 * tf.scaleX + tf.offsetX;
      const ly2 = stroke.shape.y2 * tf.scaleY + tf.offsetY;
      return distSegmentToSegment(x1, y1, x2, y2, lx1, ly1, lx2, ly2) <= threshold;
    }
    const polylines = sampleShapeToPolylines(stroke.shape, tf, 5);
    for (const poly of polylines) {
      for (let i = 0; i < poly.length - 1; i++) {
        if (
          distSegmentToSegment(x1, y1, x2, y2, poly[i].x, poly[i].y, poly[i + 1].x, poly[i + 1].y) <=
          threshold
        ) {
          return true;
        }
      }
    }
    return false;
  }

  const pts = stroke.points;
  if (pts.length === 0) return false;
  if (pts.length === 1) {
    const px = pts[0].x * tf.scaleX + tf.offsetX;
    const py = pts[0].y * tf.scaleY + tf.offsetY;
    return distToSegment(px, py, x1, y1, x2, y2) <= threshold;
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x * tf.scaleX + tf.offsetX;
    const ay = pts[i].y * tf.scaleY + tf.offsetY;
    const bx = pts[i + 1].x * tf.scaleX + tf.offsetX;
    const by = pts[i + 1].y * tf.scaleY + tf.offsetY;
    if (distSegmentToSegment(x1, y1, x2, y2, ax, ay, bx, by) <= threshold) {
      return true;
    }
  }
  return false;
}

/**
 * Multi-sample continuous path hit test for coalesced eraser sweeps.
 */
export function hitTestStrokePath(
  sweepPts: ReadonlyArray<{ x: number; y: number }>,
  stroke: AnnotationStroke,
  eraserRadiusPx: number,
  tf: RenderTransform
): boolean {
  if (sweepPts.length === 0) return false;
  if (sweepPts.length === 1) {
    return hitTestStroke(sweepPts[0].x, sweepPts[0].y, stroke, eraserRadiusPx, tf);
  }
  for (let i = 0; i < sweepPts.length - 1; i++) {
    if (
      hitTestStrokeSegment(
        sweepPts[i].x,
        sweepPts[i].y,
        sweepPts[i + 1].x,
        sweepPts[i + 1].y,
        stroke,
        eraserRadiusPx,
        tf
      )
    ) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// APPLE PENCILKIT MORPH ANIMATION, MAGNETIC SNAPPING & POST-COMMIT EDITING
// ============================================================================

function sampleUniformScreenPts(pts: Pt2D[], targetCount: number, closed: boolean): Pt2D[] {
  if (pts.length === 0) return [];
  if (pts.length === 1) return Array.from({ length: targetCount }, () => ({ ...pts[0] }));
  const work = closed && Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) > 0.5
    ? [...pts, pts[0]]
    : pts;
  const total = polylineLength(work);
  if (total <= 0.5) return Array.from({ length: targetCount }, () => ({ ...work[0] }));

  const out: Pt2D[] = new Array(targetCount);
  const segCount = work.length - 1;
  let segIdx = 0;
  let cum = 0;
  let segLen = Math.hypot(work[1].x - work[0].x, work[1].y - work[0].y);

  for (let k = 0; k < targetCount; k++) {
    const dTarget = (k / (closed ? targetCount : Math.max(1, targetCount - 1))) * total;
    while (segIdx < segCount - 1 && cum + segLen < dTarget) {
      cum += segLen;
      segIdx++;
      segLen = Math.hypot(work[segIdx + 1].x - work[segIdx].x, work[segIdx + 1].y - work[segIdx].y);
    }
    const localT = segLen > 1e-4 ? Math.max(0, Math.min(1, (dTarget - cum) / segLen)) : 0;
    const a = work[segIdx];
    const b = work[segIdx + 1];
    out[k] = {
      x: a.x + (b.x - a.x) * localT,
      y: a.y + (b.y - a.y) * localT,
    };
  }
  return out;
}

function alignClosedLoopPts(moving: Pt2D[], ref: Pt2D[]): Pt2D[] {
  const n = moving.length;
  if (n !== ref.length || n < 4) return moving;
  let bestShift = 0;
  let bestRev = false;
  let bestErr = Infinity;
  const stride = Math.max(1, Math.floor(n / 16));

  for (const rev of [false, true]) {
    for (let shift = 0; shift < n; shift += 2) {
      let err = 0;
      for (let i = 0; i < n; i += stride) {
        const idx = rev ? (n - 1 - ((i + shift) % n)) : (i + shift) % n;
        const dx = moving[idx].x - ref[i].x;
        const dy = moving[idx].y - ref[i].y;
        err += dx * dx + dy * dy;
      }
      if (err < bestErr) {
        bestErr = err;
        bestShift = shift;
        bestRev = rev;
      }
    }
  }

  const aligned: Pt2D[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const idx = bestRev ? (n - 1 - ((i + bestShift) % n)) : (i + bestShift) % n;
    aligned[i] = moving[idx];
  }
  return aligned;
}

/**
 * Renders an Apple PencilKit smooth spring morph transition from the raw freehand points
 * into the snapped geometric target shape (`progress01` in 0..1), returning CSS bounds.
 */
export function renderMorphedShapeStroke(
  ctx: CanvasRenderingContext2D,
  freehandPts: ReadonlyArray<AnnotationPoint>,
  targetShape: AnnotationShape,
  stroke: AnnotationStroke,
  tf: RenderTransform,
  progress01: number,
  overrideOpacity?: number
): CssBounds | null {
  const polylines = sampleShapeToPolylines(targetShape, tf, 3.0);
  if (polylines.length === 0 || freehandPts.length < 2) return null;

  const t = Math.max(0, Math.min(1, progress01));
  const ease = 1 - Math.pow(1 - t, 3);
  const isClosed =
    targetShape.type === 'ellipse' ||
    (targetShape.type === 'polygon' && targetShape.closed);

  const rawScreen: Pt2D[] = freehandPts.map((p) => ({
    x: p.x * tf.scaleX + tf.offsetX,
    y: p.y * tf.scaleY + tf.offsetY,
  }));

  const targetMain = polylines[0].map((p) => ({ x: p.x, y: p.y }));
  const sampleCount = isClosed ? 56 : 48;
  const tgtSampled = sampleUniformScreenPts(targetMain, sampleCount, isClosed);
  let rawSampled = sampleUniformScreenPts(rawScreen, sampleCount, isClosed);

  if (isClosed) {
    rawSampled = alignClosedLoopPts(rawSampled, tgtSampled);
  } else {
    const fwdErr =
      Math.hypot(rawSampled[0].x - tgtSampled[0].x, rawSampled[0].y - tgtSampled[0].y) +
      Math.hypot(
        rawSampled[sampleCount - 1].x - tgtSampled[sampleCount - 1].x,
        rawSampled[sampleCount - 1].y - tgtSampled[sampleCount - 1].y
      );
    const revErr =
      Math.hypot(rawSampled[sampleCount - 1].x - tgtSampled[0].x, rawSampled[sampleCount - 1].y - tgtSampled[0].y) +
      Math.hypot(
        rawSampled[0].x - tgtSampled[sampleCount - 1].x,
        rawSampled[0].y - tgtSampled[sampleCount - 1].y
      );
    if (revErr < fwdErr) {
      rawSampled = rawSampled.slice().reverse();
    }
  }

  const blended: Pt2D[] = new Array(sampleCount);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < sampleCount; i++) {
    const x = rawSampled[i].x + (tgtSampled[i].x - rawSampled[i].x) * ease;
    const y = rawSampled[i].y + (tgtSampled[i].y - rawSampled[i].y) * ease;
    blended[i] = { x, y };
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const lineWidth = Math.max(1.2, stroke.size * tf.unitScale);
  const alpha = overrideOpacity !== undefined ? overrideOpacity : stroke.opacity;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = stroke.color;
  ctx.strokeStyle = stroke.color;

  if (stroke.kind === 'highlighter') {
    const nibHeight = Math.max(8, stroke.size * tf.unitScale);
    const halfHeight = nibHeight * 0.5;
    const halfThick = Math.max(1.8, nibHeight * 0.13);
    const stampVertices = targetShape.type === 'polygon' || targetShape.type === 'arrow';
    const closedBlended = isClosed ? [...blended, blended[0]] : blended;
    const denseMain: ScreenPoint[] = closedBlended.map((pt) => ({
      x: pt.x,
      y: pt.y,
      pressure: 0.5,
      t: 0,
    }));
    sweepChiselPolyline(ctx, denseMain, halfThick, halfHeight, stampVertices);
    if (polylines.length > 1 && ease > 0.15) {
      ctx.globalAlpha = alpha * Math.min(1, (ease - 0.15) / 0.85);
      for (let s = 1; s < polylines.length; s++) {
        const sub = polylines[s];
        if (sub.length < 2) continue;
        for (let i = 0; i < sub.length; i++) {
          if (sub[i].x < minX) minX = sub[i].x;
          if (sub[i].y < minY) minY = sub[i].y;
          if (sub[i].x > maxX) maxX = sub[i].x;
          if (sub[i].y > maxY) maxY = sub[i].y;
        }
        sweepChiselPolyline(ctx, sub, halfThick, halfHeight, stampVertices);
      }
    }
    ctx.restore();
    const pad = halfHeight + halfThick + 4;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  if (stroke.kind === 'fountain') {
    const nibRad = ((stroke.nibAngleDeg ?? -38) * Math.PI) / 180;
    const halfW = Math.max(0.95, lineWidth * 0.5 + 0.18);
    const closedBlended = isClosed ? [...blended, blended[0]] : blended;
    drawFountainPolylineSweep(ctx, closedBlended, halfW, nibRad, 0.27);
    if (polylines.length > 1 && ease > 0.15) {
      ctx.globalAlpha = alpha * Math.min(1, (ease - 0.15) / 0.85);
      for (let s = 1; s < polylines.length; s++) {
        const sub = polylines[s];
        if (sub.length < 2) continue;
        for (let i = 0; i < sub.length; i++) {
          if (sub[i].x < minX) minX = sub[i].x;
          if (sub[i].y < minY) minY = sub[i].y;
          if (sub[i].x > maxX) maxX = sub[i].x;
          if (sub[i].y > maxY) maxY = sub[i].y;
        }
        drawFountainPolylineSweep(ctx, sub, Math.max(0.85, lineWidth * 0.43), nibRad, 0.34);
      }
    }
    ctx.restore();
    const pad = lineWidth + 8;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  const traceMorphedPaths = () => {
    ctx.beginPath();
    ctx.moveTo(blended[0].x, blended[0].y);
    for (let i = 1; i < blended.length; i++) {
      ctx.lineTo(blended[i].x, blended[i].y);
    }
    if (isClosed) ctx.closePath();
  };

  const strokeSecondarySubPaths = () => {
    if (polylines.length > 1 && ease > 0.15) {
      ctx.setLineDash([]);
      ctx.globalAlpha *= Math.min(1, (ease - 0.15) / 0.85);
      for (let s = 1; s < polylines.length; s++) {
        const sub = polylines[s];
        if (sub.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(sub[0].x, sub[0].y);
        for (let i = 1; i < sub.length; i++) {
          ctx.lineTo(sub[i].x, sub[i].y);
          if (sub[i].x < minX) minX = sub[i].x;
          if (sub[i].y < minY) minY = sub[i].y;
          if (sub[i].x > maxX) maxX = sub[i].x;
          if (sub[i].y > maxY) maxY = sub[i].y;
        }
        ctx.stroke();
      }
    }
  };

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (stroke.kind === 'pencil') {
    ctx.setLineDash([]);
    ctx.globalAlpha = alpha * 0.28;
    ctx.lineWidth = Math.max(0.75, lineWidth * 0.46);
    ctx.strokeStyle = stroke.color;
    traceMorphedPaths();
    ctx.stroke();
    strokeSecondarySubPaths();

    ctx.globalAlpha = alpha * 0.94;
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = getGraphiteStrokeStyle(ctx, stroke.color);
    traceMorphedPaths();
    ctx.stroke();
    strokeSecondarySubPaths();
    ctx.restore();
    const pad = lineWidth + 8;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  if (stroke.kind === 'tape') {
    const tapeW = Math.max(8, stroke.size * tf.unitScale);
    ctx.globalAlpha = stroke.revealed ? 0.2 : 1;
    ctx.setLineDash([]);
    ctx.lineWidth = tapeW;
    ctx.strokeStyle = getTapeStrokeStyle(ctx, stroke.color, stroke.tapePattern ?? 'striped');
    traceMorphedPaths();
    ctx.stroke();
    if (polylines.length > 1 && ease > 0.15) {
      strokeSecondarySubPaths();
    }
    ctx.restore();
    const pad = tapeW * 0.65 + 4;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  ctx.lineWidth = lineWidth;
  applyPenLineDash(ctx, stroke.lineStyle, lineWidth);
  traceMorphedPaths();
  ctx.stroke();

  // Gently materialize secondary sub-paths (arrowheads) solid as morph completes
  if (polylines.length > 1 && ease > 0.15) {
    ctx.globalAlpha = alpha;
    strokeSecondarySubPaths();
  }
  ctx.restore();

  const pad = lineWidth + 8;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export interface MagneticSnapResult {
  x: number;
  y: number;
  screenX: number;
  screenY: number;
}

/**
 * Finds the nearest anchor point on already-committed SNAPPED shapes (ignoring freehand handwriting
 * so Mushaf calligraphy never pulls the pen). Returns null if none within `snapRadiusPx`.
 */
export function findMagneticSnapTarget(
  normPt: { x: number; y: number },
  strokes: ReadonlyArray<AnnotationStroke>,
  tf: RenderTransform,
  excludeStrokeId?: string | null,
  snapRadiusPx = 12
): MagneticSnapResult | null {
  const px = normPt.x * tf.scaleX + tf.offsetX;
  const py = normPt.y * tf.scaleY + tf.offsetY;
  let bestD = snapRadiusPx;
  let best: MagneticSnapResult | null = null;

  const checkAnchor = (ax: number, ay: number) => {
    const sx = ax * tf.scaleX + tf.offsetX;
    const sy = ay * tf.scaleY + tf.offsetY;
    const d = Math.hypot(sx - px, sy - py);
    if (d <= bestD) {
      bestD = d;
      best = { x: ax, y: ay, screenX: sx, screenY: sy };
    }
  };

  for (let i = 0; i < strokes.length; i++) {
    const st = strokes[i];
    if (!st.shape || (excludeStrokeId && st.id === excludeStrokeId)) continue;
    const s = st.shape;
    if (s.type === 'line' || s.type === 'brace') {
      checkAnchor(s.x1, s.y1);
      checkAnchor(s.x2, s.y2);
      checkAnchor((s.x1 + s.x2) * 0.5, (s.y1 + s.y2) * 0.5);
    } else if (s.type === 'arc' || s.type === 'arrow') {
      checkAnchor(s.x1, s.y1);
      checkAnchor(s.x2, s.y2);
    } else if (s.type === 'polygon') {
      for (let j = 0; j < s.points.length; j++) {
        checkAnchor(s.points[j].x, s.points[j].y);
        if (s.closed || j < s.points.length - 1) {
          const nxt = s.points[(j + 1) % s.points.length];
          checkAnchor((s.points[j].x + nxt.x) * 0.5, (s.points[j].y + nxt.y) * 0.5);
        }
      }
    } else if (s.type === 'ellipse') {
      checkAnchor(s.cx, s.cy);
      const rot = s.rotation ?? 0;
      const { rxPx, ryPx } = resolveEllipseScreenRadii(
        s.rx,
        s.ry,
        s.rotation,
        tf,
        s.isCircle
      );
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const axes: [number, number][] = [
        [rxPx, 0],
        [-rxPx, 0],
        [0, ryPx],
        [0, -ryPx],
      ];
      for (const [lx, ly] of axes) {
        const ax = s.cx + (lx * cos - ly * sin) / tf.scaleX;
        const ay = s.cy + (lx * sin + ly * cos) / tf.scaleY;
        checkAnchor(ax, ay);
      }
    } else if (s.type === 'curve' && s.points.length >= 2) {
      checkAnchor(s.points[0].x, s.points[0].y);
      checkAnchor(s.points[s.points.length - 1].x, s.points[s.points.length - 1].y);
    }
  }

  return best;
}

/**
 * Magnetically locks the start/end endpoints of a newly snapped open connector
 * (`line`, `arc`, `arrow`, `brace`, `curve`, open `polygon`) onto nearby anchors of
 * existing snapped shapes right when Hold-to-Snap fires, so diagrams connect seamlessly.
 */
export function snapInitialShapeToAnchors(
  shape: AnnotationShape,
  strokes: ReadonlyArray<AnnotationStroke>,
  tf: RenderTransform,
  excludeStrokeId?: string | null,
  snapRadiusPx = 11
): { shape: AnnotationShape; cue: { x: number; y: number } | null } {
  if (strokes.length === 0 || tf.scaleX <= 0 || tf.scaleY <= 0) {
    return { shape, cue: null };
  }

  const isEndpointShape =
    shape.type === 'line' ||
    shape.type === 'arc' ||
    shape.type === 'arrow' ||
    shape.type === 'brace' ||
    shape.type === 'curve' ||
    (shape.type === 'polygon' && !shape.closed);

  if (!isEndpointShape) return { shape, cue: null };

  let startPt: { x: number; y: number };
  let endPt: { x: number; y: number };
  if (shape.type === 'polygon' || shape.type === 'curve') {
    if (shape.points.length < 2) return { shape, cue: null };
    startPt = shape.points[0];
    endPt = shape.points[shape.points.length - 1];
  } else {
    startPt = { x: shape.x1, y: shape.y1 };
    endPt = { x: shape.x2, y: shape.y2 };
  }

  const startSnap = findMagneticSnapTarget(startPt, strokes, tf, excludeStrokeId, snapRadiusPx);
  const endSnap = findMagneticSnapTarget(endPt, strokes, tf, excludeStrokeId, snapRadiusPx);
  if (!startSnap && !endSnap) return { shape, cue: null };

  const nextStart = startSnap ?? startPt;
  const nextEnd = endSnap ?? endPt;
  if (
    Math.hypot((nextEnd.x - nextStart.x) * tf.scaleX, (nextEnd.y - nextStart.y) * tf.scaleY) < 18
  ) {
    return { shape, cue: null };
  }

  let out: AnnotationShape = shape;
  if (endSnap) {
    out = applyShapeHandleDrag(
      out,
      out.type === 'polygon' ? `v_${out.points.length - 1}` : 'end',
      { x: endSnap.x, y: endSnap.y, pressure: 0.5, t: 0 },
      tf.scaleX,
      tf.scaleY,
      false
    );
    if (out.type === 'line' || out.type === 'arc' || out.type === 'brace') {
      out = { ...out, x2: endSnap.x, y2: endSnap.y };
    } else if (out.type === 'arrow') {
      const dx = endSnap.x - out.x2;
      const dy = endSnap.y - out.y2;
      out = {
        ...out,
        x2: endSnap.x,
        y2: endSnap.y,
        leftX: out.leftX + dx,
        leftY: out.leftY + dy,
        rightX: out.rightX + dx,
        rightY: out.rightY + dy,
      };
    }
  }
  if (startSnap) {
    out = applyShapeHandleDrag(
      out,
      out.type === 'polygon' ? 'v_0' : 'start',
      { x: startSnap.x, y: startSnap.y, pressure: 0.5, t: 0 },
      tf.scaleX,
      tf.scaleY,
      false
    );
    if (out.type === 'line' || out.type === 'arc' || out.type === 'brace') {
      out = { ...out, x1: startSnap.x, y1: startSnap.y };
    } else if (out.type === 'arrow') {
      const dx = startSnap.x - out.x1;
      const dy = startSnap.y - out.y1;
      out = {
        ...out,
        x1: startSnap.x,
        y1: startSnap.y,
        ...(out.bidirectional &&
        out.tailLeftX !== undefined &&
        out.tailLeftY !== undefined &&
        out.tailRightX !== undefined &&
        out.tailRightY !== undefined
          ? {
              tailLeftX: out.tailLeftX + dx,
              tailLeftY: out.tailLeftY + dy,
              tailRightX: out.tailRightX + dx,
              tailRightY: out.tailRightY + dy,
            }
          : {}),
      };
    }
  }

  const cueSnap = endSnap ?? startSnap;
  return {
    shape: out,
    cue: cueSnap ? { x: cueSnap.screenX, y: cueSnap.screenY } : null,
  };
}

export function drawMagneticSnapIndicator(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  color = '#007AFF'
): CssBounds {
  ctx.save();
  ctx.beginPath();
  ctx.arc(screenX, screenY, 8.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 122, 255, 0.14)';
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = color;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(screenX, screenY, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();

  const pad = 12;
  return { minX: screenX - pad, minY: screenY - pad, maxX: screenX + pad, maxY: screenY + pad };
}

export interface ShapeEditHandle {
  id: string;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
}

function getShapeRotationCenterNorm(
  shape: AnnotationShape,
  tf: RenderTransform
): { x: number; y: number } {
  if (shape.type === 'ellipse') {
    return { x: shape.cx, y: shape.cy };
  }
  if (shape.type === 'line' || shape.type === 'brace') {
    return { x: (shape.x1 + shape.x2) * 0.5, y: (shape.y1 + shape.y2) * 0.5 };
  }
  if (shape.type === 'arc') {
    return { x: (shape.x1 + shape.cx + shape.x2) / 3, y: (shape.y1 + shape.cy + shape.y2) / 3 };
  }
  if (shape.type === 'arrow') {
    return { x: (shape.x1 + shape.x2) * 0.5, y: (shape.y1 + shape.y2) * 0.5 };
  }
  const b = computeShapeCssBounds(shape, tf, 0);
  if (b) {
    const invSx = Math.abs(tf.scaleX) > 1e-6 ? 1 / tf.scaleX : 1;
    const invSy = Math.abs(tf.scaleY) > 1e-6 ? 1 / tf.scaleY : 1;
    return {
      x: ((b.minX + b.maxX) * 0.5 - tf.offsetX) * invSx,
      y: ((b.minY + b.maxY) * 0.5 - tf.offsetY) * invSy,
    };
  }
  return { x: 0, y: 0 };
}

function rotateNormPt(
  px: number,
  py: number,
  cx: number,
  cy: number,
  cos: number,
  sin: number,
  scaleX: number,
  scaleY: number
): { x: number; y: number } {
  const dx = (px - cx) * scaleX;
  const dy = (py - cy) * scaleY;
  return {
    x: cx + (dx * cos - dy * sin) / scaleX,
    y: cy + (dx * sin + dy * cos) / scaleY,
  };
}

export function rotateShapeByAngle(
  shape: AnnotationShape,
  cxNorm: number,
  cyNorm: number,
  deltaRad: number,
  scaleX: number,
  scaleY: number
): AnnotationShape {
  const cos = Math.cos(deltaRad);
  const sin = Math.sin(deltaRad);
  const rotPt = (x: number, y: number) =>
    rotateNormPt(x, y, cxNorm, cyNorm, cos, sin, scaleX, scaleY);

  if (shape.type === 'line') {
    const p1 = rotPt(shape.x1, shape.y1);
    const p2 = rotPt(shape.x2, shape.y2);
    return { type: 'line', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  }
  if (shape.type === 'arc') {
    const p1 = rotPt(shape.x1, shape.y1);
    const pc = rotPt(shape.cx, shape.cy);
    const p2 = rotPt(shape.x2, shape.y2);
    return { type: 'arc', x1: p1.x, y1: p1.y, cx: pc.x, cy: pc.y, x2: p2.x, y2: p2.y };
  }
  if (shape.type === 'brace') {
    const p1 = rotPt(shape.x1, shape.y1);
    const p2 = rotPt(shape.x2, shape.y2);
    return { ...shape, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  }
  if (shape.type === 'ellipse') {
    const c = rotPt(shape.cx, shape.cy);
    const nextRot = normalizeAngleRad((shape.rotation ?? 0) + deltaRad);
    return {
      ...shape,
      cx: c.x,
      cy: c.y,
      rotation: Math.abs(nextRot) > 0.001 ? nextRot : undefined,
    };
  }
  if (shape.type === 'polygon' || shape.type === 'curve') {
    return {
      ...shape,
      points: shape.points.map((p) => rotPt(p.x, p.y)),
    };
  }
  if (shape.type === 'arrow') {
    const p1 = rotPt(shape.x1, shape.y1);
    const p2 = rotPt(shape.x2, shape.y2);
    const lx = rotPt(shape.leftX, shape.leftY);
    const rx = rotPt(shape.rightX, shape.rightY);
    const pc =
      shape.cx !== undefined && shape.cy !== undefined ? rotPt(shape.cx, shape.cy) : null;
    const tl =
      shape.bidirectional && shape.tailLeftX !== undefined && shape.tailLeftY !== undefined
        ? rotPt(shape.tailLeftX, shape.tailLeftY)
        : null;
    const tr =
      shape.bidirectional && shape.tailRightX !== undefined && shape.tailRightY !== undefined
        ? rotPt(shape.tailRightX, shape.tailRightY)
        : null;
    return {
      ...shape,
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      leftX: lx.x,
      leftY: lx.y,
      rightX: rx.x,
      rightY: rx.y,
      ...(pc ? { cx: pc.x, cy: pc.y } : {}),
      ...(tl && tr
        ? {
            tailLeftX: tl.x,
            tailLeftY: tl.y,
            tailRightX: tr.x,
            tailRightY: tr.y,
          }
        : {}),
    };
  }
  return shape;
}

export function getShapeEditHandles(
  shape: AnnotationShape,
  tf: RenderTransform
): ShapeEditHandle[] {
  const mk = (id: string, x: number, y: number): ShapeEditHandle => ({
    id,
    x,
    y,
    screenX: x * tf.scaleX + tf.offsetX,
    screenY: y * tf.scaleY + tf.offsetY,
  });

  const invSx = Math.abs(tf.scaleX) > 1e-6 ? 1 / tf.scaleX : 1;
  const invSy = Math.abs(tf.scaleY) > 1e-6 ? 1 / tf.scaleY : 1;

  const appendRotateHandle = (list: ShapeEditHandle[]) => {
    const bounds = computeShapeCssBounds(shape, tf, 0);
    if (!bounds) return list;
    const stemScreenX = (bounds.minX + bounds.maxX) * 0.5;
    const stemScreenY = bounds.minY - 24;
    list.push(mk('rotate', (stemScreenX - tf.offsetX) * invSx, (stemScreenY - tf.offsetY) * invSy));
    return list;
  };

  if (shape.type === 'line') {
    return [mk('start', shape.x1, shape.y1), mk('end', shape.x2, shape.y2)];
  }
  if (shape.type === 'arc') {
    return appendRotateHandle([
      mk('start', shape.x1, shape.y1),
      mk('ctrl', shape.cx, shape.cy),
      mk('end', shape.x2, shape.y2),
    ]);
  }
  if (shape.type === 'arrow') {
    const list = [mk('start', shape.x1, shape.y1), mk('end', shape.x2, shape.y2)];
    if (shape.cx !== undefined && shape.cy !== undefined) {
      list.splice(1, 0, mk('ctrl', shape.cx, shape.cy));
    }
    return list;
  }
  if (shape.type === 'brace') {
    const x1 = shape.x1 * tf.scaleX;
    const y1 = shape.y1 * tf.scaleY;
    const x2 = shape.x2 * tf.scaleX;
    const y2 = shape.y2 * tf.scaleY;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const chord = Math.hypot(dx, dy) || 1;
    const nx = -dy / chord;
    const ny = dx / chord;
    const depthPx = shape.depth * tf.unitScale;
    const midPxX = (x1 + x2) * 0.5 + nx * depthPx;
    const midPxY = (y1 + y2) * 0.5 + ny * depthPx;
    return appendRotateHandle([
      mk('start', shape.x1, shape.y1),
      mk('peak', midPxX / tf.scaleX, midPxY / tf.scaleY),
      mk('end', shape.x2, shape.y2),
    ]);
  }
  if (shape.type === 'ellipse') {
    const rot = shape.rotation ?? 0;
    const { rxPx, ryPx } = resolveEllipseScreenRadii(
      shape.rx,
      shape.ry,
      shape.rotation,
      tf,
      shape.isCircle
    );
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const toNorm = (id: string, lx: number, ly: number) =>
      mk(id, shape.cx + (lx * cos - ly * sin) / tf.scaleX, shape.cy + (lx * sin + ly * cos) / tf.scaleY);
    const handles = [
      toNorm('n', 0, -ryPx),
      toNorm('e', rxPx, 0),
      toNorm('s', 0, ryPx),
      toNorm('w', -rxPx, 0),
    ];
    if (!shape.isCircle && Math.abs(rxPx - ryPx) > 1.5) {
      appendRotateHandle(handles);
    }
    return handles;
  }
  if (shape.type === 'polygon') {
    return appendRotateHandle(shape.points.map((p, idx) => mk(`v_${idx}`, p.x, p.y)));
  }
  if (shape.type === 'curve' && shape.points.length >= 2) {
    const handles: ShapeEditHandle[] = [mk('start', shape.points[0].x, shape.points[0].y)];
    if (shape.points.length >= 5) {
      const midIdx = Math.floor(shape.points.length * 0.5);
      handles.push(mk('mid', shape.points[midIdx].x, shape.points[midIdx].y));
    }
    handles.push(
      mk('end', shape.points[shape.points.length - 1].x, shape.points[shape.points.length - 1].y)
    );
    return appendRotateHandle(handles);
  }
  return [];
}

export function hitTestShapeHandle(
  screenX: number,
  screenY: number,
  shape: AnnotationShape,
  tf: RenderTransform,
  hitRadiusPx = 11
): ShapeEditHandle | null {
  const handles = getShapeEditHandles(shape, tf);
  let best: ShapeEditHandle | null = null;
  let bestD = hitRadiusPx;
  for (const h of handles) {
    const rLimit = h.id === 'rotate' ? hitRadiusPx + 2 : hitRadiusPx;
    const d = Math.hypot(screenX - h.screenX, screenY - h.screenY);
    if (d <= rLimit && (best === null || d < bestD)) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

export function hitTestShapeStroke(
  screenX: number,
  screenY: number,
  stroke: AnnotationStroke,
  tf: RenderTransform,
  thresholdPx = 10
): boolean {
  if (hitTestStroke(screenX, screenY, stroke, thresholdPx, tf)) return true;
  if (!stroke.shape) return false;

  if (stroke.shape.type === 'ellipse') {
    const cx = stroke.shape.cx * tf.scaleX + tf.offsetX;
    const cy = stroke.shape.cy * tf.scaleY + tf.offsetY;
    const { rxPx, ryPx } = resolveEllipseScreenRadii(
      stroke.shape.rx,
      stroke.shape.ry,
      stroke.shape.rotation,
      tf,
      stroke.shape.isCircle
    );
    const rot = stroke.shape.rotation ?? 0;
    const dx = screenX - cx;
    const dy = screenY - cy;
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    return (lx * lx) / Math.max(1, rxPx * rxPx) + (ly * ly) / Math.max(1, ryPx * ryPx) <= 1.04;
  }

  if (stroke.shape.type === 'polygon' && stroke.shape.closed && stroke.shape.points.length >= 3) {
    const pts = stroke.shape.points.map((p) => ({
      x: p.x * tf.scaleX + tf.offsetX,
      y: p.y * tf.scaleY + tf.offsetY,
    }));
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x;
      const yi = pts[i].y;
      const xj = pts[j].x;
      const yj = pts[j].y;
      if (yi > screenY !== yj > screenY && screenX < ((xj - xi) * (screenY - yi)) / (yj - yi + 1e-6) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  return false;
}

export function translateStroke(stroke: AnnotationStroke, dxNorm: number, dyNorm: number): AnnotationStroke {
  const shiftedPts = stroke.points.map((p) => ({
    ...p,
    x: p.x + dxNorm,
    y: p.y + dyNorm,
  }));
  if (!stroke.shape) {
    return { ...stroke, points: shiftedPts };
  }
  const s = stroke.shape;
  let nextShape: AnnotationShape;
  if (s.type === 'line') {
    nextShape = { ...s, x1: s.x1 + dxNorm, y1: s.y1 + dyNorm, x2: s.x2 + dxNorm, y2: s.y2 + dyNorm };
  } else if (s.type === 'arc') {
    nextShape = {
      ...s,
      x1: s.x1 + dxNorm,
      y1: s.y1 + dyNorm,
      cx: s.cx + dxNorm,
      cy: s.cy + dyNorm,
      x2: s.x2 + dxNorm,
      y2: s.y2 + dyNorm,
    };
  } else if (s.type === 'brace') {
    nextShape = { ...s, x1: s.x1 + dxNorm, y1: s.y1 + dyNorm, x2: s.x2 + dxNorm, y2: s.y2 + dyNorm };
  } else if (s.type === 'ellipse') {
    nextShape = { ...s, cx: s.cx + dxNorm, cy: s.cy + dyNorm };
  } else if (s.type === 'polygon' || s.type === 'curve') {
    nextShape = { ...s, points: s.points.map((p) => ({ x: p.x + dxNorm, y: p.y + dyNorm })) };
  } else {
    nextShape = {
      ...s,
      x1: s.x1 + dxNorm,
      y1: s.y1 + dyNorm,
      ...(s.cx !== undefined ? { cx: s.cx + dxNorm } : {}),
      ...(s.cy !== undefined ? { cy: s.cy + dyNorm } : {}),
      x2: s.x2 + dxNorm,
      y2: s.y2 + dyNorm,
      leftX: s.leftX + dxNorm,
      leftY: s.leftY + dyNorm,
      rightX: s.rightX + dxNorm,
      rightY: s.rightY + dyNorm,
      ...(s.tailLeftX !== undefined ? { tailLeftX: s.tailLeftX + dxNorm } : {}),
      ...(s.tailLeftY !== undefined ? { tailLeftY: s.tailLeftY + dyNorm } : {}),
      ...(s.tailRightX !== undefined ? { tailRightX: s.tailRightX + dxNorm } : {}),
      ...(s.tailRightY !== undefined ? { tailRightY: s.tailRightY + dyNorm } : {}),
    };
  }
  return { ...stroke, points: shiftedPts, shape: nextShape };
}

/**
 * Keeps underlying freehand `points` synchronized with an edited `shape` bounding frame
 * (or exact rigid rotation when `handleId === 'rotate'`) so bounds, hits, and Ctrl+Z stay coherent.
 */
export function remapPointsAfterShapeEdit(
  origStroke: AnnotationStroke,
  nextShape: AnnotationShape,
  tf: RenderTransform,
  handleId?: string | null,
  startPt?: { x: number; y: number } | null,
  rawPt?: { x: number; y: number } | null
): AnnotationPoint[] {
  if (!origStroke.shape || origStroke.points.length === 0) return origStroke.points;

  if (handleId === 'rotate' && startPt && rawPt) {
    const center = getShapeRotationCenterNorm(origStroke.shape, tf);
    const sx = Math.abs(tf.scaleX) > 1e-6 ? tf.scaleX : 1;
    const sy = Math.abs(tf.scaleY) > 1e-6 ? tf.scaleY : 1;
    const v0x = (startPt.x - center.x) * sx;
    const v0y = (startPt.y - center.y) * sy;
    const v1x = (rawPt.x - center.x) * sx;
    const v1y = (rawPt.y - center.y) * sy;
    if (Math.hypot(v0x, v0y) >= 4 && Math.hypot(v1x, v1y) >= 4) {
      const dAng = normalizeAngleRad(Math.atan2(v1y, v1x) - Math.atan2(v0y, v0x));
      const cos = Math.cos(dAng);
      const sin = Math.sin(dAng);
      return origStroke.points.map((p) => {
        const rp = rotateNormPt(p.x, p.y, center.x, center.y, cos, sin, sx, sy);
        return { ...p, x: rp.x, y: rp.y };
      });
    }
  }

  const oldB = computeShapeCssBounds(origStroke.shape, tf, 0);
  const newB = computeShapeCssBounds(nextShape, tf, 0);
  if (!oldB || !newB) return origStroke.points;

  const invSx = Math.abs(tf.scaleX) > 1e-6 ? 1 / tf.scaleX : 1;
  const invSy = Math.abs(tf.scaleY) > 1e-6 ? 1 / tf.scaleY : 1;
  const oMinX = (oldB.minX - tf.offsetX) * invSx;
  const oMaxX = (oldB.maxX - tf.offsetX) * invSx;
  const oMinY = (oldB.minY - tf.offsetY) * invSy;
  const oMaxY = (oldB.maxY - tf.offsetY) * invSy;

  const nMinX = (newB.minX - tf.offsetX) * invSx;
  const nMaxX = (newB.maxX - tf.offsetX) * invSx;
  const nMinY = (newB.minY - tf.offsetY) * invSy;
  const nMaxY = (newB.maxY - tf.offsetY) * invSy;

  const oW = oMaxX - oMinX;
  const oH = oMaxY - oMinY;
  const nW = nMaxX - nMinX;
  const nH = nMaxY - nMinY;
  const oCx = (oMinX + oMaxX) * 0.5;
  const oCy = (oMinY + oMaxY) * 0.5;
  const nCx = (nMinX + nMaxX) * 0.5;
  const nCy = (nMinY + nMaxY) * 0.5;
  const sx = Math.abs(oW) > 1e-4 ? nW / oW : 1;
  const sy = Math.abs(oH) > 1e-4 ? nH / oH : 1;

  return origStroke.points.map((p) => ({
    ...p,
    x: Math.abs(oW) > 1e-4 ? nMinX + (p.x - oMinX) * sx : nCx + (p.x - oCx),
    y: Math.abs(oH) > 1e-4 ? nMinY + (p.y - oMinY) * sy : nCy + (p.y - oCy),
  }));
}

export function applyShapeHandleDrag(
  origShape: AnnotationShape,
  handleId: string,
  rawPt: AnnotationPoint,
  scaleX: number,
  scaleY: number,
  lockPerfect: boolean,
  startPt?: { x: number; y: number } | null
): AnnotationShape {
  if (scaleX <= 0 || scaleY <= 0) return origShape;

  if (handleId === 'rotate') {
    const tf: RenderTransform = {
      scaleX,
      scaleY,
      offsetX: 0,
      offsetY: 0,
      unitScale: (scaleX + scaleY) * 0.5 || 1,
    };
    const center = getShapeRotationCenterNorm(origShape, tf);
    const v0x = startPt ? (startPt.x - center.x) * scaleX : 0;
    const v0y = startPt ? (startPt.y - center.y) * scaleY : -24;
    const v1x = (rawPt.x - center.x) * scaleX;
    const v1y = (rawPt.y - center.y) * scaleY;
    if (Math.hypot(v1x, v1y) < 6) return origShape;
    let dAngle = normalizeAngleRad(Math.atan2(v1y, v1x) - Math.atan2(v0y, v0x));
    if (lockPerfect) {
      const step = Math.PI / 12; // 15 deg crisp snap
      dAngle = Math.round(dAngle / step) * step;
    } else {
      const deg = (dAngle * 180) / Math.PI;
      const nearest90 = Math.round(deg / 90) * 90;
      if (Math.abs(deg - nearest90) <= 2.2) {
        dAngle = (nearest90 * Math.PI) / 180;
      }
    }
    return rotateShapeByAngle(origShape, center.x, center.y, dAngle, scaleX, scaleY);
  }

  if (origShape.type === 'line') {
    if (handleId === 'start') {
      const swapped: AnnotationShape = {
        type: 'line',
        x1: origShape.x2,
        y1: origShape.y2,
        x2: origShape.x1,
        y2: origShape.y1,
      };
      const adj = adjustSnappedShapeOnDrag(swapped, rawPt, scaleX, scaleY, null, lockPerfect);
      if (adj.type === 'line') {
        return { type: 'line', x1: adj.x2, y1: adj.y2, x2: adj.x1, y2: adj.y1 };
      }
    }
    return adjustSnappedShapeOnDrag(origShape, rawPt, scaleX, scaleY, null, lockPerfect);
  }

  if (origShape.type === 'arc') {
    if (handleId === 'ctrl') {
      return { ...origShape, cx: rawPt.x, cy: rawPt.y };
    }
    if (handleId === 'start') {
      const swapped: AnnotationShape = {
        type: 'arc',
        x1: origShape.x2,
        y1: origShape.y2,
        cx: origShape.cx,
        cy: origShape.cy,
        x2: origShape.x1,
        y2: origShape.y1,
      };
      const adj = adjustSnappedShapeOnDrag(swapped, rawPt, scaleX, scaleY, { shape: swapped, anchorX: swapped.x2, anchorY: swapped.y2 }, lockPerfect);
      if (adj.type === 'arc') {
        return { type: 'arc', x1: adj.x2, y1: adj.y2, cx: adj.cx, cy: adj.cy, x2: adj.x1, y2: adj.y1 };
      }
    }
    return adjustSnappedShapeOnDrag(
      origShape,
      rawPt,
      scaleX,
      scaleY,
      { shape: origShape, anchorX: origShape.x2, anchorY: origShape.y2 },
      lockPerfect
    );
  }

  if (origShape.type === 'brace') {
    if (handleId === 'peak') {
      const x1 = origShape.x1 * scaleX;
      const y1 = origShape.y1 * scaleY;
      const x2 = origShape.x2 * scaleX;
      const y2 = origShape.y2 * scaleY;
      const chord = Math.hypot(x2 - x1, y2 - y1) || 1;
      const nx = -(y2 - y1) / chord;
      const ny = (x2 - x1) / chord;
      const unitScale = (scaleX + scaleY) * 0.5 || 1;
      const midX = (x1 + x2) * 0.5;
      const midY = (y1 + y2) * 0.5;
      const depthPx = (rawPt.x * scaleX - midX) * nx + (rawPt.y * scaleY - midY) * ny;
      const clampedPx = Math.sign(depthPx || 1) * Math.max(8, Math.min(chord * 0.48, Math.abs(depthPx)));
      return { ...origShape, depth: clampedPx / unitScale };
    }
    if (handleId === 'start') {
      const swapped: AnnotationShape = {
        type: 'brace',
        x1: origShape.x2,
        y1: origShape.y2,
        x2: origShape.x1,
        y2: origShape.y1,
        depth: -origShape.depth,
      };
      const adj = adjustSnappedShapeOnDrag(swapped, rawPt, scaleX, scaleY, null, lockPerfect);
      if (adj.type === 'brace') {
        return { type: 'brace', x1: adj.x2, y1: adj.y2, x2: adj.x1, y2: adj.y1, depth: -adj.depth };
      }
    }
    return adjustSnappedShapeOnDrag(origShape, rawPt, scaleX, scaleY, null, lockPerfect);
  }

  if (origShape.type === 'arrow') {
    if (handleId === 'ctrl' && origShape.cx !== undefined && origShape.cy !== undefined) {
      const p1x = origShape.x1 * scaleX;
      const p1y = origShape.y1 * scaleY;
      const p2x = origShape.x2 * scaleX;
      const p2y = origShape.y2 * scaleY;
      const cxPx = rawPt.x * scaleX;
      const cyPx = rawPt.y * scaleY;
      const headLen = Math.max(11, Math.min(24, Math.hypot(origShape.leftX * scaleX - p2x, origShape.leftY * scaleY - p2y)));
      const endWings = buildArrowWings({ x: p2x, y: p2y }, p2x - cxPx, p2y - cyPx, headLen);
      const tailWings = origShape.bidirectional
        ? buildArrowWings({ x: p1x, y: p1y }, p1x - cxPx, p1y - cyPx, headLen)
        : null;
      return {
        ...origShape,
        cx: rawPt.x,
        cy: rawPt.y,
        leftX: endWings.left.x / scaleX,
        leftY: endWings.left.y / scaleY,
        rightX: endWings.right.x / scaleX,
        rightY: endWings.right.y / scaleY,
        ...(tailWings
          ? {
              tailLeftX: tailWings.left.x / scaleX,
              tailLeftY: tailWings.left.y / scaleY,
              tailRightX: tailWings.right.x / scaleX,
              tailRightY: tailWings.right.y / scaleY,
            }
          : {}),
      };
    }
    if (handleId === 'start') {
      const headLen = Math.max(
        11,
        Math.min(24, Math.hypot((origShape.leftX - origShape.x2) * scaleX, (origShape.leftY - origShape.y2) * scaleY))
      );
      const p2x = origShape.x2 * scaleX;
      const p2y = origShape.y2 * scaleY;
      let n1x = rawPt.x * scaleX;
      let n1y = rawPt.y * scaleY;
      if (lockPerfect) {
        const dx = n1x - p2x;
        const dy = n1y - p2y;
        const len = Math.hypot(dx, dy);
        if (len >= 4) {
          const ang = snapAngle45Rad(dx, dy);
          n1x = p2x + Math.cos(ang) * len;
          n1y = p2y + Math.sin(ang) * len;
        }
      }
      if (Math.hypot(p2x - n1x, p2y - n1y) < 4) return origShape;
      const tanX = origShape.cx !== undefined && !lockPerfect ? p2x - origShape.cx * scaleX : p2x - n1x;
      const tanY = origShape.cy !== undefined && !lockPerfect ? p2y - origShape.cy * scaleY : p2y - n1y;
      const endWings = buildArrowWings({ x: p2x, y: p2y }, tanX, tanY, headLen);
      const tailWings = origShape.bidirectional
        ? buildArrowWings(
            { x: n1x, y: n1y },
            origShape.cx !== undefined && !lockPerfect ? n1x - origShape.cx * scaleX : n1x - p2x,
            origShape.cy !== undefined && !lockPerfect ? n1y - origShape.cy * scaleY : n1y - p2y,
            headLen
          )
        : null;
      return {
        ...origShape,
        x1: n1x / scaleX,
        y1: n1y / scaleY,
        ...(lockPerfect ? { cx: undefined, cy: undefined } : {}),
        leftX: endWings.left.x / scaleX,
        leftY: endWings.left.y / scaleY,
        rightX: endWings.right.x / scaleX,
        rightY: endWings.right.y / scaleY,
        ...(tailWings
          ? {
              tailLeftX: tailWings.left.x / scaleX,
              tailLeftY: tailWings.left.y / scaleY,
              tailRightX: tailWings.right.x / scaleX,
              tailRightY: tailWings.right.y / scaleY,
            }
          : {}),
      };
    }
    return adjustSnappedShapeOnDrag(
      origShape,
      rawPt,
      scaleX,
      scaleY,
      { shape: origShape, anchorX: origShape.x2, anchorY: origShape.y2 },
      lockPerfect
    );
  }

  if (origShape.type === 'ellipse') {
    const handles = getShapeEditHandles(origShape, {
      scaleX,
      scaleY,
      offsetX: 0,
      offsetY: 0,
      unitScale: (scaleX + scaleY) * 0.5 || 1,
    });
    const h = handles.find((item) => item.id === handleId);
    if (!h) return origShape;
    return adjustSnappedShapeOnDrag(
      origShape,
      rawPt,
      scaleX,
      scaleY,
      { shape: origShape, anchorX: h.x, anchorY: h.y },
      lockPerfect
    );
  }

  if (origShape.type === 'polygon') {
    if (origShape.closed) {
      const idx = Number(handleId.replace('v_', ''));
      const v = origShape.points[idx];
      if (!v) return origShape;
      return adjustSnappedShapeOnDrag(
        origShape,
        rawPt,
        scaleX,
        scaleY,
        { shape: origShape, anchorX: v.x, anchorY: v.y },
        lockPerfect
      );
    }
    const idx = Number(handleId.replace('v_', ''));
    if (idx === 0) {
      const reversed: AnnotationShape = { ...origShape, points: origShape.points.slice().reverse() };
      const adj = adjustSnappedShapeOnDrag(reversed, rawPt, scaleX, scaleY, null, lockPerfect);
      if (adj.type === 'polygon') {
        return { ...adj, points: adj.points.slice().reverse() };
      }
    } else if (idx === origShape.points.length - 1) {
      return adjustSnappedShapeOnDrag(origShape, rawPt, scaleX, scaleY, null, lockPerfect);
    } else if (!Number.isNaN(idx) && origShape.points[idx]) {
      return {
        ...origShape,
        points: origShape.points.map((p, i) => (i === idx ? { x: rawPt.x, y: rawPt.y } : p)),
      };
    }
  }

  if (origShape.type === 'curve' && origShape.points.length >= 2) {
    if (handleId === 'mid' && origShape.points.length >= 5) {
      const midIdx = Math.floor(origShape.points.length * 0.5);
      const midPt = origShape.points[midIdx];
      const dispX = rawPt.x - midPt.x;
      const dispY = rawPt.y - midPt.y;
      const n = origShape.points.length;
      return {
        type: 'curve',
        points: origShape.points.map((p, i) => {
          if (i === 0 || i === n - 1) return { x: p.x, y: p.y };
          const u = i / (n - 1);
          const bell = Math.pow(Math.sin(Math.PI * u), 1.35);
          return { x: p.x + dispX * bell, y: p.y + dispY * bell };
        }),
      };
    }
    if (handleId === 'start') {
      const reversed: AnnotationShape = { type: 'curve', points: origShape.points.slice().reverse() };
      const adj = adjustSnappedShapeOnDrag(reversed, rawPt, scaleX, scaleY, null, lockPerfect);
      if (adj.type === 'curve') {
        return { type: 'curve', points: adj.points.slice().reverse() };
      }
    }
    return adjustSnappedShapeOnDrag(origShape, rawPt, scaleX, scaleY, null, lockPerfect);
  }

  return origShape;
}

/**
 * Draws the Apple-style vector selection frame and interactive resize/reshape/rotate handles
 * onto `draftCanvas` in CSS pixel coordinates.
 */
export function drawShapeSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  stroke: AnnotationStroke,
  tf: RenderTransform,
  activeHandleId?: string | null
): CssBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  ctx.save();
  if (stroke.shape) {
    // Subtle translucent highlight halo along the shape geometry
    ctx.save();
    traceShapePath(ctx, stroke.shape, tf);
    ctx.strokeStyle = 'rgba(0, 122, 255, 0.32)';
    ctx.lineWidth = Math.max(4, stroke.size * tf.unitScale + 5);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    const shapeBounds = computeShapeCssBounds(stroke.shape, tf, 12);
    if (shapeBounds) {
      include(shapeBounds.minX, shapeBounds.minY);
      include(shapeBounds.maxX, shapeBounds.maxY);
    }

    const rawShapeBounds = computeShapeCssBounds(stroke.shape, tf, 0);
    const handles = getShapeEditHandles(stroke.shape, tf);
    const rotHandle = handles.find((item) => item.id === 'rotate');
    if (rotHandle && rawShapeBounds) {
      const anchorX = (rawShapeBounds.minX + rawShapeBounds.maxX) * 0.5;
      const anchorY = rawShapeBounds.minY;
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(0, 122, 255, 0.55)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(anchorX, anchorY);
      ctx.lineTo(rotHandle.screenX, rotHandle.screenY);
      ctx.stroke();
      ctx.restore();
    }

    for (const h of handles) {
      const isHot = activeHandleId === h.id;
      const isRotate = h.id === 'rotate';
      const r = isRotate ? (isHot ? 8.2 : 7.0) : isHot ? 6.2 : 5.0;
      ctx.beginPath();
      ctx.arc(h.screenX, h.screenY, r, 0, Math.PI * 2);
      ctx.fillStyle = isHot ? '#007AFF' : '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 2.0;
      ctx.strokeStyle = isHot ? '#FFFFFF' : '#007AFF';
      ctx.stroke();

      if (isRotate) {
        // Tiny crisp rotation arc icon inside knob
        ctx.save();
        ctx.beginPath();
        ctx.arc(h.screenX, h.screenY, 3.3, -Math.PI * 0.78, Math.PI * 0.58);
        ctx.strokeStyle = isHot ? '#FFFFFF' : '#007AFF';
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
      }

      const pad = isRotate ? 13 : 10;
      include(h.screenX - pad, h.screenY - pad);
      include(h.screenX + pad, h.screenY + pad);
    }
  } else if (stroke.points.length > 0) {
    for (const p of stroke.points) {
      include(p.x * tf.scaleX + tf.offsetX, p.y * tf.scaleY + tf.offsetY);
    }
    const pad = Math.max(8, stroke.size * tf.unitScale * 0.65);
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(0, 122, 255, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
    ctx.setLineDash([]);
    minX -= 6;
    minY -= 6;
    maxX += 6;
    maxY += 6;
  }
  ctx.restore();

  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * GoodNotes 6-inspired Scribble-to-Erase detector:
 * - Recognizes rapid back-and-forth zig-zag scrubbing (>= 4 sharp >= 117° direction reversals
 *   with dense self-overlapping scrub ratio and bounded duration).
 * - Smooth Arabic calligraphy, harakat dots, and closed loops NEVER trigger accidental erasure,
 *   and blank-page scribbles never trigger unless at least one existing stroke is genuinely crossed.
 */
export function findScribbleErasedStrokeIds(
  scribblePts: ReadonlyArray<AnnotationPoint>,
  strokes: ReadonlyArray<AnnotationStroke>,
  tf: RenderTransform
): string[] {
  const n = scribblePts.length;
  if (n < 10 || strokes.length === 0) return [];

  const durationMs = scribblePts[n - 1].t - scribblePts[0].t;
  if (durationMs < 55 || durationMs > 2200) return [];

  // Resample in screen pixels at >= 5px spacing so micro-jitter can never mimic zig-zag reversals
  const sx = tf.scaleX;
  const sy = tf.scaleY;
  const ox = tf.offsetX;
  const oy = tf.offsetY;

  const firstX = scribblePts[0].x * sx + ox;
  const firstY = scribblePts[0].y * sy + oy;
  const pts: Pt2D[] = [{ x: firstX, y: firstY }];
  let minX = firstX;
  let minY = firstY;
  let maxX = firstX;
  let maxY = firstY;
  let lastX = firstX;
  let lastY = firstY;
  let pathLen = 0;

  for (let i = 1; i < n; i++) {
    const px = scribblePts[i].x * sx + ox;
    const py = scribblePts[i].y * sy + oy;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
    const d = Math.hypot(px - lastX, py - lastY);
    if (d >= 5 || i === n - 1) {
      if (d >= 1) {
        pts.push({ x: px, y: py });
        pathLen += d;
        lastX = px;
        lastY = py;
      }
    }
  }

  if (pts.length < 7) return [];
  const diag = Math.hypot(maxX - minX, maxY - minY);
  if (diag < 24 || diag > 480) return [];

  const scrubDensity = pathLen / Math.max(20, diag);
  if (scrubDensity < 3.05) return [];

  let reversals = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const dx1 = pts[i].x - pts[i - 1].x;
    const dy1 = pts[i].y - pts[i - 1].y;
    const dx2 = pts[i + 1].x - pts[i].x;
    const dy2 = pts[i + 1].y - pts[i].y;
    const l1 = Math.hypot(dx1, dy1);
    const l2 = Math.hypot(dx2, dy2);
    if (l1 < 5 || l2 < 5) continue;
    const cosTheta = (dx1 * dx2 + dy1 * dy2) / (l1 * l2);
    if (cosTheta <= -0.45) {
      reversals++;
    }
  }

  if (reversals < 4) return [];

  const hitRadiusPx = Math.min(14, Math.max(7, diag * 0.14));
  const hitSet = new Set<string>();

  for (let i = 0; i < strokes.length; i++) {
    const st = strokes[i];
    if (hitSet.has(st.id)) continue;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      if (hitTestStroke(p.x, p.y, st, hitRadiusPx, tf)) {
        hitSet.add(st.id);
        break;
      }
      if (k + 1 < pts.length) {
        const mx = (p.x + pts[k + 1].x) * 0.5;
        const my = (p.y + pts[k + 1].y) * 0.5;
        if (hitTestStroke(mx, my, st, hitRadiusPx, tf)) {
          hitSet.add(st.id);
          break;
        }
      }
    }
  }

  return Array.from(hitSet);
}

/**
 * Computes screen-pixel CSS bounds of any stroke or snapped shape (used to anchor floating actions).
 */
export function getStrokeScreenBounds(
  stroke: AnnotationStroke,
  tf: RenderTransform
): CssBounds | null {
  const pad = Math.max(8, stroke.size * tf.unitScale * 0.65);
  if (stroke.shape) {
    return computeShapeCssBounds(stroke.shape, tf, pad);
  }
  if (stroke.points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < stroke.points.length; i++) {
    const sx = stroke.points[i].x * tf.scaleX + tf.offsetX;
    const sy = stroke.points[i].y * tf.scaleY + tf.offsetY;
    if (sx < minX) minX = sx;
    if (sy < minY) minY = sy;
    if (sx > maxX) maxX = sx;
    if (sy > maxY) maxY = sy;
  }
  return Number.isFinite(minX)
    ? { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
    : null;
}

interface ScreenEraseNode {
  x: number;
  y: number;
  pressure: number;
  t: number;
}

function clipPolysWithCircle(
  sourcePolys: ScreenEraseNode[][],
  screenX: number,
  screenY: number,
  r: number
): { polys: ScreenEraseNode[][]; modified: boolean } {
  const rSq = r * r;
  const survivingPolys: ScreenEraseNode[][] = [];
  let modified = false;

  const isInside = (p: ScreenEraseNode) => {
    const dx = p.x - screenX;
    const dy = p.y - screenY;
    return dx * dx + dy * dy <= rSq;
  };

  const interpNode = (a: ScreenEraseNode, b: ScreenEraseNode, u: number): ScreenEraseNode => ({
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    pressure: a.pressure + (b.pressure - a.pressure) * u,
    t: a.t + (b.t - a.t) * u,
  });

  for (const poly of sourcePolys) {
    if (poly.length < 2) continue;
    let current: ScreenEraseNode[] = [];
    const flushCurrent = () => {
      if (current.length >= 2) {
        survivingPolys.push(current);
      }
      current = [];
    };

    if (!isInside(poly[0])) {
      current.push(poly[0]);
    } else {
      modified = true;
    }

    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i];
      const b = poly[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const aIn = isInside(a);
      const bIn = isInside(b);

      if (aIn && bIn) {
        modified = true;
        flushCurrent();
        continue;
      }

      const segLenSq = dx * dx + dy * dy;
      if (segLenSq < 1e-6) {
        if (!bIn) current.push(b);
        continue;
      }

      const fx = a.x - screenX;
      const fy = a.y - screenY;
      const bCoef = 2 * (fx * dx + fy * dy);
      const cCoef = fx * fx + fy * fy - rSq;
      const disc = bCoef * bCoef - 4 * segLenSq * cCoef;

      if (disc <= 0) {
        if (!aIn && !bIn) {
          current.push(b);
        }
        continue;
      }

      const sqrtDisc = Math.sqrt(disc);
      const t1 = (-bCoef - sqrtDisc) / (2 * segLenSq);
      const t2 = (-bCoef + sqrtDisc) / (2 * segLenSq);

      if (!aIn && !bIn) {
        if (t1 > 0 && t2 < 1 && t2 - t1 > 0.001) {
          modified = true;
          current.push(interpNode(a, b, t1));
          flushCurrent();
          current = [interpNode(a, b, t2), b];
        } else {
          current.push(b);
        }
      } else if (!aIn && bIn) {
        modified = true;
        const hitT = t1 >= 0 && t1 <= 1 ? t1 : t2 >= 0 && t2 <= 1 ? t2 : 0.5;
        current.push(interpNode(a, b, Math.max(0, Math.min(1, hitT))));
        flushCurrent();
      } else if (aIn && !bIn) {
        modified = true;
        const hitT = t2 >= 0 && t2 <= 1 ? t2 : t1 >= 0 && t1 <= 1 ? t1 : 0.5;
        current = [interpNode(a, b, Math.max(0, Math.min(1, hitT))), b];
      }
    }

    flushCurrent();
  }

  return { polys: survivingPolys, modified };
}

/**
 * Splits a freehand stroke or snapped shape smoothly along a continuous coalesced eraser sweep path.
 * Returns `null` if untouched, `[]` if completely erased, or >= 1 remaining sub-strokes.
 */
export function eraseStrokePartiallyPath(
  stroke: AnnotationStroke,
  sweepPts: ReadonlyArray<{ x: number; y: number }>,
  eraserRadiusPx: number,
  tf: RenderTransform
): AnnotationStroke[] | null {
  if (!hitTestStrokePath(sweepPts, stroke, eraserRadiusPx, tf)) {
    return null;
  }

  const strokePad = Math.max(2, stroke.size * tf.unitScale * 0.5);
  const r = eraserRadiusPx + strokePad;
  const invScaleX = Math.abs(tf.scaleX) > 1e-6 ? 1 / tf.scaleX : 1;
  const invScaleY = Math.abs(tf.scaleY) > 1e-6 ? 1 / tf.scaleY : 1;

  let polys: ScreenEraseNode[][] = [];
  if (stroke.shape) {
    const shapePolys = sampleShapeToPolylines(stroke.shape, tf, 3.0);
    const nowT = stroke.points[0]?.t ?? performance.now();
    for (const sp of shapePolys) {
      if (sp.length === 0) continue;
      polys.push(
        sp.map((p) => ({
          x: p.x,
          y: p.y,
          pressure: 0.5,
          t: nowT,
        }))
      );
    }
  } else {
    if (stroke.points.length === 0) return [];
    if (stroke.points.length === 1) {
      return [];
    }
    polys.push(
      stroke.points.map((p) => ({
        x: p.x * tf.scaleX + tf.offsetX,
        y: p.y * tf.scaleY + tf.offsetY,
        pressure: p.pressure,
        t: p.t,
      }))
    );
  }

  let anyModified = false;
  const stepDist = Math.max(2, r * 0.28);

  if (sweepPts.length === 1) {
    const res = clipPolysWithCircle(polys, sweepPts[0].x, sweepPts[0].y, r);
    polys = res.polys;
    anyModified = res.modified;
  } else {
    for (let k = 0; k < sweepPts.length - 1; k++) {
      if (polys.length === 0) break;
      const p0 = sweepPts[k];
      const p1 = sweepPts[k + 1];
      const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const steps = Math.max(1, Math.ceil(segLen / stepDist));
      const startStep = k === 0 ? 0 : 1;
      for (let s = startStep; s <= steps; s++) {
        if (polys.length === 0) break;
        const u = steps === 0 ? 1 : s / steps;
        const cx = p0.x + (p1.x - p0.x) * u;
        const cy = p0.y + (p1.y - p0.y) * u;
        const res = clipPolysWithCircle(polys, cx, cy, r);
        polys = res.polys;
        if (res.modified) anyModified = true;
      }
    }
  }

  if (!anyModified) {
    return null;
  }

  return polys.map((poly, idx) => ({
    ...stroke,
    id: `${stroke.id}_p${idx}_${Math.random().toString(36).slice(2, 6)}`,
    shape: undefined,
    points: poly.map((p) => ({
      x: (p.x - tf.offsetX) * invScaleX,
      y: (p.y - tf.offsetY) * invScaleY,
      pressure: p.pressure,
      t: p.t,
    })),
  }));
}

/**
 * Splits a freehand stroke or snapped shape cleanly around a circular partial eraser footprint.
 * Returns `null` if untouched, `[]` if completely erased, or >= 1 remaining sub-strokes.
 */
export function eraseStrokePartially(
  stroke: AnnotationStroke,
  screenX: number,
  screenY: number,
  eraserRadiusPx: number,
  tf: RenderTransform
): AnnotationStroke[] | null {
  return eraseStrokePartiallyPath(stroke, [{ x: screenX, y: screenY }], eraserRadiusPx, tf);
}


/**
 * Draws a crisp Apple-style live Precision HUD pill near an actively edited/snapped shape
 * showing angle (°) or dimensions/diameter in Arabic digits, returning its CSS bounds so
 * `draftCanvas` clears cleanly with zero trails.
 */
export function drawShapePrecisionHud(
  ctx: CanvasRenderingContext2D,
  shape: AnnotationShape,
  tf: RenderTransform,
  canvasW: number,
  canvasH: number,
  opts?: { activeHandleId?: string | null; rotationDeg?: number | null }
): CssBounds | null {
  const bounds = computeShapeCssBounds(shape, tf, 0);
  if (!bounds) return null;

  let text = '';
  if (opts?.activeHandleId === 'rotate' && opts.rotationDeg !== undefined && opts.rotationDeg !== null) {
    const rounded = Math.round(((opts.rotationDeg % 360) + 360) % 360);
    text = `↻ ${toArabicDigits(rounded)}°`;
  } else if (shape.type === 'line' || shape.type === 'arrow' || shape.type === 'brace') {
    const dx = (shape.x2 - shape.x1) * tf.scaleX;
    const dy = (shape.y2 - shape.y1) * tf.scaleY;
    const lenPx = Math.round(Math.hypot(dx, dy));
    const degRaw = (Math.atan2(-dy, dx) * 180) / Math.PI;
    const degNorm = Math.round(((degRaw % 360) + 360) % 360);
    text = `${toArabicDigits(degNorm)}°  ·  ${toArabicDigits(lenPx)}`;
  } else if (shape.type === 'ellipse') {
    const { rxPx, ryPx } = resolveEllipseScreenRadii(
      shape.rx,
      shape.ry,
      shape.rotation,
      tf,
      shape.isCircle
    );
    const wPx = Math.round(rxPx * 2);
    const hPx = Math.round(ryPx * 2);
    if (shape.isCircle || Math.abs(wPx - hPx) <= 2) {
      text = `Ø ${toArabicDigits(wPx)}`;
    } else {
      text = `${toArabicDigits(wPx)} × ${toArabicDigits(hPx)}`;
    }
  } else if (shape.type === 'arc') {
    const dx = (shape.x2 - shape.x1) * tf.scaleX;
    const dy = (shape.y2 - shape.y1) * tf.scaleY;
    const lenPx = Math.round(Math.hypot(dx, dy));
    const midX = (shape.x1 + shape.x2) * 0.5 * tf.scaleX;
    const midY = (shape.y1 + shape.y2) * 0.5 * tf.scaleY;
    const sagPx = Math.round(Math.hypot(shape.cx * tf.scaleX - midX, shape.cy * tf.scaleY - midY));
    text = `${toArabicDigits(lenPx)}  ·  ◠ ${toArabicDigits(sagPx)}`;
  } else {
    const wPx = Math.round(bounds.maxX - bounds.minX);
    const hPx = Math.round(bounds.maxY - bounds.minY);
    if (wPx < 4 && hPx < 4) return null;
    text = `${toArabicDigits(wPx)} × ${toArabicDigits(hPx)}`;
  }

  if (!text) return null;

  ctx.save();
  ctx.font = '700 11px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  const metrics = ctx.measureText(text);
  const padX = 9;
  const pillW = Math.ceil(metrics.width + padX * 2);
  const pillH = 22;

  const anchorX = (bounds.minX + bounds.maxX) * 0.5;
  const placeBelow = bounds.minY < 46;
  const rawY = placeBelow ? bounds.maxY + 14 : bounds.minY - 36;
  const pillX = Math.max(8, Math.min(Math.max(8, canvasW - pillW - 8), anchorX - pillW * 0.5));
  const pillY = Math.max(8, Math.min(Math.max(8, canvasH - pillH - 8), rawY));

  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, pillH, 999);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.stroke();

  ctx.fillStyle = '#F8FAFC';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pillX + pillW * 0.5, pillY + pillH * 0.5 + 0.5);
  ctx.restore();

  return {
    minX: pillX - 3,
    minY: pillY - 3,
    maxX: pillX + pillW + 3,
    maxY: pillY + pillH + 3,
  };
}

/**
 * Samples a snapped geometric shape cleanly into normalized `AnnotationPoint[]`
 * so users can flatten any snapped shape into freehand editable ink/segments.
 */
export function flattenShapeToFreehandPoints(
  stroke: AnnotationStroke,
  tf: RenderTransform
): AnnotationPoint[] {
  if (!stroke.shape) return stroke.points;
  const polylines = sampleShapeToPolylines(stroke.shape, tf, 3.0);
  if (polylines.length === 0) return stroke.points;
  const invSx = Math.abs(tf.scaleX) > 1e-6 ? 1 / tf.scaleX : 1;
  const invSy = Math.abs(tf.scaleY) > 1e-6 ? 1 / tf.scaleY : 1;
  const baseT = stroke.points[0]?.t ?? performance.now();

  // Merge polylines into a continuous normalized polyline (preserving clean vertices)
  const merged = polylines[0];
  return merged.map((p, idx) => ({
    x: (p.x - tf.offsetX) * invSx,
    y: (p.y - tf.offsetY) * invSy,
    pressure: 0.5,
    t: baseT + idx * 4,
  }));
}

function isPointInPolygonPx(
  px: number,
  py: number,
  poly: ReadonlyArray<{ x: number; y: number }>
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-6) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentsIntersectPx(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  if (
    Math.max(ax, bx) < Math.min(cx, dx) ||
    Math.max(cx, dx) < Math.min(ax, bx) ||
    Math.max(ay, by) < Math.min(cy, dy) ||
    Math.max(cy, dy) < Math.min(ay, by)
  ) {
    return false;
  }
  const ccw = (p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number) =>
    (p3y - p1y) * (p2x - p1x) - (p2y - p1y) * (p3x - p1x);
  const d1 = ccw(cx, cy, dx, dy, ax, ay);
  const d2 = ccw(cx, cy, dx, dy, bx, by);
  const d3 = ccw(ax, ay, bx, by, cx, cy);
  const d4 = ccw(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  const eps = 1e-6;
  const onSeg = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    qx <= Math.max(px, rx) + eps &&
    qx >= Math.min(px, rx) - eps &&
    qy <= Math.max(py, ry) + eps &&
    qy >= Math.min(py, ry) - eps;
  if (Math.abs(d1) <= eps && onSeg(cx, cy, ax, ay, dx, dy)) return true;
  if (Math.abs(d2) <= eps && onSeg(cx, cy, bx, by, dx, dy)) return true;
  if (Math.abs(d3) <= eps && onSeg(ax, ay, cx, cy, bx, by)) return true;
  if (Math.abs(d4) <= eps && onSeg(ax, ay, dx, dy, bx, by)) return true;
  return false;
}

export interface LassoHitOptions {
  mode?: LassoMode;
  matchMode?: LassoMatchMode;
  includeHighlights?: boolean;
}

/**
 * Returns IDs of all strokes matching the Lasso loop or Marquee rectangle in CSS pixels.
 * Supports:
 * - `mode`: `'freeform'` lasso loop or `'rect'` marquee box
 * - `matchMode`: `'touch'` (any intersection or interior overlap) or `'contain'` (fully enclosed)
 * - `includeHighlights`: whether highlighters and study tape are included
 */
export function findStrokesInLasso(
  lassoScreenPts: ReadonlyArray<{ x: number; y: number }>,
  strokes: ReadonlyArray<AnnotationStroke>,
  tf: RenderTransform,
  opts?: LassoHitOptions
): string[] {
  if (lassoScreenPts.length < 2 || strokes.length === 0) return [];

  const mode: LassoMode = opts?.mode ?? 'freeform';
  const matchMode: LassoMatchMode = opts?.matchMode ?? 'touch';
  const includeHighlights = opts?.includeHighlights ?? true;

  if (mode === 'rect') {
    const p0 = lassoScreenPts[0];
    const p1 = lassoScreenPts[lassoScreenPts.length - 1];
    const rMinX = Math.min(p0.x, p1.x);
    const rMaxX = Math.max(p0.x, p1.x);
    const rMinY = Math.min(p0.y, p1.y);
    const rMaxY = Math.max(p0.y, p1.y);
    const rectEdges = [
      { ax: rMinX, ay: rMinY, bx: rMaxX, by: rMinY },
      { ax: rMaxX, ay: rMinY, bx: rMaxX, by: rMaxY },
      { ax: rMaxX, ay: rMaxY, bx: rMinX, by: rMaxY },
      { ax: rMinX, ay: rMaxY, bx: rMinX, by: rMinY },
    ];
    const rectCorners = [
      { x: rMinX, y: rMinY },
      { x: rMaxX, y: rMinY },
      { x: rMaxX, y: rMaxY },
      { x: rMinX, y: rMaxY },
    ];

    const hits: string[] = [];
    for (let i = 0; i < strokes.length; i++) {
      const st = strokes[i];
      if (!includeHighlights && (st.kind === 'highlighter' || st.kind === 'tape')) {
        continue;
      }
      const sb = getStrokeScreenBounds(st, tf);
      if (!sb) continue;
      const touchPad = Math.max(3, st.size * tf.unitScale * 0.5 + 2);
      if (
        sb.maxX < rMinX - (matchMode === 'contain' ? 0 : touchPad) ||
        sb.minX > rMaxX + (matchMode === 'contain' ? 0 : touchPad) ||
        sb.maxY < rMinY - (matchMode === 'contain' ? 0 : touchPad) ||
        sb.minY > rMaxY + (matchMode === 'contain' ? 0 : touchPad)
      ) {
        continue;
      }

      const polylines: Array<ReadonlyArray<{ x: number; y: number }>> = st.shape
        ? sampleShapeToPolylines(st.shape, tf, matchMode === 'contain' ? 4 : 8)
        : [
            st.points.map((p) => ({
              x: p.x * tf.scaleX + tf.offsetX,
              y: p.y * tf.scaleY + tf.offsetY,
            })),
          ];

      let matched = false;
      if (matchMode === 'contain') {
        const tol = 2;
        let hasAnyPt = false;
        let allInside = true;
        for (let pIdx = 0; pIdx < polylines.length && allInside; pIdx++) {
          const poly = polylines[pIdx];
          for (let k = 0; k < poly.length; k++) {
            hasAnyPt = true;
            const pt = poly[k];
            if (
              pt.x < rMinX - tol ||
              pt.x > rMaxX + tol ||
              pt.y < rMinY - tol ||
              pt.y > rMaxY + tol
            ) {
              allInside = false;
              break;
            }
          }
        }
        matched = hasAnyPt && allInside;
      } else {
        for (let pIdx = 0; pIdx < polylines.length && !matched; pIdx++) {
          const poly = polylines[pIdx];
          if (poly.length === 0) continue;

          for (let k = 0; k < poly.length; k++) {
            const pt = poly[k];
            if (
              pt.x >= rMinX - touchPad &&
              pt.x <= rMaxX + touchPad &&
              pt.y >= rMinY - touchPad &&
              pt.y <= rMaxY + touchPad
            ) {
              matched = true;
              break;
            }
          }
          if (matched || poly.length < 2) continue;

          for (let k = 0; k < poly.length - 1 && !matched; k++) {
            const a = poly[k];
            const b = poly[k + 1];
            for (let eIdx = 0; eIdx < 4; eIdx++) {
              const ed = rectEdges[eIdx];
              if (segmentsIntersectPx(a.x, a.y, b.x, b.y, ed.ax, ed.ay, ed.bx, ed.by)) {
                matched = true;
                break;
              }
            }
            if (matched) break;
            for (let cIdx = 0; cIdx < 4; cIdx++) {
              const cp = rectCorners[cIdx];
              if (distToSegment(cp.x, cp.y, a.x, a.y, b.x, b.y) <= touchPad) {
                matched = true;
                break;
              }
            }
          }
        }
      }

      if (matched) {
        hits.push(st.id);
      }
    }
    return hits;
  }

  let lMinX = Infinity;
  let lMinY = Infinity;
  let lMaxX = -Infinity;
  let lMaxY = -Infinity;
  for (let i = 0; i < lassoScreenPts.length; i++) {
    const p = lassoScreenPts[i];
    if (p.x < lMinX) lMinX = p.x;
    if (p.y < lMinY) lMinY = p.y;
    if (p.x > lMaxX) lMaxX = p.x;
    if (p.y > lMaxY) lMaxY = p.y;
  }

  const isClosed = lassoScreenPts.length >= 3;
  if (matchMode === 'contain' && !isClosed) {
    return [];
  }

  const lassoEdges: Array<{ ax: number; ay: number; bx: number; by: number }> = [];
  if (matchMode === 'touch') {
    for (let i = 0; i < lassoScreenPts.length - 1; i++) {
      lassoEdges.push({
        ax: lassoScreenPts[i].x,
        ay: lassoScreenPts[i].y,
        bx: lassoScreenPts[i + 1].x,
        by: lassoScreenPts[i + 1].y,
      });
    }
    if (isClosed) {
      lassoEdges.push({
        ax: lassoScreenPts[lassoScreenPts.length - 1].x,
        ay: lassoScreenPts[lassoScreenPts.length - 1].y,
        bx: lassoScreenPts[0].x,
        by: lassoScreenPts[0].y,
      });
    }
  }

  const hits: string[] = [];
  for (let i = 0; i < strokes.length; i++) {
    const st = strokes[i];
    if (!includeHighlights && (st.kind === 'highlighter' || st.kind === 'tape')) {
      continue;
    }
    const sb = getStrokeScreenBounds(st, tf);
    if (!sb) continue;
    const touchPad = Math.max(3, st.size * tf.unitScale * 0.5 + 2);
    if (
      sb.maxX < lMinX - (matchMode === 'contain' ? 0 : touchPad) ||
      sb.minX > lMaxX + (matchMode === 'contain' ? 0 : touchPad) ||
      sb.maxY < lMinY - (matchMode === 'contain' ? 0 : touchPad) ||
      sb.minY > lMaxY + (matchMode === 'contain' ? 0 : touchPad)
    ) {
      continue;
    }

    const polylines: Array<ReadonlyArray<{ x: number; y: number }>> = st.shape
      ? sampleShapeToPolylines(st.shape, tf, matchMode === 'contain' ? 4 : 8)
      : [
          st.points.map((p) => ({
            x: p.x * tf.scaleX + tf.offsetX,
            y: p.y * tf.scaleY + tf.offsetY,
          })),
        ];

    let matched = false;
    if (matchMode === 'contain') {
      let hasAnyPt = false;
      let allInside = true;
      for (let pIdx = 0; pIdx < polylines.length && allInside; pIdx++) {
        const poly = polylines[pIdx];
        for (let k = 0; k < poly.length; k++) {
          hasAnyPt = true;
          if (!isPointInPolygonPx(poly[k].x, poly[k].y, lassoScreenPts)) {
            allInside = false;
            break;
          }
        }
      }
      matched = hasAnyPt && allInside;
    } else {
      for (let pIdx = 0; pIdx < polylines.length && !matched; pIdx++) {
        const poly = polylines[pIdx];
        if (poly.length === 0) continue;

        if (isClosed) {
          for (let k = 0; k < poly.length; k++) {
            if (isPointInPolygonPx(poly[k].x, poly[k].y, lassoScreenPts)) {
              matched = true;
              break;
            }
          }
          if (matched) break;
        }

        if (poly.length === 1) {
          const pt = poly[0];
          for (let eIdx = 0; eIdx < lassoEdges.length; eIdx++) {
            const ed = lassoEdges[eIdx];
            if (distToSegment(pt.x, pt.y, ed.ax, ed.ay, ed.bx, ed.by) <= touchPad) {
              matched = true;
              break;
            }
          }
          continue;
        }

        for (let k = 0; k < poly.length - 1 && !matched; k++) {
          const a = poly[k];
          const b = poly[k + 1];
          for (let eIdx = 0; eIdx < lassoEdges.length; eIdx++) {
            const ed = lassoEdges[eIdx];
            if (segmentsIntersectPx(a.x, a.y, b.x, b.y, ed.ax, ed.ay, ed.bx, ed.by)) {
              matched = true;
              break;
            }
          }
          if (matched) break;
          for (let lIdx = 0; lIdx < lassoScreenPts.length; lIdx++) {
            const lp = lassoScreenPts[lIdx];
            if (distToSegment(lp.x, lp.y, a.x, a.y, b.x, b.y) <= touchPad) {
              matched = true;
              break;
            }
          }
        }
      }
    }

    if (matched) {
      hits.push(st.id);
    }
  }
  return hits;
}

export function getStrokesGroupBounds(
  strokes: ReadonlyArray<AnnotationStroke>,
  tf: RenderTransform
): CssBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < strokes.length; i++) {
    const b = getStrokeScreenBounds(strokes[i], tf);
    if (!b) continue;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export function drawLassoOverlay(
  ctx: CanvasRenderingContext2D,
  lassoScreenPts: ReadonlyArray<{ x: number; y: number }> | null,
  groupBounds: CssBounds | null,
  mode: LassoMode = 'freeform'
): CssBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  ctx.save();
  if (lassoScreenPts && lassoScreenPts.length >= 2) {
    if (mode === 'rect') {
      const p0 = lassoScreenPts[0];
      const p1 = lassoScreenPts[lassoScreenPts.length - 1];
      const rx = Math.min(p0.x, p1.x);
      const ry = Math.min(p0.y, p1.y);
      const rw = Math.abs(p1.x - p0.x);
      const rh = Math.abs(p1.y - p0.y);
      ctx.fillStyle = 'rgba(0, 122, 255, 0.08)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(0, 122, 255, 0.9)';
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
      include(rx - 6, ry - 6);
      include(rx + rw + 6, ry + rh + 6);
    } else {
      ctx.beginPath();
      ctx.moveTo(lassoScreenPts[0].x, lassoScreenPts[0].y);
      include(lassoScreenPts[0].x, lassoScreenPts[0].y);
      for (let i = 1; i < lassoScreenPts.length; i++) {
        ctx.lineTo(lassoScreenPts[i].x, lassoScreenPts[i].y);
        include(lassoScreenPts[i].x, lassoScreenPts[i].y);
      }
      if (lassoScreenPts.length >= 3) {
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 122, 255, 0.08)';
        ctx.fill();
      }
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(0, 122, 255, 0.88)';
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.setLineDash([]);
      minX -= 6;
      minY -= 6;
      maxX += 6;
      maxY += 6;
    }
  }

  if (groupBounds) {
    const pad = 4;
    const bx = groupBounds.minX - pad;
    const by = groupBounds.minY - pad;
    const bw = groupBounds.maxX - groupBounds.minX + pad * 2;
    const bh = groupBounds.maxY - groupBounds.minY + pad * 2;
    ctx.fillStyle = 'rgba(0, 122, 255, 0.04)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(0, 122, 255, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.setLineDash([]);

    const corners = [
      [bx, by],
      [bx + bw, by],
      [bx + bw, by + bh],
      [bx, by + bh],
    ];
    for (let i = 0; i < corners.length; i++) {
      ctx.beginPath();
      ctx.arc(corners[i][0], corners[i][1], 4.2, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#007AFF';
      ctx.stroke();
    }
    include(bx - 8, by - 8);
    include(bx + bw + 8, by + bh + 8);
  }
  ctx.restore();

  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/**
 * Generates an instant clean geometric AnnotationShape directly while dragging with Quick Shapes tool.
 * Supports explicit modes (`line`, `arrow`, `rect`, `ellipse`, `triangle`) as well as instant `auto` recognition.
 */
export function buildQuickShapeFromDrag(
  mode: QuickShapeMode,
  startPt: AnnotationPoint,
  endPt: AnnotationPoint,
  rawPoints: ReadonlyArray<AnnotationPoint>,
  scaleX: number,
  scaleY: number,
  lockPerfect: boolean
): AnnotationShape | undefined {
  const sx = Math.abs(scaleX) > 1e-6 ? scaleX : 1;
  const sy = Math.abs(scaleY) > 1e-6 ? scaleY : 1;
  const p0x = startPt.x * sx;
  const p0y = startPt.y * sy;
  let p1x = endPt.x * sx;
  let p1y = endPt.y * sy;

  const dx = p1x - p0x;
  const dy = p1y - p0y;
  const chord = Math.hypot(dx, dy);

  if (mode === 'auto') {
    if (rawPoints.length >= 4) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < rawPoints.length; i++) {
        const px = rawPoints[i].x * sx;
        const py = rawPoints[i].y * sy;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
      if (Math.hypot(maxX - minX, maxY - minY) >= 18) {
        const detected = detectHoldShape(rawPoints as AnnotationPoint[], sx, sy, true);
        if (detected) {
          return lockPerfect ? enforcePerfectShape(detected, sx, sy) : detected;
        }
      }
    }
    if (chord < 6) return undefined;
    mode = 'line';
  }

  if (chord < 6) return undefined;

  if (mode === 'line' || mode === 'arrow') {
    if (lockPerfect) {
      const ang = snapAngle45Rad(dx, dy);
      p1x = p0x + Math.cos(ang) * chord;
      p1y = p0y + Math.sin(ang) * chord;
    } else {
      const deg = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
      if (deg < 2.2 || Math.abs(deg - 180) < 2.2) p1y = p0y;
      else if (Math.abs(deg - 90) < 2.2) p1x = p0x;
    }

    if (mode === 'line') {
      return {
        type: 'line',
        x1: p0x / sx,
        y1: p0y / sy,
        x2: p1x / sx,
        y2: p1y / sy,
      };
    }

    const lenPx = Math.hypot(p1x - p0x, p1y - p0y);
    const headLen = Math.max(12, Math.min(24, lenPx * 0.24));
    const wings = buildArrowWings({ x: p1x, y: p1y }, p1x - p0x, p1y - p0y, headLen);
    return {
      type: 'arrow',
      x1: p0x / sx,
      y1: p0y / sy,
      x2: p1x / sx,
      y2: p1y / sy,
      leftX: wings.left.x / sx,
      leftY: wings.left.y / sy,
      rightX: wings.right.x / sx,
      rightY: wings.right.y / sy,
    };
  }

  if (lockPerfect) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    p1x = p0x + (dx >= 0 ? side : -side);
    p1y = p0y + (dy >= 0 ? side : -side);
  }

  const left = Math.min(p0x, p1x);
  const right = Math.max(p0x, p1x);
  const top = Math.min(p0y, p1y);
  const bottom = Math.max(p0y, p1y);

  if (mode === 'rect') {
    return {
      type: 'polygon',
      closed: true,
      points: [
        { x: left / sx, y: top / sy },
        { x: right / sx, y: top / sy },
        { x: right / sx, y: bottom / sy },
        { x: left / sx, y: bottom / sy },
      ],
    };
  }

  if (mode === 'triangle') {
    const midX = (left + right) * 0.5;
    return {
      type: 'polygon',
      closed: true,
      points: [
        { x: midX / sx, y: top / sy },
        { x: right / sx, y: bottom / sy },
        { x: left / sx, y: bottom / sy },
      ],
    };
  }

  // ellipse
  const cx = (left + right) * 0.5;
  const cy = (top + bottom) * 0.5;
  const rx = Math.max(3, (right - left) * 0.5);
  const ry = Math.max(3, (bottom - top) * 0.5);
  return {
    type: 'ellipse',
    cx: cx / sx,
    cy: cy / sy,
    rx: rx / sx,
    ry: ry / sy,
    isCircle: lockPerfect || Math.abs(rx - ry) <= 3,
  };
}


