import "./styles.css";
import { type Data, loadData, loadGem } from "./data";
import { getLang, setLang, t } from "./i18n";
import { renderControls, renderDetails, renderLegend, renderNational, renderSources } from "./components/panels";
import { type State, type View, getState, setState, subscribe } from "./state";
import type { Area, ViewCtx, ViewHandle } from "./views/common";
import { sameArea } from "./views/common";
import { geoView } from "./views/geo";
import { hexView } from "./views/hex";
import { circlesView } from "./views/circles";
import { spikesView } from "./views/spikes";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mapEl = $("map");

let data: Data;
let handle: ViewHandle | null = null;
let mountedView: View | null = null;
let hovered: Area | null = null;
let selected: Area | null = null;
let mountToken = 0;

const ctx = (): ViewCtx => ({
  data,
  state: getState(),
  selected,
  onHover: (a) => {
    hovered = a;
    renderDetails($("details"), data, getState(), hovered ?? selected);
  },
  onPick: (a) => {
    selected = sameArea(a, selected) ? null : a;
    renderDetails($("details"), data, getState(), selected);
    handle?.update(ctx());
  },
});

async function mount(view: View) {
  const token = ++mountToken;
  handle?.destroy();
  handle = null;
  mountedView = view;
  mapEl.classList.toggle("is-3d", view === "relief");
  if (view === "relief") {
    mapEl.innerHTML = `<p class="loading">${t("loading")}</p>`;
    const { reliefView } = await import("./views/relief"); // deck.gl is loaded only when needed
    if (token !== mountToken) return;
    handle = reliefView(mapEl, ctx());
    return;
  }
  const make = { geo: geoView, hex: hexView, circles: circlesView, spikes: spikesView }[view];
  handle = make(mapEl, ctx());
}

function renderChrome(s: State) {
  if (hovered && !document.querySelector(".area:hover")) hovered = null;
  setLang(s.lang);
  $("title").textContent = t("title");
  $("subtitle").textContent = t("subtitle");
  $("lang-btn").textContent = getLang() === "de" ? "English" : "Deutsch";
  $("sources-btn").textContent = t("sources");
  $("foot").innerHTML =
    getLang() === "de"
      ? `Daten: © Die Bundeswahlleiterin, Wiesbaden 2025 (dl-de/by-2-0) · Geometrie: © GeoBasis-DE / BKG · Keine Cookies, keine externen Dienste.`
      : `Data: © Die Bundeswahlleiterin, Wiesbaden 2025 (dl-de/by-2-0) · Geometry: © GeoBasis-DE / BKG · No cookies, no external services.`;
  renderNational($("national"), data, s);
  renderControls($("controls"), data, s);
  renderLegend($("legend"), data, s);
  renderDetails($("details"), data, s, hovered ?? selected);
}

function render(s: State, prev?: State) {
  // municipalities exist only on the geographic map
  if (s.level === "gem" && s.view !== "geo") {
    setState({ level: "wk" });
    return;
  }
  if (s.level === "gem" && !data.gem) {
    mapEl.classList.add("is-loading");
    void loadGem(data).then(() => {
      mapEl.classList.remove("is-loading");
      render(getState(), prev ?? getState());
    }).catch((e) => {
      mapEl.classList.remove("is-loading");
      mapEl.insertAdjacentHTML("beforeend", `<p class="loading">⚠ ${String(e)}</p>`);
    });
    renderChrome({ ...s, level: "wk" });
    return;
  }
  renderChrome(s);
  if (s.view !== mountedView) {
    hovered = null;
    void mount(s.view);
  }
  else if (prev) handle?.update(ctx());
}

function initTheme() {
  const btn = $("theme-btn");
  let theme: string | null = null;
  try { theme = localStorage.getItem("theme"); } catch { /* storage unavailable */ }
  if (theme) document.documentElement.dataset.theme = theme;
  btn.onclick = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* ignore */ }
    render(getState(), getState());
  };
}

async function init() {
  setLang(getState().lang);
  $("loading").textContent = t("loading");
  try {
    data = await loadData();
  } catch (e) {
    mapEl.innerHTML = `<p class="loading">⚠ ${String(e)}</p>`;
    return;
  }
  initTheme();
  $("lang-btn").onclick = () => setState({ lang: getLang() === "de" ? "en" : "de" });
  const dlg = $<HTMLDialogElement>("sources");
  $("sources-btn").onclick = () => { renderSources(dlg, data); dlg.showModal(); };
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  // search: pick a Wahlkreis by number or name
  $("controls").addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.id !== "wk-search") return;
    const id = parseInt(input.value, 10);
    if (data.wkById.has(id)) {
      selected = { kind: "wk", id };
      if (getState().level !== "wk") setState({ level: "wk" });
      renderDetails($("details"), data, getState(), selected);
      handle?.update(ctx());
      input.value = "";
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selected) { selected = null; renderDetails($("details"), data, getState(), null); handle?.update(ctx()); }
  });

  subscribe((s, prev) => {
    if (selected && selected.kind !== s.level) selected = null;
    render(s, prev);
  });
  render(getState());
}

void init();
