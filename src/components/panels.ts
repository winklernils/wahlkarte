import { type AreaResult, type Data, partyVotes, turnout, winner } from "../data";
import { type Key, fmt, getLang, pct, t } from "../i18n";
import { IN_BUNDESTAG, SELECTABLE, partyColor, partyLabel } from "../parties";
import { type State, setState } from "../state";
import { type Area, areaOf, landOf } from "../views/common";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const isVotesView = (s: State) => s.view === "spikes" || s.view === "relief";

// ------------------------------------------------------------------ details ---
export function renderDetails(el: HTMLElement, data: Data, s: State, a: Area | null) {
  const area: AreaResult = a ? areaOf(data, a) : data.results.bund;
  const land = a ? landOf(data, a) : undefined;
  const vi = s.vote === "e" ? 0 : 1;
  const valid = area.valid[vi];
  const de = getLang() === "de";
  let sub = t("national");
  if (a?.kind === "wk") sub = `${de ? "Wahlkreis" : "Constituency"} ${a.id} · ${data.landById.get(land!)!.name}`;
  if (a?.kind === "land") sub = de ? "Land" : "State";
  if (a?.kind === "gem") {
    const g = data.gem!.byId.get(a.id)!;
    const isWk = g.id.includes("-WK");
    sub = `${isWk ? (de ? "Wahlkreis" : "Constituency") : de ? "Gemeinde" : "Municipality"} · ${
      g.split ? `${t("gemSplit")} ${g.wk}` : `${de ? "Wahlkreis" : "Constituency"} ${g.wk}`} · ${data.landById.get(g.land)!.name}`;
  }

  // "Übrige" (remaining individual candidates) goes into "others"
  const rows = Object.entries(area[s.vote]).filter(([p]) => p !== "Übrige").sort((x, y) => y[1] - x[1]);
  const top = rows.slice(0, 7);
  const rest = rows.slice(7).reduce((x, [, v]) => x + v, 0) + (area[s.vote]["Übrige"] ?? 0);
  if (rest > 0) top.push([t("others"), rest]);
  const maxShare = (100 * top[0][1]) / valid;

  const w = winner(area, s.vote);
  let partyBox = "";
  if (isVotesView(s)) {
    const v = partyVotes(area, s.party, s.vote);
    partyBox = `<div class="party-box" style="--c:${partyColor(s.party, land)}">
      <span class="swatch"></span><strong>${esc(partyLabel(s.party))}</strong>
      ${v === null ? `<span class="muted">${t("notOnBallot")}</span>`
        : `<span class="big">${fmt(v)}</span> ${t("votes")} · ${pct((100 * v) / valid)}`}
    </div>`;
  }
  let seat = "";
  if (a?.kind === "wk") {
    const wk = data.wkById.get(a.id)!;
    const ew = winner(wk, "e");
    seat = wk.seated
      ? `<p class="note">${t("seat")}: <strong>${esc(partyLabel(ew.party))}</strong></p>`
      : `<p class="note warn">${esc(partyLabel(ew.party))}: ${t("noSeat")}</p>`;
  }

  el.innerHTML = `
    <p class="eyebrow">${esc(sub)}</p>
    <h2>${esc(!a && !de ? "Germany" : area.name)}</h2>
    ${partyBox}
    <p class="winner"><span class="swatch" style="--c:${partyColor(w.party, land)}"></span>
      ${t("winner")} (${t(s.vote === "e" ? "vote.e" : "vote.z")}): <strong>${esc(partyLabel(w.party))}</strong>
      · ${t("margin")} ${fmt(Math.round(w.margin * 10) / 10)} ${t("pp")}</p>
    <ol class="bars">
      ${top.map(([p, v]) => {
        const share = (100 * v) / valid;
        const c = p === t("others") ? "#9a9a9a" : partyColor(p, land);
        return `<li><span class="name">${esc(partyLabel(p))}</span>
          <span class="bar"><span style="width:${(share / maxShare) * 100}%;--c:${c}"></span></span>
          <span class="val" title="${fmt(v)} ${t("votes")}">${pct(share)}</span></li>`;
      }).join("")}
    </ol>
    <dl class="facts">
      <div><dt>${t("turnout")}</dt><dd>${pct(turnout(area))}</dd></div>
      <div><dt>${t("eligible")}</dt><dd>${fmt(area.eligible)}</dd></div>
      <div><dt>${t("validVotes")}</dt><dd>${fmt(valid)}</dd></div>
      ${a?.kind === "wk" ? `<div><dt>${t("population")}</dt><dd>${fmt(data.wkById.get(a.id)!.pop)}</dd></div>` : ""}
    </dl>
    ${seat}`;
}

// ----------------------------------------------------------------- controls ---
type Opt = { value: string; label: string };
function segmented(label: string, key: keyof State, opts: Opt[], s: State) {
  const name = `seg-${key}`;
  return `<fieldset class="seg"><legend>${label}</legend><div class="seg-row">${opts
    .map((o) => `<label><input type="radio" name="${name}" data-key="${key}" value="${esc(o.value)}"
      ${String(s[key]) === o.value ? "checked" : ""}><span>${esc(o.label)}</span></label>`)
    .join("")}</div></fieldset>`;
}

export function renderControls(el: HTMLElement, data: Data, s: State) {
  const views = (["geo", "hex", "circles", "spikes", "relief"] as const).map((v) => ({ value: v, label: t(`view.${v}` as Key) }));
  const parts = [
    segmented(t("view"), "view", views, s),
    segmented(t("vote"), "vote", [{ value: "z", label: t("vote.z") }, { value: "e", label: t("vote.e") }], s),
  ];
  if (s.view === "spikes" || s.view === "relief") {
    const cur = s.level === "land" ? "land" : s.grid ? "grid" : "wk";
    parts.push(`<fieldset class="seg"><legend>${t("resolution")}</legend><div class="seg-row">${[
      ["grid", t("res.grid")], ["wk", t("level.wk")], ["land", t("level.land")],
    ].map(([v, l]) => `<label><input type="radio" name="seg-res" data-res="${v}" ${cur === v ? "checked" : ""}><span>${l}</span></label>`).join("")}</div></fieldset>`);
  } else {
    const levels = [{ value: "land", label: t("level.land") }, { value: "wk", label: t("level.wk") }];
    if (s.view === "geo") levels.push({ value: "gem", label: t("level.gem") });
    parts.push(segmented(t("level"), "level", levels, s));
  }
  if (!isVotesView(s)) {
    parts.push(`<label class="check"><input type="checkbox" data-key="shading" ${s.shading ? "checked" : ""}> ${t("shading")}</label>`);
  }
  if (s.view === "circles") {
    parts.push(segmented(t("size"), "size", [{ value: "eligible", label: t("size.eligible") }, { value: "valid", label: t("size.valid") }], s));
  }
  if (isVotesView(s)) {
    parts.push(`<label class="select"><span>${t("party")}</span><select data-key="party">${SELECTABLE.map(
      (p) => `<option value="${esc(p)}" ${p === s.party ? "selected" : ""}>${esc(partyLabel(p))}${
        IN_BUNDESTAG.has(p) ? "" : ` – ${t("notInBundestag")}`}</option>`).join("")}</select></label>`);
    parts.push(segmented(t("scale"), "scale", [{ value: "shared", label: t("scale.shared") }, { value: "party", label: t("scale.party") }], s));
  }
  if (s.view === "relief" && !(s.level === "wk" && s.grid)) {
    parts.push(segmented(t("relief"), "relief", [{ value: "columns", label: t("relief.columns") }, { value: "areas", label: t("relief.areas") }], s));
  }
  parts.push(`<label class="search"><span class="sr-only">${t("search")}</span>
    <input type="search" list="wk-list" placeholder="${t("search")}" id="wk-search" autocomplete="off">
    <datalist id="wk-list">${data.results.wahlkreise.map((w) => `<option value="${w.id} ${esc(w.name)}">`).join("")}</datalist></label>`);
  el.innerHTML = parts.join("");

  el.querySelectorAll<HTMLInputElement>("input[type=radio]").forEach((i) =>
    i.addEventListener("change", () => setState({ [i.dataset.key!]: i.value } as Partial<State>)),
  );
  el.querySelectorAll<HTMLInputElement>("input[data-res]").forEach((i) =>
    i.addEventListener("change", () => {
      const r = i.dataset.res;
      setState(r === "land" ? { level: "land" } : { level: "wk", grid: r === "grid" });
    }),
  );
  el.querySelector<HTMLInputElement>("input[data-key=shading]")?.addEventListener("change", (e) =>
    setState({ shading: (e.target as HTMLInputElement).checked }),
  );
  el.querySelector<HTMLSelectElement>("select[data-key=party]")?.addEventListener("change", (e) =>
    setState({ party: (e.target as HTMLSelectElement).value }),
  );
}

// ------------------------------------------------------------------- legend ---
export function renderLegend(el: HTMLElement, data: Data, s: State) {
  if (isVotesView(s)) {
    const union = s.party === "UNION"
      ? `<span class="key"><span class="swatch" style="--c:${partyColor("CDU")}"></span>CDU</span>
         <span class="key"><span class="swatch" style="--c:${partyColor("CSU")}"></span>CSU (${getLang() === "de" ? "Bayern" : "Bavaria"})</span>`
      : `<span class="key"><span class="swatch" style="--c:${partyColor(s.party)}"></span>${esc(partyLabel(s.party))}</span>`;
    const missing = s.party === "SSW" ? ` · ${getLang() === "de" ? "SSW tritt nur in Schleswig-Holstein an" : "SSW only stands in Schleswig-Holstein"}` : "";
    const desc = s.level === "land" ? "legendSpikesLand" : s.level === "wk" && s.grid ? "legendGrid" : "legendSpikes";
    el.innerHTML = `<div class="keys">${union}</div><p>${t(desc)}${missing}</p>`;
    return;
  }
  const areas: Area[] = s.level === "land"
    ? data.results.laender.map((l) => ({ kind: "land", id: l.id }))
    : s.level === "gem" && data.gem
      ? [...data.gem.byId.keys()].map((id) => ({ kind: "gem", id }))
      : data.results.wahlkreise.map((w) => ({ kind: "wk", id: w.id }));
  const counts = new Map<string, number>();
  for (const a of areas) {
    const p = winner(areaOf(data, a), s.vote).party;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const order = ["CDU", "CSU", "AfD", "SPD", "GRÜNE", "Die Linke", "BSW", "SSW"];
  const keys = [...counts].sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - (order.indexOf(b[0]) + 99) % 99);
  const unit = s.level === "land" ? t("level.land") : s.level === "gem" ? t("level.gem") : t("level.wk");
  const desc = s.view === "geo" && s.level === "gem" ? t("legendGem")
    : s.view === "hex" ? t("legendHex")
    : s.view === "circles" ? t("legendCircles", { m: t(s.size === "eligible" ? "size.eligible" : "size.valid") })
    : t("legendGeo");
  const shading = s.shading
    ? `<span class="key shade"><span class="ramp"></span>${getLang() === "de" ? "knapp → deutlich" : "close → clear"}</span>` : "";
  el.innerHTML = `<div class="keys">${keys.map(([p, n]) =>
    `<span class="key"><span class="swatch" style="--c:${partyColor(p)}"></span>${esc(partyLabel(p))} <span class="muted">${n}</span></span>`).join("")}
    ${shading}</div><p>${desc}${s.level === "land" ? ` · ${t("legendLand")}` : ""} · <span class="muted">${unit}: ${areas.length}</span></p>`;
}

// ----------------------------------------------------------- national strip ---
/** Readable text colour on a party colour (dark text on light colours such as FDP yellow). */
function textOn(hex: string): string {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#111" : "#fff";
}

export function renderNational(el: HTMLElement, data: Data, s: State) {
  const b = data.results.bund;
  const valid = b.valid[s.vote === "e" ? 0 : 1];
  const order = ["CDU", "CSU", "AfD", "SPD", "GRÜNE", "Die Linke", "BSW", "FDP", "SSW"];
  const parts: [string, number, string][] = order
    .filter((p) => p in b[s.vote])
    .map((p) => [partyLabel(p), b[s.vote][p], partyColor(p)]);
  const other = valid - parts.reduce((x, [, v]) => x + v, 0);
  parts.push([t("others"), other, "#b5b5b5"]);
  el.innerHTML = `
    <div class="nat-bar" role="img" aria-label="${t("national")}: ${parts.map(([l, v]) => `${esc(l)} ${pct((100 * v) / valid)}`).join(", ")}">
      ${parts.map(([label, v, c]) => {
        const share = pct((100 * v) / valid);
        return `<span class="nat-seg" style="flex:${v};--c:${c};--fg:${textOn(c)}" data-label="${esc(label)}" data-share="${share}" title="${esc(label)}: ${share}">
          <span class="nat-in"><b>${esc(label)}</b> ${share}</span></span>`;
      }).join("")}
    </div>
    <div class="nat-out" aria-hidden="true"></div>
    <p class="nat-caption">${t("national")}, ${t(s.vote === "e" ? "vote.e" : "vote.z")}</p>`;
  layoutNational(el);
  if (!el.dataset.observed) {
    el.dataset.observed = "1";
    new ResizeObserver(() => layoutNational(el)).observe(el);
  }
}

/**
 * Labels that fit stay inside their segment; the others become small boxes below the bar in one
 * row, kept in party order and pushed apart just enough not to overlap, each joined to its segment
 * by a thin angled leader line. If one row is too narrow (phones), they alternate over two rows.
 */
function layoutNational(el: HTMLElement) {
  const bar = el.querySelector<HTMLElement>(".nat-bar");
  const out = el.querySelector<HTMLElement>(".nat-out");
  if (!bar || !out) return;
  out.replaceChildren();
  const barLeft = bar.getBoundingClientRect().left;
  const width = bar.clientWidth;
  const GAP = 6, DROP = 12, ROW_H = 26;
  const calls: { box: HTMLElement; centre: number; w: number; x: number; row: number }[] = [];
  for (const seg of bar.querySelectorAll<HTMLElement>(".nat-seg")) {
    const inner = seg.querySelector<HTMLElement>(".nat-in")!;
    const fits = inner.scrollWidth + 10 <= seg.clientWidth;
    inner.style.visibility = fits ? "visible" : "hidden";
    if (fits) continue;
    const r = seg.getBoundingClientRect();
    const box = document.createElement("span");
    box.className = "nat-call";
    box.style.setProperty("--c", seg.style.getPropertyValue("--c"));
    box.innerHTML = `<i></i><b>${seg.dataset.label}</b> ${seg.dataset.share}`;
    out.append(box);
    calls.push({ box, centre: r.left - barLeft + r.width / 2, w: box.offsetWidth, x: 0, row: 0 });
  }
  if (!calls.length) {
    out.style.height = "0px";
    return;
  }
  // fewest rows (taking every n-th box) in which each row fits the bar width
  let rows = 1;
  const fitsIn = (n: number) =>
    Array.from({ length: n }, (_, r) => calls.filter((_, i) => i % n === r).reduce((x, c) => x + c.w + GAP, -GAP))
      .every((w) => w <= width);
  while (rows <= 2 && !fitsIn(rows)) rows++;
  if (rows > 2) {
    // too narrow for leader lines (phones): compact legend of all parties under the bar
    out.replaceChildren();
    out.className = "nat-out nat-grid";
    out.style.height = "";
    for (const seg of bar.querySelectorAll<HTMLElement>(".nat-seg")) {
      seg.querySelector<HTMLElement>(".nat-in")!.style.visibility = "hidden";
      const item = document.createElement("span");
      item.className = "nat-call static";
      item.style.setProperty("--c", seg.style.getPropertyValue("--c"));
      item.innerHTML = `<i></i><b>${seg.dataset.label}</b> ${seg.dataset.share}`;
      out.append(item);
    }
    return;
  }
  out.className = "nat-out";
  calls.forEach((c, i) => (c.row = i % rows));
  for (let row = 0; row < rows; row++) {
    const rc = calls.filter((c) => c.row === row);
    // ideal: centred under the segment; forward pass removes overlaps, backward pass keeps it inside
    let right = -Infinity;
    for (const c of rc) {
      c.x = Math.max(c.centre - c.w / 2, right + GAP, 0);
      right = c.x + c.w;
    }
    let left = width + GAP;
    for (let i = rc.length - 1; i >= 0; i--) {
      rc[i].x = Math.min(rc[i].x, left - GAP - rc[i].w);
      left = rc[i].x;
    }
  }
  const height = DROP + rows * ROW_H;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "nat-leads");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  for (const c of calls) {
    const top = DROP + c.row * ROW_H;
    c.box.style.left = `${c.x}px`;
    c.box.style.top = `${top}px`;
    const bx = Math.min(Math.max(c.centre, c.x + 6), c.x + c.w - 6);
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("points", `${c.centre},0 ${c.centre},${DROP / 2} ${bx},${top}`);
    svg.append(line);
  }
  out.prepend(svg);
  out.style.height = `${height}px`;
}

// ------------------------------------------------------------------ sources ---
export function renderSources(dlg: HTMLDialogElement, data: Data) {
  const de = getLang() === "de";
  dlg.innerHTML = `<form method="dialog" class="dlg">
    <h2>${t("sources")}</h2>
    <p>${de
      ? "Alle Wahlergebnisse stammen ausschließlich aus amtlichen Veröffentlichungen der Bundeswahlleiterin (endgültiges Ergebnis, Stand 14.03.2025), die Grenzen von der Bundeswahlleiterin und dem Bundesamt für Kartographie und Geodäsie (BKG). Es werden keine Medien-, Umfrage- oder Wikipedia-Daten verwendet."
      : "All election results come exclusively from official publications of the Federal Returning Officer (Die Bundeswahlleiterin), final result as of 14 March 2025; boundaries from the Federal Returning Officer and the Federal Agency for Cartography and Geodesy (BKG). No media, polling or Wikipedia data is used."}</p>
    <ol class="src">${data.sources.map((s) => `<li>
      <strong>${esc(de ? s.title_de : s.title_en)}</strong><br>
      <a href="${esc(s.url)}" rel="noopener">${esc(s.file)}</a> · <a href="${esc(s.page)}" rel="noopener">${de ? "Seite" : "page"}</a><br>
      <span class="muted">${esc(s.licence)}</span><br>
      <span class="muted">${de ? "Abgerufen" : "Retrieved"} ${s.retrieved} · SHA-256 <code>${s.sha256.slice(0, 16)}…</code></span></li>`).join("")}</ol>
    <h3>${de ? "Prüfungen beim Datenimport" : "Checks run on import"}</h3>
    <ul>${(de ? [
      "Status „Endgültig“ in der Ergebnisdatei",
      "Genau 299 Wahlkreise und 16 Länder; jede Wahlkreisnummer hat eine Geometrie",
      "Für jede Partei und beide Stimmen: Summe der Wahlkreise = Summe der Länder = Bundesergebnis",
      "Parteistimmen ergeben je Gebiet die gültigen Stimmen; Wählende = gültige + ungültige",
      "Wahlberechtigte (60.510.631) und Wahlbeteiligung (82,5 %) entsprechen dem amtlichen Ergebnis",
      "23 Wahlkreissieger ohne Mandat (Zweitstimmendeckung), wie amtlich ausgewiesen",
    ] : [
      "Result file is marked “Endgültig” (final)",
      "Exactly 299 constituencies and 16 states; every constituency number has a geometry",
      "For each party and both votes: sum of constituencies = sum of states = national result",
      "Party votes add up to valid votes in every area; voters = valid + invalid",
      "Eligible voters (60,510,631) and turnout (82.5 %) match the official result",
      "23 constituency winners without a seat (second-vote coverage), as officially reported",
    ]).map((x) => `<li>${x}</li>`).join("")}</ul>
    <h3>${de ? "Methode der Kartogramme" : "Cartogram method"}</h3>
    <p>${de
      ? "Hexagone: Der Umriss Deutschlands (ETRS89-LAEA) wird mit genau 299 gleich großen Hexagonen gefüllt. Die Wahlkreise werden per optimaler Zuordnung auf diese Zellen verteilt, sodass die Landesumrisse erhalten bleiben und jedes Land zusammenhängt. Kreise: Dorling-Kartogramm, Kreisfläche proportional zur Zahl der Wahlberechtigten bzw. gültigen Stimmen."
      : "Hexagons: Germany's outline (ETRS89-LAEA) is filled with exactly 299 equal hexagons. Constituencies are distributed onto these cells by optimal assignment, so the country's outline is kept and every state stays contiguous. Circles: Dorling cartogram, circle area proportional to eligible voters or valid votes."}</p>
    <h3>${de ? "Feinraster der Stimmen 2D (Raster 5 km)" : "Fine grid of Votes 2D (5 km grid)"}</h3>
    <p>${de
      ? "Grundlage sind die Ergebnisse aller rund 95.000 Wahlbezirke. Briefwahlstimmen werden nicht getrennt dargestellt, sondern auf die Urnenwahlbezirke verteilt, für die der jeweilige Briefwahlvorstand zuständig ist – gewichtet nach der amtlichen Zahl der Wahlberechtigten mit Wahlschein (Sperrvermerk A2) je Wahlbezirk. Gemeinsame Briefwahlvorstände mehrerer Gemeinden werden über die amtliche Kennziffer der Briefwahlzugehörigkeit zugeordnet. Die Wahlbezirke werden je Gemeinde und Wahlkreis zusammengefasst und gleichmäßig über die Gemeindefläche (BKG VG250) auf ein 5-km-Raster verteilt; in Berlin und Hamburg über die Wahlkreisfläche. Jeder Wahlkreis ergibt exakt das amtliche Ergebnis; die Verteilung innerhalb einer Gemeinde ist eine Schätzung."
      : "Based on the results of all ~95,000 polling districts. Postal votes are not shown separately but distributed over the polling-station districts served by their postal board, weighted by the official number of voters with a postal ballot (Sperrvermerk A2) per district. Joint postal boards of several municipalities are matched via the official postal-group code. Districts are summed per municipality and constituency and spread evenly over the municipality's area (BKG VG250) onto a 5 km grid; in Berlin and Hamburg over the constituency area. Every constituency adds up to the official result exactly; the distribution within a municipality is an estimate."}</p>
    <button class="btn" value="close">${t("close")}</button></form>`;
}
