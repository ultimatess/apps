// Browser sensor adapters (GPS + motion). All maths lives in telemetry.js.
const vec = (v) => (v && [v.x, v.y, v.z].every(Number.isFinite) ? [v.x, v.y, v.z] : null);

export function createSensors({ onFix, onMotion, onStatus, log = () => {} }) {
  let watchId = null;
  let motionOn = false;
  const status = { gps: "off", accuracy: null, motion: "off" };
  const update = (patch) => {
    Object.assign(status, patch);
    onStatus?.({ ...status });
  };

  function startGps() {
    if (!("geolocation" in navigator)) return update({ gps: "unavailable" });
    if (watchId !== null) return;
    update({ gps: "waiting" });
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        update({ gps: "ok", accuracy: Math.round(c.accuracy || 0) });
        onFix?.({
          latitude: c.latitude, longitude: c.longitude, speed: c.speed, heading: c.heading,
          accuracy: c.accuracy, timestamp: pos.timestamp || Date.now(),
        });
      },
      (err) => {
        log(`GPS: ${err.message}`, "error");
        update({ gps: err.code === 1 ? "denied" : "waiting" });
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
  }

  function handleMotion(e) {
    const r = e.rotationRate;
    onMotion?.({
      acc: vec(e.acceleration),
      accG: vec(e.accelerationIncludingGravity),
      rot: r && [r.alpha, r.beta, r.gamma].some(Number.isFinite) ? { alpha: r.alpha || 0, beta: r.beta || 0, gamma: r.gamma || 0 } : null,
      t: performance.now(),
    });
  }

  async function startMotion() {
    if (motionOn) return true;
    if (typeof DeviceMotionEvent === "undefined") {
      update({ motion: "unavailable" });
      return false;
    }
    try {
      // iOS 13+: both APIs need an explicit grant from a user gesture (v2 only asked for orientation).
      if (typeof DeviceMotionEvent.requestPermission === "function") {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== "granted") {
          update({ motion: "denied" });
          return false;
        }
      }
      if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        await DeviceOrientationEvent.requestPermission().catch(() => {});
      }
    } catch (e) {
      log(`Motion permission: ${e.message}`, "error");
      update({ motion: "denied" });
      return false;
    }
    window.addEventListener("devicemotion", handleMotion);
    motionOn = true;
    update({ motion: "ok" });
    return true;
  }

  function stop() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    window.removeEventListener("devicemotion", handleMotion);
    motionOn = false;
    update({ gps: "off", motion: "off", accuracy: null });
  }

  return { startGps, startMotion, stop, status, get active() { return watchId !== null || motionOn; } };
}
