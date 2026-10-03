/**
 * Screen Wake Lock and Haptic Vibration helpers for Mobile Controllers
 */

let wakeLockSentinel = null;

export async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      console.log('[WakeLock] Screen wake lock acquired');
      wakeLockSentinel.addEventListener('release', () => {
        console.log('[WakeLock] Screen wake lock released');
        wakeLockSentinel = null;
      });
      // Re-acquire on visibility change
      document.addEventListener('visibilitychange', async () => {
        if (wakeLockSentinel === null && document.visibilityState === 'visible') {
          try {
            wakeLockSentinel = await navigator.wakeLock.request('screen');
          } catch (e) {}
        }
      });
    } catch (err) {
      console.warn('[WakeLock] Could not acquire wake lock:', err.message);
    }
  }
}

export function releaseWakeLock() {
  if (wakeLockSentinel) {
    wakeLockSentinel.release();
    wakeLockSentinel = null;
  }
}

export function vibrate(pattern = [50]) {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {}
  }
}
