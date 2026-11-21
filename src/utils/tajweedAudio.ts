/**
 * Tajweed Articulatory & Acoustic Audio Synthesizer
 * Generates authentic phonetics for Arabic Lathawiya letters (ث, ذ, ظ)
 * Synchronized with articulatory mouth & tongue movements.
 */

// AudioContext singleton
let audioCtxInstance: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtxInstance) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      audioCtxInstance = new AudioCtx();
    }
  }
  if (audioCtxInstance && audioCtxInstance.state === 'suspended') {
    audioCtxInstance.resume();
  }
  return audioCtxInstance;
}

export interface PronunciationConfig {
  letter: 'ث' | 'ذ' | 'ظ';
  name: string;
  phonemeExample: string;
  description: string;
  characteristics: string[];
  isVoiced: boolean; // جهر (ذ، ظ) vs همس (ث)
  isElevated: boolean; // استعلاء وإطباق (ظ) vs استفال (ث، ذ)
  durationMs: number;
}

export const LATHAWIYA_DETAILS: Record<'ث' | 'ذ' | 'ظ', PronunciationConfig> = {
  'ث': {
    letter: 'ث',
    name: 'ثاء',
    phonemeExample: 'إِثْ',
    description: 'حرف لثوي مهموس رخو ومستفل',
    characteristics: ['همس (جريان النفس)', 'رخاوة (جريان الصوت)', 'استفال وانفتاح (ترقيق)'],
    isVoiced: false,
    isElevated: false,
    durationMs: 1600,
  },
  'ذ': {
    letter: 'ذ',
    name: 'ذال',
    phonemeExample: 'إِذْ',
    description: 'حرف لثوي مجهور رخو ومستفل',
    characteristics: ['جهر (حبس النفس واهتزاز الأوتار)', 'رخاوة (جريان الصوت)', 'استفال وانفتاح (ترقيق)'],
    isVoiced: true,
    isElevated: false,
    durationMs: 1600,
  },
  'ظ': {
    letter: 'ظ',
    name: 'ظاء',
    phonemeExample: 'إِظْ',
    description: 'حرف لثوي مجهور رخو ومستعلٍ مطبق',
    characteristics: ['جهر (اهتزاز الأوتار)', 'رخاوة (جريان الصوت)', 'استعلاء وإطباق (تفخيم وتصعيد الصوت نحو الحنك)'],
    isVoiced: true,
    isElevated: true,
    durationMs: 1800,
  },
};

/**
 * Synthesizes pure acoustic phonetics for the selected Lathawiya letter
 * combining vocal fold vibration (for voiced /ð/, /ðˤ/) and dental slit turbulence.
 */
export function playArticulatoryPhoneme(letter: 'ث' | 'ذ' | 'ظ', onPhaseChange?: (phase: 'contact' | 'steady' | 'release' | 'done') => void): void {
  const ctx = getAudioContext();
  if (!ctx) {
    if (onPhaseChange) {
      setTimeout(() => onPhaseChange('contact'), 200);
      setTimeout(() => onPhaseChange('steady'), 500);
      setTimeout(() => onPhaseChange('release'), 1200);
      setTimeout(() => onPhaseChange('done'), 1600);
    }
    return;
  }

  const now = ctx.currentTime;
  const config = LATHAWIYA_DETAILS[letter];

  // Timing markers
  const attackTime = 0.22; // Reach dental contact
  const steadyDuration = letter === 'ظ' ? 0.85 : 0.75;
  const releaseTime = 0.35;
  const totalDuration = attackTime + steadyDuration + releaseTime;

  // Notify animation triggers
  if (onPhaseChange) {
    onPhaseChange('contact');
    setTimeout(() => onPhaseChange('steady'), attackTime * 1000);
    setTimeout(() => onPhaseChange('release'), (attackTime + steadyDuration) * 1000);
    setTimeout(() => onPhaseChange('done'), totalDuration * 1000);
  }

  // Master Gain Node
  const masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);
  masterGain.gain.setValueAtTime(0.001, now);
  masterGain.gain.linearRampToValueAtTime(0.21, now + 0.08);

  // 1. Initial Glottal Carrier "إِ" (Hamzat Wasl with Kasrah)
  const carrierOsc = ctx.createOscillator();
  const carrierGain = ctx.createGain();
  carrierOsc.type = 'sine';
  carrierOsc.frequency.setValueAtTime(220, now);
  carrierOsc.frequency.exponentialRampToValueAtTime(180, now + attackTime);
  
  carrierGain.gain.setValueAtTime(0.18, now);
  carrierGain.gain.exponentialRampToValueAtTime(0.001, now + attackTime);

  carrierOsc.connect(carrierGain);
  carrierGain.connect(masterGain);
  carrierOsc.start(now);
  carrierOsc.stop(now + attackTime + 0.05);

  // 2. Friction Generator (Dental Slit Noise)
  // Generates pinkish/bandpass dental friction for /θ/, /ð/, /ðˤ/
  const bufferSize = ctx.sampleRate * totalDuration;
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }

  const whiteNoise = ctx.createBufferSource();
  whiteNoise.buffer = noiseBuffer;

  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';

  // Specific frequencies based on articulation
  if (letter === 'ث') {
    // Crisp high dental whisper
    noiseFilter.frequency.setValueAtTime(4200, now);
    noiseFilter.Q.setValueAtTime(1.8, now);
  } else if (letter === 'ذ') {
    // Smoother dental friction
    noiseFilter.frequency.setValueAtTime(3200, now);
    noiseFilter.Q.setValueAtTime(2.2, now);
  } else {
    // ظ - Lowered acoustic resonance for Tafkheem (velarized cavity)
    noiseFilter.frequency.setValueAtTime(2400, now);
    noiseFilter.Q.setValueAtTime(2.8, now);
  }

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.001, now);
  noiseGain.gain.setValueAtTime(0.001, now + attackTime * 0.5);
  
  const fricativeLevel = letter === 'ث' ? 0.32 : 0.16;
  noiseGain.gain.linearRampToValueAtTime(fricativeLevel, now + attackTime);
  noiseGain.gain.setValueAtTime(fricativeLevel, now + attackTime + steadyDuration);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + totalDuration);

  whiteNoise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(masterGain);
  whiteNoise.start(now);
  whiteNoise.stop(now + totalDuration);

  // 3. Vocal Fold & Pharyngeal Resonance for Voiced Letters (ذ, ظ)
  if (config.isVoiced) {
    const f0 = letter === 'ظ' ? 128 : 142; // Deeper fundamental for Zhaa
    const voiceOsc = ctx.createOscillator();
    const subOsc = ctx.createOscillator();
    const voiceGain = ctx.createGain();

    voiceOsc.type = 'sawtooth';
    voiceOsc.frequency.setValueAtTime(f0, now);

    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(f0 * 0.5, now);

    // Formant filter bank
    const f1Filter = ctx.createBiquadFilter();
    f1Filter.type = 'bandpass';
    f1Filter.frequency.setValueAtTime(letter === 'ظ' ? 360 : 480, now);
    f1Filter.Q.setValueAtTime(3.5, now);

    const f2Filter = ctx.createBiquadFilter();
    f2Filter.type = 'bandpass';
    // Back vowel / velarization lowered F2 for Zhaa (Tafkheem)
    f2Filter.frequency.setValueAtTime(letter === 'ظ' ? 980 : 1750, now);
    f2Filter.Q.setValueAtTime(4.0, now);

    voiceGain.gain.setValueAtTime(0.001, now);
    voiceGain.gain.linearRampToValueAtTime(letter === 'ظ' ? 0.28 : 0.24, now + attackTime);
    voiceGain.gain.setValueAtTime(letter === 'ظ' ? 0.28 : 0.24, now + attackTime + steadyDuration);
    voiceGain.gain.exponentialRampToValueAtTime(0.001, now + totalDuration);

    voiceOsc.connect(f1Filter);
    voiceOsc.connect(f2Filter);
    subOsc.connect(f1Filter);

    f1Filter.connect(voiceGain);
    f2Filter.connect(voiceGain);
    voiceGain.connect(masterGain);

    voiceOsc.start(now + attackTime * 0.4);
    subOsc.start(now + attackTime * 0.4);
    voiceOsc.stop(now + totalDuration);
    subOsc.stop(now + totalDuration);
  }
}

/**
 * Spoken Arabic speech removed per user request
 */
export function speakTajweedLetter(_letter: 'ث' | 'ذ' | 'ظ', _mode: 'name' | 'makhraj' = 'makhraj'): void {
  // Speech pronunciation disabled
}

