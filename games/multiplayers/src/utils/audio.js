/**
 * Pure Web Audio API Synthesizer for Party Deck.
 * Zero external audio files required. Works across all modern browsers.
 */

let audioCtx = null;
let muted = (() => {
  try { return localStorage.getItem('np_muted') === '1'; } catch (e) { return false; }
})();

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = !!value;
  try { localStorage.setItem('np_muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
}

function getAudioContext() {
  if (muted) return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// User interaction unlocks audio on mobile browsers
export function initAudio() {
  getAudioContext();
}

/**
 * Clock ticking sound for countdown
 */
export function playTick(pitch = 800) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.5, ctx.currentTime + 0.04);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  } catch (e) {}
}

/**
 * Dramatic gong / suspense alert when an accusation is triggered
 */
export function playGong() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Sub-bass layer
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(120, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 1.2);

    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(180, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 1.0);

    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 1.5);
    osc2.stop(ctx.currentTime + 1.5);
  } catch (e) {}
}

/**
 * High-urgency alert buzzer
 */
export function playBuzzer() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.setValueAtTime(130, ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {}
}

/**
 * Bright chime for round start
 */
export function playRoundStart() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const notes = [440, 554.37, 659.25, 880]; // A major arpeggio
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startTime = ctx.currentTime + idx * 0.08;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.2, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.45);
    });
  } catch (e) {}
}

/**
 * Victory fanfare
 */
export function playVictory() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C major
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startTime = ctx.currentTime + idx * 0.12;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.25, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.7);
    });
  } catch (e) {}
}

function tone(ctx, { type = 'sine', from, to = from, start = 0, duration = 0.2, volume = 0.2 }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + start;
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Soft two-note blip when a player joins the room */
export function playJoin() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    tone(ctx, { from: 660, start: 0, duration: 0.12, volume: 0.12 });
    tone(ctx, { from: 990, start: 0.09, duration: 0.18, volume: 0.12 });
  } catch (e) {}
}

/** Bright "ding" for a correct answer */
export function playCorrect() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    tone(ctx, { type: 'triangle', from: 880, start: 0, duration: 0.15, volume: 0.2 });
    tone(ctx, { type: 'triangle', from: 1320, start: 0.1, duration: 0.3, volume: 0.2 });
  } catch (e) {}
}

/** Low "bonk" for a wrong answer / false start */
export function playWrong() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    tone(ctx, { type: 'square', from: 220, to: 110, duration: 0.3, volume: 0.12 });
  } catch (e) {}
}

/** Noise burst for crashes and explosions */
export function playExplosion() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    src.buffer = buffer;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  } catch (e) {}
}

/** Countdown beep: short for 3-2-1, long and high for GO */
export function playCountdown(isGo = false) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    tone(ctx, { type: 'square', from: isGo ? 1046 : 523, duration: isGo ? 0.45 : 0.15, volume: 0.12 });
  } catch (e) {}
}
