// Small DOM helpers shared by the views. No framework.
export const $ = (id) => document.getElementById(id);

const SVG = "http://www.w3.org/2000/svg";

/** h("button", { class: "btn", onclick }, "Label") */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") Object.entries(v).forEach(([p, val]) => el.style.setProperty(p, val));
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== "list") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...kids.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

export function icon(name) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

/** Mark the button whose data-v equals `value` in a segmented control. */
export function markSeg(container, value) {
  container.querySelectorAll("button[data-v]").forEach((b) => {
    const on = b.dataset.v === String(value);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

/** Segmented control: calls fn(value) when a different button is tapped. */
export function bindSeg(container, fn) {
  container.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b || !container.contains(b)) return;
    markSeg(container, b.dataset.v);
    fn(b.dataset.v);
  });
}

/** Keep the filled part of a range input's track in step with its value. */
export function paintRange(input) {
  const min = Number(input.min || 0), max = Number(input.max || 100);
  input.style.setProperty("--fill", `${((Number(input.value) - min) / (max - min)) * 100}%`);
}

let toastTimer = null;
export function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2300);
}

/** Bottom sheet with arbitrary content. Returns a close() function. */
export function openSheet(title, content) {
  const dlg = $("sheet");
  $("sheetTitle").textContent = title;
  $("sheetContent").replaceChildren(...[content].flat());
  if (!dlg.open) dlg.showModal();
  return () => dlg.close();
}

/** Action menu: [{ label, icon, danger, run }]. Each action closes the sheet first. */
export function openMenu(title, actions) {
  const close = openSheet(title, h("div", { class: "menu" }, actions.filter(Boolean).map((a) => h("button", {
    class: a.danger ? "danger" : "",
    onclick: () => { close(); a.run(); },
  }, icon(a.icon ?? "chevron"), a.label))));
  return close;
}

export function bindSheet() {
  const dlg = $("sheet");
  $("sheetClose").addEventListener("click", () => dlg.close());
  // Tap on the backdrop closes any sheet.
  document.querySelectorAll("dialog.sheet").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
}

/** Sounds and haptics, both gated by settings. */
export function createFeedback(settings) {
  let ctx = null;
  let keepAlive = null;
  const audio = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  };
  const TONES = {
    tick: ["sine", 1200, 500, 0.08, 0.03],
    ok: ["sine", 660, 990, 0.1, 0.1],
    brake: ["sawtooth", 360, 110, 0.2, 0.3],
    relayOn: ["square", 1900, 1400, 0.05, 0.018],
    relayOff: ["square", 1300, 950, 0.05, 0.018],
    alert: ["triangle", 880, 880, 0.14, 0.22],
  };
  function sound(type = "tick") {
    if (!settings.sound) return;
    const c = audio();
    if (!c) return;
    const [wave, f0, f1, vol, dur] = TONES[type] ?? TONES.tick;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain).connect(c.destination);
    const t = c.currentTime;
    osc.type = wave;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t);
    osc.stop(t + dur);
  }
  // Browsers block vibration until the user has touched the page.
  let touched = false;
  window.addEventListener("pointerdown", () => { touched = true; }, { once: true, capture: true });
  const haptic = (pattern = 15) => { if (touched && settings.haptics && navigator.vibrate) navigator.vibrate(pattern); };
  return {
    sound,
    haptic,
    tap() { sound("tick"); haptic(12); },
    arm: audio,
    /** A near-silent tone keeps iOS (Bluefy) from suspending the page while driving. */
    keepAlive() {
      const c = audio();
      if (!c || keepAlive) return;
      try {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.frequency.value = 15;
        gain.gain.value = 0.0001;
        osc.connect(gain).connect(c.destination);
        osc.start();
        keepAlive = osc;
      } catch { /* optional */ }
    },
  };
}
