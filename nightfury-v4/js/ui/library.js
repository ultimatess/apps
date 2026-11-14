// Library tab: every sendable item, filterable by group and search.
import { $, h, icon } from "./dom.js";
import { GROUPS, itemHint, itemLabel, itemScene } from "../library.js";
import { sceneTint } from "../scene.js";

export function mountLibrary(ctx) {
  const { store, lib, fb, bus } = ctx;
  let group = "all";
  let query = "";

  function card(item) {
    const scene = itemScene(item);
    const pinned = store.pins.includes(item.id);
    return h("div", { class: "item", role: "group", dataset: { id: item.id }, style: { "--c": sceneTint(scene) } },
      h("button", { class: "hit", "aria-label": `Send ${itemLabel(item)}`, onclick: () => ctx.send(item) },
        ctx.thumb(scene),
        h("b", { class: "tamil" }, itemLabel(item)),
        h("small", {}, itemHint(item))),
      pinned && h("span", { class: "pinned", title: "Pinned to the quick deck" }, icon("pin")),
      h("button", { class: "more", "aria-label": `More for ${itemLabel(item)}`, onclick: () => { fb.tap(); ctx.itemMenu(item); } }, icon("more")));
  }

  function renderChips() {
    $("libChips").replaceChildren(...GROUPS.map((g) => h("button", {
      class: g.id === group ? "on" : "", "aria-pressed": g.id === group ? "true" : "false", dataset: { group: g.id },
      onclick: () => { fb.tap(); group = g.id; renderChips(); renderGrid(); },
    }, g.id === "mine" && store.items.length ? `${g.title} · ${store.items.length}` : g.title)));
  }

  function renderGrid() {
    const items = lib.filter(group, query);
    $("libGrid").replaceChildren(...items.map(card));
    const empty = $("libEmpty");
    empty.hidden = items.length > 0;
    if (!items.length) {
      empty.textContent = query
        ? `Nothing matches “${query}”.`
        : group === "mine" ? "Nothing saved yet. Make something in the Studio and tap Save." : "Nothing here.";
    }
    ctx.thumbs.sweep();
    markActive();
  }

  function markActive() {
    const id = ctx.state.activeId;
    document.querySelectorAll("#libGrid .item").forEach((el) => el.classList.toggle("active", !!id && el.dataset.id === id));
  }

  $("libSearch").addEventListener("input", (e) => { query = e.target.value; renderGrid(); });
  bus.on("library", () => { renderChips(); renderGrid(); });
  bus.on("active", markActive);
  bus.on("group", (g) => { group = g; renderChips(); renderGrid(); });

  renderChips();
  renderGrid();
  return null;
}
