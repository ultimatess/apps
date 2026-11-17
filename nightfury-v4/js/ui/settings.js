// Settings sheet. Controls are declared in the markup with data-setting; this file
// keeps them in step with the store and applies side effects.
import { $, bindSeg, markSeg, toast } from "./dom.js";
import { kmhToMph } from "../telemetry.js";

export function mountSettings(ctx) {
  const { store, S, fb, bus, drive } = ctx;
  const dlg = $("settings");

  function sync() {
    dlg.querySelectorAll(".seg[data-setting]").forEach((seg) => markSeg(seg, S[seg.dataset.setting]));
    dlg.querySelectorAll("input.switch[data-setting]").forEach((sw) => { sw.checked = !!S[sw.dataset.setting]; });
    const mph = S.unit === "mph";
    $("limitInput").value = S.limitKmh ? Math.round(mph ? kmhToMph(S.limitKmh) : S.limitKmh) : "";
    $("limitUnit").textContent = mph ? "mph" : "km/h";
  }

  function applied(key) {
    if (key === "brakeSensitivity") drive.setSensitivity(S.brakeSensitivity);
    if (key === "invertTurns") drive.resetTurns();
    if (key === "nightDim" || key === "nightLevel") ctx.pushBrightness();
    if (key === "panelKeep") ctx.memory.applyKeep().then(() => bus.emit("memory"));
    bus.emit("settings", key);
  }

  $("settingsBtn").addEventListener("click", () => { fb.tap(); sync(); dlg.showModal(); });
  dlg.querySelectorAll(".seg[data-setting]").forEach((seg) => bindSeg(seg, (v) => {
    fb.tap();
    store.set({ [seg.dataset.setting]: seg.dataset.type === "number" ? Number(v) : v });
    applied(seg.dataset.setting);
    sync();
  }));
  dlg.querySelectorAll("input.switch[data-setting]").forEach((sw) => sw.addEventListener("change", () => {
    store.set({ [sw.dataset.setting]: sw.checked });
    applied(sw.dataset.setting);
  }));
  $("limitInput").addEventListener("change", (e) => {
    const v = Math.max(0, Math.min(250, parseInt(e.target.value, 10) || 0));
    store.set({ limitKmh: S.unit === "mph" ? Math.round(v / 0.621371) : v }); // stored in km/h
    sync();
  });
  $("resetSettingsBtn").addEventListener("click", () => {
    store.resetSettings();
    drive.setSensitivity(S.brakeSensitivity);
    sync();
    ctx.pushBrightness();
    ctx.memory.applyKeep().then(() => bus.emit("memory"));
    bus.emit("settings", "all");
    toast("Settings reset");
  });

  ctx.syncSettings = sync;
  sync();
  return null;
}
