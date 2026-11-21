import React, { useState } from 'react';

interface SafaraLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  taglineText?: string;
  showBadge?: boolean;
  interactive?: boolean;
}

/**
 * SafaraLogo - الشعار الرسمي المتكامل لمنصة "مَعَ السَّفَرَة"
 * مبني بالكامل على طراز الخط الكوفي الحديث الفاخر (Modern Neo-Kufic Architecture):
 * 1. حروف عربية حقيقية صلبة وواضحة (Zain / Kufam Display 900) بلون أبيض ناصع.
 * 2. تاج الشدة والفتحة الهندسية المذهبة المستقرة بدقة فوق أسنان السين.
 * 3. حركات تشكيل مسطحة (Matte Gold) موزعة بنسب بصرية متناسقة فوق رؤوس الحروف.
 * 4. أيقونة المصحف الشريف الكوفية باللون الأبيض النقي.
 */
export const SafaraLogo: React.FC<SafaraLogoProps> = ({
  className = '',
  size = 'md',
  showTagline = false,
  taglineText = 'مَنَصَّةُ إِتْقَانِ التِّلَاوَةِ وَالْقُرْآنِ الْكَرِيم',
  showBadge = false,
  interactive = true,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={`safara-brand-container size-${size} ${interactive ? 'is-interactive' : ''} ${className}`}
      id="safara-header-brand-logo"
      title="منصة مَعَ السَّفَرَة التعليمية"
      dir="rtl"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="safara-brand-inner">
        {/* 1. Kufic Open Book Vector Icon in Pure, Minimalist White */}
        <div className="safara-book-symbol" aria-hidden="true">
          <svg
            viewBox="0 0 96 70"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="safara-book-svg-element"
          >
            {/* Outer Book Geometry */}
            <path
              d="M 48 13 
                 C 33 5, 17 8, 7 14 
                 C 4 15.5, 3 18.5, 3 22 
                 L 3 56 
                 C 3 59.5, 6 61.5, 9 60 
                 C 19 55, 33 53.5, 48 58.5 
                 C 63 53.5, 77 55, 87 60 
                 C 90 61.5, 93 59.5, 93 56 
                 L 93 22 
                 C 93 18.5, 92 15.5, 89 14 
                 C 79 8, 63 5, 48 13 Z"
              stroke="#FFFFFF"
              strokeWidth="4.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="rgba(255, 255, 255, 0.08)"
            />
            {/* Book Spine */}
            <path
              d="M 48 13 L 48 58.5"
              stroke="#FFFFFF"
              strokeWidth="4.2"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* 2. Arabic Brand Words */}
        <div className="safara-brand-column">
          <div className="safara-brand-words" aria-label="مَعَ السَّفَرَة">
            {/* Word 1: مَعَ */}
            <div className="safara-word-unit word-unit-maa">
              <span className="safara-main-letters">مـع</span>
              
              {/* Fatha over Meem (مَ) */}
              <div className="safara-gold-mark fatha-meem-mark" aria-hidden="true">
                <svg viewBox="0 0 20 8" fill="none" className="mark-fatha-svg">
                  <rect x="1" y="1" width="18" height="5" rx="2.5" fill="#F59E0B" transform="rotate(-15 10 4)" />
                </svg>
              </div>

              {/* Fatha over Ain (عَ) */}
              <div className="safara-gold-mark fatha-ain-mark" aria-hidden="true">
                <svg viewBox="0 0 20 8" fill="none" className="mark-fatha-svg">
                  <rect x="1" y="1" width="18" height="5" rx="2.5" fill="#F59E0B" transform="rotate(-15 10 4)" />
                </svg>
              </div>
            </div>

            {/* Word 2: السَّفَرَة */}
            <div className="safara-word-unit word-unit-safara">
              <span className="safara-main-letters">السفرة</span>

              {/* Signature Crown Shaddah + Fatha over Seen (سَّ) */}
              <div className="safara-gold-mark crown-shaddah-mark" aria-hidden="true">
                <svg viewBox="0 0 28 20" fill="none" className="mark-crown-svg">
                  <g transform="rotate(-15 14 10)">
                    {/* Top Slanted Bar (Fatha) */}
                    <rect x="2" y="1" width="24" height="4" rx="2" fill="#F59E0B" />
                    {/* 3-Tooth Crisp Shaddah Body */}
                    <path
                      d="M 4 9.5 
                         C 4 6, 7.5 6, 9.5 9.5 
                         C 11.5 6, 16.5 6, 18.5 9.5 
                         C 20.5 6, 24 6, 24 9.5 
                         C 24 14.5, 21 16.5, 18.5 16.5 
                         C 16 16.5, 14.5 15, 14 13.5 
                         C 13.5 15, 12 16.5, 9.5 16.5 
                         C 7 16.5, 4 14.5, 4 9.5 Z"
                      fill="#F59E0B"
                    />
                  </g>
                </svg>
              </div>

              {/* Fatha over Fa (فَ) */}
              <div className="safara-gold-mark fatha-fa-mark" aria-hidden="true">
                <svg viewBox="0 0 20 8" fill="none" className="mark-fatha-svg">
                  <rect x="1" y="1" width="18" height="5" rx="2.5" fill="#F59E0B" transform="rotate(-15 10 4)" />
                </svg>
              </div>

              {/* Fatha over Ra (رَ) */}
              <div className="safara-gold-mark fatha-ra-mark" aria-hidden="true">
                <svg viewBox="0 0 20 8" fill="none" className="mark-fatha-svg">
                  <rect x="1" y="1" width="18" height="5" rx="2.5" fill="#F59E0B" transform="rotate(-15 10 4)" />
                </svg>
              </div>
            </div>

            {/* Optional Verified Quality Badge */}
            {showBadge && (
              <span className="safara-brand-badge" title="الإصدار الرسمي المعتمد">
                الْمُعْتَمَدَة
              </span>
            )}
          </div>

          {/* 3. Sub-brand Tagline (if enabled) */}
          {showTagline && (
            <div className="safara-brand-tagline" aria-hidden="true">
              <span className="tagline-bullet">✦</span>
              <span className="tagline-text">{taglineText}</span>
              <span className="tagline-bullet">✦</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const SafaraTypographyLogo = SafaraLogo;
export const TalaqaTypographyLogo = SafaraLogo;
export default SafaraLogo;
