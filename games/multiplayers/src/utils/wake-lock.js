/**
 * Screen Wake Lock and Haptic Vibration helpers for Mobile Controllers
 */

let wakeLockSentinel = null;
let wanted = false;
let visibilityHooked = false;

async function acquire() {
  if (!('wakeLock' in navigator) || wakeLockSentinel) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
    });
  } catch (err) {
    // Not fatal: low battery mode or no user gesture yet.
  }
}

export async function requestWakeLock() {
  wanted = true;
  if (!visibilityHooked && typeof document !== 'undefined') {
    visibilityHooked = true;
    // The browser drops the lock whenever the tab is hidden; take it back on return.
    document.addEventListener('visibilitychange', () => {
      if (wanted && document.visibilityState === 'visible') acquire();
    });
  }
  await acquire();
}

export function releaseWakeLock() {
  wanted = false;
  if (wakeLockSentinel) {
    wakeLockSentinel.release();
    wakeLockSentinel = null;
  }
}

export function vibrate(pattern = [50]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {}
  }
}
