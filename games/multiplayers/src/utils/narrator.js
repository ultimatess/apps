import { isMuted } from './audio.js';

/** Optional spoken narration on the host screen (Web Speech API). Silently no-ops if unsupported. */
export function narrate(text, { rate = 0.95, pitch = 0.9 } = {}) {
  if (isMuted() || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = pitch;
    window.speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

export function stopNarration() {
  try { window.speechSynthesis?.cancel(); } catch (e) { /* ignore */ }
}
