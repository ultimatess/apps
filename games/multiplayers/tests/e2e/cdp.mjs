// Minimal zero-dependency Chrome DevTools Protocol driver (Node >= 22: global WebSocket).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

export function findChrome() {
  const p = CANDIDATES.find((c) => existsSync(c));
  if (!p) throw new Error("Chrome not found. Set CHROME_PATH.");
  return p;
}

export async function launch({ headless = true } = {}) {
  const userDir = mkdtempSync(join(tmpdir(), "netplay-chrome-"));
  const args = [
    headless ? "--headless=new" : "",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--hide-scrollbars",
    "--mute-audio",
    // Every tab is a separate "device" in these tests: never throttle background tabs.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--autoplay-policy=no-user-gesture-required",
    "about:blank",
  ].filter(Boolean);
  const proc = spawn(findChrome(), args, { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`Chrome did not start:\n${buf}`)), 20000);
    proc.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}):\n${buf}`)); });
  });
  const conn = await connect(wsUrl);
  return {
    conn,
    async newPage() {
      const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
      const page = new Page(conn, sessionId);
      page.targetId = targetId;
      return page;
    },
    async close() {
      try { await conn.send("Browser.close"); } catch { /* already gone */ }
      conn.ws.close();
      proc.kill("SIGKILL");
      try { rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.message} ${msg.error.data ?? ""}`)) : resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  return {
    ws,
    send(method, params = {}, sessionId) {
      const msgId = ++id;
      ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
      return new Promise((resolve, reject) => pending.set(msgId, { resolve, reject }));
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

export class Page {
  constructor(conn, sessionId) {
    this.conn = conn;
    this.sessionId = sessionId;
    this.console = [];
    this.errors = [];
    conn.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
        this.console.push({ type: msg.params.type, text });
      } else if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.errors.push(d.exception?.description ?? d.text);
      } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        this.errors.push(`${msg.params.entry.source}: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
      }
    });
  }

  send(method, params) {
    return this.conn.send(method, params, this.sessionId);
  }

  async init({ width = 390, height = 844, mobile = true, scale = 2 } = {}) {
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Log.enable");
    await this.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile });
    if (mobile) await this.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }

  addInitScript(source) {
    return this.send("Page.addScriptToEvaluateOnNewDocument", { source });
  }

  async goto(url) {
    const loaded = new Promise((resolve) => {
      const off = this.conn.on((m) => {
        if (m.sessionId === this.sessionId && m.method === "Page.loadEventFired") { off(); resolve(); }
      });
    });
    await this.send("Page.navigate", { url });
    await loaded;
  }

  async reload() {
    const loaded = new Promise((resolve) => {
      const off = this.conn.on((m) => {
        if (m.sessionId === this.sessionId && m.method === "Page.loadEventFired") { off(); resolve(); }
      });
    });
    await this.send("Page.reload", { ignoreCache: true });
    await loaded;
  }

  async eval(expr) {
    const src = typeof expr === "function" ? `(${expr})()` : expr;
    const res = await this.send("Runtime.evaluate", { expression: src, awaitPromise: true, returnByValue: true, userGesture: true });
    if (res.exceptionDetails) throw new Error(`eval failed: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
    return res.result.value;
  }

  async waitFor(expr, { timeout = 5000, interval = 50, label } = {}) {
    const start = Date.now();
    let last;
    while (Date.now() - start < timeout) {
      last = await this.eval(expr);
      if (last) return last;
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`Timed out waiting for ${label ?? expr}`);
  }

  /** Real input: trusted pointer + click at the element centre (exercises layout/hit-testing). */
  async click(selector) {
    const box = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    })()`);
    if (!box) throw new Error(`No element for ${selector}`);
    if (!box.w || !box.h) throw new Error(`Element ${selector} is not visible`);
    const hit = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const top = document.elementFromPoint(${box.x}, ${box.y});
      return !!top && (el === top || el.contains(top));
    })()`);
    if (!hit) throw new Error(`Element ${selector} is covered by another element`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
  }

  /** Centre point of an element (scrolled into view), or null. */
  async boxOf(selector) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`);
  }

  /** Real pointer drag through relative points [[fx, fy], ...] (0..1) inside an element. */
  async drag(selector, points, { holdMs = 0, stepMs = 16 } = {}) {
    const box = await this.boxOf(selector);
    if (!box) throw new Error(`No element for ${selector}`);
    const at = ([fx, fy]) => ({ x: box.x + box.w * fx, y: box.y + box.h * fy });
    const first = at(points[0]);
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: first.x, y: first.y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: first.x, y: first.y, button: "left", buttons: 1, clickCount: 1 });
    for (const p of points.slice(1)) {
      const pt = at(p);
      await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, button: "left", buttons: 1 });
      if (stepMs) await new Promise((r) => setTimeout(r, stepMs));
    }
    if (holdMs) await new Promise((r) => setTimeout(r, holdMs));
    const last = at(points[points.length - 1]);
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: last.x, y: last.y, button: "left", buttons: 0, clickCount: 1 });
  }

  /** Press (and optionally hold) the mouse on an element's centre. */
  async press(selector, holdMs = 60) {
    const box = await this.boxOf(selector);
    if (!box) throw new Error(`No element for ${selector}`);
    const x = box.x + box.w / 2;
    const y = box.y + box.h / 2;
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await new Promise((r) => setTimeout(r, holdMs));
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  }

  async close() {
    try { await this.conn.send("Target.closeTarget", { targetId: this.targetId }); } catch { /* ignore */ }
  }

  async screenshot() {
    const { data } = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    return Buffer.from(data, "base64");
  }
}
