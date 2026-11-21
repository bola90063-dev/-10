import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { jsPDF } from 'jspdf';
import { domToCanvas } from 'modern-screenshot';
import { SafaraLogo } from '../SafaraTypographyLogo';
import { SilkWaveBackground } from '../SilkWaveBackground';
import {
  drawAppleHighlighterStroke,
  drawApplePenStroke,
  type RenderTransform,
} from './strokeEngine';
import type { AnnotationStroke } from './types';
import { toArabicDigits } from '../../utils/mushafData';

export interface PdfExportTarget {
  surfaceId: string;
  strokes: ReadonlyArray<AnnotationStroke>;
  pageElement: HTMLElement | null;
  overlayElement: HTMLElement | null;
  isBounded: boolean;
  backgroundHex?: string;
  fallbackHlCanvas?: HTMLCanvasElement | null;
  fallbackPenCanvas?: HTMLCanvasElement | null;
}

interface ExportDocumentMeta {
  title: string;
  subtitle: string;
  dateLabel: string;
}

const TOPIC_TITLES: Record<string, string> = {
  lathawiya: 'الحروف اللثوية',
  noon_meem: 'النون والميم المشددتان',
  qalqalah: 'حروف القلقلة (قطب جد)',
  noon_sakinah: 'أحكام النون الساكنة والتنوين',
};

const TAB_TITLES: Record<string, string> = {
  explain: 'الشرح التفاعلي',
  letters: 'تعرّف على الحروف',
  words: 'تدرّب في كلمات',
  apply: 'طبّق في القرآن',
};

const ARCHIVAL_PAPER_BG = '#FAF6EC';

function extractDocumentMeta(
  surfaceId: string,
  pageEl: HTMLElement | null
): ExportDocumentMeta {
  let dateLabel = '';
  try {
    dateLabel = new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date());
  } catch {
    dateLabel = new Date().toLocaleDateString();
  }

  const mushafMatch = surfaceId.match(/^mushaf:page:(\d+)$/);
  if (mushafMatch) {
    const pageNumAr = toArabicDigits(Number(mushafMatch[1]));
    const surahRaw = pageEl?.querySelector('.mushaf-page-header-surah')?.textContent?.trim();
    const juzRaw = pageEl?.querySelector('.mushaf-page-header-juz')?.textContent?.trim();
    const title = surahRaw || `صفحة ${pageNumAr}`;
    const subtitleParts = [juzRaw, `صفحة ${pageNumAr}`].filter(Boolean);
    return {
      title,
      subtitle: subtitleParts.join('  ·  '),
      dateLabel,
    };
  }

  if (surfaceId.startsWith('tajweed:')) {
    const parts = surfaceId.split(':');
    const topicTitle = TOPIC_TITLES[parts[1] ?? ''] || 'أحكام التجويد';
    const tabTitle = TAB_TITLES[parts[2] ?? ''] || 'الدرس التفاعلي';
    return {
      title: topicTitle,
      subtitle: tabTitle,
      dateLabel,
    };
  }

  return {
    title: 'تعليم قراءة العربية والقرآن والتجويد',
    subtitle: 'منصة مَعَ السَّفَرَة التعليمية',
    dateLabel,
  };
}

function shouldIncludeDomNode(node: Node): boolean {
  if (!(node instanceof Element)) return true;
  if (node.hasAttribute('data-annotation-ui')) return false;
  const cl = node.classList;
  if (
    cl.contains('annotation-surface') ||
    cl.contains('annotation-tape-hotspot') ||
    cl.contains('global-annotation-stage') ||
    cl.contains('global-annotation-canvas') ||
    cl.contains('global-laser-canvas') ||
    cl.contains('annotation-tool-cursor') ||
    cl.contains('mushaf-liquid-lens-backdrop') ||
    cl.contains('apple-palette-anchor')
  ) {
    return false;
  }
  return true;
}

function buildPdfFilename(surfaceId: string): string {
  const mushafMatch = surfaceId.match(/^mushaf:page:(\d+)$/);
  if (mushafMatch) {
    return `safara-mushaf-page-${mushafMatch[1]}.pdf`;
  }
  const safeName =
    surfaceId
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'page';
  return `safara-${safeName}.pdf`;
}

function resolveCaptureScale(width: number, height: number): number {
  const desired = 2;
  const maxDim = 10500;
  const maxPixels = 28_000_000;
  let scale = desired;
  if (width * scale > maxDim) {
    scale = maxDim / Math.max(1, width);
  }
  if (height * scale > maxDim) {
    scale = Math.min(scale, maxDim / Math.max(1, height));
  }
  if (width * height * scale * scale > maxPixels) {
    scale = Math.min(scale, Math.sqrt(maxPixels / Math.max(1, width * height)));
  }
  return Math.max(1, Math.min(desired, scale));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function deduplicateSvgIds(container: HTMLElement, prefix: string): void {
  const idMap = new Map<string, string>();
  const elementsWithId = container.querySelectorAll('[id]');
  elementsWithId.forEach((el) => {
    const oldId = el.getAttribute('id');
    if (!oldId) return;
    if (oldId === 'safara-header-brand-logo') {
      el.removeAttribute('id');
      return;
    }
    const newId = `${prefix}-${oldId}`;
    idMap.set(oldId, newId);
    el.setAttribute('id', newId);
  });

  if (idMap.size === 0) return;

  const refAttrs = ['fill', 'stroke', 'filter', 'clip-path', 'mask'];
  const allElements = container.querySelectorAll('*');
  allElements.forEach((el) => {
    for (const attr of refAttrs) {
      const val = el.getAttribute(attr);
      if (!val || !val.includes('url(#')) continue;
      let updated = val;
      idMap.forEach((newId, oldId) => {
        updated = updated.replace(`url(#${oldId})`, `url(#${newId})`);
      });
      if (updated !== val) {
        el.setAttribute(attr, updated);
      }
    }
  });
}

async function captureElementCanvas(
  el: HTMLElement,
  width: number,
  height: number,
  scale: number,
  backgroundColor: string,
  filterFn?: (node: Node) => boolean
): Promise<HTMLCanvasElement> {
  const options = {
    scale,
    width,
    height,
    backgroundColor,
    ...(filterFn ? { filter: filterFn } : {}),
    maximumCanvasSize: 16384,
    timeout: 15000,
    style: {
      margin: '0',
    },
    font: {
      preferredFormat: 'woff2' as const,
    },
  };

  try {
    return await domToCanvas(el, options);
  } catch (err) {
    console.warn('[pdfExport] Retrying DOM capture without external font embedding:', err);
    return await domToCanvas(el, {
      ...options,
      font: false,
    });
  }
}

async function renderBrandedHeaderCanvas(
  meta: ExportDocumentMeta,
  logicalWidth: number,
  scale: number,
  compact = false
): Promise<HTMLCanvasElement> {
  const height = compact ? 74 : 112;
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-24000px';
  host.style.top = '0';
  host.style.width = `${logicalWidth}px`;
  host.style.height = `${height}px`;
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-1';
  host.setAttribute('dir', 'rtl');

  const styleOverride = document.createElement('style');
  styleOverride.textContent = `
    .pdf-brand-header-scope .silk-wave-bg-container {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      z-index: 0 !important;
      contain: none !important;
      transform: none !important;
    }
    .pdf-brand-header-scope .silk-wave-svg {
      transform: scale(1.04) !important;
    }
    .pdf-brand-header-scope .safara-brand-container {
      transform: none !important;
    }
  `;

  const headerCard = document.createElement('div');
  headerCard.className = 'pdf-brand-header-scope';
  headerCard.setAttribute('dir', 'rtl');
  headerCard.style.cssText = `
    position: relative;
    width: ${logicalWidth}px;
    height: ${height}px;
    overflow: hidden;
    background: #002DB3;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    box-sizing: border-box;
  `;

  const bgMount = document.createElement('div');
  bgMount.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;';

  const scrim = document.createElement('div');
  scrim.style.cssText =
    'position:absolute;inset:0;z-index:1;pointer-events:none;background:linear-gradient(90deg,rgba(0,14,66,0.34) 0%,rgba(0,22,94,0.10) 45%,rgba(0,14,66,0.22) 100%);';

  const row = document.createElement('div');
  row.style.cssText = `
    position: relative;
    z-index: 2;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: ${compact ? '8px 34px' : '12px 38px'};
    gap: 24px;
    box-sizing: border-box;
  `;

  const logoSlot = document.createElement('div');
  logoSlot.style.cssText = 'display:flex;align-items:center;flex-shrink:0;';

  const titleSlot = document.createElement('div');
  titleSlot.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
    gap: ${compact ? '2px' : '4px'};
    font-family: 'Cairo', 'Tajawal', sans-serif;
    text-align: left;
    min-width: 0;
  `;
  titleSlot.innerHTML = compact
    ? `<div style="display:flex;align-items:center;gap:10px;white-space:nowrap;">
         <span style="font-size:15px;font-weight:800;color:#FFFFFF;text-shadow:0 1px 6px rgba(0,10,40,0.6);">${escapeHtml(meta.title)}</span>
         <span style="color:rgba(253,230,138,0.65);font-size:12px;">·</span>
         <span style="font-size:12px;font-weight:600;color:#FDE68A;">${escapeHtml(meta.subtitle)}</span>
       </div>`
    : `<div style="font-size:20px;font-weight:800;color:#FFFFFF;line-height:1.25;white-space:nowrap;text-shadow:0 2px 10px rgba(0,10,40,0.65);">${escapeHtml(meta.title)}</div>
       <div style="font-size:12.5px;font-weight:600;color:#FDE68A;line-height:1.3;white-space:nowrap;letter-spacing:0.2px;">${escapeHtml(meta.subtitle)}</div>`;

  const goldRule = document.createElement('div');
  goldRule.style.cssText = `
    position: relative;
    z-index: 3;
    height: 3px;
    width: 100%;
    flex-shrink: 0;
    background: linear-gradient(90deg, rgba(212,175,55,0.25) 0%, #D4AF37 20%, #FEF08A 50%, #D4AF37 80%, rgba(212,175,55,0.25) 100%);
  `;

  row.appendChild(logoSlot);
  row.appendChild(titleSlot);
  headerCard.appendChild(bgMount);
  headerCard.appendChild(scrim);
  headerCard.appendChild(row);
  headerCard.appendChild(goldRule);
  host.appendChild(styleOverride);
  host.appendChild(headerCard);
  document.body.appendChild(host);

  const bgRoot = createRoot(bgMount);
  const logoRoot = createRoot(logoSlot);

  try {
    flushSync(() => {
      bgRoot.render(createElement(SilkWaveBackground));
      logoRoot.render(
        createElement(SafaraLogo, {
          size: compact ? 'sm' : 'md',
          showTagline: false,
          showBadge: false,
          interactive: false,
        })
      );
    });

    deduplicateSvgIds(headerCard, compact ? 'pdf-hdr-c' : 'pdf-hdr-f');

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    return await captureElementCanvas(headerCard, logicalWidth, height, scale, '#002DB3');
  } finally {
    logoRoot.unmount();
    bgRoot.unmount();
    host.remove();
  }
}

async function renderBrandedFooterCanvas(
  meta: ExportDocumentMeta,
  logicalWidth: number,
  scale: number,
  pageNumber?: number,
  totalPages?: number
): Promise<HTMLCanvasElement> {
  const height = 46;
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-24000px';
  host.style.top = '0';
  host.style.width = `${logicalWidth}px`;
  host.style.height = `${height}px`;
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-1';
  host.setAttribute('dir', 'rtl');

  const hasMultiPage = Boolean(pageNumber && totalPages && totalPages > 1);
  const leftLabel = hasMultiPage
    ? `صفحة ${toArabicDigits(pageNumber!)} من ${toArabicDigits(totalPages!)}  ·  ${meta.dateLabel}`
    : meta.dateLabel;

  host.innerHTML = `
    <div dir="rtl" style="width:${logicalWidth}px;height:${height}px;background:${ARCHIVAL_PAPER_BG};display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;font-family:'Cairo','Tajawal',sans-serif;">
      <div style="position:relative;height:1px;margin:0 36px;background:linear-gradient(90deg,rgba(0,45,179,0.04) 0%,rgba(0,45,179,0.22) 28%,rgba(201,162,39,0.52) 50%,rgba(0,45,179,0.22) 72%,rgba(0,45,179,0.04) 100%);display:flex;align-items:center;justify-content:center;">
        <span style="background:${ARCHIVAL_PAPER_BG};padding:0 10px;color:#C9A227;font-size:10px;line-height:1;">✦</span>
      </div>
      <div style="flex:1;display:flex;align-items:center;justify-content:space-between;padding:0 38px 4px;font-size:11px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <svg viewBox="0 0 96 70" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:18px;height:13px;flex-shrink:0;">
            <path d="M 48 13 C 33 5, 17 8, 7 14 C 4 15.5, 3 18.5, 3 22 L 3 56 C 3 59.5, 6 61.5, 9 60 C 19 55, 33 53.5, 48 58.5 C 63 53.5, 77 55, 87 60 C 90 61.5, 93 59.5, 93 56 L 93 22 C 93 18.5, 92 15.5, 89 14 C 79 8, 63 5, 48 13 Z" stroke="#002DB3" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" fill="rgba(0,45,179,0.06)"/>
            <path d="M 48 13 L 48 58.5" stroke="#C9A227" stroke-width="6" stroke-linecap="round"/>
          </svg>
          <span style="font-weight:800;color:#0B1F5E;">مَعَ السَّفَرَة</span>
          <span style="color:#C9A227;font-weight:700;">·</span>
          <span style="color:#64748B;font-weight:600;">مَنَصَّةُ إِتْقَانِ التِّلَاوَةِ وَالْقُرْآنِ الْكَرِيم</span>
        </div>
        <span style="color:#64748B;font-size:10.5px;font-weight:600;">${escapeHtml(leftLabel)}</span>
      </div>
    </div>
  `;

  document.body.appendChild(host);
  try {
    const inner = (host.firstElementChild as HTMLElement) || host;
    return await captureElementCanvas(inner, logicalWidth, height, scale, ARCHIVAL_PAPER_BG);
  } finally {
    host.remove();
  }
}

function drawGoldDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string
): void {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawManuscriptBorderFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  topOffset: number,
  bottomOffset: number,
  scale: number
): void {
  const insetOuter = Math.round(12 * scale);
  const insetInner = Math.round(17 * scale);
  const topY = topOffset + insetOuter;
  const botY = h - bottomOffset - insetOuter;
  if (botY - topY < 48) return;

  ctx.save();
  ctx.strokeStyle = 'rgba(0, 45, 179, 0.14)';
  ctx.lineWidth = Math.max(1, 1.1 * scale);
  ctx.strokeRect(insetOuter, topY, w - insetOuter * 2, botY - topY);

  const innerTop = topOffset + insetInner;
  const innerBot = h - bottomOffset - insetInner;
  const innerLeft = insetInner;
  const innerRight = w - insetInner;

  ctx.strokeStyle = 'rgba(201, 162, 39, 0.38)';
  ctx.lineWidth = Math.max(1, 0.9 * scale);
  ctx.strokeRect(innerLeft, innerTop, innerRight - innerLeft, innerBot - innerTop);
  ctx.restore();

  const dRadius = 3.2 * scale;
  const dFill = 'rgba(201, 162, 39, 0.72)';
  drawGoldDiamond(ctx, innerLeft, innerTop, dRadius, dFill);
  drawGoldDiamond(ctx, innerRight, innerTop, dRadius, dFill);
  drawGoldDiamond(ctx, innerLeft, innerBot, dRadius, dFill);
  drawGoldDiamond(ctx, innerRight, innerBot, dRadius, dFill);
}

function paintSilkBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const baseGrad = ctx.createLinearGradient(0, 0, w, h);
  baseGrad.addColorStop(0, '#001A75');
  baseGrad.addColorStop(0.45, '#002DB3');
  baseGrad.addColorStop(1, '#00155E');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, w, h);

  const sheen1 = ctx.createRadialGradient(w * 0.25, h * 0.2, 0, w * 0.25, h * 0.2, Math.max(w, h) * 0.65);
  sheen1.addColorStop(0, 'rgba(59, 133, 255, 0.42)');
  sheen1.addColorStop(1, 'rgba(0, 45, 179, 0)');
  ctx.fillStyle = sheen1;
  ctx.fillRect(0, 0, w, h);

  const sheen2 = ctx.createRadialGradient(w * 0.78, h * 0.75, 0, w * 0.78, h * 0.75, Math.max(w, h) * 0.6);
  sheen2.addColorStop(0, 'rgba(30, 107, 255, 0.28)');
  sheen2.addColorStop(1, 'rgba(0, 20, 102, 0)');
  ctx.fillStyle = sheen2;
  ctx.fillRect(0, 0, w, h);
}

async function buildAnnotatedPageComposite(target: PdfExportTarget): Promise<{
  canvas: HTMLCanvasElement;
  bgHex: string;
}> {
  const pageEl = target.pageElement;
  const overlayEl = target.overlayElement ?? pageEl;
  const bgHex =
    target.backgroundHex && target.backgroundHex !== 'transparent'
      ? target.backgroundHex
      : target.isBounded
      ? '#FCF8EE'
      : '#002DB3';

  if (pageEl) {
    const pageRect = pageEl.getBoundingClientRect();
    const overlayRect = overlayEl ? overlayEl.getBoundingClientRect() : pageRect;

    const pageW = Math.max(
      1,
      Math.round(target.isBounded ? pageRect.width : Math.max(pageEl.scrollWidth, pageRect.width))
    );
    const pageH = Math.max(
      1,
      Math.round(target.isBounded ? pageRect.height : Math.max(pageEl.scrollHeight, pageRect.height))
    );

    const overlayW = Math.max(1, target.isBounded ? overlayRect.width : pageW);
    const overlayH = Math.max(1, target.isBounded ? overlayRect.height : pageH);
    const overlayOffsetX = target.isBounded ? overlayRect.left - pageRect.left : 0;
    const overlayOffsetY = target.isBounded ? overlayRect.top - pageRect.top : 0;

    const captureScale = resolveCaptureScale(pageW, pageH);
    const domCanvas = await captureElementCanvas(
      pageEl,
      pageW,
      pageH,
      captureScale,
      target.isBounded ? bgHex : 'rgba(0, 0, 0, 0)',
      shouldIncludeDomNode
    );

    const composite = document.createElement('canvas');
    composite.width = Math.max(1, domCanvas.width);
    composite.height = Math.max(1, domCanvas.height);

    const compCtx = composite.getContext('2d');
    if (!compCtx) {
      throw new Error('Could not initialize 2D canvas context for PDF export.');
    }

    if (target.isBounded) {
      compCtx.fillStyle = bgHex;
      compCtx.fillRect(0, 0, composite.width, composite.height);
    } else {
      paintSilkBackdrop(compCtx, composite.width, composite.height);
    }
    compCtx.drawImage(domCanvas, 0, 0, composite.width, composite.height);

    const actualScaleX = composite.width / pageW;
    const actualScaleY = composite.height / pageH;
    const drawX = overlayOffsetX * actualScaleX;
    const drawY = overlayOffsetY * actualScaleY;
    const overlayPxW = Math.max(1, Math.round(overlayW * actualScaleX));
    const overlayPxH = Math.max(1, Math.round(overlayH * actualScaleY));

    const strokes = target.strokes;
    if (strokes.length > 0) {
      const tf: RenderTransform = target.isBounded
        ? {
            scaleX: overlayW / 1000,
            scaleY: overlayH / 1000,
            offsetX: 0,
            offsetY: 0,
            unitScale: Math.max(0.55, Math.min(1.65, overlayW / 920)),
          }
        : {
            scaleX: 1,
            scaleY: 1,
            offsetX: 0,
            offsetY: 0,
            unitScale: 1,
          };

      const hasHl = strokes.some((s) => s.kind === 'highlighter');
      const hasPen = strokes.some((s) => s.kind !== 'highlighter');

      if (hasHl) {
        const hlCanvas = document.createElement('canvas');
        hlCanvas.width = overlayPxW;
        hlCanvas.height = overlayPxH;
        const hlCtx = hlCanvas.getContext('2d');
        const scratchCanvas = document.createElement('canvas');
        if (hlCtx) {
          for (let i = 0; i < strokes.length; i++) {
            const st = strokes[i];
            if (st.kind === 'highlighter') {
              drawAppleHighlighterStroke(
                hlCtx,
                scratchCanvas,
                st,
                tf,
                actualScaleX,
                actualScaleY,
                false
              );
            }
          }
          compCtx.save();
          compCtx.globalCompositeOperation = 'multiply';
          compCtx.drawImage(hlCanvas, drawX, drawY, overlayPxW, overlayPxH);
          compCtx.restore();
        }
      }

      if (hasPen) {
        const penCanvas = document.createElement('canvas');
        penCanvas.width = overlayPxW;
        penCanvas.height = overlayPxH;
        const penCtx = penCanvas.getContext('2d');
        if (penCtx) {
          penCtx.save();
          penCtx.scale(actualScaleX, actualScaleY);
          for (let i = 0; i < strokes.length; i++) {
            const st = strokes[i];
            if (st.kind !== 'highlighter') {
              drawApplePenStroke(penCtx, st, tf, false);
            }
          }
          penCtx.restore();
          compCtx.drawImage(penCanvas, drawX, drawY, overlayPxW, overlayPxH);
        }
      }
    } else if (
      target.fallbackPenCanvas &&
      target.fallbackPenCanvas.width > 0 &&
      target.fallbackPenCanvas.height > 0
    ) {
      if (
        target.fallbackHlCanvas &&
        target.fallbackHlCanvas.width > 0 &&
        target.fallbackHlCanvas.height > 0
      ) {
        compCtx.save();
        compCtx.globalCompositeOperation = 'multiply';
        compCtx.drawImage(target.fallbackHlCanvas, drawX, drawY, overlayPxW, overlayPxH);
        compCtx.restore();
      }
      compCtx.drawImage(target.fallbackPenCanvas, drawX, drawY, overlayPxW, overlayPxH);
    }

    // For non-Mushaf pages anchored to `.app`, crop out the redundant top `#main-header`
    // after strokes have been aligned & composited so the branded PDF header isn't duplicated.
    if (!target.isBounded) {
      const appHeader = document.getElementById('main-header');
      if (appHeader) {
        const headerRect = appHeader.getBoundingClientRect();
        if (headerRect.height > 8 && headerRect.top >= pageRect.top - 4) {
          const cropTopPx = Math.round((headerRect.bottom - pageRect.top + 6) * actualScaleY);
          if (cropTopPx > 0 && cropTopPx < composite.height - 120) {
            const cropped = document.createElement('canvas');
            cropped.width = composite.width;
            cropped.height = composite.height - cropTopPx;
            const cCtx = cropped.getContext('2d');
            if (cCtx) {
              cCtx.drawImage(
                composite,
                0,
                cropTopPx,
                composite.width,
                cropped.height,
                0,
                0,
                cropped.width,
                cropped.height
              );
              return { canvas: cropped, bgHex };
            }
          }
        }
      }
    }

    return { canvas: composite, bgHex };
  }

  if (
    target.fallbackPenCanvas &&
    target.fallbackPenCanvas.width > 0 &&
    target.fallbackPenCanvas.height > 0
  ) {
    const composite = document.createElement('canvas');
    composite.width = target.fallbackPenCanvas.width;
    composite.height = target.fallbackPenCanvas.height;
    const ctx = composite.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D canvas context.');
    }
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, composite.width, composite.height);
    if (
      target.fallbackHlCanvas &&
      target.fallbackHlCanvas.width > 0 &&
      target.fallbackHlCanvas.height > 0
    ) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(target.fallbackHlCanvas, 0, 0, composite.width, composite.height);
      ctx.restore();
    }
    ctx.drawImage(target.fallbackPenCanvas, 0, 0, composite.width, composite.height);
    return { canvas: composite, bgHex };
  }

  throw new Error('No printable surface available.');
}

function drawRoundedShadowedCard(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  radius: number,
  isBounded: boolean
): void {
  ctx.save();
  ctx.shadowColor = isBounded ? 'rgba(11, 31, 94, 0.10)' : 'rgba(0, 20, 80, 0.18)';
  ctx.shadowBlur = Math.max(8, radius * 1.8);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(3, radius * 0.5);
  ctx.fillStyle = isBounded ? '#FCF8EE' : '#002DB3';
  ctx.beginPath();
  ctx.roundRect(dx, dy, dw, dh, radius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(dx, dy, dw, dh, radius);
  ctx.clip();
  ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = isBounded ? 'rgba(201, 162, 39, 0.28)' : 'rgba(0, 45, 179, 0.22)';
  ctx.lineWidth = Math.max(1, radius * 0.11);
  ctx.beginPath();
  ctx.roundRect(dx, dy, dw, dh, radius);
  ctx.stroke();
  ctx.restore();
}

export async function exportSurfaceToPdf(target: PdfExportTarget): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('PDF export requires a browser environment.');
  }

  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Proceed even if a remote font failed to load
    }
  }

  const meta = extractDocumentMeta(target.surfaceId, target.pageElement);
  const { canvas: contentCanvas } = await buildAnnotatedPageComposite(target);

  const cw = contentCanvas.width;
  const ch = contentCanvas.height;
  const contentAspect = ch / Math.max(1, cw);

  const pdfWidthPt = 595.28; // Standard A4 width in points
  const a4HeightPt = 841.89;
  const logicalSheetW = 1000;
  const brandScale = 2;
  const sheetPxW = logicalSheetW * brandScale;
  const padX = Math.round(36 * brandScale);
  const padY = Math.round(24 * brandScale);
  const frameRadius = Math.round((target.isBounded ? 8 : 12) * brandScale);

  let pdf: jsPDF;

  if (contentAspect <= 1.75) {
    const headerCanvas = await renderBrandedHeaderCanvas(meta, logicalSheetW, brandScale, false);
    const footerCanvas = await renderBrandedFooterCanvas(meta, logicalSheetW, brandScale);

    const drawW = sheetPxW - padX * 2;
    const drawH = Math.max(1, Math.round(drawW * contentAspect));
    const sheetPxH = headerCanvas.height + padY + drawH + padY + footerCanvas.height;

    const sheet = document.createElement('canvas');
    sheet.width = sheetPxW;
    sheet.height = sheetPxH;
    const ctx = sheet.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize branded PDF sheet context.');
    }

    ctx.fillStyle = ARCHIVAL_PAPER_BG;
    ctx.fillRect(0, 0, sheetPxW, sheetPxH);

    ctx.drawImage(headerCanvas, 0, 0, sheetPxW, headerCanvas.height);

    drawManuscriptBorderFrame(
      ctx,
      sheetPxW,
      sheetPxH,
      headerCanvas.height,
      footerCanvas.height,
      brandScale
    );

    drawRoundedShadowedCard(
      ctx,
      contentCanvas,
      0,
      0,
      cw,
      ch,
      padX,
      headerCanvas.height + padY,
      drawW,
      drawH,
      frameRadius,
      target.isBounded
    );

    ctx.drawImage(
      footerCanvas,
      0,
      sheetPxH - footerCanvas.height,
      sheetPxW,
      footerCanvas.height
    );

    const pdfHeightPt = Math.max(200, Math.round(pdfWidthPt * (sheetPxH / sheetPxW) * 100) / 100);
    pdf = new jsPDF({
      orientation: pdfWidthPt > pdfHeightPt ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [pdfWidthPt, pdfHeightPt],
      compress: true,
    });

    const imgData = sheet.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidthPt, pdfHeightPt, undefined, 'FAST');
  } else {
    const a4PxH = Math.round(sheetPxW * (a4HeightPt / pdfWidthPt));
    const fullHeader = await renderBrandedHeaderCanvas(meta, logicalSheetW, brandScale, false);
    const compactHeader = await renderBrandedHeaderCanvas(meta, logicalSheetW, brandScale, true);
    const sampleFooter = await renderBrandedFooterCanvas(meta, logicalSheetW, brandScale, 1, 2);

    const drawW = sheetPxW - padX * 2;
    const scaleToSheet = drawW / Math.max(1, cw);

    const page1BodyCapPx = Math.max(
      200,
      a4PxH - fullHeader.height - sampleFooter.height - padY * 2
    );
    const nextBodyCapPx = Math.max(
      200,
      a4PxH - compactHeader.height - sampleFooter.height - padY * 2
    );

    const page1SrcSlice = Math.min(ch, Math.max(1, Math.floor(page1BodyCapPx / scaleToSheet)));
    const nextSrcSlice = Math.max(1, Math.floor(nextBodyCapPx / scaleToSheet));

    const slices: Array<{ sy: number; sh: number }> = [{ sy: 0, sh: page1SrcSlice }];
    let cursorY = page1SrcSlice;
    while (cursorY < ch) {
      const sh = Math.min(nextSrcSlice, ch - cursorY);
      slices.push({ sy: cursorY, sh });
      cursorY += sh;
    }

    pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: [pdfWidthPt, a4HeightPt],
      compress: true,
    });

    const totalPages = slices.length;
    for (let i = 0; i < totalPages; i++) {
      if (i > 0) {
        pdf.addPage([pdfWidthPt, a4HeightPt], 'portrait');
      }
      const header = i === 0 ? fullHeader : compactHeader;
      const footer = await renderBrandedFooterCanvas(
        meta,
        logicalSheetW,
        brandScale,
        i + 1,
        totalPages
      );

      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = sheetPxW;
      pageCanvas.height = a4PxH;
      const ctx = pageCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not initialize multi-page PDF canvas.');
      }

      ctx.fillStyle = ARCHIVAL_PAPER_BG;
      ctx.fillRect(0, 0, sheetPxW, a4PxH);
      ctx.drawImage(header, 0, 0, sheetPxW, header.height);

      drawManuscriptBorderFrame(
        ctx,
        sheetPxW,
        a4PxH,
        header.height,
        footer.height,
        brandScale
      );

      const slice = slices[i];
      const destH = Math.max(1, Math.round(slice.sh * scaleToSheet));
      drawRoundedShadowedCard(
        ctx,
        contentCanvas,
        0,
        slice.sy,
        cw,
        slice.sh,
        padX,
        header.height + padY,
        drawW,
        destH,
        frameRadius,
        target.isBounded
      );

      ctx.drawImage(footer, 0, a4PxH - footer.height, sheetPxW, footer.height);

      const imgData = pageCanvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidthPt, a4HeightPt, undefined, 'FAST');
    }
  }

  const filename = buildPdfFilename(target.surfaceId);
  pdf.save(filename);
  return filename;
}
