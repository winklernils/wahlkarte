import { Deck, MapView, type MapViewState } from "@deck.gl/core";
import { ColumnLayer, GeoJsonLayer, TextLayer } from "@deck.gl/layers";
import { color as d3color } from "d3";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { type Grid, loadGrid, partyVotes } from "../data";
import { fmt, t } from "../i18n";
import { isDark, partyColor } from "../parties";
import type { Area, ViewCtx, ViewHandle } from "./common";
import { CITIES, gridMax, ramp, rampIndex } from "./style";
import { niceSteps, scaleMax } from "./votes";

// tallest possible column (Germany is ≈ 880 km north–south)
const MAX_HEIGHT_M = { wk: 130_000, land: 260_000, grid: 150_000 };
// 5 km raster: square columns (4-sided "disks" turned 45°), ≈3.4 km wide like the 2D columns
const GRID_RADIUS_M = 2400;

type Item = { area: Area; land: string; lon: number; lat: number; votes: number | null };

const rgb = (hex: string, a = 255): [number, number, number, number] => {
  const c = d3color(hex)!.rgb();
  return [c.r, c.g, c.b, a];
};

/**
 * 3D relief (deck.gl / WebGL): absolute votes as columns or extruded areas per Wahlkreis / Land,
 * or — in the same style as the 2D raster — as ≈14,000 columns on the 5 km grid, coloured on the
 * near-white → party colour → dark ramp on a light plane with city labels.
 */
export function reliefView(el: HTMLElement, ctx0: ViewCtx): ViewHandle {
  let ctx = ctx0;
  let token = 0;
  let grid: Grid | null = null;
  el.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "relief";
  const hint = document.createElement("p");
  hint.className = "relief-hint";
  const reset = document.createElement("button");
  reset.className = "btn small relief-reset";
  const legend = document.createElement("div");
  legend.className = "relief-legend";
  el.append(wrap, hint, reset, legend);

  const pickedArea = (o: unknown): Area | null => {
    if (o === null || o === undefined) return null;
    if (typeof o === "number") return grid ? { kind: "wk", id: grid.wk[o] } : null; // raster cell index
    if ("area" in (o as Item)) return (o as Item).area;
    return (o as Feature<Geometry, { item: Item }>).properties?.item?.area ?? null;
  };

  const fitView = (): MapViewState => {
    const h = wrap.clientHeight || 600;
    const w = wrap.clientWidth || 600;
    const zByH = Math.log2((0.62 * h * 360) / (256 * 1.59 * 8.6));
    const zByW = Math.log2((0.75 * w * 360) / (256 * 9.5));
    return { longitude: 10.45, latitude: 50.9, zoom: Math.min(zByH, zByW), pitch: 50, bearing: -12, maxPitch: 75 };
  };

  let deck: Deck<MapView> | null = null;
  try {
    deck = new Deck({
      parent: wrap,
      views: new MapView({ repeat: false }),
      initialViewState: fitView(),
      controller: { dragRotate: true, touchRotate: true },
      layers: [],
      onHover: (info) => ctx.onHover(pickedArea(info.object)),
      onClick: (info) => {
        const a = pickedArea(info.object);
        if (a) ctx.onPick(a);
      },
      getCursor: ({ isDragging, isHovering }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab"),
    });
  } catch {
    wrap.textContent = t("webglMissing");
  }
  reset.onclick = () => deck?.setProps({ initialViewState: { ...fitView(), transitionDuration: 600 } });

  const legendSteps = (max: number, elevationScale: number, colourOf?: (v: number) => string) => {
    legend.replaceChildren();
    legend.append(
      ...niceSteps(max).map((v) => {
        const s = document.createElement("span");
        s.className = "relief-step";
        if (colourOf) {
          const chip = document.createElement("i");
          chip.className = "relief-chip";
          chip.style.background = colourOf(v);
          s.append(chip);
        }
        s.append(`${fmt(v)} ≙ ${Math.round((v * elevationScale) / 1000)} km`);
        return s;
      }),
    );
  };

  const drawGrid = async (my: number) => {
    const { data, state } = ctx;
    el.classList.add("relief-raster");
    grid = await loadGrid();
    if (my !== token) return;
    const g = grid;
    const max = gridMax(g, state.vote, state.scale === "shared" ? null : state.party);
    const elevationScale = MAX_HEIGHT_M.grid / max;
    const arr = state.party === "UNION" ? null : g[state.vote][state.party];
    const value = (i: number) => (arr ? arr[i] : g[state.vote]["CDU"][i] + g[state.vote]["CSU"][i]);
    const cells: number[] = [];
    for (let i = 0; i < g.lon.length; i++) if (value(i) > 0 && value(i) / max > 0.0015) cells.push(i);
    const colourAt = (i: number) => {
      const r = ramp(partyColor(state.party, data.wkById.get(g.wk[i])?.land));
      return rgb(r.mid[rampIndex(value(i) / max)]);
    };

    deck?.setProps({
      layers: [
        new GeoJsonLayer({
          id: "plane",
          data: data.wkFeatures,
          filled: true,
          stroked: true,
          getFillColor: rgb("#fbfbfd"),
          getLineColor: rgb("#e6e8ef"),
          lineWidthMinPixels: 0.5,
          pickable: true,
        }),
        new GeoJsonLayer({
          id: "laender",
          data: data.landFeatures,
          filled: false,
          stroked: true,
          getLineColor: rgb("#c4c7d4"),
          lineWidthMinPixels: 0.9,
        }),
        new ColumnLayer<number>({
          id: "raster",
          data: cells,
          diskResolution: 4,
          angle: 45,
          radius: GRID_RADIUS_M,
          extruded: true,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 200, 0, 255],
          elevationScale,
          getPosition: (i) => [g.lon[i], g.lat[i]],
          getElevation: (i) => value(i),
          getFillColor: colourAt,
          updateTriggers: { getElevation: [state.party, state.vote, state.scale], getFillColor: [state.party, state.vote, state.scale] },
          // soft light like the 2D lit / shaded column sides
          material: { ambient: 0.62, diffuse: 0.5, shininess: 12, specularColor: [40, 40, 40] },
        }),
        new TextLayer<(typeof CITIES)[number]>({
          id: "cities",
          data: CITIES,
          getPosition: (c) => [c[1], c[2]],
          getText: (c) => c[0].toUpperCase(),
          getPixelOffset: (c) => [c[3] === "r" ? 14 : -14, 0],
          getTextAnchor: (c) => (c[3] === "r" ? "start" : "end"),
          getAlignmentBaseline: "center",
          getSize: 11,
          fontFamily: "Georgia, 'Times New Roman', serif",
          characterSet: "auto",
          getColor: [58, 58, 68, 255],
          fontSettings: { sdf: true },
          outlineWidth: 4,
          outlineColor: [255, 255, 255, 230],
          parameters: { depthCompare: "always" },
        }),
      ],
    });
    legendSteps(max, elevationScale, (v) => ramp(partyColor(state.party, "NW")).mid[rampIndex(v / max)]);
  };

  const draw = () => {
    const my = ++token;
    const { data, state } = ctx;
    hint.textContent = t("tip3d");
    reset.textContent = t("resetView");
    if (state.level === "wk" && state.grid) {
      void drawGrid(my);
      return;
    }
    el.classList.remove("relief-raster");
    const isLand = state.level === "land";
    const max = scaleMax(data, state);
    // whole Länder raised as blocks look massive, so they get half the column height
    const elevationScale = (MAX_HEIGHT_M[isLand ? "land" : "wk"] * (isLand && state.relief === "areas" ? 0.5 : 1)) / max;
    const dark = isDark();
    const baseFill = rgb(dark ? "#2a2a2a" : "#ecebe7");
    const line = rgb(dark ? "#555555" : "#c9c7c0");

    // one item per Wahlkreis or Land
    const items: Item[] = isLand
      ? data.results.laender.map((l) => ({ area: { kind: "land", id: l.id }, land: l.id, lon: l.lon, lat: l.lat,
          votes: partyVotes(l, state.party, state.vote) }))
      : data.results.wahlkreise.map((w) => ({ area: { kind: "wk", id: w.id }, land: w.land, lon: w.lon, lat: w.lat,
          votes: partyVotes(w, state.party, state.vote) }));
    const byKey = new Map(items.map((i) => [String(i.area.id), i]));
    const shapes: FeatureCollection<Geometry, { item: Item }> = {
      type: "FeatureCollection",
      features: isLand
        ? data.landFeatures.features.map((f) => ({ ...f, properties: { item: byKey.get(f.properties.land)! } }))
        : data.wkFeatures.features.map((f) => ({ ...f, properties: { item: byKey.get(String(f.properties.id))! } })),
    };
    const fill = (i: Item) => (i.votes === null ? baseFill : rgb(partyColor(state.party, i.land)));
    const triggers = { getElevation: [state.party, state.vote, state.level], getFillColor: [state.party, dark, state.level] };

    const base = new GeoJsonLayer<{ item: Item }>({
      id: "base",
      data: shapes,
      filled: true,
      stroked: true,
      getFillColor: baseFill,
      getLineColor: line,
      lineWidthMinPixels: isLand ? 1 : 0.5,
      pickable: state.relief === "columns",
      updateTriggers: { getFillColor: [dark] },
    });
    const lands = new GeoJsonLayer({
      id: "laender",
      data: data.landFeatures,
      filled: false,
      stroked: true,
      getLineColor: rgb(dark ? "#9a9a9a" : "#6b6b6b"),
      lineWidthMinPixels: 1.2,
    });
    const layers =
      state.relief === "columns"
        ? [
            base,
            lands,
            new ColumnLayer<Item>({
              id: "columns",
              data: items.filter((i) => (i.votes ?? 0) > 0),
              diskResolution: isLand ? 24 : 16,
              radius: isLand ? 15000 : 3600,
              extruded: true,
              pickable: true,
              autoHighlight: true,
              highlightColor: [255, 200, 0, 255],
              elevationScale,
              getPosition: (i) => [i.lon, i.lat],
              getElevation: (i) => i.votes ?? 0,
              getFillColor: fill,
              updateTriggers: triggers,
              material: { ambient: 0.55, diffuse: 0.6, shininess: 20 },
            }),
          ]
        : [
            new GeoJsonLayer<{ item: Item }>({
              id: "areas",
              data: shapes,
              extruded: true,
              filled: true,
              stroked: false,
              wireframe: true,
              pickable: true,
              autoHighlight: true,
              highlightColor: [255, 200, 0, 255],
              elevationScale,
              getElevation: (f) => f.properties.item.votes ?? 0,
              getFillColor: (f) => fill(f.properties.item),
              getLineColor: rgb(dark ? "#000000" : "#ffffff", 140),
              updateTriggers: triggers,
              material: { ambient: 0.5, diffuse: 0.6, shininess: 10 },
            }),
            lands,
          ];
    deck?.setProps({ layers });
    legendSteps(max, elevationScale);
  };
  draw();
  return {
    update: (c) => ((ctx = c), draw()),
    destroy: () => {
      token++;
      deck?.finalize();
      el.classList.remove("relief-raster");
      el.replaceChildren();
    },
  };
}
