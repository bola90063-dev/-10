import React from 'react';

/**
 * SilkWaveBackground Component
 * Renders the exact Royal Cobalt Blue Silk / Satin liquid fabric wave texture
 * matching the user's reference image with undulating draped wave highlights & shadows.
 */
export const SilkWaveBackground: React.FC = () => {
  return (
    <div className="silk-wave-bg-container" aria-hidden="true">
      {/* Dynamic Silk Wave Mesh SVG */}
      <svg
        className="silk-wave-svg"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Base Silk Radial Shading */}
          <radialGradient id="silk-spot-1" cx="30%" cy="25%" r="65%">
            <stop offset="0%" stopColor="#1E6BFF" stopOpacity="0.8" />
            <stop offset="45%" stopColor="#0047FF" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#001F8A" stopOpacity="1" />
          </radialGradient>

          <radialGradient id="silk-spot-2" cx="75%" cy="65%" r="70%">
            <stop offset="0%" stopColor="#2977FF" stopOpacity="0.75" />
            <stop offset="50%" stopColor="#003EE0" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#001466" stopOpacity="1" />
          </radialGradient>

          {/* Smooth Linear Wave Gradients */}
          <linearGradient id="wave-fold-1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#001254" stopOpacity="0.7" />
            <stop offset="35%" stopColor="#003CE0" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#4A8DFF" stopOpacity="0.65" />
            <stop offset="68%" stopColor="#002DB3" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#000E42" stopOpacity="0.8" />
          </linearGradient>

          <linearGradient id="wave-fold-2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#5CA0FF" stopOpacity="0.6" />
            <stop offset="25%" stopColor="#0047FF" stopOpacity="0.4" />
            <stop offset="55%" stopColor="#001A7A" stopOpacity="0.85" />
            <stop offset="75%" stopColor="#0038D6" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#458CFF" stopOpacity="0.5" />
          </linearGradient>

          <linearGradient id="wave-sheen" x1="20%" y1="0%" x2="80%" y2="100%">
            <stop offset="0%" stopColor="#70B0FF" stopOpacity="0.45" />
            <stop offset="50%" stopColor="#0047FF" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#001878" stopOpacity="0.7" />
          </linearGradient>

          <filter id="silk-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="35" result="blur" />
          </filter>
        </defs>

        {/* Base Solid Royal Blue */}
        <rect width="100%" height="100%" fill="#0035D1" />
        <rect width="100%" height="100%" fill="url(#silk-spot-1)" />
        <rect width="100%" height="100%" fill="url(#silk-spot-2)" />

        {/* Diagonal & Curved Silk Ripple Folds (Matching Fabric Drape in Image) */}
        <g filter="url(#silk-blur)" opacity="0.95">
          {/* Main Diagonal Drape Wave */}
          <path
            d="M-200,-100 C300,150 200,450 700,500 C1100,540 1200,300 1600,600 L1600,1100 L-200,1100 Z"
            fill="url(#wave-fold-1)"
          />

          {/* Upper Swirling Silk Fold */}
          <path
            d="M-100,400 C400,200 650,550 1100,250 C1350,80 1500,200 1650,-50 L1650,-200 L-100,-200 Z"
            fill="url(#wave-fold-2)"
          />

          {/* Secondary Liquid Ripple */}
          <path
            d="M200,-100 C500,350 450,700 950,750 C1350,790 1400,500 1700,900 L1700,1100 L200,1100 Z"
            fill="url(#wave-sheen)"
            opacity="0.7"
          />

          {/* Center Light Highlights */}
          <ellipse
            cx="650"
            cy="380"
            rx="520"
            ry="260"
            transform="rotate(-25 650 380)"
            fill="#3B85FF"
            opacity="0.45"
          />

          {/* Deep Silk Crease 1 */}
          <path
            d="M-150,150 Q450,550 850,300 T1600,750"
            stroke="#000E4A"
            strokeWidth="140"
            fill="none"
            opacity="0.7"
          />

          {/* Radiant Silky Sheen Ridge */}
          <path
            d="M-50,50 Q550,450 950,200 T1650,650"
            stroke="#6BB0FF"
            strokeWidth="70"
            fill="none"
            opacity="0.5"
          />
        </g>
      </svg>

      {/* CSS Ambient Light Shimmer Overlay */}
      <div className="silk-sheen-overlay"></div>
    </div>
  );
};
