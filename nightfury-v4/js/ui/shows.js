// Shows tab: playlists of library items.
import { $, bindSeg, h, icon, markSeg, openSheet, toast } from "./dom.js";
import { itemLabel, itemScene } from "../library.js";
import { MODES, MODE_IDS, nextUnitIndex } from "../modes.js";

export function mountShows(ctx) {
  const { store, lib, engine, fb, bus } = ctx;
  const open = new Set();
  let nowKey = "";

  const total = (show) => show.items.reduce((n, it) => n + (Number(it.secs) || 8), 0);
  const playingId = () => engine.player.show?.id ?? null;

  function save(show, patch) {
    const stored = store.saveShow({ ...show, ...patch });
    if (playingId() === stored.id) {
      // Keep the running show in step with the edit.
      const pos = engine.player.position(ctx.now());
      if (stored.items.length) { engine.player.show = stored; engine.player.seek(Math.min(pos?.index ?? 0, stored.items.length - 1), ctx.now()); }
      else engine.stopShow();
    }
    render();
    return stored;
  }

  function togglePlay(show) {
    fb.tap();
    if (playingId() === show.id) {
      engine.stopShow();
      toast("Show stopped");
    } else if (!show.items.some((it) => lib.get(it.ref))) {
      toast("Add some items first");
    } else {
      engine.playShow(show, ctx.now());
      ctx.state.activeId = null;
      bus.emit("active");
      toast(`Playing ${show.name}`);
    }
    engine.tick(ctx.now());
    render();
  }

  function picker(show) {
    let current = show;
    const list = h("div", { class: "pick" });
    const draw = () => {
      const refs = new Set(current.items.map((it) => it.ref));
      list.replaceChildren(...lib.all().filter((item) => item.kind !== "mode").map((item) => h("button", {
        class: refs.has(item.id) ? "on" : "",
        onclick: () => {
          const items = refs.has(item.id) ? current.items.filter((it) => it.ref !== item.id) : [...current.items, { ref: item.id, secs: 8 }];
          current = save(current, { items });
          draw();
        },
      }, ctx.thumb(itemScene(item), ""), h("b", { class: "tamil" }, itemLabel(item)), h("span", { class: "tick" }))));
      ctx.thumbs.sweep();
    };
    draw();
    openSheet(`Items in ${show.name}`, [list, h("button", { class: "btn btn-primary wide", onclick: () => $("sheet").close() }, "Done")]);
  }

  function rename(show) {
    const input = h("input", { class: "input", maxlength: 40, value: show.name, "aria-label": "Show name" });
    const apply = () => { $("sheet").close(); save(show, { name: input.value.trim() || show.name }); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(); });
    openSheet("Rename show", [input, h("button", { class: "btn btn-primary wide", onclick: apply }, "Save")]);
    setTimeout(() => input.select(), 50);
  }

  function itemRow(show, it, i, editable) {
    const item = lib.get(it.ref);
    const move = (d) => {
      const items = show.items.slice();
      const j = i + d;
      if (j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
      save(show, { items });
    };
    const secs = (d) => save(show, { items: show.items.map((x, k) => (k === i ? { ...x, secs: Math.max(2, Math.min(120, (Number(x.secs) || 8) + d)) } : x)) });
    const btn = (name, label, fn) => h("button", { "aria-label": label, onclick: () => { fb.tap(); fn(); } }, icon(name));
    return h("div", { class: "show-item", dataset: { index: i } },
      item ? ctx.thumb(itemScene(item), "") : h("canvas", {}),
      h("span", { class: "name tamil" }, item ? itemLabel(item) : "Deleted item"),
      h("span", { class: "ctl" },
        editable && h("button", { "aria-label": "Shorter", onclick: () => secs(-2) }, "−"),
        h("span", { class: "secs" }, `${it.secs}s`),
        editable && h("button", { "aria-label": "Longer", onclick: () => secs(2) }, "+"),
        editable && btn("up", "Move up", () => move(-1)),
        editable && btn("down", "Move down", () => move(1)),
        editable && btn("close", "Remove", () => save(show, { items: show.items.filter((_, k) => k !== i) }))));
  }

  function card(show) {
    const editable = !show.builtin;
    const playing = playingId() === show.id;
    const isOpen = open.has(show.id);
    const toggle = () => { fb.tap(); if (isOpen) open.delete(show.id); else open.add(show.id); render(); };
    return h("div", { class: `card show${playing ? " playing" : ""}${isOpen ? " open" : ""}`, dataset: { show: show.id } },
      h("div", { class: "show-head" },
        h("button", { class: "play", "aria-label": playing ? `Stop ${show.name}` : `Play ${show.name}`, onclick: () => togglePlay(show) }, icon(playing ? "pause" : "play")),
        h("button", { class: "title", "aria-expanded": isOpen ? "true" : "false", onclick: toggle },
          h("b", {}, show.name),
          h("small", {}, `${show.items.length} item${show.items.length === 1 ? "" : "s"} · ${total(show)} s${show.builtin ? " · built in" : ""}`)),
        h("button", { class: "chev icon-btn", "aria-label": isOpen ? "Collapse" : "Expand", onclick: toggle }, icon("chevron"))),
      h("div", { class: "show-body" },
        ...show.items.map((it, i) => itemRow(show, it, i, editable)),
        !show.items.length && h("p", { class: "hint" }, "Empty. Add items from the library."),
        h("div", { class: "wrap" },
          editable && h("button", { class: "btn btn-small", onclick: () => { fb.tap(); picker(show); } }, icon("plus"), "Add items"),
          editable && h("button", { class: "btn btn-small", onclick: () => { fb.tap(); rename(show); } }, "Rename"),
          h("button", { class: "btn btn-small", onclick: () => { fb.tap(); const s = store.saveShow({ name: `${show.name} copy`, items: show.items }); open.add(s.id); render(); toast("Copied: this one is yours to edit"); } }, icon("copy"), editable ? "Duplicate" : "Copy to edit"),
          editable && h("button", { class: "btn btn-small danger", onclick: () => ctx.confirm("Delete show", `Delete “${show.name}”? This cannot be undone.`, "Delete", () => { if (playingId() === show.id) engine.stopShow(); store.removeShow(show.id); render(); }) }, icon("trash"), "Delete"))));
  }

  function modeRow(id) {
    const m = MODES[id];
    const playing = playingId() === `mode.${id}`;
    return h("div", { class: `mode-row${playing ? " playing" : ""}`, dataset: { mode: id }, style: { "--c": m.color } },
      h("button", { class: "play", "aria-label": playing ? `Stop ${m.name}` : `Start ${m.name}`, onclick: () => ctx.playMode(id) }, icon(playing ? "pause" : "play")),
      h("button", { class: "title", onclick: () => ctx.playMode(id) },
        h("b", { class: "tamil" }, m.name.includes(m.label) ? m.name : `${m.label} · ${m.name}`),
        h("small", {}, m.hint)));
  }

  /** A running mode is rebuilt when its language or style changes. */
  function modeOption(patch) {
    fb.tap();
    store.set(patch);
    const id = playingId();
    if (id?.startsWith("mode.")) ctx.playMode(id.slice(5), { toggle: false });
  }

  function render() {
    $("modeList").replaceChildren(...MODE_IDS.map(modeRow));
    markSeg($("modeLang"), ctx.S.modeLang);
    markSeg($("modeStyle"), ctx.S.modeStyle);
    $("showList").replaceChildren(...lib.shows().map(card));
    ctx.thumbs.sweep();
    nowKey = "";
    tick();
  }

  /** Now-playing strip and the highlighted row; cheap enough to run on the UI timer. */
  function tick() {
    const show = engine.player.show;
    const pos = show ? engine.player.position(ctx.now()) : null;
    const key = pos ? `${show.id}|${pos.index}` : "";
    const tab = document.querySelector('.tab[data-tab="shows"]');
    if (!!pos !== !!tab.querySelector(".badge")) {
      if (pos) tab.append(h("span", { class: "badge" })); else tab.querySelector(".badge")?.remove();
    }
    if (key === nowKey) return;
    nowKey = key;
    $("nowPlaying").hidden = !pos;
    document.querySelectorAll(".show-item.current").forEach((el) => el.classList.remove("current"));
    if (!pos) return;
    $("nowName").textContent = show.name;
    const item = show.mode ? null : lib.get(pos.item.ref);
    $("nowItem").textContent = show.mode
      ? `${pos.item.unit + 1} of ${show.units} · ${pos.item.label}`
      : `${pos.index + 1} of ${show.items.length} · ${item ? itemLabel(item) : "Deleted item"}`;
    document.querySelector(`.show[data-show="${CSS.escape(show.id)}"] .show-item[data-index="${pos.index}"]`)?.classList.add("current");
  }

  $("newShowBtn").addEventListener("click", () => {
    fb.tap();
    const s = store.saveShow({ name: `My show ${store.shows.length + 1}`, items: [] });
    open.add(s.id);
    render();
    picker(s);
  });
  $("nowStop").addEventListener("click", () => { fb.tap(); engine.stopShow(); engine.tick(ctx.now()); render(); bus.emit("active"); });
  $("nowNext").addEventListener("click", () => {
    fb.tap();
    const pos = engine.player.position(ctx.now());
    if (!pos) return;
    const show = engine.player.show;
    engine.player.seek(show.mode ? nextUnitIndex(show, pos.index) : pos.index + 1, ctx.now());
    engine.tick(ctx.now());
  });
  bindSeg($("modeLang"), (v) => modeOption({ modeLang: v }));
  bindSeg($("modeStyle"), (v) => modeOption({ modeStyle: v }));
  bus.on("shows", (opts) => { if (opts?.open) open.add(opts.open); render(); });
  bus.on("library", render);
  engine.on("show", () => { nowKey = "x"; });

  render();
  return { render: tick };
}
