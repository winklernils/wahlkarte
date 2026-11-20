import { color as d3color, interpolateLab, select } from "d3";
import { CITIES, RAMP_STEPS, gridMax, ramp, rampIndex } from "./style";
import type { Feature, Geometry } from "geojson";
import { type AreaResult, loadGrid, partyVotes } from "../data";
import { fmt, getLang, t } from "../i18n";
import { partyColor } from "../parties";
import { type Area, type ViewCtx, type ViewHandle, H, W, interactive } from "./common";
import { projectionFor } from "./projection";
import { niceSteps, scaleMax } from "./votes";

/**
 * 2D spike map in the style of population-density spike maps: the map plane is tilted
 * (squashed vertically) and spikes rise straight up, drawn from back (north) to front (south)
 * so nearer spikes hide farther ones and the result reads as a relief.
 *
 * The 5 km grid is drawn like rendered population-density maps (e.g. rayshader renders):
 * slim filled columns with a lit and a shaded side, coloured on a ramp from almost white (few
 * votes) through the party colour to a dark shade of it (most votes), on a light, softly shadowed
 * plane. A fairly steep view (little squash) keeps columns from hiding much of the land behind.
 */
const STYLE = {
  grid: { maxH: 175, w: 3.8, stroke: 0, tilt: 0.74 },
  wk: { maxH: 105, w: 6, stroke: 1, tilt: 0.6 },
  land: { maxH: 230, w: 22, stroke: 1.5, tilt: 0.6 },
};
const MARGIN_TOP = 20;

type Spike = { x: number; y: number; v: number; color: string; area?: Area };

export function spikesView(el: HTMLElement, ctx0: ViewCtx): ViewHandle {
  let ctx = ctx0;
  let token = 0;
  let observer: ResizeObserver | null = null;

  const draw = async () => {
    const my = ++token;
    const { data, state } = ctx;
    const mode: keyof typeof STYLE = state.level === "land" ? "land" : state.grid ? "grid" : "wk";
    const st = STYLE[mode];
    const { proj, path } = projectionFor(data);
    const TILT = st.tilt;
    const top = st.maxH + MARGIN_TOP;
    const vbH = Math.ceil(top + H * TILT + 20);
    const P = (lon: number, lat: number): [number, number] => {
      const [x, y] = proj([lon, lat])!;
      return [x, top + y * TILT];
    };

    observer?.disconnect();
    observer = null;
    el.replaceChildren();
    const svg = select(el).append("svg")
      .attr("viewBox", `0 0 ${W} ${vbH}`)
      .attr("role", "img")
      .attr("aria-label", t("view.spikes"))
      .attr("class", mode === "grid" ? "map-svg spikes-svg spikes-grid" : "map-svg spikes-svg");

    // tilted base map
    const plane = svg.append("g").attr("class", "plane").attr("transform", `translate(0,${top}) scale(1,${TILT})`);
    if (mode === "land") {
      interactive(
        plane.append("g")
          .selectAll<SVGPathElement, Feature<Geometry, { land: string }>>("path")
          .data(data.landFeatures.features)
          .join("path")
          .attr("d", path)
          .attr("class", "wk-base land-base"),
        (f) => ({ kind: "land", id: f.properties.land }),
        () => ctx,
      );
    } else {
      interactive(
        plane.append("g")
          .selectAll<SVGPathElement, Feature<Geometry, { id: number }>>("path")
          .data(data.wkFeatures.features)
          .join("path")
          .attr("d", path)
          .attr("class", "wk-base"),
        (f) => ({ kind: "wk", id: f.properties.id }),
        () => ctx,
      );
      plane.append("g").selectAll("path").data(data.landFeatures.features).join("path")
        .attr("d", path).attr("class", "land-border");
    }

    // spikes
    let spikes: Spike[];
    let max: number;
    if (mode === "grid") {
      const loading = svg.append("text").attr("class", "spike-loading").attr("x", W / 2).attr("y", vbH / 2).text(t("loading"));
      const grid = await loadGrid();
      if (my !== token) return; // a newer draw started meanwhile
      loading.remove();
      max = gridMax(grid, state.vote, state.scale === "shared" ? null : state.party);
      const arr = state.party === "UNION" ? null : grid[state.vote][state.party];
      spikes = [];
      for (let i = 0; i < grid.lon.length; i++) {
        const v = arr ? arr[i] : grid[state.vote]["CDU"][i] + grid[state.vote]["CSU"][i];
        if (!(v > 0) || (v / max) * st.maxH < 0.25) continue; // practically empty cells stay flat
        const [x, y] = P(grid.lon[i], grid.lat[i]);
        const land = data.wkById.get(grid.wk[i])?.land;
        spikes.push({ x, y, v, color: partyColor(state.party, land) });
      }
    } else {
      max = scaleMax(data, state);
      const src: { a: AreaResult & { lon: number; lat: number }; area: Area; land: string }[] =
        mode === "land"
          ? data.results.laender.map((l) => ({ a: l, area: { kind: "land", id: l.id } as Area, land: l.id }))
          : data.results.wahlkreise.map((w) => ({ a: w, area: { kind: "wk", id: w.id } as Area, land: w.land }));
      spikes = src.flatMap((d) => {
        const v = partyVotes(d.a, state.party, state.vote);
        if (!v) return [];
        const [x, y] = P(d.a.lon, d.a.lat);
        return [{ x, y, v, color: partyColor(state.party, d.land), area: d.area }];
      });
    }
    spikes.sort((a, b) => a.y - b.y || a.x - b.x); // back to front
    const h = (v: number) => (v / max) * st.maxH;
    const tint = (c: string) => d3color(interpolateLab("#ffffff", c)(mode === "grid" ? 0.16 : 0.22))!.formatHex();
    const spikePath = (s: Spike) =>
      `M${(s.x - st.w / 2).toFixed(1)},${s.y.toFixed(1)}L${s.x.toFixed(1)},${(s.y - h(s.v)).toFixed(1)}L${(s.x + st.w / 2).toFixed(1)},${s.y.toFixed(1)}`;

    const layer = svg.append("g").attr("class", "spikes");
    if (mode === "grid") {
      // ≈14,000 columns: drawn on a canvas laid exactly over the SVG (the SVG map below keeps hover)
      const canvas = document.createElement("canvas");
      canvas.className = "spike-canvas";
      canvas.setAttribute("aria-hidden", "true");
      el.append(canvas);
      const cities = CITIES.map(([name, lon, lat, side]) => ({ name, side, p: P(lon, lat) }));
      const paint = () => {
        const svgEl = svg.node()!;
        const r = svgEl.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        if (!r.width) return;
        const k = Math.min(r.width / W, r.height / vbH);
        const ox = (r.width - W * k) / 2, oy = (r.height - vbH * k) / 2;
        const dpr = window.devicePixelRatio || 1;
        Object.assign(canvas.style, { left: `${r.left - er.left}px`, top: `${r.top - er.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
        const g = canvas.getContext("2d")!;
        g.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
        g.clearRect(0, 0, W, vbH);
        const half = st.w / 2;
        for (const sp of spikes) {
          const hh = h(sp.v);
          const rp = ramp(sp.color);
          const i = rampIndex(hh / st.maxH);
          if (hh < 1.2) { // flat texture
            g.fillStyle = rp.mid[i];
            g.fillRect(sp.x - half, sp.y - Math.max(hh, 0.5), st.w, Math.max(hh, 0.5));
            continue;
          }
          g.fillStyle = rp.lit[i];
          g.fillRect(sp.x - half, sp.y - hh, half, hh);
          g.fillStyle = rp.shade[i];
          g.fillRect(sp.x, sp.y - hh, half, hh);
          g.fillStyle = rp.lit[Math.min(RAMP_STEPS - 1, i + 4)]; // bright cap
          g.fillRect(sp.x - half, sp.y - hh, st.w, 0.8);
        }
        // city labels with thin leader lines, drawn last so they stay readable
        g.font = "10px Georgia, 'Times New Roman', serif";
        g.textBaseline = "middle";
        for (const c of cities) {
          const [x, y] = c.p;
          const dir = c.side === "r" ? 1 : -1;
          const tx = x + dir * 22;
          g.strokeStyle = "rgba(60,60,70,0.55)";
          g.lineWidth = 0.6;
          g.beginPath();
          g.moveTo(x + dir * 3, y);
          g.lineTo(tx - dir * 2, y);
          g.stroke();
          const label = c.name.toUpperCase();
          g.textAlign = c.side === "r" ? "left" : "right";
          g.lineWidth = 3;
          g.strokeStyle = "rgba(255,255,255,0.85)";
          g.strokeText(label, tx, y);
          g.fillStyle = "#3a3a44";
          g.fillText(label, tx, y);
        }
      };
      paint();
      observer = new ResizeObserver(() => paint());
      observer.observe(el);
    } else {
      interactive(
        layer.selectAll<SVGPathElement, Spike>("path")
          .data(spikes)
          .join("path")
          .attr("d", (s) => spikePath(s) + "Z")
          .attr("fill", (s) => tint(s.color))
          .attr("stroke", (s) => s.color)
          .attr("stroke-width", st.stroke)
          .attr("class", "spike"),
        (s) => s.area!,
        () => ctx,
      );
    }

    if (mode === "land") {
      svg.append("g").attr("class", "spike-values")
        .selectAll("text")
        .data(spikes)
        .join("text")
        .attr("x", (d) => d.x)
        .attr("y", (d) => d.y - h(d.v) - 5)
        .text((d) => (d.v >= 1e6 ? `${fmt(Math.round(d.v / 1e5) / 10)} ${getLang() === "de" ? "Mio." : "M"}` : `${fmt(Math.round(d.v / 1e3))}k`));
    }

    // height legend in the empty corner east of Bavaria (bottom right)
    const lg = svg.append("g").attr("class", "spike-legend").attr("transform", `translate(${W - 190}, ${vbH - 30})`);
    const col = partyColor(state.party, "NW");
    niceSteps(max).forEach((v, i) => {
      const x = i * 70;
      if (mode === "grid") {
        const rp = ramp(col);
        const j = rampIndex(h(v) / st.maxH);
        lg.append("rect").attr("x", x - 3).attr("y", -h(v)).attr("width", 3).attr("height", h(v)).attr("fill", rp.lit[j]);
        lg.append("rect").attr("x", x).attr("y", -h(v)).attr("width", 3).attr("height", h(v)).attr("fill", rp.shade[j]);
      } else {
        lg.append("path")
          .attr("d", `M${x - st.w / 2},0L${x},${-h(v)}L${x + st.w / 2},0Z`)
          .attr("fill", tint(col)).attr("stroke", col).attr("stroke-width", st.stroke);
      }
      lg.append("text").attr("x", x).attr("y", 14).attr("text-anchor", "middle").text(fmt(v));
    });
  };

  void draw();
  return {
    update: (c) => ((ctx = c), void draw()),
    destroy: () => {
      token++;
      observer?.disconnect();
      el.replaceChildren();
    },
  };
}


