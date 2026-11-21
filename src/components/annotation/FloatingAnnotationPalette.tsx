import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  Circle,
  Copy,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Minus,
  MousePointer2,
  MoveUpRight,
  PenTool,
  Plus,
  Redo2,
  Settings,
  SlidersHorizontal,
  Spline,
  Square,
  Trash2,
  Triangle,
  Undo2,
  Wand2,
} from 'lucide-react';
import {
  useAnnotationActions,
  useAnnotationDockState,
  useAnnotationToolState,
} from './AnnotationContext';
import { flattenShapeToFreehandPoints, type RenderTransform } from './strokeEngine';
import {
  APPLE_HIGHLIGHTER_COLORS,
  APPLE_LASER_COLORS,
  APPLE_PENCIL_COLORS,
  APPLE_PEN_COLORS,
  APPLE_TAPE_COLORS,
  SIZE_DIAL_MAX,
  SIZE_DIAL_MIN,
  SIZE_DIAL_STEP,
  applyMagneticSnap,
  clampSizeLevel,
  laserSizeLevelToPx,
  pxToLaserSizeLevel,
  pxToSizeLevel,
  sizeLevelToPx,
  snapSizeLevel,
  type AnnotationTool,
  type ColorSlotIndex,
  type ColorSwatch,
  type ColorableAnnotationTool,
  type PenLineStyle,
  type QuickShapeMode,
  type SizableAnnotationTool,
  type SizeSlotIndex,
  type TapePattern,
} from './types';
import { toArabicDigits } from '../../utils/mushafData';

function buildFountainPreviewSvgPath(nibAngleDeg: number, sizePx: number): string {
  const rad = (nibAngleDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const vx = -uy;
  const vy = ux;
  const a = Math.max(1.8, Math.min(6.2, sizePx * 0.48));
  const b = Math.max(0.75, Math.min(1.8, a * 0.23));

  const sampleCubic = (
    p0: [number, number],
    c1: [number, number],
    c2: [number, number],
    p1: [number, number],
    steps: number,
    skipFirst: boolean
  ): [number, number][] => {
    const pts: [number, number][] = [];
    for (let i = skipFirst ? 1 : 0; i <= steps; i++) {
      const t = i / steps;
      const inv = 1 - t;
      pts.push([
        inv * inv * inv * p0[0] + 3 * inv * inv * t * c1[0] + 3 * inv * t * t * c2[0] + t * t * t * p1[0],
        inv * inv * inv * p0[1] + 3 * inv * inv * t * c1[1] + 3 * inv * t * t * c2[1] + t * t * t * p1[1],
      ]);
    }
    return pts;
  };

  const pts = [
    ...sampleCubic([16, 22], [44, 10], [72, 29], [104, 16], 18, false),
    ...sampleCubic([104, 16], [128, 7], [148, 24], [166, 12], 14, true),
  ];

  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[i > 0 ? i - 1 : 0];
    const next = pts[i < pts.length - 1 ? i + 1 : pts.length - 1];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const nu = nx * ux + ny * uy;
    const nv = nx * vx + ny * vy;
    const denom = Math.hypot(a * nu, b * nv) || 1;
    const ex = ((a * a * nu) * ux + (b * b * nv) * vx) / denom;
    const ey = ((a * a * nu) * uy + (b * b * nv) * vy) / denom;
    left.push([pts[i][0] + ex, pts[i][1] + ey]);
    right.push([pts[i][0] - ex, pts[i][1] - ey]);
  }

  let d = `M ${left[0][0].toFixed(1)} ${left[0][1].toFixed(1)}`;
  for (let i = 1; i < left.length; i++) {
    d += ` L ${left[i][0].toFixed(1)} ${left[i][1].toFixed(1)}`;
  }
  for (let i = right.length - 1; i >= 0; i--) {
    d += ` L ${right[i][0].toFixed(1)} ${right[i][1].toFixed(1)}`;
  }
  return `${d} Z`;
}

/**
 * Realistic Apple PencilKit-grade static studio illustrations (viewBox 46x54).
 * Uses pure multi-stop cylindrical gradients and crisp specular highlights —
 * wrapped in React.memo with zero SVG filters or motion transitions for zero lag.
 */
const ApplePenNibSvg = React.memo<{ color: string; sizeLevel: number }>(({ color, sizeLevel }) => {
  const gaugeRadius = Math.max(1.7, Math.min(3.6, 1.7 + ((sizeLevel - 5) / 95) * 1.9));

  return (
    <svg className="apple-nib-svg" viewBox="0 0 46 80" fill="none" aria-hidden="true">
      {/* Precision color-matched ink nib with fine edge sheen */}
      <path
        d="M23 3.2C23.52 3.2 24.02 3.6 24.28 4.26L26.55 10.6C24.3 11.24 21.7 11.24 19.45 10.6L21.72 4.26C21.98 3.6 22.48 3.2 23 3.2Z"
        fill={color}
      />
      <path
        d="M22.35 4.75L20.95 9.85C21.45 10.0 21.9 10.05 22.3 10.05L22.9 4.8Z"
        fill="rgba(255, 255, 255, 0.42)"
      />
      {/* Sculpted matte-porcelain conical nose */}
      <path
        d="M19.45 10.6C21.7 11.24 24.3 11.24 26.55 10.6L31.4 21.8H14.6L19.45 10.6Z"
        fill="url(#pkStudioPenCone)"
        stroke="rgba(15, 23, 42, 0.14)"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      {/* Curved specular rib on cone */}
      <path d="M20.3 11.4L16.5 21.2H18.4L21.4 11.5Z" fill="rgba(255, 255, 255, 0.72)" />
      {/* Brushed satin-aluminum collar */}
      <path
        d="M14.45 21.8H31.55L31.9 24.6H14.1L14.45 21.8Z"
        fill="url(#pkStudioPenFerrule)"
        stroke="rgba(15, 23, 42, 0.12)"
        strokeWidth="0.65"
      />
      {/* Sculpted matte-ceramic barrel deeply rooted into dock rim */}
      <path
        d="M14.1 24.6H31.9V80H14.1V24.6Z"
        fill="url(#pkStudioPenBarrel)"
        stroke="rgba(15, 23, 42, 0.12)"
        strokeWidth="0.7"
      />
      {/* Cylindrical live-color ink band + wrap highlight */}
      <rect x="14.1" y="27.2" width="17.8" height="5.2" fill={color} opacity="0.94" />
      <rect x="14.1" y="27.2" width="17.8" height="5.2" fill="url(#pkStudioCylWrap)" />
      <rect x="14.2" y="33.9" width="17.6" height="1.15" rx="0.55" fill={color} opacity="0.35" />
      {/* Recessed live-size indicator jewel */}
      <circle cx="23" cy="41.4" r={gaugeRadius} fill={color} opacity="0.88" />
      <circle cx={22.4} cy={40.8} r={Math.max(0.65, gaugeRadius * 0.34)} fill="rgba(255,255,255,0.55)" />
      {/* Silky studio cylinder specular strip */}
      <rect x="16.8" y="25.4" width="2.4" height="53.6" rx="1.2" fill="rgba(255, 255, 255, 0.42)" />
      <defs>
        <linearGradient id="pkStudioPenCone" x1="14.6" y1="16" x2="31.4" y2="16" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D7E0EB" />
          <stop offset="0.28" stopColor="#FFFFFF" />
          <stop offset="0.65" stopColor="#F4F7FA" />
          <stop offset="0.9" stopColor="#C7D3E0" />
          <stop offset="1" stopColor="#DCE4EE" />
        </linearGradient>
        <linearGradient id="pkStudioPenFerrule" x1="14.1" y1="23.2" x2="31.9" y2="23.2" gradientUnits="userSpaceOnUse">
          <stop stopColor="#BAC6D2" />
          <stop offset="0.3" stopColor="#F8FAFC" />
          <stop offset="0.66" stopColor="#DCE3EC" />
          <stop offset="1" stopColor="#9EADB9" />
        </linearGradient>
        <linearGradient id="pkStudioPenBarrel" x1="14.1" y1="37" x2="31.9" y2="37" gradientUnits="userSpaceOnUse">
          <stop stopColor="#DCE4EE" />
          <stop offset="0.28" stopColor="#FFFFFF" />
          <stop offset="0.64" stopColor="#F8FAFC" />
          <stop offset="0.9" stopColor="#CED8E4" />
          <stop offset="1" stopColor="#E1E8F0" />
        </linearGradient>
        <linearGradient id="pkStudioCylWrap" x1="14.1" y1="29.8" x2="31.9" y2="29.8" gradientUnits="userSpaceOnUse">
          <stop stopColor="rgba(15, 23, 42, 0.18)" />
          <stop offset="0.28" stopColor="rgba(255, 255, 255, 0.34)" />
          <stop offset="0.62" stopColor="rgba(255, 255, 255, 0)" />
          <stop offset="0.9" stopColor="rgba(15, 23, 42, 0.2)" />
          <stop offset="1" stopColor="rgba(255, 255, 255, 0.1)" />
        </linearGradient>
      </defs>
    </svg>
  );
});

const AppleHighlighterNibSvg = React.memo<{ color: string; sizeLevel: number }>(
  ({ color, sizeLevel }) => {
    const ribbonHeight = Math.max(2.6, Math.min(6.4, 2.6 + ((sizeLevel - 5) / 95) * 3.8));
    const ribbonY = 36.8 - ribbonHeight / 2;

    return (
      <svg className="apple-nib-svg" viewBox="0 0 46 80" fill="none" aria-hidden="true">
        {/* Authentic beveled chisel felt tip */}
        <path
          d="M15.4 8.6L29.6 4.2C30.45 3.94 31.3 4.52 31.36 5.4L31.8 15.6H14.2L14.78 9.8C14.86 9.22 15.08 8.76 15.4 8.6Z"
          fill={color}
          opacity="0.94"
          stroke="rgba(15, 23, 42, 0.16)"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        {/* Crisp chisel bevel highlight */}
        <path d="M15.9 9.0L29.4 4.8L30.45 7.1L16.05 11.4Z" fill="rgba(255, 255, 255, 0.44)" />
        <rect x="14.3" y="14.5" width="17.4" height="1.1" fill="rgba(15, 23, 42, 0.12)" />
        {/* Sculpted ergonomic marker shoulder */}
        <path
          d="M13.2 15.6H32.8L35.2 22.8H10.8L13.2 15.6Z"
          fill="url(#pkStudioHlShoulder)"
          stroke="rgba(15, 23, 42, 0.12)"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        {/* Machined satin neck collar */}
        <rect
          x="10.7"
          y="21.9"
          width="24.6"
          height="2.1"
          rx="0.7"
          fill="url(#pkStudioHlRing)"
          stroke="rgba(15, 23, 42, 0.11)"
          strokeWidth="0.6"
        />
        {/* Broad matte-porcelain highlighter body deeply rooted into dock rim */}
        <path
          d="M10.8 24H35.2V80H10.8V24Z"
          fill="url(#pkStudioHlBarrel)"
          stroke="rgba(15, 23, 42, 0.12)"
          strokeWidth="0.7"
        />
        {/* Satin-translucent colored grip sleeve + studio cylinder gloss */}
        <path
          d="M10.8 29.4C10.8 28.18 11.78 27.2 13 27.2H33C34.22 27.2 35.2 28.18 35.2 29.4V80H10.8V29.4Z"
          fill={color}
          opacity="0.86"
        />
        <path
          d="M10.8 29.4C10.8 28.18 11.78 27.2 13 27.2H33C34.22 27.2 35.2 28.18 35.2 29.4V80H10.8V29.4Z"
          fill="url(#pkStudioHlSleeveGloss)"
        />
        {/* Clean live chisel-width indicator ribbon */}
        <path
          d={`M16.2 ${ribbonY + 1.1}L30.2 ${ribbonY - 0.8}L29.5 ${ribbonY + ribbonHeight - 0.8}L15.5 ${ribbonY + ribbonHeight + 1.1}Z`}
          fill="rgba(255, 255, 255, 0.86)"
        />
        {/* Porcelain vertical sheen */}
        <rect x="14.1" y="24.8" width="2.6" height="54.2" rx="1.3" fill="rgba(255, 255, 255, 0.34)" />
        <defs>
          <linearGradient id="pkStudioHlShoulder" x1="10.8" y1="19.2" x2="35.2" y2="19.2" gradientUnits="userSpaceOnUse">
            <stop stopColor="#D7E0EB" />
            <stop offset="0.3" stopColor="#FFFFFF" />
            <stop offset="0.66" stopColor="#F5F7FA" />
            <stop offset="0.9" stopColor="#C8D4E1" />
            <stop offset="1" stopColor="#DCE4EE" />
          </linearGradient>
          <linearGradient id="pkStudioHlRing" x1="10.7" y1="22.95" x2="35.3" y2="22.95" gradientUnits="userSpaceOnUse">
            <stop stopColor="#BAC6D2" />
            <stop offset="0.32" stopColor="#F8FAFC" />
            <stop offset="0.68" stopColor="#DCE3EC" />
            <stop offset="1" stopColor="#A0AEBC" />
          </linearGradient>
          <linearGradient id="pkStudioHlBarrel" x1="10.8" y1="37" x2="35.2" y2="37" gradientUnits="userSpaceOnUse">
            <stop stopColor="#DCE4EE" />
            <stop offset="0.28" stopColor="#FFFFFF" />
            <stop offset="0.64" stopColor="#F8FAFC" />
            <stop offset="0.9" stopColor="#CED8E4" />
            <stop offset="1" stopColor="#E1E8F0" />
          </linearGradient>
          <linearGradient id="pkStudioHlSleeveGloss" x1="10.8" y1="36.3" x2="35.2" y2="36.3" gradientUnits="userSpaceOnUse">
            <stop stopColor="rgba(15, 23, 42, 0.14)" />
            <stop offset="0.26" stopColor="rgba(255, 255, 255, 0.36)" />
            <stop offset="0.6" stopColor="rgba(255, 255, 255, 0)" />
            <stop offset="0.9" stopColor="rgba(15, 23, 42, 0.16)" />
            <stop offset="1" stopColor="rgba(255, 255, 255, 0.1)" />
          </linearGradient>
        </defs>
      </svg>
    );
  }
);

const AppleLaserStylusSvg = React.memo<{
  color: string;
  sizeLevel: number;
  isActive: boolean;
}>(({ color, sizeLevel, isActive }) => {
  const haloRadius = (isActive ? 7.6 : 5.6) + ((sizeLevel - 5) / 95) * 1.4;

  return (
    <svg className="apple-nib-svg" viewBox="0 0 46 80" fill="none" aria-hidden="true">
      {/* Pure-gradient optical aura around glass lens (no SVG blur filter) */}
      <circle
        cx="23"
        cy="8.2"
        r={haloRadius}
        fill="url(#pkStudioLaserHalo)"
        opacity={isActive ? 0.85 : 0.45}
      />
      <circle cx="23" cy="8.2" r={haloRadius * 0.56} fill={color} opacity={isActive ? 0.28 : 0.16} />
      {/* Precision glass optical emitter lens */}
      <circle cx="23" cy="8.2" r="3.45" fill={color} stroke="rgba(15, 23, 42, 0.22)" strokeWidth="0.6" />
      <circle cx="22.1" cy="7.3" r="1.15" fill="#FFFFFF" opacity="0.96" />
      {/* Chamfered brushed-titanium emitter crown */}
      <path
        d="M17.4 12.6H28.6L31.2 21.4H14.8L17.4 12.6Z"
        fill="url(#pkStudioLaserCrown)"
        stroke="rgba(15, 23, 42, 0.18)"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      <line x1="16.4" y1="16.9" x2="29.6" y2="16.9" stroke="rgba(15, 23, 42, 0.14)" strokeWidth="0.7" />
      {/* Anodized Space-Gray aluminum presenter barrel deeply rooted into dock rim */}
      <path
        d="M14.8 21.4H31.2V80H14.8V21.4Z"
        fill="url(#pkStudioLaserBody)"
        stroke="rgba(15, 23, 42, 0.24)"
        strokeWidth="0.7"
      />
      {/* Recessed color-matched optical accent ring */}
      <rect x="14.8" y="24.6" width="16.4" height="3" fill={color} opacity="0.94" />
      <rect x="14.8" y="24.6" width="16.4" height="3" fill="url(#pkStudioLaserRingSheen)" />
      {/* Flush machined pill presenter trigger */}
      <rect
        x="19.8"
        y="31.8"
        width="6.4"
        height="12.6"
        rx="3.2"
        fill="url(#pkStudioLaserBtn)"
        stroke="rgba(255, 255, 255, 0.22)"
        strokeWidth="0.75"
      />
      <circle cx="23" cy="36.2" r="1.35" fill={color} opacity={isActive ? 0.98 : 0.72} />
      {/* Anodized specular strip */}
      <rect x="17.2" y="22.4" width="2.1" height="56.6" rx="1.05" fill="rgba(255, 255, 255, 0.14)" />
      <defs>
        <radialGradient
          id="pkStudioLaserHalo"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(23 8.2) rotate(90) scale(8.8)"
        >
          <stop stopColor="#FFFFFF" stopOpacity="0.78" />
          <stop offset="0.38" stopColor={color} stopOpacity="0.42" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pkStudioLaserCrown" x1="14.8" y1="17" x2="31.2" y2="17" gradientUnits="userSpaceOnUse">
          <stop stopColor="#B5C1CE" />
          <stop offset="0.3" stopColor="#F8FAFC" />
          <stop offset="0.66" stopColor="#D6DEE8" />
          <stop offset="0.92" stopColor="#8E9DAD" />
          <stop offset="1" stopColor="#B0BCC9" />
        </linearGradient>
        <linearGradient id="pkStudioLaserBody" x1="14.8" y1="35.7" x2="31.2" y2="35.7" gradientUnits="userSpaceOnUse">
          <stop stopColor="#334155" />
          <stop offset="0.28" stopColor="#64748B" />
          <stop offset="0.58" stopColor="#475569" />
          <stop offset="0.88" stopColor="#1E293B" />
          <stop offset="1" stopColor="#3B485A" />
        </linearGradient>
        <linearGradient id="pkStudioLaserRingSheen" x1="14.8" y1="26.1" x2="31.2" y2="26.1" gradientUnits="userSpaceOnUse">
          <stop stopColor="rgba(0,0,0,0.2)" />
          <stop offset="0.3" stopColor="rgba(255,255,255,0.36)" />
          <stop offset="0.9" stopColor="rgba(0,0,0,0.22)" />
          <stop offset="1" stopColor="rgba(255,255,255,0.1)" />
        </linearGradient>
        <linearGradient id="pkStudioLaserBtn" x1="19.8" y1="38.1" x2="26.2" y2="38.1" gradientUnits="userSpaceOnUse">
          <stop stopColor="#475569" />
          <stop offset="0.38" stopColor="#64748B" />
          <stop offset="1" stopColor="#334155" />
        </linearGradient>
      </defs>
    </svg>
  );
});

const AppleEraserNibSvg = React.memo<{ sizeLevel: number; highlighterOnly?: boolean }>(
  ({ sizeLevel, highlighterOnly = false }) => {
    const gaugeWidth = Math.max(5.6, Math.min(12.8, 5.6 + ((sizeLevel - 5) / 95) * 7.2));
    const gaugeColor = highlighterOnly ? '#F59E0B' : '#E11D48';

    return (
      <svg className="apple-nib-svg" viewBox="0 0 46 80" fill="none" aria-hidden="true">
        {/* Iconic rounded architectural rubber eraser head */}
        <path
          d="M13.6 10C13.6 6.7 16.2 4.5 19.5 4.5H26.5C29.8 4.5 32.4 6.7 32.4 10V21.8H13.6V10Z"
          fill="url(#pkStudioEraserRubber)"
          stroke={highlighterOnly ? 'rgba(217, 119, 6, 0.34)' : 'rgba(190, 24, 93, 0.2)'}
          strokeWidth="0.7"
        />
        {/* Top crown satin highlight */}
        <path
          d="M15.4 8.3C16.05 6.6 17.5 5.65 19.5 5.65H26.5C28.1 5.65 29.4 6.2 30.15 7.4C28.05 7.95 25.55 8.3 23 8.3C20.2 8.3 17.6 8.6 15.4 8.3Z"
          fill="rgba(255, 255, 255, 0.58)"
        />
        <rect x="15.8" y="8.9" width="2.3" height="11.4" rx="1.15" fill="rgba(255, 255, 255, 0.4)" />
        {/* Brushed satin-aluminum ferrule band */}
        <rect
          x="12.5"
          y="21.4"
          width="21"
          height="6.1"
          rx="1.4"
          fill="url(#pkStudioEraserFerrule)"
          stroke="rgba(15, 23, 42, 0.13)"
          strokeWidth="0.7"
        />
        <line x1="13.2" y1="23.5" x2="32.8" y2="23.5" stroke="rgba(15, 23, 42, 0.12)" strokeWidth="0.65" />
        <line x1="13.2" y1="25.5" x2="32.8" y2="25.5" stroke="rgba(15, 23, 42, 0.1)" strokeWidth="0.65" />
        {/* Matte-porcelain architectural sleeve deeply rooted into dock rim */}
        <path
          d="M12.6 27.5H33.4V80H12.6V27.5Z"
          fill="url(#pkStudioEraserSleeve)"
          stroke="rgba(15, 23, 42, 0.12)"
          strokeWidth="0.7"
        />
        {/* Live-size gauge pill (rose normally, amber in highlighter-only mode) */}
        <rect
          x={23 - gaugeWidth / 2}
          y="36.8"
          width={gaugeWidth}
          height="3.2"
          rx="1.6"
          fill={gaugeColor}
          opacity={highlighterOnly ? 0.88 : 0.74}
        />
        <rect x="15.6" y="28.6" width="2.5" height="50.4" rx="1.25" fill="rgba(255, 255, 255, 0.38)" />
      <defs>
        <linearGradient id="pkStudioEraserRubber" x1="13.6" y1="13.2" x2="32.4" y2="13.2" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F2B8CE" />
          <stop offset="0.3" stopColor="#FFF7FA" />
          <stop offset="0.66" stopColor="#FCDCE8" />
          <stop offset="0.9" stopColor="#E397B4" />
          <stop offset="1" stopColor="#EEB4CA" />
        </linearGradient>
        <linearGradient id="pkStudioEraserFerrule" x1="12.5" y1="24.45" x2="33.5" y2="24.45" gradientUnits="userSpaceOnUse">
          <stop stopColor="#BAC6D2" />
          <stop offset="0.32" stopColor="#F8FAFC" />
          <stop offset="0.68" stopColor="#DCE3EC" />
          <stop offset="1" stopColor="#9EADB9" />
        </linearGradient>
        <linearGradient id="pkStudioEraserSleeve" x1="12.6" y1="38.75" x2="33.4" y2="38.75" gradientUnits="userSpaceOnUse">
          <stop stopColor="#DCE4EE" />
          <stop offset="0.28" stopColor="#FFFFFF" />
          <stop offset="0.64" stopColor="#F8FAFC" />
          <stop offset="0.9" stopColor="#CED8E4" />
          <stop offset="1" stopColor="#E1E8F0" />
        </linearGradient>
      </defs>
    </svg>
  );
});

const AppleFountainNibSvg = React.memo<{ color: string; sizeLevel: number }>(
  ({ color, sizeLevel }) => {
    const bandH = Math.max(2.2, Math.min(5.2, 2.2 + ((sizeLevel - 5) / 95) * 3));

    return (
      <svg className="apple-nib-svg" viewBox="0 0 46 80" fill="none" aria-hidden="true">
        {/* Classic split calligraphy fountain nib in warm champagne gold */}
        <path
          d="M23 3.2L29.6 15.2L27.4 22.4H18.6L16.4 15.2L23 3.2Z"
          fill="url(#pkStudioFountainNib)"
          stroke="rgba(120, 82, 24, 0.34)"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        {/* Ink slit & breather heart/dot */}
        <line x1="23" y1="3.8" x2="23" y2="14.2" stroke="rgba(15, 23, 42, 0.55)" strokeWidth="0.75" />
        <circle cx="23" cy="14.8" r="1.35" fill={color} />
        <path d="M21.4 6.8L18.4 14.8L20.1 15.1L22.3 7.2Z" fill="rgba(255, 255, 255, 0.58)" />
        {/* Grip section collar */}
        <path
          d="M15.8 22.4H30.2L31.6 25.8H14.4L15.8 22.4Z"
          fill="url(#pkStudioFountainCollar)"
          stroke="rgba(15, 23, 42, 0.14)"
          strokeWidth="0.65"
        />
        {/* Deep satin lacquer fountain pen barrel */}
        <path
          d="M14.2 25.8H31.8V80H14.2V25.8Z"
          fill="url(#pkStudioFountainBarrel)"
          stroke="rgba(15, 23, 42, 0.14)"
          strokeWidth="0.7"
        />
        {/* Live ink collar */}
        <rect x="14.2" y="28.4" width="17.6" height={bandH + 2.4} fill={color} opacity="0.92" />
        <rect x="14.2" y="28.4" width="17.6" height={bandH + 2.4} fill="url(#pkStudioFountainWrap)" />
        {/* Brushed gold trim ring */}
        <rect x="14.2" y="38.2" width="17.6" height="1.8" fill="url(#pkStudioFountainNib)" />
        <rect x="16.9" y="26.6" width="2.2" height="52.4" rx="1.1" fill="rgba(255, 255, 255, 0.34)" />
        <defs>
          <linearGradient id="pkStudioFountainNib" x1="16.4" y1="13" x2="29.6" y2="13" gradientUnits="userSpaceOnUse">
            <stop stopColor="#C8A054" />
            <stop offset="0.32" stopColor="#FBF0D1" />
            <stop offset="0.68" stopColor="#DFBC74" />
            <stop offset="1" stopColor="#9C752D" />
          </linearGradient>
          <linearGradient id="pkStudioFountainCollar" x1="14.4" y1="24.1" x2="31.6" y2="24.1" gradientUnits="userSpaceOnUse">
            <stop stopColor="#B8C4D0" />
            <stop offset="0.32" stopColor="#FFFFFF" />
            <stop offset="0.7" stopColor="#D6DFE9" />
            <stop offset="1" stopColor="#94A3B8" />
          </linearGradient>
          <linearGradient id="pkStudioFountainBarrel" x1="14.2" y1="40" x2="31.8" y2="40" gradientUnits="userSpaceOnUse">
            <stop stopColor="#D5DEE9" />
            <stop offset="0.28" stopColor="#FFFFFF" />
            <stop offset="0.66" stopColor="#F1F5F9" />
            <stop offset="0.92" stopColor="#C2CEDC" />
            <stop offset="1" stopColor="#DCE4EE" />
          </linearGradient>
          <linearGradient id="pkStudioFountainWrap" x1="14.2" y1="31" x2="31.8" y2="31" gradientUnits="userSpaceOnUse">
            <stop stopColor="rgba(15, 23, 42, 0.18)" />
            <stop offset="0.3" stopColor="rgba(255, 255, 255, 0.32)" />
            <stop offset="0.9" stopColor="rgba(15, 23, 42, 0.2)" />
          </linearGradient>
        </defs>
      </svg>
    );
  }
);

const ApplePencilNibSvg = React.memo<{ color: string; sizeLevel: number }>(({ color, sizeLevel }) => {
  const leadH = Math.max(2, Math.min(4.6, 2 + ((sizeLevel - 5) / 95) * 2.6));

  return (
    <svg className="apple-nib-svg" viewBox="0 0 46 80" fill="none" aria-hidden="true">
      {/* Tapered graphite core tip */}
      <path
        d="M23 3.4L26.2 10.6C24.2 11.2 21.8 11.2 19.8 10.6L23 3.4Z"
        fill={color}
      />
      <path d="M22.4 4.8L20.9 9.8L22.1 10.1L22.9 5.0Z" fill="rgba(255, 255, 255, 0.32)" />
      {/* Warm carved natural cedar wood cone */}
      <path
        d="M19.8 10.6C21.8 11.2 24.2 11.2 26.2 10.6L31.4 23.2H14.6L19.8 10.6Z"
        fill="url(#pkStudioPencilWood)"
        stroke="rgba(120, 74, 38, 0.24)"
        strokeWidth="0.65"
        strokeLinejoin="round"
      />
      {/* Cedar grain highlight */}
      <path d="M20.4 11.3L16.5 22.6H18.4L21.5 11.4Z" fill="rgba(255, 255, 255, 0.45)" />
      {/* Faceted Apple-Pencil matte barrel with subtle color jacket */}
      <path
        d="M14.6 23.2L18.5 21.8L23 23.2L27.5 21.8L31.4 23.2V80H14.6V23.2Z"
        fill="url(#pkStudioPencilBody)"
        stroke="rgba(15, 23, 42, 0.13)"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      {/* Facet ridge lines */}
      <line x1="18.6" y1="22.1" x2="18.6" y2="80" stroke="rgba(15, 23, 42, 0.08)" strokeWidth="0.6" />
      <line x1="27.4" y1="22.1" x2="27.4" y2="80" stroke="rgba(15, 23, 42, 0.08)" strokeWidth="0.6" />
      {/* Graphite color sleeve + thickness pill */}
      <rect x="14.6" y="27.5" width="16.8" height="4.4" fill={color} opacity="0.88" />
      <rect x="14.6" y="27.5" width="16.8" height="4.4" fill="url(#pkStudioPencilSheen)" />
      <rect x="19" y="36.4" width="8" height={leadH} rx={leadH / 2} fill={color} opacity="0.82" />
      <rect x="16.2" y="24" width="2" height="55" rx="1" fill="rgba(255, 255, 255, 0.35)" />
      <defs>
        <linearGradient id="pkStudioPencilWood" x1="14.6" y1="16.8" x2="31.4" y2="16.8" gradientUnits="userSpaceOnUse">
          <stop stopColor="#CFA57E" />
          <stop offset="0.34" stopColor="#F5DEC4" />
          <stop offset="0.72" stopColor="#DFBA95" />
          <stop offset="1" stopColor="#B8895E" />
        </linearGradient>
        <linearGradient id="pkStudioPencilBody" x1="14.6" y1="40" x2="31.4" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#DCE3EC" />
          <stop offset="0.3" stopColor="#FFFFFF" />
          <stop offset="0.65" stopColor="#F4F6FA" />
          <stop offset="0.92" stopColor="#C9D3DF" />
          <stop offset="1" stopColor="#DEE5EE" />
        </linearGradient>
        <linearGradient id="pkStudioPencilSheen" x1="14.6" y1="29.7" x2="31.4" y2="29.7" gradientUnits="userSpaceOnUse">
          <stop stopColor="rgba(15, 23, 42, 0.14)" />
          <stop offset="0.3" stopColor="rgba(255, 255, 255, 0.34)" />
          <stop offset="0.9" stopColor="rgba(15, 23, 42, 0.18)" />
        </linearGradient>
      </defs>
    </svg>
  );
});

const AppleTapeStylusSvg = React.memo<{ color: string; sizeLevel: number }>(
  ({ color, sizeLevel }) => {
    const stripH = Math.max(3, Math.min(6.4, 3 + ((sizeLevel - 5) / 95) * 3.4));

    return (
      <svg className="apple-nib-svg" viewBox="0 0 46 80" fill="none" aria-hidden="true">
        {/* Flat masking-tape applicator head */}
        <path
          d="M15.2 6.8C15.2 5.4 16.3 4.4 17.6 4.4H28.4C29.7 4.4 30.8 5.4 30.8 6.8L31.8 17.4H14.2L15.2 6.8Z"
          fill={color}
          stroke="rgba(15, 23, 42, 0.16)"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        {/* Crisp tape edge highlight & subtle diagonal hatch motif */}
        <rect x="16.4" y="6.2" width="13.2" height="2.4" rx="1" fill="rgba(255, 255, 255, 0.56)" />
        <line x1="17.5" y1="15.5" x2="21.5" y2="10.2" stroke="rgba(255, 255, 255, 0.52)" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="22.5" y1="15.5" x2="26.5" y2="10.2" stroke="rgba(255, 255, 255, 0.52)" strokeWidth="1.2" strokeLinecap="round" />
        {/* Satin shoulder & roller bridge */}
        <path
          d="M13 17.4H33L34.6 24.4H11.4L13 17.4Z"
          fill="url(#pkStudioTapeShoulder)"
          stroke="rgba(15, 23, 42, 0.12)"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        {/* Broad frosted-porcelain study tape dispenser body */}
        <path
          d="M11.4 24.4H34.6V80H11.4V24.4Z"
          fill="url(#pkStudioTapeBody)"
          stroke="rgba(15, 23, 42, 0.12)"
          strokeWidth="0.7"
        />
        {/* Pastel tape spool window & live width ribbon */}
        <rect
          x="13.6"
          y="28.6"
          width="18.8"
          height="16.4"
          rx="4.2"
          fill={color}
          opacity="0.78"
          stroke="rgba(15, 23, 42, 0.1)"
          strokeWidth="0.65"
        />
        <rect
          x="16"
          y={36.8 - stripH / 2}
          width="14"
          height={stripH}
          rx="1.6"
          fill="rgba(255, 255, 255, 0.85)"
        />
        <rect x="14.3" y="25.4" width="2.4" height="53.6" rx="1.2" fill="rgba(255, 255, 255, 0.4)" />
        <defs>
          <linearGradient id="pkStudioTapeShoulder" x1="11.4" y1="20.9" x2="34.6" y2="20.9" gradientUnits="userSpaceOnUse">
            <stop stopColor="#D7E0EB" />
            <stop offset="0.3" stopColor="#FFFFFF" />
            <stop offset="0.66" stopColor="#F5F7FA" />
            <stop offset="1" stopColor="#D0DAE6" />
          </linearGradient>
          <linearGradient id="pkStudioTapeBody" x1="11.4" y1="40" x2="34.6" y2="40" gradientUnits="userSpaceOnUse">
            <stop stopColor="#DCE4EE" />
            <stop offset="0.28" stopColor="#FFFFFF" />
            <stop offset="0.64" stopColor="#F8FAFC" />
            <stop offset="0.92" stopColor="#CED8E4" />
            <stop offset="1" stopColor="#E1E8F0" />
          </linearGradient>
        </defs>
      </svg>
    );
  }
);

const AppleLassoStylusSvg = React.memo<{ isActive: boolean }>(({ isActive }) => {
  return (
    <svg className="apple-nib-svg" viewBox="0 0 46 80" fill="none" aria-hidden="true">
      {/* Fine dashed selection loop above tip */}
      <ellipse
        cx="23"
        cy="10.2"
        rx="7.6"
        ry="5.2"
        stroke={isActive ? '#007AFF' : '#475569'}
        strokeWidth="1.5"
        strokeDasharray="3.2 2.2"
        fill={isActive ? 'rgba(0, 122, 255, 0.08)' : 'rgba(15, 23, 42, 0.03)'}
      />
      {/* Selection stylus nib cone */}
      <path
        d="M21 15.2H25L30.8 24H15.2L21 15.2Z"
        fill="url(#pkStudioLassoCone)"
        stroke="rgba(15, 23, 42, 0.14)"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      {/* Porcelain + slate barrel */}
      <path
        d="M14.6 24H31.4V80H14.6V24Z"
        fill="url(#pkStudioLassoBarrel)"
        stroke="rgba(15, 23, 42, 0.13)"
        strokeWidth="0.7"
      />
      {/* Diagonal candy-stripe dashed marquee collar (classic GoodNotes/Apple Lasso signature) */}
      <rect x="14.6" y="27.2" width="16.8" height="5.2" fill="#E2E8F0" />
      <path d="M15.4 32.4L18.8 27.2H21.2L17.8 32.4H15.4Z" fill="#007AFF" opacity="0.82" />
      <path d="M21.8 32.4L25.2 27.2H27.6L24.2 32.4H21.8Z" fill="#007AFF" opacity="0.82" />
      <path d="M28.2 32.4L31.4 27.5V31.2L30.6 32.4H28.2Z" fill="#007AFF" opacity="0.82" />
      {/* Grip band */}
      <rect x="17" y="37" width="12" height="2" rx="1" fill="rgba(15, 23, 42, 0.14)" />
      <rect x="17" y="24.8" width="2.2" height="54.2" rx="1.1" fill="rgba(255, 255, 255, 0.44)" />
      <defs>
        <linearGradient id="pkStudioLassoCone" x1="15.2" y1="19.6" x2="30.8" y2="19.6" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D3DCE6" />
          <stop offset="0.32" stopColor="#FFFFFF" />
          <stop offset="0.7" stopColor="#EFF4F8" />
          <stop offset="1" stopColor="#C1CDDA" />
        </linearGradient>
        <linearGradient id="pkStudioLassoBarrel" x1="14.6" y1="40" x2="31.4" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#DCE4EE" />
          <stop offset="0.28" stopColor="#FFFFFF" />
          <stop offset="0.65" stopColor="#F8FAFC" />
          <stop offset="0.92" stopColor="#CED8E4" />
          <stop offset="1" stopColor="#E2E8F0" />
        </linearGradient>
      </defs>
    </svg>
  );
});

/**
 * Single Unified External Dock Thickness Roller (5%..100% in 20 crisp 5% magnetic detents).
 */
const DOCK_ROLLER_INSET_PX = 8;

const TOOL_SHORT_NAMES: Record<SizableAnnotationTool, string> = {
  pen: 'القلم',
  fountain: 'الخطّاط',
  pencil: 'الرصاص',
  highlighter: 'التظليل',
  shapes: 'الأشكال',
  tape: 'التحفيظ',
  eraser: 'الممحاة',
};

const TOOL_SIZE_TITLES: Record<SizableAnnotationTool, string> = {
  pen: 'سُمك القلم',
  fountain: 'سُمك الخطّاط',
  pencil: 'سُمك الرصاص',
  highlighter: 'عرض التظليل',
  shapes: 'سُمك الأشكال',
  tape: 'عرض الشريط',
  eraser: 'حجم الممحاة',
};

const SLOT_INDICES: readonly SizeSlotIndex[] = [0, 1, 2];

function renderSlotPreviewStage(
  tool: SizableAnnotationTool,
  color: string,
  realPx: number
): React.ReactNode {
  if (tool === 'pen' || tool === 'fountain' || tool === 'pencil' || tool === 'shapes') {
    const dotPx = Math.max(2, Math.min(22, Math.round(realPx)));
    return (
      <span
        className="apple-size-dot"
        style={{
          width: `${dotPx}px`,
          height: `${dotPx}px`,
          backgroundColor: color,
          opacity: tool === 'pencil' ? 0.84 : 1,
        }}
      />
    );
  }
  if (tool === 'highlighter') {
    return (
      <span className="apple-callout-hl-stage">
        <span className="apple-callout-hl-lines" />
        <span
          className="apple-callout-hl-bar"
          style={{
            height: `${Math.max(6, Math.min(26, Math.round(realPx * 0.48)))}px`,
            backgroundColor: color,
          }}
        />
      </span>
    );
  }
  if (tool === 'tape') {
    return (
      <span className="apple-callout-hl-stage">
        <span className="apple-callout-hl-lines" />
        <span
          className="apple-callout-tape-bar"
          style={{
            height: `${Math.max(6, Math.min(24, Math.round(realPx * 0.45)))}px`,
            backgroundColor: color,
          }}
        />
      </span>
    );
  }
  return (
    <span
      className="apple-eraser-preview"
      style={{
        width: `${Math.max(9, Math.min(28, Math.round(realPx * 0.44)))}px`,
        height: `${Math.max(9, Math.min(28, Math.round(realPx * 0.44)))}px`,
      }}
    />
  );
}

interface CalmMagneticSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  magnetStep?: number;
  ariaLabel: string;
  ariaValueText?: string;
  onActivate?: () => void;
  onChange: (nextVal: number) => void;
}

/**
 * Unified calm RTL slider with smooth 1% drag
 * and magnetic 5-degree detents (5, 10, 15, 20...).
 * Used consistently across thickness, pen opacity, and highlighter transparency controls.
 */
const CalmMagneticSlider: React.FC<CalmMagneticSliderProps> = ({
  value,
  min,
  max,
  step = SIZE_DIAL_STEP,
  magnetStep = 5,
  ariaLabel,
  ariaValueText,
  onActivate,
  onChange,
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const trackRef = useRef<HTMLDivElement>(null);
  const trackRectRef = useRef<DOMRect | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const pendingValueRef = useRef<number | null>(null);
  const dragRatioRef = useRef<number | null>(null);
  const lockedAnchorRef = useRef<number | null>(null);
  const dragSpeedRef = useRef<number>(0.25);
  const lastSampleRef = useRef<{ x: number; t: number } | null>(null);
  const wheelAccumRef = useRef(0);

  const valueRef = useRef(value);
  valueRef.current = value;

  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    return () => {
      if (dragRafRef.current !== null) {
        window.cancelAnimationFrame(dragRafRef.current);
      }
    };
  }, []);

  const pulseHapticDetent = useCallback(() => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(4);
      }
    } catch {
      // Ignore vibration permission/support restrictions
    }
  }, []);

  const commitValue = useCallback(
    (nextVal: number) => {
      onActivateRef.current?.();
      const clamped = Math.max(min, Math.min(max, Math.round(nextVal)));
      if (clamped !== valueRef.current) {
        valueRef.current = clamped;
        onChangeRef.current(clamped);
      }
    },
    [min, max]
  );

  const stepToAnchor = useCallback(
    (dir: number) => {
      const cur = valueRef.current;
      const next =
        dir > 0
          ? Math.min(max, (Math.floor(cur / magnetStep) + 1) * magnetStep)
          : Math.max(min, (Math.ceil(cur / magnetStep) - 1) * magnetStep);
      commitValue(next);
    },
    [min, max, magnetStep, commitValue]
  );

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const primaryDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? -e.deltaX : -e.deltaY;
      if (primaryDelta === 0) return;

      if (Math.abs(primaryDelta) >= 34) {
        wheelAccumRef.current = 0;
        stepToAnchor(primaryDelta > 0 ? 1 : -1);
        return;
      }

      wheelAccumRef.current += primaryDelta;
      const threshold = 18;
      if (Math.abs(wheelAccumRef.current) >= threshold) {
        const dir = wheelAccumRef.current > 0 ? 1 : -1;
        wheelAccumRef.current = 0;
        stepToAnchor(dir);
      }
    };

    el.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleNativeWheel);
  }, [stepToAnchor]);

  const updateFromClientX = useCallback(
    (clientX: number, immediateCommit: boolean) => {
      const trackEl = trackRef.current;
      if (!trackEl) return;
      const rect = trackRectRef.current ?? trackEl.getBoundingClientRect();
      const usable = Math.max(1, rect.width - DOCK_ROLLER_INSET_PX * 2);
      const progress = Math.max(
        0,
        Math.min(1, (rect.right - DOCK_ROLLER_INSET_PX - clientX) / usable)
      );
      const rawVal = min + progress * (max - min);
      const prevLockedAnchor = lockedAnchorRef.current;
      const { value: snappedVal, visualValue, lockedAnchor } = applyMagneticSnap(rawVal, min, max, {
        magnetStep,
        lockedAnchor: prevLockedAnchor,
        dragSpeedPxPerMs: dragSpeedRef.current,
      });
      lockedAnchorRef.current = lockedAnchor;

      if (lockedAnchor !== null && lockedAnchor !== prevLockedAnchor && snappedVal !== valueRef.current) {
        pulseHapticDetent();
      }

      const visualRatio = Math.max(0, Math.min(1, (visualValue - min) / Math.max(1, max - min)));

      dragRatioRef.current = visualRatio;
      trackEl.style.setProperty('--dial-ratio', visualRatio.toFixed(4));

      if (immediateCommit) {
        if (dragRafRef.current !== null) {
          window.cancelAnimationFrame(dragRafRef.current);
          dragRafRef.current = null;
        }
        pendingValueRef.current = null;
        commitValue(snappedVal);
        return;
      }

      pendingValueRef.current = snappedVal;
      if (dragRafRef.current === null) {
        dragRafRef.current = window.requestAnimationFrame(() => {
          dragRafRef.current = null;
          const nextNow = pendingValueRef.current;
          pendingValueRef.current = null;
          if (nextNow !== null) {
            commitValue(nextNow);
          }
        });
      }
    },
    [min, max, magnetStep, commitValue, pulseHapticDetent]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    trackRectRef.current = e.currentTarget.getBoundingClientRect();
    lockedAnchorRef.current = null;
    dragSpeedRef.current = 0.25;
    lastSampleRef.current = { x: e.clientX, t: performance.now() };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic capture errors
    }
    activePointerIdRef.current = e.pointerId;
    setIsDragging(true);
    updateFromClientX(e.clientX, true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    const now = performance.now();
    const prevSample = lastSampleRef.current;
    if (prevSample) {
      const dx = Math.abs(e.clientX - prevSample.x);
      const dt = Math.max(1, now - prevSample.t);
      if (dx >= 0.4) {
        const instantSpeed = dx / dt;
        dragSpeedRef.current = 0.35 * instantSpeed + 0.65 * dragSpeedRef.current;
        lastSampleRef.current = { x: e.clientX, t: now };
      }
    } else {
      lastSampleRef.current = { x: e.clientX, t: now };
    }
    updateFromClientX(e.clientX, false);
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    updateFromClientX(e.clientX, true);
    activePointerIdRef.current = null;
    trackRectRef.current = null;
    dragRatioRef.current = null;
    lockedAnchorRef.current = null;
    dragSpeedRef.current = 0.25;
    lastSampleRef.current = null;
    setIsDragging(false);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore capture release errors
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const arrowDelta = e.shiftKey ? 1 : step;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      commitValue(value + arrowDelta);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      commitValue(value - arrowDelta);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      commitValue(value + step * 3);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      commitValue(value - step * 3);
    } else if (e.key === 'Home') {
      e.preventDefault();
      commitValue(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      commitValue(max);
    }
  };

  const ratio = Math.max(0, Math.min(1, (value - min) / Math.max(1, max - min)));
  const activeRatio = isDragging && dragRatioRef.current !== null ? dragRatioRef.current : ratio;

  return (
    <div
      ref={trackRef}
      className={`apple-dock-roller-track ${isDragging ? 'is-dragging' : ''}`}
      style={{ '--dial-ratio': activeRatio.toFixed(4) } as React.CSSProperties}
      dir="rtl"
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={ariaValueText}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
    >
      <div className="apple-dock-roller-fill" aria-hidden="true" />
      <div className="apple-dock-roller-thumb" aria-hidden="true" />
    </div>
  );
};

interface DockThicknessSlotsProps {
  tool: SizableAnnotationTool;
  isStandby: boolean;
  isPulsing: boolean;
  suppressPreview: boolean;
  sizeSlots: [number, number, number];
  activeSlot: SizeSlotIndex;
  editingSlot: SizeSlotIndex | null;
  color: string;
  onActivateTool: () => void;
  onSelectSlot: (slot: SizeSlotIndex) => void;
  onEditingSlotChange: (slot: SizeSlotIndex | null) => void;
  onChangeSlotLevel: (slot: SizeSlotIndex, nextLevel: number) => void;
}

const DockThicknessSlots: React.FC<DockThicknessSlotsProps> = ({
  tool,
  isStandby,
  isPulsing,
  suppressPreview,
  sizeSlots,
  activeSlot,
  editingSlot,
  color,
  onActivateTool,
  onSelectSlot,
  onEditingSlotChange,
  onChangeSlotLevel,
}) => {
  const [transientSlot, setTransientSlot] = useState<SizeSlotIndex | null>(null);

  const slotsTrayRef = useRef<HTMLDivElement>(null);
  const previewTimerRef = useRef<number | null>(null);
  const wheelAccumRef = useRef(0);
  const wheelSlotRef = useRef<SizeSlotIndex | null>(null);

  const slotLevels: [number, number, number] = [
    pxToSizeLevel(tool, sizeSlots[0]),
    pxToSizeLevel(tool, sizeSlots[1]),
    pxToSizeLevel(tool, sizeSlots[2]),
  ];

  const slotLevelsRef = useRef(slotLevels);
  slotLevelsRef.current = slotLevels;

  const isStandbyRef = useRef(isStandby);
  isStandbyRef.current = isStandby;

  const onActivateToolRef = useRef(onActivateTool);
  onActivateToolRef.current = onActivateTool;

  const onChangeSlotLevelRef = useRef(onChangeSlotLevel);
  onChangeSlotLevelRef.current = onChangeSlotLevel;

  const flashSlotCallout = useCallback((slot: SizeSlotIndex) => {
    setTransientSlot(slot);
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
    }
    previewTimerRef.current = window.setTimeout(() => {
      setTransientSlot(null);
      previewTimerRef.current = null;
    }, 760);
  }, []);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
      }
    };
  }, []);

  const commitSlotLevel = useCallback(
    (slot: SizeSlotIndex, nextRaw: number, showTransient = false, snapToStep = false) => {
      if (isStandbyRef.current) {
        onActivateToolRef.current();
      }
      const nextLevel = snapToStep ? snapSizeLevel(nextRaw) : clampSizeLevel(nextRaw);
      if (nextLevel !== slotLevelsRef.current[slot]) {
        onChangeSlotLevelRef.current(slot, nextLevel);
      }
      if (showTransient) {
        flashSlotCallout(slot);
      }
    },
    [flashSlotCallout]
  );

  // Native non-passive wheel listener over the 3 external dot buttons (steps +/-5%)
  useEffect(() => {
    const el = slotsTrayRef.current;
    if (!el) return;

    const handleNativeWheel = (e: WheelEvent) => {
      const slotBtnHit =
        e.target instanceof Element ? e.target.closest<HTMLElement>('[data-slot-index]') : null;
      if (!slotBtnHit) return;
      const idxAttr = slotBtnHit.dataset.slotIndex;
      if (idxAttr === undefined) return;
      const slotIdx = Number(idxAttr) as SizeSlotIndex;
      if (slotIdx !== 0 && slotIdx !== 1 && slotIdx !== 2) return;

      e.preventDefault();
      e.stopPropagation();

      const primaryDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? -e.deltaX : -e.deltaY;
      if (primaryDelta === 0) return;

      if (wheelSlotRef.current !== slotIdx) {
        wheelSlotRef.current = slotIdx;
        wheelAccumRef.current = 0;
      }

      if (Math.abs(primaryDelta) >= 36) {
        wheelAccumRef.current = 0;
        const dir = primaryDelta > 0 ? 1 : -1;
        commitSlotLevel(slotIdx, slotLevelsRef.current[slotIdx] + dir * SIZE_DIAL_STEP, true, true);
        return;
      }

      wheelAccumRef.current += primaryDelta;
      const threshold = 22;
      if (Math.abs(wheelAccumRef.current) >= threshold) {
        const steps = Math.trunc(wheelAccumRef.current / threshold);
        wheelAccumRef.current -= steps * threshold;
        commitSlotLevel(
          slotIdx,
          slotLevelsRef.current[slotIdx] + steps * SIZE_DIAL_STEP,
          true,
          true
        );
      }
    };

    el.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleNativeWheel);
  }, [commitSlotLevel]);

  const handleSlotClick = (idx: SizeSlotIndex) => {
    if (isStandby) {
      onSelectSlot(idx);
      onActivateTool();
      onEditingSlotChange(null);
      return;
    }
    if (activeSlot !== idx) {
      onSelectSlot(idx);
      if (editingSlot !== null) {
        onEditingSlotChange(idx);
      }
      return;
    }
    onEditingSlotChange(editingSlot === idx ? null : idx);
  };

  const handleSlotContextMenu = (e: React.MouseEvent, idx: SizeSlotIndex) => {
    e.preventDefault();
    if (isStandby) {
      onActivateTool();
    }
    onSelectSlot(idx);
    onEditingSlotChange(idx);
  };

  const accentColor = tool === 'eraser' ? '#EC4899' : color;
  const calloutSlot = editingSlot === null ? transientSlot : null;
  const showCallout = !suppressPreview && calloutSlot !== null;

  const editorLevel = editingSlot !== null ? slotLevels[editingSlot] : SIZE_DIAL_MIN;
  const editorRealPx = editingSlot !== null ? sizeLevelToPx(tool, editorLevel) : 4;

  return (
    <div
      ref={slotsTrayRef}
      className={`apple-thickness-slots ${isStandby ? 'is-standby' : ''} ${
        isPulsing ? 'is-pulsing' : ''
      }`}
      style={{ '--dial-accent': accentColor } as React.CSSProperties}
      role="group"
      aria-label={`نقاط سُمك ${TOOL_SHORT_NAMES[tool]} الثلاثة`}
    >
      {/* Transient wheel preview callout when scrolling directly over a dot */}
      <div className="apple-dock-roller-callout-anchor" aria-hidden="true">
        <AnimatePresence>
          {showCallout && calloutSlot !== null && (
            <motion.div
              className="apple-dock-roller-callout"
              initial={{ opacity: 0, y: 6, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.96 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="apple-roller-callout-stage">
                {renderSlotPreviewStage(tool, color, sizeLevelToPx(tool, slotLevels[calloutSlot]))}
              </div>
              <span className="apple-roller-callout-pct">
                {toArabicDigits(slotLevels[calloutSlot])}٪
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Individual Slot Thickness Editor Popover */}
      <div className="apple-slot-editor-anchor">
        <AnimatePresence>
          {editingSlot !== null && (
            <motion.div
              className="apple-slot-editor-popover"
              role="dialog"
              aria-label={`ضبط سُمك ${toArabicDigits(editingSlot + 1)} لأداة ${TOOL_SHORT_NAMES[tool]}`}
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.96 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="apple-slot-editor-head">
                <div className="apple-roller-callout-stage">
                  {renderSlotPreviewStage(tool, color, editorRealPx)}
                </div>
                <span className="apple-roller-callout-pct">{toArabicDigits(editorLevel)}٪</span>
              </div>

              <CalmMagneticSlider
                value={editorLevel}
                min={SIZE_DIAL_MIN}
                max={SIZE_DIAL_MAX}
                step={SIZE_DIAL_STEP}
                magnetStep={5}
                ariaLabel={`${TOOL_SIZE_TITLES[tool]} ${toArabicDigits(editingSlot + 1)} من ٥٪ إلى ١٠٠٪`}
                ariaValueText={`${TOOL_SIZE_TITLES[tool]} ${toArabicDigits(editorLevel)} بالمئة`}
                onActivate={() => {
                  if (isStandbyRef.current) {
                    onActivateToolRef.current();
                  }
                }}
                onChange={(nextLvl) => commitSlotLevel(editingSlot, nextLvl, false, false)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 3 Pure Clean Proportional Dot Buttons (uniform circle shape across tools, no numbers) */}
      <div className="apple-thickness-slots-group">
        {SLOT_INDICES.map((idx) => {
          const level = slotLevels[idx];
          const ratio = (level - SIZE_DIAL_MIN) / (SIZE_DIAL_MAX - SIZE_DIAL_MIN);
          const dotSizePx = Math.round(5 + ratio * 12);
          const isSelected = !isStandby && activeSlot === idx;
          const isEditingThis = editingSlot === idx;
          const slotNumAr = toArabicDigits(idx + 1);
          const levelAr = toArabicDigits(level);
          return (
            <button
              key={idx}
              type="button"
              data-slot-index={idx}
              className={`apple-thickness-slot-btn ${isSelected ? 'is-active' : ''} ${
                isEditingThis ? 'is-editing' : ''
              }`}
              aria-pressed={isSelected}
              aria-expanded={isEditingThis}
              onClick={() => handleSlotClick(idx)}
              onContextMenu={(e) => handleSlotContextMenu(e, idx)}
              title={
                isSelected
                  ? `${TOOL_SIZE_TITLES[tool]} ${slotNumAr} (${levelAr}٪) · اضغط مجدداً لضبط هذا المقاس أو اسحب بالعجلة`
                  : `${TOOL_SIZE_TITLES[tool]} ${slotNumAr} (${levelAr}٪) · اختصار (${idx + 1}) · كليك يمين للتعديل`
              }
              aria-label={`${TOOL_SIZE_TITLES[tool]} ${slotNumAr}: ${levelAr} بالمئة`}
            >
              <span
                className="apple-thickness-slot-dot"
                style={{ width: `${dotSizePx}px`, height: `${dotSizePx}px` }}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

const COLOR_TOOL_TITLES: Record<ColorableAnnotationTool, string> = {
  pen: 'لون القلم',
  fountain: 'لون الخطّاط',
  pencil: 'لون الرصاص',
  highlighter: 'لون التظليل',
  shapes: 'لون الأشكال',
  tape: 'لون الشريط',
  laser: 'لون الليزر',
};

const COLOR_SLOT_INDICES: readonly ColorSlotIndex[] = [0, 1, 2];

interface DockColorSlotsProps {
  tool: ColorableAnnotationTool;
  isStandby: boolean;
  isHidden?: boolean;
  colorSlots: [string, string, string];
  activeSlot: ColorSlotIndex;
  editingSlot: ColorSlotIndex | null;
  palette: readonly ColorSwatch[];
  onActivateTool: () => void;
  onSelectSlot: (slot: ColorSlotIndex) => void;
  onEditingSlotChange: (slot: ColorSlotIndex | null) => void;
  onChangeSlotColor: (slot: ColorSlotIndex, hex: string) => void;
}

const DockColorSlots: React.FC<DockColorSlotsProps> = ({
  tool,
  isStandby,
  isHidden = false,
  colorSlots,
  activeSlot,
  editingSlot,
  palette,
  onActivateTool,
  onSelectSlot,
  onEditingSlotChange,
  onChangeSlotColor,
}) => {
  const handleSlotClick = (idx: ColorSlotIndex) => {
    if (isHidden) return;
    if (isStandby) {
      onSelectSlot(idx);
      onActivateTool();
      onEditingSlotChange(null);
      return;
    }
    if (activeSlot !== idx) {
      onSelectSlot(idx);
      if (editingSlot !== null) {
        onEditingSlotChange(idx);
      }
      return;
    }
    onEditingSlotChange(editingSlot === idx ? null : idx);
  };

  const handleSlotContextMenu = (e: React.MouseEvent, idx: ColorSlotIndex) => {
    e.preventDefault();
    if (isHidden) return;
    if (isStandby) {
      onActivateTool();
    }
    onSelectSlot(idx);
    onEditingSlotChange(idx);
  };

  const resolveColorName = (hex: string) =>
    palette.find((s) => s.hex.toLowerCase() === hex.toLowerCase())?.label ?? hex;

  return (
    <div
      className={`apple-color-slots ${isStandby ? 'is-standby' : ''} ${
        isHidden ? 'is-hidden' : ''
      }`}
      role="group"
      aria-label={`ألوان ${COLOR_TOOL_TITLES[tool]} الثلاثة`}
      aria-hidden={isHidden}
    >
      <div className="apple-color-editor-anchor">
        <AnimatePresence>
          {!isHidden && editingSlot !== null && (
            <motion.div
              className="apple-color-editor-popover"
              role="dialog"
              aria-label={`تغيير ${COLOR_TOOL_TITLES[tool]} (${toArabicDigits(editingSlot + 1)})`}
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.96 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="apple-swatch-row" role="group" aria-label="اختيار لون الخانة">
                {palette.map((swatch) => {
                  const isCurrent =
                    colorSlots[editingSlot].toLowerCase() === swatch.hex.toLowerCase();
                  return (
                    <button
                      key={swatch.id}
                      type="button"
                      className={`apple-swatch-btn ${isCurrent ? 'is-selected' : ''}`}
                      style={{ '--swatch-hex': swatch.hex } as React.CSSProperties}
                      onClick={() => {
                        onChangeSlotColor(editingSlot, swatch.hex);
                        onEditingSlotChange(null);
                      }}
                      title={swatch.label}
                      aria-label={swatch.label}
                      aria-pressed={isCurrent}
                    />
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="apple-color-slots-group">
        {COLOR_SLOT_INDICES.map((idx) => {
          const hex = colorSlots[idx];
          const isSelected = !isStandby && !isHidden && activeSlot === idx;
          const isEditingThis = editingSlot === idx;
          const slotNumAr = toArabicDigits(idx + 1);
          const colorLabel = resolveColorName(hex);
          return (
            <button
              key={idx}
              type="button"
              disabled={isHidden}
              tabIndex={isHidden ? -1 : 0}
              className={`apple-color-slot-btn ${isSelected ? 'is-active' : ''} ${
                isEditingThis ? 'is-editing' : ''
              }`}
              style={{ '--slot-color': hex } as React.CSSProperties}
              aria-pressed={isSelected}
              aria-expanded={!isHidden && isEditingThis}
              onClick={() => handleSlotClick(idx)}
              onContextMenu={(e) => handleSlotContextMenu(e, idx)}
              title={
                isSelected
                  ? `${colorLabel} · اضغط مجدداً لتبديل اللون`
                  : `${colorLabel} · كليك يمين لتخصيص الخانة ${slotNumAr}`
              }
              aria-label={`${COLOR_TOOL_TITLES[tool]} ${slotNumAr}: ${colorLabel}`}
            >
              <span className="apple-color-slot-dot" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
};

const TOOL_LABELS: Record<AnnotationTool, string> = {
  cursor: 'تصفح',
  lasso: 'تحديد حر',
  pen: 'قلم حبر',
  fountain: 'قلم خطّاط',
  pencil: 'قلم رصاص',
  highlighter: 'تظليل أبل',
  shapes: 'أشكال سريعة',
  tape: 'شريط التحفيظ',
  laser: 'ليزر ضوئي',
  eraser: 'ممحاة',
};

const QUICK_SHAPE_OPTIONS: ReadonlyArray<{
  mode: QuickShapeMode;
  label: string;
}> = [
  { mode: 'auto', label: 'تلقائي' },
  { mode: 'line', label: 'خط' },
  { mode: 'arrow', label: 'سهم' },
  { mode: 'rect', label: 'مستطيل' },
  { mode: 'ellipse', label: 'دائرة' },
  { mode: 'triangle', label: 'مثلث' },
];

export const FloatingAnnotationPalette: React.FC = () => {
  const {
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
    selectedStrokeObjects,
    selectedStrokeAnchor,
    shortcutFeedback,
  } = useAnnotationToolState();
  const { canUndo, canRedo, hasActiveStrokes, isExportingPdf } = useAnnotationDockState();
  const {
    setActiveTool,
    setPaletteOpen,
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
    updateStrokesBatch,
    toggleTapeRevealed,
    removeStrokes,
    duplicateStrokes,
    reorderStrokes,
    exportActiveSurfacePdf,
    undo,
    redo,
    clearSurface,
  } = useAnnotationActions();

  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isDockSettingsOpen, setIsDockSettingsOpen] = useState(false);
  const [isSelectedPropsOpen, setIsSelectedPropsOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<SizeSlotIndex | null>(null);
  const [editingColorSlot, setEditingColorSlot] = useState<ColorSlotIndex | null>(null);
  const [lastSizableTool, setLastSizableTool] = useState<SizableAnnotationTool>('pen');
  const [lastColorableTool, setLastColorableTool] = useState<ColorableAnnotationTool>('pen');
  const [isRollerPulsing, setIsRollerPulsing] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dockRootRef = useRef<HTMLDivElement>(null);
  const selectedBarRef = useRef<HTMLDivElement>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const dragStartRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const hasInspectorOptions = activeTool !== 'cursor';

  const triggerRollerPulse = useCallback(() => {
    setIsRollerPulsing(true);
    if (pulseTimerRef.current !== null) {
      window.clearTimeout(pulseTimerRef.current);
    }
    pulseTimerRef.current = window.setTimeout(() => {
      setIsRollerPulsing(false);
      pulseTimerRef.current = null;
    }, 360);
  }, []);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current !== null) {
        window.clearTimeout(pulseTimerRef.current);
      }
    };
  }, []);

  // Remember the most recently active sizable & colorable tools so the 3 external slots adapt cleanly
  // and wake that tool automatically if clicked from Browse mode.
  useEffect(() => {
    if (activeTool !== 'cursor' && activeTool !== 'lasso' && activeTool !== 'laser') {
      setLastSizableTool(activeTool);
    }
    if (activeTool !== 'cursor' && activeTool !== 'lasso' && activeTool !== 'eraser') {
      setLastColorableTool(activeTool);
    }
    setEditingSlot(null);
    setEditingColorSlot(null);
  }, [activeTool]);

  // Close popovers when switching to cursor/eraser or collapsing dock
  useEffect(() => {
    if (!hasInspectorOptions || !isPaletteOpen) {
      setIsInspectorOpen(false);
    }
    if (!isPaletteOpen) {
      setIsDockSettingsOpen(false);
      setEditingSlot(null);
      setEditingColorSlot(null);
    }
  }, [hasInspectorOptions, isPaletteOpen]);

  // Close properties popover whenever selection disappears or changes
  useEffect(() => {
    if (!selectedStrokeAnchor) {
      setIsSelectedPropsOpen(false);
    }
  }, [selectedStrokeAnchor]);

  // Close popovers on outside pointerdown (capture phase so drawing surfaces calling stopPropagation still dismiss it) or Escape key
  useEffect(() => {
    if (
      !isInspectorOpen &&
      !isDockSettingsOpen &&
      !isSelectedPropsOpen &&
      editingSlot === null &&
      editingColorSlot === null
    ) {
      return;
    }
    const onOutside = (e: PointerEvent) => {
      const dockEl = dockRootRef.current;
      const barEl = selectedBarRef.current;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const inNode = (el: HTMLElement | null) =>
        Boolean(
          el &&
            (path.length > 0
              ? path.includes(el)
              : e.target instanceof Node && el.contains(e.target))
        );
      if (!inNode(dockEl)) {
        setIsInspectorOpen(false);
        setIsDockSettingsOpen(false);
        setEditingSlot(null);
        setEditingColorSlot(null);
      }
      if (!inNode(barEl)) {
        setIsSelectedPropsOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.key === 'Escape') {
        setIsInspectorOpen(false);
        setIsDockSettingsOpen(false);
        setIsSelectedPropsOpen(false);
        setEditingSlot(null);
        setEditingColorSlot(null);
      }
    };
    window.addEventListener('pointerdown', onOutside, { capture: true });
    window.addEventListener('keydown', onEsc, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onOutside, { capture: true });
      window.removeEventListener('keydown', onEsc, { capture: true });
    };
  }, [isInspectorOpen, isDockSettingsOpen, isSelectedPropsOpen, editingSlot, editingColorSlot]);

  const clampDragOffset = useCallback((rawX: number, rawY: number) => {
    const dockW = dockRootRef.current?.offsetWidth ?? 560;
    const maxX = Math.max(0, (window.innerWidth - dockW) * 0.5 - 16);
    const maxUp = Math.max(0, window.innerHeight - 108);
    return {
      x: Math.max(-maxX, Math.min(maxX, rawX)),
      y: Math.max(-maxUp, Math.min(10, rawY)),
    };
  }, []);

  // Keep dragged palette safely inside viewport on window resize
  useEffect(() => {
    const clampOnResize = () => {
      setDragOffset((prev) => {
        if (prev.x === 0 && prev.y === 0) return prev;
        return clampDragOffset(prev.x, prev.y);
      });
    };
    window.addEventListener('resize', clampOnResize);
    return () => window.removeEventListener('resize', clampOnResize);
  }, [clampDragOffset]);

  const handleSelectTool = (tool: AnnotationTool) => {
    setIsDockSettingsOpen(false);
    setEditingSlot(null);
    setEditingColorSlot(null);
    if (tool === 'cursor') {
      setActiveTool(tool);
      setIsInspectorOpen(false);
      return;
    }
    if (activeTool === tool) {
      // Second tap on active Pen / Highlighter / Laser / Eraser toggles its options inspector
      setIsInspectorOpen((prev) => !prev);
      if (tool === 'eraser') {
        triggerRollerPulse();
      }
    } else {
      setActiveTool(tool);
      setIsInspectorOpen(false);
    }
  };

  const handleDragStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragStartRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
    };
  };

  const handleDragMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    setDragOffset(clampDragOffset(drag.originX + dx, drag.originY + dy));
  };

  const handleDragEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragStartRef.current = null;
    setIsDragging(false);
    // Gentle center & edge snap on release
    setDragOffset((prev) => {
      const clamped = clampDragOffset(prev.x, prev.y);
      return Math.abs(clamped.x) < 18 ? { ...clamped, x: 0 } : clamped;
    });
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }
  };

  const activeAccentColor =
    activeTool === 'pen'
      ? penSettings.color
      : activeTool === 'fountain'
      ? fountainSettings.color
      : activeTool === 'pencil'
      ? pencilSettings.color
      : activeTool === 'highlighter'
      ? highlighterSettings.color
      : activeTool === 'shapes'
      ? shapesSettings.color
      : activeTool === 'tape'
      ? tapeSettings.color
      : activeTool === 'laser'
      ? laserSettings.color
      : activeTool === 'eraser'
      ? eraserSettings.highlighterOnly
        ? '#F59E0B'
        : '#E11D48'
      : '#007AFF';

  const penSizeLevel = pxToSizeLevel('pen', penSettings.size);
  const fountainSizeLevel = pxToSizeLevel('fountain', fountainSettings.size);
  const pencilSizeLevel = pxToSizeLevel('pencil', pencilSettings.size);
  const highlighterSizeLevel = pxToSizeLevel('highlighter', highlighterSettings.size);
  const tapeSizeLevel = pxToSizeLevel('tape', tapeSettings.size);
  const eraserSizeLevel = pxToSizeLevel('eraser', eraserSettings.size);

  // External 3-slot thickness dots adapt to all sizable tools (or stay ready in standby on Browse / Lasso / Laser)
  const rollerTool: SizableAnnotationTool =
    activeTool === 'cursor' || activeTool === 'lasso' || activeTool === 'laser'
      ? lastSizableTool
      : activeTool;

  const currentSlots: [number, number, number] =
    rollerTool === 'pen'
      ? penSettings.sizeSlots
      : rollerTool === 'fountain'
      ? fountainSettings.sizeSlots
      : rollerTool === 'pencil'
      ? pencilSettings.sizeSlots
      : rollerTool === 'highlighter'
      ? highlighterSettings.sizeSlots
      : rollerTool === 'shapes'
      ? shapesSettings.sizeSlots
      : rollerTool === 'tape'
      ? tapeSettings.sizeSlots
      : eraserSettings.sizeSlots;

  const currentActiveSlot: SizeSlotIndex =
    rollerTool === 'pen'
      ? penSettings.activeSizeSlot
      : rollerTool === 'fountain'
      ? fountainSettings.activeSizeSlot
      : rollerTool === 'pencil'
      ? pencilSettings.activeSizeSlot
      : rollerTool === 'highlighter'
      ? highlighterSettings.activeSizeSlot
      : rollerTool === 'shapes'
      ? shapesSettings.activeSizeSlot
      : rollerTool === 'tape'
      ? tapeSettings.activeSizeSlot
      : eraserSettings.activeSizeSlot;

  const rollerColor =
    rollerTool === 'pen'
      ? penSettings.color
      : rollerTool === 'fountain'
      ? fountainSettings.color
      : rollerTool === 'pencil'
      ? pencilSettings.color
      : rollerTool === 'highlighter'
      ? highlighterSettings.color
      : rollerTool === 'shapes'
      ? shapesSettings.color
      : rollerTool === 'tape'
      ? tapeSettings.color
      : eraserSettings.highlighterOnly
      ? '#F59E0B'
      : '#EC4899';

  const handleSelectSizeSlot = useCallback(
    (slot: SizeSlotIndex) => {
      if (rollerTool === 'pen') {
        updatePenSettings({ activeSizeSlot: slot });
      } else if (rollerTool === 'fountain') {
        updateFountainSettings({ activeSizeSlot: slot });
      } else if (rollerTool === 'pencil') {
        updatePencilSettings({ activeSizeSlot: slot });
      } else if (rollerTool === 'highlighter') {
        updateHighlighterSettings({ activeSizeSlot: slot });
      } else if (rollerTool === 'shapes') {
        updateShapesSettings({ activeSizeSlot: slot });
      } else if (rollerTool === 'tape') {
        updateTapeSettings({ activeSizeSlot: slot });
      } else {
        updateEraserSettings({ activeSizeSlot: slot });
      }
    },
    [
      rollerTool,
      updatePenSettings,
      updateFountainSettings,
      updatePencilSettings,
      updateHighlighterSettings,
      updateShapesSettings,
      updateTapeSettings,
      updateEraserSettings,
    ]
  );

  const handleChangeSlotLevel = useCallback(
    (slot: SizeSlotIndex, lvl: number) => {
      const nextPx = sizeLevelToPx(rollerTool, lvl);
      const applyPatch = (slots: [number, number, number]): [number, number, number] => {
        const copy: [number, number, number] = [slots[0], slots[1], slots[2]];
        copy[slot] = nextPx;
        return copy;
      };
      if (rollerTool === 'pen') {
        updatePenSettings({ sizeSlots: applyPatch(penSettings.sizeSlots) });
      } else if (rollerTool === 'fountain') {
        updateFountainSettings({ sizeSlots: applyPatch(fountainSettings.sizeSlots) });
      } else if (rollerTool === 'pencil') {
        updatePencilSettings({ sizeSlots: applyPatch(pencilSettings.sizeSlots) });
      } else if (rollerTool === 'highlighter') {
        updateHighlighterSettings({ sizeSlots: applyPatch(highlighterSettings.sizeSlots) });
      } else if (rollerTool === 'shapes') {
        updateShapesSettings({ sizeSlots: applyPatch(shapesSettings.sizeSlots) });
      } else if (rollerTool === 'tape') {
        updateTapeSettings({ sizeSlots: applyPatch(tapeSettings.sizeSlots) });
      } else {
        updateEraserSettings({ sizeSlots: applyPatch(eraserSettings.sizeSlots) });
      }
    },
    [
      rollerTool,
      penSettings.sizeSlots,
      fountainSettings.sizeSlots,
      pencilSettings.sizeSlots,
      highlighterSettings.sizeSlots,
      shapesSettings.sizeSlots,
      tapeSettings.sizeSlots,
      eraserSettings.sizeSlots,
      updatePenSettings,
      updateFountainSettings,
      updatePencilSettings,
      updateHighlighterSettings,
      updateShapesSettings,
      updateTapeSettings,
      updateEraserSettings,
    ]
  );

  const colorTool: ColorableAnnotationTool =
    activeTool !== 'cursor' && activeTool !== 'lasso' && activeTool !== 'eraser'
      ? activeTool
      : lastColorableTool;

  const currentColorSlots: [string, string, string] =
    colorTool === 'pen'
      ? penSettings.colorSlots
      : colorTool === 'fountain'
      ? fountainSettings.colorSlots
      : colorTool === 'pencil'
      ? pencilSettings.colorSlots
      : colorTool === 'highlighter'
      ? highlighterSettings.colorSlots
      : colorTool === 'shapes'
      ? shapesSettings.colorSlots
      : colorTool === 'tape'
      ? tapeSettings.colorSlots
      : laserSettings.colorSlots;

  const currentActiveColorSlot: ColorSlotIndex =
    colorTool === 'pen'
      ? penSettings.activeColorSlot
      : colorTool === 'fountain'
      ? fountainSettings.activeColorSlot
      : colorTool === 'pencil'
      ? pencilSettings.activeColorSlot
      : colorTool === 'highlighter'
      ? highlighterSettings.activeColorSlot
      : colorTool === 'shapes'
      ? shapesSettings.activeColorSlot
      : colorTool === 'tape'
      ? tapeSettings.activeColorSlot
      : laserSettings.activeColorSlot;

  const currentColorPalette: readonly ColorSwatch[] =
    colorTool === 'highlighter'
      ? APPLE_HIGHLIGHTER_COLORS
      : colorTool === 'pencil'
      ? APPLE_PENCIL_COLORS
      : colorTool === 'tape'
      ? APPLE_TAPE_COLORS
      : colorTool === 'laser'
      ? APPLE_LASER_COLORS
      : APPLE_PEN_COLORS;

  const handleSelectColorSlot = useCallback(
    (slot: ColorSlotIndex) => {
      if (colorTool === 'pen') {
        updatePenSettings({ activeColorSlot: slot });
      } else if (colorTool === 'fountain') {
        updateFountainSettings({ activeColorSlot: slot });
      } else if (colorTool === 'pencil') {
        updatePencilSettings({ activeColorSlot: slot });
      } else if (colorTool === 'highlighter') {
        updateHighlighterSettings({ activeColorSlot: slot });
      } else if (colorTool === 'shapes') {
        updateShapesSettings({ activeColorSlot: slot });
      } else if (colorTool === 'tape') {
        updateTapeSettings({ activeColorSlot: slot });
      } else {
        updateLaserSettings({ activeColorSlot: slot });
      }
    },
    [
      colorTool,
      updatePenSettings,
      updateFountainSettings,
      updatePencilSettings,
      updateHighlighterSettings,
      updateShapesSettings,
      updateTapeSettings,
      updateLaserSettings,
    ]
  );

  const handleChangeSlotColor = useCallback(
    (slot: ColorSlotIndex, hex: string) => {
      const applyPatch = (slots: [string, string, string]): [string, string, string] => {
        const copy: [string, string, string] = [slots[0], slots[1], slots[2]];
        copy[slot] = hex;
        return copy;
      };
      if (colorTool === 'pen') {
        updatePenSettings({ colorSlots: applyPatch(penSettings.colorSlots) });
      } else if (colorTool === 'fountain') {
        updateFountainSettings({ colorSlots: applyPatch(fountainSettings.colorSlots) });
      } else if (colorTool === 'pencil') {
        updatePencilSettings({ colorSlots: applyPatch(pencilSettings.colorSlots) });
      } else if (colorTool === 'highlighter') {
        updateHighlighterSettings({ colorSlots: applyPatch(highlighterSettings.colorSlots) });
      } else if (colorTool === 'shapes') {
        updateShapesSettings({ colorSlots: applyPatch(shapesSettings.colorSlots) });
      } else if (colorTool === 'tape') {
        updateTapeSettings({ colorSlots: applyPatch(tapeSettings.colorSlots) });
      } else {
        updateLaserSettings({ colorSlots: applyPatch(laserSettings.colorSlots) });
      }
    },
    [
      colorTool,
      penSettings.colorSlots,
      fountainSettings.colorSlots,
      pencilSettings.colorSlots,
      highlighterSettings.colorSlots,
      shapesSettings.colorSlots,
      tapeSettings.colorSlots,
      laserSettings.colorSlots,
      updatePenSettings,
      updateFountainSettings,
      updatePencilSettings,
      updateHighlighterSettings,
      updateShapesSettings,
      updateTapeSettings,
      updateLaserSettings,
    ]
  );

  const hasOpenPopover =
    isPaletteOpen &&
    (isInspectorOpen || editingSlot !== null || editingColorSlot !== null);

  const previewStrokeWidth = Math.max(1.5, Math.min(10.5, penSettings.size * 0.8));
  const previewDashArray =
    penSettings.lineStyle === 'dashed'
      ? `${(previewStrokeWidth * 2.5).toFixed(1)} ${(previewStrokeWidth * 1.9).toFixed(1)}`
      : penSettings.lineStyle === 'dotted'
      ? `0.1 ${(previewStrokeWidth * 2.15).toFixed(1)}`
      : undefined;

  const shapesPreviewStrokeWidth = Math.max(1.5, Math.min(9, shapesSettings.size * 0.72));
  const shapesPreviewDashArray =
    shapesSettings.lineStyle === 'dashed'
      ? `${(shapesPreviewStrokeWidth * 2.4).toFixed(1)} ${(shapesPreviewStrokeWidth * 1.8).toFixed(1)}`
      : shapesSettings.lineStyle === 'dotted'
      ? `0.1 ${(shapesPreviewStrokeWidth * 2.1).toFixed(1)}`
      : undefined;

  const selectedQuickColors =
    selectedStrokeAnchor?.kind === 'highlighter'
      ? highlighterSettings.colorSlots
      : selectedStrokeAnchor?.kind === 'fountain'
      ? fountainSettings.colorSlots
      : selectedStrokeAnchor?.kind === 'pencil'
      ? pencilSettings.colorSlots
      : selectedStrokeAnchor?.kind === 'tape'
      ? tapeSettings.colorSlots
      : penSettings.colorSlots;

  const selectedBarCoords = (() => {
    if (!selectedStrokeAnchor || typeof window === 'undefined') return null;
    const minLeft = 148;
    const maxLeft = Math.max(minLeft, window.innerWidth - 148);
    const left = Math.max(minLeft, Math.min(maxLeft, selectedStrokeAnchor.centerX));
    const placeBelow = selectedStrokeAnchor.topY < 86;
    const rawTop = placeBelow
      ? selectedStrokeAnchor.bottomY + 10
      : selectedStrokeAnchor.topY - 10;
    const top = Math.max(20, Math.min(window.innerHeight - 64, rawTop));
    return { left, top, placeBelow };
  })();

  const selectedTargetIds = selectedStrokeAnchor
    ? selectedStrokeAnchor.strokeIds && selectedStrokeAnchor.strokeIds.length > 0
      ? selectedStrokeAnchor.strokeIds
      : [selectedStrokeAnchor.strokeId]
    : [];
  const selectedCount = selectedStrokeAnchor?.count ?? selectedTargetIds.length;
  const primarySelStroke = selectedStrokeObjects[0] ?? null;
  const hasSelectedPen = selectedStrokeObjects.some((s) => s.kind === 'pen');
  const hasSelectedFountain = selectedStrokeObjects.some((s) => s.kind === 'fountain');
  const hasSelectedTape = selectedStrokeObjects.some((s) => s.kind === 'tape');
  const hasSelectedShape = selectedStrokeObjects.some((s) => Boolean(s.shape));
  const selectedSizeLevel = primarySelStroke
    ? pxToSizeLevel(primarySelStroke.kind, primarySelStroke.size)
    : 20;
  const selectedOpacityPct = primarySelStroke
    ? Math.max(20, Math.min(100, Math.round(primarySelStroke.opacity * 100)))
    : 100;

  const stepSelectedThickness = (deltaLevel: number) => {
    if (!selectedStrokeAnchor || selectedTargetIds.length === 0) return;
    updateStrokesBatch(
      selectedStrokeAnchor.surfaceId,
      selectedTargetIds,
      (st) => {
        const curLvl = pxToSizeLevel(st.kind, st.size);
        const nextLvl = clampSizeLevel(curLvl + deltaLevel);
        return { ...st, size: sizeLevelToPx(st.kind, nextLvl) };
      },
      true
    );
  };

  const flattenSelectedShapes = () => {
    if (!selectedStrokeAnchor || selectedTargetIds.length === 0) return;
    const surfEl = document.querySelector<HTMLElement>(
      `[data-surface-id="${selectedStrokeAnchor.surfaceId}"]`
    );
    const rect = surfEl?.getBoundingClientRect();
    const tf: RenderTransform =
      rect && rect.width > 0 && rect.height > 0
        ? {
            scaleX: rect.width / 1000,
            scaleY: rect.height / 1000,
            offsetX: 0,
            offsetY: 0,
            unitScale: ((rect.width / 1000 + rect.height / 1000) * 0.5) || 1,
          }
        : { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, unitScale: 1 };
    updateStrokesBatch(
      selectedStrokeAnchor.surfaceId,
      selectedTargetIds,
      (st) => {
        if (!st.shape) return st;
        return {
          ...st,
          shape: undefined,
          points: flattenShapeToFreehandPoints(st, tf),
        };
      },
      true
    );
    setIsSelectedPropsOpen(false);
  };

  return (
    <div className="apple-annotation-portal" data-annotation-ui="true" dir="rtl">
      {/* Floating Quick-Action Mini-Bar above/below any selected stroke, shape, or lasso group */}
      <AnimatePresence>
        {selectedStrokeAnchor && selectedBarCoords && (
          <motion.div
            key={selectedTargetIds.join(',')}
            ref={selectedBarRef}
            className={`apple-selected-stroke-bar ${selectedBarCoords.placeBelow ? 'is-below' : 'is-above'}`}
            style={{
              left: `${Math.round(selectedBarCoords.left)}px`,
              top: `${Math.round(selectedBarCoords.top)}px`,
            }}
            role="toolbar"
            aria-label="إجراءات العنصر المحدد"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
          >
            {selectedCount > 1 && (
              <>
                <span className="apple-selected-bar-count" title="عدد العناصر المحددة">
                  {toArabicDigits(selectedCount)}
                </span>
                <span className="apple-selected-bar-sep" aria-hidden="true" />
              </>
            )}

            <div className="apple-selected-bar-colors">
              {selectedQuickColors.map((hex, idx) => (
                <button
                  key={`${hex}-${idx}`}
                  type="button"
                  className="apple-selected-bar-dot"
                  style={{ '--dot-hex': hex } as React.CSSProperties}
                  aria-label="تغيير اللون"
                  title="تبديل لون العنصر المحدد"
                  onClick={() =>
                    updateStrokesBatch(
                      selectedStrokeAnchor.surfaceId,
                      selectedTargetIds,
                      (st) => ({ ...st, color: hex }),
                      true
                    )
                  }
                />
              ))}
            </div>

            <span className="apple-selected-bar-sep" aria-hidden="true" />

            <button
              type="button"
              className="apple-selected-bar-btn"
              title="تنحيف السُمك"
              aria-label="تنحيف السُمك"
              onClick={() => stepSelectedThickness(-10)}
            >
              <Minus className="w-3.5 h-3.5" strokeWidth={2.1} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="apple-selected-bar-btn"
              title="زيادة السُمك"
              aria-label="زيادة السُمك"
              onClick={() => stepSelectedThickness(10)}
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.1} aria-hidden="true" />
            </button>

            <button
              type="button"
              className={`apple-selected-bar-btn ${isSelectedPropsOpen ? 'is-active' : ''}`}
              title="خصائص إضافية (السُمك، الشفافية، الترتيب)"
              aria-label="خصائص العنصر المحدد"
              aria-expanded={isSelectedPropsOpen}
              onClick={() => setIsSelectedPropsOpen((prev) => !prev)}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" strokeWidth={1.95} aria-hidden="true" />
            </button>

            <span className="apple-selected-bar-sep" aria-hidden="true" />

            <button
              type="button"
              className="apple-selected-bar-btn"
              title="تكرار"
              aria-label="تكرار المحدد"
              onClick={() =>
                duplicateStrokes(selectedStrokeAnchor.surfaceId, selectedTargetIds)
              }
            >
              <Copy className="w-3.5 h-3.5" strokeWidth={1.9} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="apple-selected-bar-btn is-danger"
              title="حذف (Delete)"
              aria-label="حذف المحدد"
              onClick={() =>
                removeStrokes(selectedStrokeAnchor.surfaceId, selectedTargetIds)
              }
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={1.9} aria-hidden="true" />
            </button>

            <AnimatePresence>
              {isSelectedPropsOpen && primarySelStroke && (
                <motion.div
                  className={`apple-selected-props-popover ${
                    selectedBarCoords.placeBelow ? 'is-below' : 'is-above'
                  }`}
                  role="dialog"
                  aria-label="خصائص العناصر المحددة"
                  initial={{ opacity: 0, y: selectedBarCoords.placeBelow ? -6 : 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: selectedBarCoords.placeBelow ? -4 : 4, scale: 0.96 }}
                  transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="apple-inspector-section">
                    <div className="apple-slider-head">
                      <span>السُمك</span>
                      <span className="apple-slider-val">{toArabicDigits(selectedSizeLevel)}٪</span>
                    </div>
                    <CalmMagneticSlider
                      value={selectedSizeLevel}
                      min={SIZE_DIAL_MIN}
                      max={SIZE_DIAL_MAX}
                      step={SIZE_DIAL_STEP}
                      magnetStep={5}
                      ariaLabel="سُمك العناصر المحددة"
                      onChange={(nextLvl) =>
                        updateStrokesBatch(
                          selectedStrokeAnchor.surfaceId,
                          selectedTargetIds,
                          (st) => ({ ...st, size: sizeLevelToPx(st.kind, nextLvl) }),
                          true
                        )
                      }
                    />
                  </div>

                  <div className="apple-inspector-section">
                    <div className="apple-slider-head">
                      <span>الكثافة والشفافية</span>
                      <span className="apple-slider-val">{toArabicDigits(selectedOpacityPct)}٪</span>
                    </div>
                    <CalmMagneticSlider
                      value={selectedOpacityPct}
                      min={20}
                      max={100}
                      step={5}
                      magnetStep={5}
                      ariaLabel="شفافية العناصر المحددة"
                      onChange={(val) =>
                        updateStrokesBatch(
                          selectedStrokeAnchor.surfaceId,
                          selectedTargetIds,
                          (st) => ({ ...st, opacity: val / 100 }),
                          true
                        )
                      }
                    />
                  </div>

                  {hasSelectedPen && (
                    <div className="apple-inspector-section">
                      <div className="apple-segmented is-three" role="group" aria-label="نمط الخط">
                        {(['solid', 'dashed', 'dotted'] as PenLineStyle[]).map((styleKey) => (
                          <button
                            key={styleKey}
                            type="button"
                            className={`apple-seg-btn ${
                              (primarySelStroke.lineStyle ?? 'solid') === styleKey ? 'is-active' : ''
                            }`}
                            onClick={() =>
                              updateStrokesBatch(
                                selectedStrokeAnchor.surfaceId,
                                selectedTargetIds,
                                (st) => (st.kind === 'pen' ? { ...st, lineStyle: styleKey } : st),
                                true
                              )
                            }
                          >
                            {styleKey === 'solid' ? 'متصل' : styleKey === 'dashed' ? 'متقطع' : 'منقط'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {hasSelectedFountain && (
                    <div className="apple-inspector-section">
                      <div className="apple-slider-head">
                        <span>زاوية سن الخطّاط</span>
                        <span className="apple-slider-val" dir="ltr">
                          {toArabicDigits(Math.abs(Math.round(primarySelStroke.nibAngleDeg ?? -38)))}°
                        </span>
                      </div>
                      <CalmMagneticSlider
                        value={Math.round(primarySelStroke.nibAngleDeg ?? -38)}
                        min={-75}
                        max={-10}
                        step={5}
                        magnetStep={5}
                        ariaLabel="زاوية سن القلم الخطاط المحدد"
                        onChange={(deg) =>
                          updateStrokesBatch(
                            selectedStrokeAnchor.surfaceId,
                            selectedTargetIds,
                            (st) => (st.kind === 'fountain' ? { ...st, nibAngleDeg: deg } : st),
                            true
                          )
                        }
                      />
                    </div>
                  )}

                  {hasSelectedTape && (
                    <>
                      <div className="apple-inspector-section">
                        <div className="apple-segmented is-three" role="group" aria-label="نمط الشريط">
                          {(['striped', 'solid', 'dots'] as TapePattern[]).map((pat) => (
                            <button
                              key={pat}
                              type="button"
                              className={`apple-seg-btn ${
                                (primarySelStroke.tapePattern ?? 'striped') === pat ? 'is-active' : ''
                              }`}
                              onClick={() =>
                                updateStrokesBatch(
                                  selectedStrokeAnchor.surfaceId,
                                  selectedTargetIds,
                                  (st) => (st.kind === 'tape' ? { ...st, tapePattern: pat } : st),
                                  true
                                )
                              }
                            >
                              {pat === 'striped' ? 'مخطط' : pat === 'solid' ? 'مصمت' : 'منقط'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="apple-props-flatten-btn"
                        onClick={() => {
                          if (selectedTargetIds.length === 1) {
                            toggleTapeRevealed(selectedStrokeAnchor.surfaceId, primarySelStroke.id);
                          } else {
                            const nextRevealed = !Boolean(primarySelStroke.revealed);
                            updateStrokesBatch(
                              selectedStrokeAnchor.surfaceId,
                              selectedTargetIds,
                              (st) => (st.kind === 'tape' ? { ...st, revealed: nextRevealed } : st),
                              true
                            );
                          }
                        }}
                      >
                        {primarySelStroke.revealed ? (
                          <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>{primarySelStroke.revealed ? 'إعادة تغطية النص' : 'كشف النص للمراجعة'}</span>
                      </button>
                    </>
                  )}

                  <div className="apple-selected-props-row">
                    <button
                      type="button"
                      className="apple-props-action-btn"
                      onClick={() =>
                        reorderStrokes(selectedStrokeAnchor.surfaceId, selectedTargetIds, 'front')
                      }
                      title="تقديم للأمام فوق العناصر الأخرى"
                    >
                      <ArrowUpToLine className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>للأمام</span>
                    </button>
                    <button
                      type="button"
                      className="apple-props-action-btn"
                      onClick={() =>
                        reorderStrokes(selectedStrokeAnchor.surfaceId, selectedTargetIds, 'back')
                      }
                      title="إرسال للخلف تحت العناصر الأخرى"
                    >
                      <ArrowDownToLine className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>للخلف</span>
                    </button>
                  </div>

                  {hasSelectedShape && (
                    <button
                      type="button"
                      className="apple-props-flatten-btn"
                      onClick={flattenSelectedShapes}
                      title="تحويل الشكل الهندسي إلى مسار رسم حر"
                    >
                      <Spline className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>تحويل لرسم حر</span>
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Subtle transient HUD toast when a keyboard shortcut executes */}
      <AnimatePresence>
        {shortcutFeedback && (
          <motion.div
            key={shortcutFeedback.seq}
            className={`apple-shortcut-toast ${
              hasOpenPopover ? 'is-top' : isPaletteOpen ? 'is-above-dock' : 'is-bottom'
            }`}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 8, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="apple-shortcut-toast-label">{shortcutFeedback.label}</span>
            <kbd className="apple-shortcut-toast-key" dir="ltr">
              {shortcutFeedback.keycap}
            </kbd>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {!isPaletteOpen ? (
          <motion.button
            key="launcher"
            type="button"
            className={`apple-palette-launcher ${activeTool !== 'cursor' ? 'is-armed' : ''}`}
            onClick={() => setPaletteOpen(true)}
            title="فتح منظومة الأقلام والتظليل والليزر"
            aria-label="فتح منظومة الأقلام والتظليل والليزر"
            initial={{ opacity: 0, scale: 0.86, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.86, y: 12 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={
              activeTool !== 'cursor'
                ? ({ '--armed-color': activeAccentColor } as React.CSSProperties)
                : undefined
            }
          >
            <PenTool className="w-5 h-5" strokeWidth={2.1} aria-hidden="true" />
            <span className="apple-launcher-label">الأقلام</span>
          </motion.button>
        ) : (
          <div
            key="dock"
            ref={dockRootRef}
            className={`apple-palette-anchor ${isDragging ? 'is-dragging' : ''}`}
            style={{
              transform: `translate3d(calc(-50% + ${dragOffset.x}px), ${dragOffset.y}px, 0)`,
            }}
          >
            <motion.div
              className="apple-palette-motion-shell"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Contextual Apple PencilKit Inspector Popover */}
              <div className="apple-inspector-anchor">
                <AnimatePresence>
                  {isInspectorOpen && hasInspectorOptions && (
                    <motion.div
                      className="apple-inspector-popover"
                      role="dialog"
                      aria-label={`إعدادات ${TOOL_LABELS[activeTool]}`}
                      initial={{ opacity: 0, y: 10, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.96 }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    >
                  {/* Pen Preview + Opacity + Line Style + Smart Shapes + Scribble Erase */}
                  {activeTool === 'pen' && (
                    <>
                      <div className="apple-inspector-preview" aria-hidden="true">
                        <svg viewBox="0 0 180 34" className="apple-inspector-preview-svg" fill="none">
                          <path
                            d="M14 23 C 46 6, 74 30, 108 16 C 134 5, 152 22, 166 13"
                            stroke={penSettings.color}
                            strokeOpacity={penSettings.opacity}
                            strokeWidth={previewStrokeWidth}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeDasharray={previewDashArray}
                          />
                        </svg>
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-slider-head">
                          <span>الكثافة</span>
                          <span className="apple-slider-val">
                            {toArabicDigits(Math.round(penSettings.opacity * 100))}٪
                          </span>
                        </div>
                        <CalmMagneticSlider
                          value={Math.round(penSettings.opacity * 100)}
                          min={35}
                          max={100}
                          step={5}
                          magnetStep={5}
                          ariaLabel="كثافة حبر القلم"
                          ariaValueText={`${toArabicDigits(Math.round(penSettings.opacity * 100))} بالمئة`}
                          onChange={(val) => updatePenSettings({ opacity: val / 100 })}
                        />
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-slider-head">
                          <span>سلاسة الخط</span>
                          <span className="apple-slider-val">
                            {toArabicDigits(Math.round(penSettings.smoothing * 100))}٪
                          </span>
                        </div>
                        <CalmMagneticSlider
                          value={Math.round(penSettings.smoothing * 100)}
                          min={0}
                          max={100}
                          step={5}
                          magnetStep={10}
                          ariaLabel="سلاسة وتنعيم خط القلم"
                          ariaValueText={`${toArabicDigits(Math.round(penSettings.smoothing * 100))} بالمئة`}
                          onChange={(val) => updatePenSettings({ smoothing: val / 100 })}
                        />
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-segmented is-three" role="group" aria-label="نمط خط القلم">
                          <button
                            type="button"
                            className={`apple-seg-btn apple-line-style-btn ${
                              penSettings.lineStyle === 'solid' ? 'is-active' : ''
                            }`}
                            onClick={() => updatePenSettings({ lineStyle: 'solid' })}
                            title="خط متصل"
                          >
                            <svg width="24" height="6" viewBox="0 0 24 6" aria-hidden="true">
                              <line x1="2" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                            </svg>
                            <span>متصل</span>
                          </button>
                          <button
                            type="button"
                            className={`apple-seg-btn apple-line-style-btn ${
                              penSettings.lineStyle === 'dashed' ? 'is-active' : ''
                            }`}
                            onClick={() => updatePenSettings({ lineStyle: 'dashed' })}
                            title="خط متقطع"
                          >
                            <svg width="24" height="6" viewBox="0 0 24 6" aria-hidden="true">
                              <line x1="2" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="5 4" />
                            </svg>
                            <span>متقطع</span>
                          </button>
                          <button
                            type="button"
                            className={`apple-seg-btn apple-line-style-btn ${
                              penSettings.lineStyle === 'dotted' ? 'is-active' : ''
                            }`}
                            onClick={() => updatePenSettings({ lineStyle: 'dotted' })}
                            title="خط منقط"
                          >
                            <svg width="24" height="6" viewBox="0 0 24 6" aria-hidden="true">
                              <line x1="3" y1="3" x2="21" y2="3" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="0.1 5" />
                            </svg>
                            <span>منقط</span>
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Fountain Pen Preview + Opacity + Nib Angle + Smoothing + Smart Shapes + Scribble */}
                  {activeTool === 'fountain' && (
                    <>
                      <div className="apple-inspector-preview" aria-hidden="true">
                        <svg viewBox="0 0 180 34" className="apple-inspector-preview-svg" fill="none">
                          <path
                            d={buildFountainPreviewSvgPath(
                              fountainSettings.nibAngleDeg,
                              fountainSettings.size
                            )}
                            fill={fountainSettings.color}
                            fillOpacity={fountainSettings.opacity}
                          />
                        </svg>
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-slider-head">
                          <span>الكثافة</span>
                          <span className="apple-slider-val">
                            {toArabicDigits(Math.round(fountainSettings.opacity * 100))}٪
                          </span>
                        </div>
                        <CalmMagneticSlider
                          value={Math.round(fountainSettings.opacity * 100)}
                          min={35}
                          max={100}
                          step={5}
                          magnetStep={5}
                          ariaLabel="كثافة حبر قلم الخطاط"
                          onChange={(val) => updateFountainSettings({ opacity: val / 100 })}
                        />
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-slider-head">
                          <span>زاوية السن</span>
                          <span className="apple-slider-val" dir="ltr">
                            {toArabicDigits(Math.abs(fountainSettings.nibAngleDeg))}°
                          </span>
                        </div>
                        <CalmMagneticSlider
                          value={fountainSettings.nibAngleDeg}
                          min={-75}
                          max={-10}
                          step={5}
                          magnetStep={5}
                          ariaLabel="زاوية سن قلم الخطاط"
                          onChange={(deg) => updateFountainSettings({ nibAngleDeg: deg })}
                        />
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-slider-head">
                          <span>سلاسة الخط</span>
                          <span className="apple-slider-val">
                            {toArabicDigits(Math.round(fountainSettings.smoothing * 100))}٪
                          </span>
                        </div>
                        <CalmMagneticSlider
                          value={Math.round(fountainSettings.smoothing * 100)}
                          min={0}
                          max={100}
                          step={5}
                          magnetStep={10}
                          ariaLabel="سلاسة وتنعيم خط قلم الخطاط"
                          ariaValueText={`${toArabicDigits(Math.round(fountainSettings.smoothing * 100))} بالمئة`}
                          onChange={(val) => updateFountainSettings({ smoothing: val / 100 })}
                        />
                      </div>
                    </>
                  )}

                  {/* Graphite Pencil Preview + Density + Smoothing */}
                  {activeTool === 'pencil' && (
                    <>
                      <div className="apple-inspector-preview" aria-hidden="true">
                        <svg viewBox="0 0 180 34" className="apple-inspector-preview-svg" fill="none">
                          <path
                            d="M16 22 C 48 8, 78 28, 112 16 C 138 6, 152 22, 166 14"
                            stroke={pencilSettings.color}
                            strokeOpacity={pencilSettings.opacity * 0.34}
                            strokeWidth={Math.max(1.8, Math.min(10.5, pencilSettings.size * 0.78))}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeDasharray="1.4 1.8"
                          />
                          <path
                            d="M16 22 C 48 8, 78 28, 112 16 C 138 6, 152 22, 166 14"
                            stroke={pencilSettings.color}
                            strokeOpacity={pencilSettings.opacity * 0.72}
                            strokeWidth={Math.max(1.1, Math.min(6.4, pencilSettings.size * 0.46))}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-slider-head">
                          <span>ضغط الرصاص</span>
                          <span className="apple-slider-val">
                            {toArabicDigits(Math.round(pencilSettings.opacity * 100))}٪
                          </span>
                        </div>
                        <CalmMagneticSlider
                          value={Math.round(pencilSettings.opacity * 100)}
                          min={35}
                          max={95}
                          step={5}
                          magnetStep={5}
                          ariaLabel="ضغط وشفافية قلم الرصاص"
                          onChange={(val) => updatePencilSettings({ opacity: val / 100 })}
                        />
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-slider-head">
                          <span>سلاسة الخط</span>
                          <span className="apple-slider-val">
                            {toArabicDigits(Math.round(pencilSettings.smoothing * 100))}٪
                          </span>
                        </div>
                        <CalmMagneticSlider
                          value={Math.round(pencilSettings.smoothing * 100)}
                          min={0}
                          max={100}
                          step={5}
                          magnetStep={10}
                          ariaLabel="سلاسة وتنعيم خط قلم الرصاص"
                          ariaValueText={`${toArabicDigits(Math.round(pencilSettings.smoothing * 100))} بالمئة`}
                          onChange={(val) => updatePencilSettings({ smoothing: val / 100 })}
                        />
                      </div>
                    </>
                  )}

                  {/* Quick Shapes / Ruler Mode Grid + Line Style + Opacity */}
                  {activeTool === 'shapes' && (
                    <>
                      <div className="apple-inspector-preview" aria-hidden="true">
                        <svg viewBox="0 0 180 34" className="apple-inspector-preview-svg" fill="none">
                          <line
                            x1="22"
                            y1="17"
                            x2="152"
                            y2="17"
                            stroke={shapesSettings.color}
                            strokeOpacity={shapesSettings.opacity}
                            strokeWidth={shapesPreviewStrokeWidth}
                            strokeLinecap="round"
                            strokeDasharray={shapesPreviewDashArray}
                          />
                          {shapesSettings.shapeMode === 'arrow' && (
                            <path
                              d="M142 11 L154 17 L142 23"
                              stroke={shapesSettings.color}
                              strokeOpacity={shapesSettings.opacity}
                              strokeWidth={shapesPreviewStrokeWidth}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          )}
                        </svg>
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-slider-head">
                          <span>نوع الشكل</span>
                        </div>
                        <div className="apple-shape-mode-grid" role="group" aria-label="اختيار الشكل السريع">
                          {QUICK_SHAPE_OPTIONS.map(({ mode, label }) => (
                            <button
                              key={mode}
                              type="button"
                              className={`apple-shape-mode-btn ${
                                shapesSettings.shapeMode === mode ? 'is-active' : ''
                              }`}
                              onClick={() => updateShapesSettings({ shapeMode: mode })}
                              title={label}
                            >
                              {mode === 'auto' && <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />}
                              {mode === 'line' && <Minus className="w-3.5 h-3.5" aria-hidden="true" />}
                              {mode === 'arrow' && <MoveUpRight className="w-3.5 h-3.5" aria-hidden="true" />}
                              {mode === 'rect' && <Square className="w-3.5 h-3.5" aria-hidden="true" />}
                              {mode === 'ellipse' && <Circle className="w-3.5 h-3.5" aria-hidden="true" />}
                              {mode === 'triangle' && <Triangle className="w-3.5 h-3.5" aria-hidden="true" />}
                              <span>{label}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-slider-head">
                          <span>الكثافة</span>
                          <span className="apple-slider-val">
                            {toArabicDigits(Math.round(shapesSettings.opacity * 100))}٪
                          </span>
                        </div>
                        <CalmMagneticSlider
                          value={Math.round(shapesSettings.opacity * 100)}
                          min={35}
                          max={100}
                          step={5}
                          magnetStep={5}
                          ariaLabel="كثافة خط الأشكال"
                          onChange={(val) => updateShapesSettings({ opacity: val / 100 })}
                        />
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-segmented is-three" role="group" aria-label="نمط خط الأشكال">
                          {(['solid', 'dashed', 'dotted'] as PenLineStyle[]).map((styleKey) => (
                            <button
                              key={styleKey}
                              type="button"
                              className={`apple-seg-btn ${
                                shapesSettings.lineStyle === styleKey ? 'is-active' : ''
                              }`}
                              onClick={() => updateShapesSettings({ lineStyle: styleKey })}
                            >
                              {styleKey === 'solid' ? 'متصل' : styleKey === 'dashed' ? 'متقطع' : 'منقط'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Study / Memorization Tape Pattern + Opacity + Straight Assist */}
                  {activeTool === 'tape' && (
                    <>
                      <div className="apple-inspector-preview is-highlighter is-tape" aria-hidden="true">
                        <div className="apple-preview-text-lines" />
                        <div
                          className={`apple-tape-preview-bar is-${tapeSettings.pattern}`}
                          style={{
                            height: `${Math.max(10, Math.min(22, tapeSettings.size * 0.48))}px`,
                            backgroundColor: tapeSettings.color,
                            opacity: 1,
                          }}
                        />
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-slider-head">
                          <span>نقش الشريط</span>
                        </div>
                        <div className="apple-segmented is-three" role="group" aria-label="نقش شريط التحفيظ">
                          {(['striped', 'solid', 'dots'] as TapePattern[]).map((pat) => (
                            <button
                              key={pat}
                              type="button"
                              className={`apple-seg-btn ${tapeSettings.pattern === pat ? 'is-active' : ''}`}
                              onClick={() => updateTapeSettings({ pattern: pat })}
                            >
                              {pat === 'striped' ? 'مخطط' : pat === 'solid' ? 'مصمت' : 'منقط'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-slider-head">
                          <span>سلاسة الخط</span>
                          <span className="apple-slider-val">
                            {toArabicDigits(Math.round(tapeSettings.smoothing * 100))}٪
                          </span>
                        </div>
                        <CalmMagneticSlider
                          value={Math.round(tapeSettings.smoothing * 100)}
                          min={0}
                          max={100}
                          step={5}
                          magnetStep={10}
                          ariaLabel="سلاسة وتنعيم خط شريط التحفيظ"
                          ariaValueText={`${toArabicDigits(Math.round(tapeSettings.smoothing * 100))} بالمئة`}
                          onChange={(val) => updateTapeSettings({ smoothing: val / 100 })}
                        />
                      </div>

                      <div className="apple-inspector-toggle-row">
                        <span className="apple-toggle-title">استقامة الشريط تلقائياً</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={tapeSettings.straightAssist}
                          className={`apple-switch ${tapeSettings.straightAssist ? 'is-on' : ''}`}
                          onClick={() =>
                            updateTapeSettings({ straightAssist: !tapeSettings.straightAssist })
                          }
                        >
                          <span className="apple-switch-knob" />
                        </button>
                      </div>
                    </>
                  )}

                  {/* Highlighter Preview + Transparency + Smoothing + Straight Assist */}
                  {activeTool === 'highlighter' && (
                    <>
                      <div className="apple-inspector-preview is-highlighter" aria-hidden="true">
                        <div className="apple-preview-text-lines" />
                        <svg viewBox="0 0 180 34" className="apple-inspector-preview-svg" fill="none">
                          {(() => {
                            const h = Math.max(8, Math.min(20, highlighterSettings.size * 0.44));
                            const halfH = h * 0.5;
                            const slant = halfH * 0.404; // tan(22deg) matching -22deg chisel nib
                            const yTop = 17 - halfH;
                            const yBot = 17 + halfH;
                            return (
                              <polygon
                                points={`${24 + slant},${yTop} ${156 + slant},${yTop} ${156 - slant},${yBot} ${24 - slant},${yBot}`}
                                fill={highlighterSettings.color}
                                fillOpacity={highlighterSettings.opacity}
                                style={{ mixBlendMode: 'multiply' }}
                              />
                            );
                          })()}
                        </svg>
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-slider-head">
                          <span>الشفافية</span>
                          <span className="apple-slider-val">
                            {toArabicDigits(Math.round(highlighterSettings.opacity * 100))}٪
                          </span>
                        </div>
                        <CalmMagneticSlider
                          value={Math.round(highlighterSettings.opacity * 100)}
                          min={20}
                          max={90}
                          step={5}
                          magnetStep={5}
                          ariaLabel="شفافية قلم التظليل"
                          ariaValueText={`${toArabicDigits(Math.round(highlighterSettings.opacity * 100))} بالمئة`}
                          onChange={(val) => updateHighlighterSettings({ opacity: val / 100 })}
                        />
                      </div>

                      <div className="apple-inspector-section">
                        <div className="apple-slider-head">
                          <span>سلاسة الخط</span>
                          <span className="apple-slider-val">
                            {toArabicDigits(Math.round(highlighterSettings.smoothing * 100))}٪
                          </span>
                        </div>
                        <CalmMagneticSlider
                          value={Math.round(highlighterSettings.smoothing * 100)}
                          min={0}
                          max={100}
                          step={5}
                          magnetStep={10}
                          ariaLabel="سلاسة وتنعيم خط قلم التظليل"
                          ariaValueText={`${toArabicDigits(Math.round(highlighterSettings.smoothing * 100))} بالمئة`}
                          onChange={(val) => updateHighlighterSettings({ smoothing: val / 100 })}
                        />
                      </div>

                      <div className="apple-inspector-toggle-row">
                        <span className="apple-toggle-title">استقامة السحب التلقائي</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={highlighterSettings.straightAssist}
                          className={`apple-switch ${highlighterSettings.straightAssist ? 'is-on' : ''}`}
                          onClick={() =>
                            updateHighlighterSettings({
                              straightAssist: !highlighterSettings.straightAssist,
                            })
                          }
                        >
                          <span className="apple-switch-knob" />
                        </button>
                      </div>
                    </>
                  )}

                  {/* Optical Laser Preview + Mode, Size, Fade Duration & Smoothing */}
                  {activeTool === 'laser' && (() => {
                    const laserSizeLevel = pxToLaserSizeLevel(laserSettings.size);
                    const beamW = Math.max(2.1, Math.min(8.4, laserSettings.size * 0.92));
                    const dotR = Math.max(3.6, Math.min(7.4, 2.4 + laserSettings.size * 0.56));

                    return (
                      <>
                        <div
                          className="apple-inspector-preview"
                          style={{
                            background: '#0F172A',
                            borderColor: 'rgba(15, 23, 42, 0.25)',
                          }}
                          aria-hidden="true"
                        >
                          <svg viewBox="0 0 180 34" className="apple-inspector-preview-svg" fill="none">
                            <defs>
                              <radialGradient id="pkLaserPreviewAura" cx="50%" cy="50%" r="50%">
                                <stop offset="0%" stopColor={laserSettings.color} stopOpacity="0.62" />
                                <stop offset="48%" stopColor={laserSettings.color} stopOpacity="0.22" />
                                <stop offset="100%" stopColor={laserSettings.color} stopOpacity="0" />
                              </radialGradient>
                            </defs>

                            {/* Subtle slate reference lines */}
                            <line x1="20" y1="12" x2="160" y2="12" stroke="rgba(148, 163, 184, 0.14)" strokeWidth="1.2" />
                            <line x1="20" y1="22" x2="160" y2="22" stroke="rgba(148, 163, 184, 0.14)" strokeWidth="1.2" />

                            {laserSettings.mode === 'trail' ? (
                              <>
                                <path
                                  d="M16 23 C 46 6, 74 30, 108 16 C 134 5, 152 22, 164 13"
                                  stroke={laserSettings.color}
                                  strokeOpacity="0.26"
                                  strokeWidth={beamW * 2.2}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                <path
                                  d="M16 23 C 46 6, 74 30, 108 16 C 134 5, 152 22, 164 13"
                                  stroke={laserSettings.color}
                                  strokeOpacity="0.96"
                                  strokeWidth={beamW * 0.94}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                <path
                                  d="M16 23 C 46 6, 74 30, 108 16 C 134 5, 152 22, 164 13"
                                  stroke="#FFFFFF"
                                  strokeOpacity="0.88"
                                  strokeWidth={Math.max(0.85, beamW * 0.34)}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                <circle cx="164" cy="13" r={Math.max(2.6, beamW * 0.65)} fill={laserSettings.color} />
                                <circle cx="164" cy="13" r={Math.max(1.1, beamW * 0.25)} fill="#FFFFFF" />
                              </>
                            ) : (
                              <>
                                <circle cx="90" cy="17" r={dotR * 2.35} fill="url(#pkLaserPreviewAura)" />
                                <circle
                                  cx="90"
                                  cy="17"
                                  r={dotR}
                                  fill={laserSettings.color}
                                  stroke="rgba(255, 255, 255, 0.92)"
                                  strokeWidth="1.2"
                                />
                                <circle cx="90" cy="17" r={Math.max(1.3, dotR * 0.36)} fill="#FFFFFF" />
                              </>
                            )}
                          </svg>
                        </div>

                        <div className="apple-inspector-section">
                          <div className="apple-segmented" role="group" aria-label="نمط مؤشر الليزر">
                            <button
                              type="button"
                              className={`apple-seg-btn apple-line-style-btn ${
                                laserSettings.mode === 'trail' ? 'is-active' : ''
                              }`}
                              onClick={() => updateLaserSettings({ mode: 'trail' })}
                              title="يرسم شعاعاً مضيئاً يتلاشى تلقائياً بعد رفع القلم"
                            >
                              <svg width="26" height="10" viewBox="0 0 26 10" fill="none" aria-hidden="true">
                                <path
                                  d="M3 7.5 C 8 2, 15 8, 22 2.8"
                                  stroke="currentColor"
                                  strokeWidth="2.1"
                                  strokeLinecap="round"
                                />
                                <circle cx="22.5" cy="2.6" r="1.7" fill="currentColor" />
                              </svg>
                              <span>شعاع متلاشٍ</span>
                            </button>
                            <button
                              type="button"
                              className={`apple-seg-btn apple-line-style-btn ${
                                laserSettings.mode === 'dot' ? 'is-active' : ''
                              }`}
                              onClick={() => updateLaserSettings({ mode: 'dot' })}
                              title="نقطة ضوئية فورية مع نبضة عند النقر"
                            >
                              <svg width="26" height="10" viewBox="0 0 26 10" fill="none" aria-hidden="true">
                                <circle cx="13" cy="5" r="4.2" fill="currentColor" fillOpacity="0.2" />
                                <circle cx="13" cy="5" r="2.2" fill="currentColor" />
                              </svg>
                              <span>نقطة فقط</span>
                            </button>
                          </div>
                        </div>

                        <div className="apple-inspector-section">
                          <div className="apple-slider-head">
                            <span>حجم الليزر</span>
                            <span className="apple-slider-val">
                              {toArabicDigits(laserSizeLevel)}٪
                            </span>
                          </div>
                          <CalmMagneticSlider
                            value={laserSizeLevel}
                            min={SIZE_DIAL_MIN}
                            max={SIZE_DIAL_MAX}
                            step={SIZE_DIAL_STEP}
                            magnetStep={5}
                            ariaLabel="حجم مؤشر الليزر"
                            ariaValueText={`${toArabicDigits(laserSizeLevel)} بالمئة`}
                            onChange={(lvl) => updateLaserSettings({ size: laserSizeLevelToPx(lvl) })}
                          />
                        </div>

                        {laserSettings.mode === 'trail' && (
                          <>
                            <div className="apple-inspector-section">
                              <div className="apple-slider-head">
                                <span>سلاسة الخط</span>
                                <span className="apple-slider-val">
                                  {toArabicDigits(Math.round(laserSettings.smoothing * 100))}٪
                                </span>
                              </div>
                              <CalmMagneticSlider
                                value={Math.round(laserSettings.smoothing * 100)}
                                min={0}
                                max={100}
                                step={5}
                                magnetStep={10}
                                ariaLabel="سلاسة وتنعيم خط الليزر"
                                ariaValueText={`${toArabicDigits(Math.round(laserSettings.smoothing * 100))} بالمئة`}
                                onChange={(val) => updateLaserSettings({ smoothing: val / 100 })}
                              />
                            </div>

                            <div className="apple-inspector-section">
                              <div className="apple-slider-head">
                                <span>مدة بقاء الشعاع</span>
                                <span className="apple-slider-val">
                                  {toArabicDigits(
                                    (Math.round(laserSettings.fadeDurationMs / 100) / 10)
                                      .toFixed(1)
                                      .replace('.', '٫')
                                  )}{' '}
                                  ث
                                </span>
                              </div>
                              <CalmMagneticSlider
                                value={Math.max(5, Math.min(30, Math.round(laserSettings.fadeDurationMs / 100)))}
                                min={5}
                                max={30}
                                step={5}
                                magnetStep={5}
                                ariaLabel="مدة بقاء شعاع الليزر بالثواني"
                                onChange={(decisec) =>
                                  updateLaserSettings({ fadeDurationMs: decisec * 100 })
                                }
                              />
                            </div>
                          </>
                        )}
                      </>
                    );
                  })()}

                  {/* Smart Eraser Preview + Size + Mode + Highlighter-Only Filter */}
                  {activeTool === 'eraser' && (() => {
                    const hlOnly = Boolean(eraserSettings.highlighterOnly);
                    const isPartial = eraserSettings.mode === 'partial';
                    const previewR = Math.max(5.5, Math.min(13.5, eraserSettings.size * 0.24));
                    const accentStroke = hlOnly ? '#D97706' : '#E11D48';
                    const accentFill = hlOnly
                      ? 'rgba(254, 243, 199, 0.52)'
                      : 'rgba(251, 207, 232, 0.44)';

                    return (
                      <>
                        <div className="apple-inspector-preview" aria-hidden="true">
                          <div className="apple-preview-text-lines" />
                          <svg viewBox="0 0 180 34" className="apple-inspector-preview-svg" fill="none">
                            <defs>
                              <mask id="pkEraserInspectorPreviewMask">
                                <rect x="0" y="0" width="180" height="34" fill="white" />
                                <circle cx="90" cy="17" r={previewR} fill="black" />
                              </mask>
                            </defs>

                            {/* Highlighter bar (always affected by eraser) */}
                            <rect
                              x="24"
                              y="12"
                              width="132"
                              height="10"
                              rx="3"
                              fill="#FACC15"
                              fillOpacity={isPartial ? 0.56 : 0.26}
                              mask={isPartial ? 'url(#pkEraserInspectorPreviewMask)' : undefined}
                              style={{ mixBlendMode: 'multiply' }}
                            />

                            {/* Ink stroke (stays untouched when highlighterOnly is active) */}
                            <path
                              d="M18 22 C 48 8, 76 28, 108 15 C 134 5, 152 22, 164 13"
                              stroke="#1E293B"
                              strokeOpacity={hlOnly ? 0.92 : isPartial ? 0.88 : 0.24}
                              strokeWidth="2.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              mask={
                                isPartial && !hlOnly
                                  ? 'url(#pkEraserInspectorPreviewMask)'
                                  : undefined
                              }
                            />

                            {/* Soft footprint halo */}
                            <circle
                              cx="90"
                              cy="17"
                              r={previewR + 2.2}
                              fill={hlOnly ? 'rgba(245, 158, 11, 0.1)' : 'rgba(225, 29, 72, 0.08)'}
                            />
                            {/* Live Eraser Footprint Circle */}
                            <circle
                              cx="90"
                              cy="17"
                              r={previewR}
                              fill={accentFill}
                              stroke={accentStroke}
                              strokeWidth="1.5"
                              strokeDasharray={isPartial ? '3.2 2.4' : undefined}
                            />
                            {hlOnly && (
                              <circle cx="90" cy="17" r="1.8" fill="#D97706" />
                            )}
                          </svg>
                        </div>

                        <div className="apple-inspector-section">
                          <div className="apple-slider-head">
                            <span>حجم الممحاة</span>
                            <span className="apple-slider-val">
                              {toArabicDigits(eraserSizeLevel)}٪
                            </span>
                          </div>
                          <CalmMagneticSlider
                            value={eraserSizeLevel}
                            min={SIZE_DIAL_MIN}
                            max={SIZE_DIAL_MAX}
                            step={SIZE_DIAL_STEP}
                            magnetStep={5}
                            ariaLabel="حجم الممحاة"
                            ariaValueText={`${toArabicDigits(eraserSizeLevel)} بالمئة`}
                            onChange={(lvl) =>
                              updateEraserSettings({ size: sizeLevelToPx('eraser', lvl) })
                            }
                          />
                        </div>

                        <div className="apple-inspector-section">
                          <div className="apple-slider-head">
                            <span>وضع المسح</span>
                          </div>
                          <div className="apple-segmented" role="group" aria-label="وضع الممحاة">
                            <button
                              type="button"
                              className={`apple-seg-btn apple-line-style-btn ${
                                eraserSettings.mode === 'stroke' ? 'is-active' : ''
                              }`}
                              onClick={() => updateEraserSettings({ mode: 'stroke' })}
                              title="مسح العنصر كاملاً عند لمسه"
                            >
                              <svg width="26" height="10" viewBox="0 0 26 10" fill="none" aria-hidden="true">
                                <line
                                  x1="2"
                                  y1="5"
                                  x2="24"
                                  y2="5"
                                  stroke="currentColor"
                                  strokeOpacity="0.32"
                                  strokeWidth="2.1"
                                  strokeLinecap="round"
                                />
                                <circle
                                  cx="13"
                                  cy="5"
                                  r="3.4"
                                  fill="rgba(225, 29, 72, 0.16)"
                                  stroke="currentColor"
                                  strokeWidth="1.3"
                                />
                              </svg>
                              <span>عنصر كامل</span>
                            </button>
                            <button
                              type="button"
                              className={`apple-seg-btn apple-line-style-btn ${
                                eraserSettings.mode === 'partial' ? 'is-active' : ''
                              }`}
                              onClick={() => updateEraserSettings({ mode: 'partial' })}
                              title="قص ومسح الجزء الملامس فقط من الخط"
                            >
                              <svg width="26" height="10" viewBox="0 0 26 10" fill="none" aria-hidden="true">
                                <line
                                  x1="2"
                                  y1="5"
                                  x2="8"
                                  y2="5"
                                  stroke="currentColor"
                                  strokeWidth="2.1"
                                  strokeLinecap="round"
                                />
                                <line
                                  x1="18"
                                  y1="5"
                                  x2="24"
                                  y2="5"
                                  stroke="currentColor"
                                  strokeWidth="2.1"
                                  strokeLinecap="round"
                                />
                                <circle
                                  cx="13"
                                  cy="5"
                                  r="3.4"
                                  fill="rgba(225, 29, 72, 0.14)"
                                  stroke="currentColor"
                                  strokeWidth="1.3"
                                  strokeDasharray="1.8 1.5"
                                />
                              </svg>
                              <span>مسح جزئي</span>
                            </button>
                          </div>
                        </div>

                        <div className="apple-inspector-toggle-row">
                          <span className="apple-toggle-title">مسح التظليل فقط</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={hlOnly}
                            className={`apple-switch ${hlOnly ? 'is-on' : ''}`}
                            onClick={() =>
                              updateEraserSettings({
                                highlighterOnly: !eraserSettings.highlighterOnly,
                              })
                            }
                            title="يمسح التظليل وشريط التحفيظ فقط دون المساس بكتابات الحبر والرصاص"
                          >
                            <span className="apple-switch-knob" />
                          </button>
                        </div>
                      </>
                    );
                  })()}

                  {/* Smart Lasso Preview + Mode + Match Scope + Highlighter Filter */}
                  {activeTool === 'lasso' && (() => {
                    const isRect = lassoSettings.mode === 'rect';
                    const isContain = lassoSettings.matchMode === 'contain';
                    const includeHl = lassoSettings.includeHighlights;

                    return (
                      <>
                        <div className="apple-inspector-preview" aria-hidden="true">
                          <div className="apple-preview-text-lines" />
                          <svg viewBox="0 0 180 34" className="apple-inspector-preview-svg" fill="none">
                            {/* Sample highlight strip */}
                            <rect
                              x="44"
                              y="12"
                              width="92"
                              height="10"
                              rx="3"
                              fill="#FACC15"
                              fillOpacity={includeHl ? 0.56 : 0.24}
                              style={{ mixBlendMode: 'multiply' }}
                            />
                            {/* Sample ink arc inside lasso frame */}
                            <path
                              d="M54 21 C 74 11, 102 25, 126 14"
                              stroke="#007AFF"
                              strokeWidth="2.4"
                              strokeLinecap="round"
                            />
                            {/* Neighbor edge line demonstrating touch vs contain */}
                            <line
                              x1="22"
                              y1="17"
                              x2="45"
                              y2="17"
                              stroke={isContain ? '#94A3B8' : '#007AFF'}
                              strokeOpacity={isContain ? 0.55 : 0.92}
                              strokeWidth="2.2"
                              strokeLinecap="round"
                            />

                            {isRect ? (
                              <>
                                <rect
                                  x="40"
                                  y="5"
                                  width="100"
                                  height="24"
                                  rx="2.5"
                                  fill="rgba(0, 122, 255, 0.08)"
                                  stroke="#007AFF"
                                  strokeWidth="1.5"
                                  strokeDasharray="4 3"
                                />
                                <circle cx="40" cy="5" r="2" fill="#FFFFFF" stroke="#007AFF" strokeWidth="1.2" />
                                <circle cx="140" cy="5" r="2" fill="#FFFFFF" stroke="#007AFF" strokeWidth="1.2" />
                                <circle cx="140" cy="29" r="2" fill="#FFFFFF" stroke="#007AFF" strokeWidth="1.2" />
                                <circle cx="40" cy="29" r="2" fill="#FFFFFF" stroke="#007AFF" strokeWidth="1.2" />
                              </>
                            ) : (
                              <path
                                d="M40 16 C 40 6, 72 4, 96 6 C 122 8, 144 6, 144 17 C 144 28, 118 30, 88 28 C 60 27, 40 26, 40 16 Z"
                                fill="rgba(0, 122, 255, 0.08)"
                                stroke="#007AFF"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeDasharray="4 3"
                              />
                            )}
                          </svg>
                        </div>

                        <div className="apple-inspector-section">
                          <div className="apple-slider-head">
                            <span>نمط التحديد</span>
                          </div>
                          <div className="apple-segmented" role="group" aria-label="نمط أداة التحديد">
                            <button
                              type="button"
                              className={`apple-seg-btn apple-line-style-btn ${
                                lassoSettings.mode === 'freeform' ? 'is-active' : ''
                              }`}
                              onClick={() => updateLassoSettings({ mode: 'freeform' })}
                              title="ارسم طوقاً حراً حول العناصر لتحديدها"
                            >
                              <svg width="24" height="12" viewBox="0 0 24 12" fill="none" aria-hidden="true">
                                <path
                                  d="M4 6.5 C 4 2.5, 9.5 1.5, 14 2.5 C 19 3.5, 20.5 6.5, 19 9 C 17 11, 10 10.5, 6 9.5 C 4.5 9, 4 7.8, 4 6.5 Z"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeDasharray="3 2.2"
                                />
                              </svg>
                              <span>تحديد حر</span>
                            </button>
                            <button
                              type="button"
                              className={`apple-seg-btn apple-line-style-btn ${
                                lassoSettings.mode === 'rect' ? 'is-active' : ''
                              }`}
                              onClick={() => updateLassoSettings({ mode: 'rect' })}
                              title="اسحب مستطيل تحديد سريع حول العناصر"
                            >
                              <svg width="24" height="12" viewBox="0 0 24 12" fill="none" aria-hidden="true">
                                <rect
                                  x="4.5"
                                  y="2"
                                  width="15"
                                  height="8"
                                  rx="1.2"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeDasharray="3 2.2"
                                />
                              </svg>
                              <span>مستطيل</span>
                            </button>
                          </div>
                        </div>

                        <div className="apple-inspector-section">
                          <div className="apple-slider-head">
                            <span>نطاق الالتقاط</span>
                          </div>
                          <div className="apple-segmented" role="group" aria-label="نطاق التقاط التحديد">
                            <button
                              type="button"
                              className={`apple-seg-btn apple-line-style-btn ${
                                lassoSettings.matchMode === 'touch' ? 'is-active' : ''
                              }`}
                              onClick={() => updateLassoSettings({ matchMode: 'touch' })}
                              title="يلتقط كل عنصر يلامسه إطار التحديد"
                            >
                              <svg width="24" height="12" viewBox="0 0 24 12" fill="none" aria-hidden="true">
                                <line x1="2" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                <rect
                                  x="9"
                                  y="2"
                                  width="12"
                                  height="8"
                                  rx="1.2"
                                  stroke="currentColor"
                                  strokeWidth="1.4"
                                  strokeDasharray="2.8 2"
                                />
                              </svg>
                              <span>بالتلامس</span>
                            </button>
                            <button
                              type="button"
                              className={`apple-seg-btn apple-line-style-btn ${
                                lassoSettings.matchMode === 'contain' ? 'is-active' : ''
                              }`}
                              onClick={() => updateLassoSettings({ matchMode: 'contain' })}
                              title="يلتقط العناصر الواقعة بالكامل داخل إطار التحديد فقط"
                            >
                              <svg width="24" height="12" viewBox="0 0 24 12" fill="none" aria-hidden="true">
                                <line x1="9" y1="6" x2="15" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                <rect
                                  x="5"
                                  y="2"
                                  width="14"
                                  height="8"
                                  rx="1.2"
                                  stroke="currentColor"
                                  strokeWidth="1.4"
                                  strokeDasharray="2.8 2"
                                />
                              </svg>
                              <span>احتواء كامل</span>
                            </button>
                          </div>
                        </div>

                        <div className="apple-inspector-toggle-row">
                          <span className="apple-toggle-title">تضمين التظليل والشريط</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={includeHl}
                            className={`apple-switch ${includeHl ? 'is-on' : ''}`}
                            onClick={() => updateLassoSettings({ includeHighlights: !includeHl })}
                            title="تحديد التظليل وأشرطة التحفيظ مع الكتابات أو استثناؤها"
                          >
                            <span className="apple-switch-knob" />
                          </button>
                        </div>
                      </>
                    );
                  })()}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

            {/* Main Floating Apple PencilKit Dock */}
            <div className="apple-palette-dock" role="toolbar" aria-label="منظومة الأقلام والتظليل والليزر">
              {/* Zone 1: Drag Handle + Standalone Browse Mode */}
              <button
                type="button"
                className="apple-dock-drag-handle"
                title="اسحب لنقل شريط الأقلام · نقرتان لإعادته للمنتصف"
                aria-label="سحب شريط الأقلام"
                onPointerDown={handleDragStart}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
                onPointerCancel={handleDragEnd}
                onDoubleClick={() => setDragOffset({ x: 0, y: 0 })}
              >
                <GripVertical className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />
              </button>

              <button
                type="button"
                className={`apple-cursor-btn ${activeTool === 'cursor' ? 'is-active' : ''}`}
                aria-pressed={activeTool === 'cursor'}
                onClick={() => handleSelectTool('cursor')}
                title="وضع التصفح العادي (V) · نقرة على شريط التحفيظ لكشفه"
                aria-label="وضع التصفح العادي"
              >
                <MousePointer2 className="w-4 h-4" strokeWidth={1.95} aria-hidden="true" />
                <span className="apple-cursor-label">تصفح</span>
              </button>

              <div className="apple-dock-divider" aria-hidden="true" />

              {/* Zone 2: Clean Minimal Static Tool Nibs (8 Styluses) */}
              <div className="apple-nibs-tray" role="group" aria-label="أدوات الرسم والمؤشر">
                <button
                  type="button"
                  className={`apple-nib-slot ${activeTool === 'pen' ? 'is-active' : ''}`}
                  style={{ '--slot-accent': penSettings.color } as React.CSSProperties}
                  aria-pressed={activeTool === 'pen'}
                  onClick={() => handleSelectTool('pen')}
                  title="قلم حبر (P) · اضغط مجدداً للإعدادات"
                  aria-label="قلم حبر"
                >
                  <ApplePenNibSvg color={penSettings.color} sizeLevel={penSizeLevel} />
                </button>

                {systemSettings.enabledOptionalTools.fountain && (
                  <button
                    type="button"
                    className={`apple-nib-slot ${activeTool === 'fountain' ? 'is-active' : ''}`}
                    style={{ '--slot-accent': fountainSettings.color } as React.CSSProperties}
                    aria-pressed={activeTool === 'fountain'}
                    onClick={() => handleSelectTool('fountain')}
                    title="قلم خطّاط (F) · يكتب بسُمكٍ مائل وزاوية سن قابلة للتعديل"
                    aria-label="قلم خطّاط"
                  >
                    <AppleFountainNibSvg
                      color={fountainSettings.color}
                      sizeLevel={fountainSizeLevel}
                    />
                  </button>
                )}

                <button
                  type="button"
                  className={`apple-nib-slot ${activeTool === 'pencil' ? 'is-active' : ''}`}
                  style={{ '--slot-accent': pencilSettings.color } as React.CSSProperties}
                  aria-pressed={activeTool === 'pencil'}
                  onClick={() => handleSelectTool('pencil')}
                  title="قلم رصاص (G) · ملمس جرافيت ناعم"
                  aria-label="قلم رصاص"
                >
                  <ApplePencilNibSvg color={pencilSettings.color} sizeLevel={pencilSizeLevel} />
                </button>

                <button
                  type="button"
                  className={`apple-nib-slot ${activeTool === 'highlighter' ? 'is-active' : ''}`}
                  style={{ '--slot-accent': highlighterSettings.color } as React.CSSProperties}
                  aria-pressed={activeTool === 'highlighter'}
                  onClick={() => handleSelectTool('highlighter')}
                  title="تظليل أبل (H) · اضغط مجدداً للشفافية واستقامة السحب"
                  aria-label="تظليل أبل"
                >
                  <AppleHighlighterNibSvg
                    color={highlighterSettings.color}
                    sizeLevel={highlighterSizeLevel}
                  />
                </button>

                {systemSettings.enabledOptionalTools.tape && (
                  <button
                    type="button"
                    className={`apple-nib-slot ${activeTool === 'tape' ? 'is-active' : ''}`}
                    style={{ '--slot-accent': tapeSettings.color } as React.CSSProperties}
                    aria-pressed={activeTool === 'tape'}
                    onClick={() => handleSelectTool('tape')}
                    title="شريط التحفيظ (T) · لإخفاء الكلمات واختبار الحفظ بالنقر"
                    aria-label="شريط التحفيظ"
                  >
                    <AppleTapeStylusSvg color={tapeSettings.color} sizeLevel={tapeSizeLevel} />
                  </button>
                )}

                <button
                  type="button"
                  className={`apple-nib-slot ${activeTool === 'eraser' ? 'is-active' : ''}`}
                  style={
                    {
                      '--slot-accent': eraserSettings.highlighterOnly ? '#F59E0B' : '#E11D48',
                    } as React.CSSProperties
                  }
                  aria-pressed={activeTool === 'eraser'}
                  onClick={() => handleSelectTool('eraser')}
                  title="ممحاة ذكية (E) · اضغط مجدداً لحجم الممحاة ووضع المسح"
                  aria-label="ممحاة ذكية"
                >
                  <AppleEraserNibSvg
                    sizeLevel={eraserSizeLevel}
                    highlighterOnly={Boolean(eraserSettings.highlighterOnly)}
                  />
                </button>

                {systemSettings.enabledOptionalTools.lasso && (
                  <button
                    type="button"
                    className={`apple-nib-slot ${activeTool === 'lasso' ? 'is-active' : ''}`}
                    style={{ '--slot-accent': '#007AFF' } as React.CSSProperties}
                    aria-pressed={activeTool === 'lasso'}
                    onClick={() => handleSelectTool('lasso')}
                    title="تحديد حر ونقل مجموعة عناصر (S) · اضغط مجدداً لإعدادات الالتقاط"
                    aria-label="أداة التحديد الحر"
                  >
                    <AppleLassoStylusSvg isActive={activeTool === 'lasso'} />
                  </button>
                )}

                <button
                  type="button"
                  className={`apple-nib-slot ${activeTool === 'laser' ? 'is-active' : ''}`}
                  style={{ '--slot-accent': laserSettings.color } as React.CSSProperties}
                  aria-pressed={activeTool === 'laser'}
                  onClick={() => handleSelectTool('laser')}
                  title="مؤشر ليزر ضوئي (L) · اضغط مجدداً للحجم ومدة التلاشي"
                  aria-label="مؤشر ليزر ضوئي"
                >
                  <AppleLaserStylusSvg
                    color={laserSettings.color}
                    sizeLevel={pxToLaserSizeLevel(laserSettings.size)}
                    isActive={activeTool === 'laser'}
                  />
                </button>
              </div>

              <div className="apple-dock-divider" aria-hidden="true" />

              {/* Zone 3: 3 Independent Thickness Dots + 3 Quick Color Circles */}
              <DockThicknessSlots
                tool={rollerTool}
                isStandby={activeTool === 'cursor' || activeTool === 'lasso' || activeTool === 'laser'}
                isPulsing={isRollerPulsing}
                suppressPreview={isInspectorOpen || isDockSettingsOpen || editingColorSlot !== null}
                sizeSlots={currentSlots}
                activeSlot={currentActiveSlot}
                editingSlot={editingSlot}
                color={rollerColor}
                onActivateTool={() => setActiveTool(rollerTool)}
                onSelectSlot={handleSelectSizeSlot}
                onEditingSlotChange={(nextSlot) => {
                  if (nextSlot !== null) {
                    setIsInspectorOpen(false);
                    setIsDockSettingsOpen(false);
                    setEditingColorSlot(null);
                  }
                  setEditingSlot(nextSlot);
                }}
                onChangeSlotLevel={handleChangeSlotLevel}
              />

              <DockColorSlots
                tool={colorTool}
                isStandby={activeTool === 'cursor' || activeTool === 'lasso'}
                isHidden={activeTool === 'eraser'}
                colorSlots={currentColorSlots}
                activeSlot={currentActiveColorSlot}
                editingSlot={editingColorSlot}
                palette={currentColorPalette}
                onActivateTool={() => setActiveTool(colorTool)}
                onSelectSlot={handleSelectColorSlot}
                onEditingSlotChange={(nextSlot) => {
                  if (nextSlot !== null) {
                    setIsInspectorOpen(false);
                    setIsDockSettingsOpen(false);
                    setEditingSlot(null);
                  }
                  setEditingColorSlot(nextSlot);
                }}
                onChangeSlotColor={handleChangeSlotColor}
              />

              <div className="apple-dock-divider" aria-hidden="true" />

              {/* Zone 4: History, PNG Export & Clear */}
              <div className="apple-dock-actions" role="group" aria-label="التراجع والتصدير والمسح">
                <button
                  type="button"
                  className="apple-icon-btn"
                  disabled={!canUndo}
                  onClick={() => undo()}
                  title="تراجع خطوة · للشكل المضبوط: مرة للرسم الحر ومرتان للمسح"
                  aria-label="تراجع عن آخر خطوة"
                >
                  <Undo2 className="w-4 h-4" strokeWidth={1.9} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="apple-icon-btn"
                  disabled={!canRedo}
                  onClick={() => redo()}
                  title="إعادة الخطوة"
                  aria-label="إعادة الخطوة"
                >
                  <Redo2 className="w-4 h-4" strokeWidth={1.9} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="apple-icon-btn"
                  disabled={isExportingPdf}
                  aria-busy={isExportingPdf}
                  onClick={() => void exportActiveSurfacePdf()}
                  title="تنزيل الصفحة الحالية مع الكتابة كملف PDF"
                  aria-label="تنزيل الصفحة الحالية مع الكتابة كملف PDF"
                >
                  {isExportingPdf ? (
                    <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <Download className="w-4 h-4" strokeWidth={1.9} aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  className="apple-icon-btn is-danger"
                  disabled={!hasActiveStrokes}
                  onClick={() => clearSurface()}
                  title="مسح رسومات الصفحة الحالية"
                  aria-label="مسح رسومات الصفحة الحالية"
                >
                  <Trash2 className="w-4 h-4" strokeWidth={1.9} aria-hidden="true" />
                </button>
              </div>

              <div className="apple-dock-divider" aria-hidden="true" />

              <div className="apple-dock-utility" role="group" aria-label="الإعدادات وطي الشريط">
                <div className="apple-dock-settings-wrap">
                  <button
                    type="button"
                    className={`apple-icon-btn ${isDockSettingsOpen ? 'is-active-utility' : ''}`}
                    aria-expanded={isDockSettingsOpen}
                    aria-haspopup="dialog"
                    onClick={() => {
                      setIsInspectorOpen(false);
                      setEditingSlot(null);
                      setEditingColorSlot(null);
                      setIsDockSettingsOpen((prev) => !prev);
                    }}
                    title="إعدادات الأقلام والأدوات"
                    aria-label="إعدادات الأقلام والأدوات"
                  >
                    <Settings className="w-4 h-4" strokeWidth={1.9} aria-hidden="true" />
                  </button>

                  <AnimatePresence>
                    {isDockSettingsOpen && (
                      <motion.div
                        className="apple-dock-settings-popover"
                        dir="rtl"
                        role="dialog"
                        aria-label="إعدادات منظومة الأقلام"
                        initial={{ opacity: 0, y: 10, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.96 }}
                        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                      >
                        <div className="apple-dock-settings-group">
                          <div className="apple-dock-settings-group-title">سلوك الأقلام</div>
                          <div className="apple-inspector-toggle-row">
                            <span className="apple-toggle-title">ضبط الأشكال</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={systemSettings.smartShapes}
                              aria-label="ضبط الأشكال التلقائي لجميع الأقلام"
                              className={`apple-switch ${systemSettings.smartShapes ? 'is-on' : ''}`}
                              onClick={() =>
                                updateSystemSettings({ smartShapes: !systemSettings.smartShapes })
                              }
                            >
                              <span className="apple-switch-knob" />
                            </button>
                          </div>

                          <div className="apple-inspector-toggle-row">
                            <span className="apple-toggle-title">شطب للمسح السريع</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={systemSettings.scribbleErase}
                              aria-label="شطب للمسح السريع لجميع الأقلام"
                              className={`apple-switch ${systemSettings.scribbleErase ? 'is-on' : ''}`}
                              onClick={() =>
                                updateSystemSettings({ scribbleErase: !systemSettings.scribbleErase })
                              }
                            >
                              <span className="apple-switch-knob" />
                            </button>
                          </div>
                        </div>

                        <div className="apple-dock-settings-divider" aria-hidden="true" />

                        <div className="apple-dock-settings-group">
                          <div className="apple-dock-settings-group-title">أدوات إضافية في الشريط</div>
                          <div className="apple-inspector-toggle-row">
                            <span className="apple-toggle-title">قلم خطّاط</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={systemSettings.enabledOptionalTools.fountain}
                              aria-label="إظهار قلم خطّاط في الشريط"
                              className={`apple-switch ${
                                systemSettings.enabledOptionalTools.fountain ? 'is-on' : ''
                              }`}
                              onClick={() => toggleOptionalTool('fountain')}
                            >
                              <span className="apple-switch-knob" />
                            </button>
                          </div>

                          <div className="apple-inspector-toggle-row">
                            <span className="apple-toggle-title">شريط التحفيظ</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={systemSettings.enabledOptionalTools.tape}
                              aria-label="إظهار شريط التحفيظ في الشريط"
                              className={`apple-switch ${
                                systemSettings.enabledOptionalTools.tape ? 'is-on' : ''
                              }`}
                              onClick={() => toggleOptionalTool('tape')}
                            >
                              <span className="apple-switch-knob" />
                            </button>
                          </div>

                          <div className="apple-inspector-toggle-row">
                            <span className="apple-toggle-title">التحديد الحر (لاسو)</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={systemSettings.enabledOptionalTools.lasso}
                              aria-label="إظهار أداة التحديد الحر في الشريط"
                              className={`apple-switch ${
                                systemSettings.enabledOptionalTools.lasso ? 'is-on' : ''
                              }`}
                              onClick={() => toggleOptionalTool('lasso')}
                            >
                              <span className="apple-switch-knob" />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button
                  type="button"
                  className="apple-icon-btn is-collapse"
                  onClick={() => {
                    setIsInspectorOpen(false);
                    setIsDockSettingsOpen(false);
                    setEditingSlot(null);
                    setEditingColorSlot(null);
                    setPaletteOpen(false);
                  }}
                  title="طيّ شريط الأقلام"
                  aria-label="طيّ شريط الأقلام"
                >
                  <ChevronDown className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
