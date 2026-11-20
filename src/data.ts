import * as topojson from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";

export type VoteKey = "e" | "z"; // e = Erststimme, z = Zweitstimme

export interface AreaResult {
  name: string;
  eligible: number;
  voters: number;
  invalid: [number, number];
  valid: [number, number];
  e: Record<string, number>;
  z: Record<string, number>;
}
export interface WahlkreisResult extends AreaResult {
  id: number;
  land: string;
  seated: string | null;
  pop: number;
  area: number;
  lon: number;
  lat: number;
}
export interface LandResult extends AreaResult {
  id: string;
  nr: string;
  lon: number;
  lat: number;
}
export interface Results {
  meta: { election: string; date: string; status: string; status_date: string };
  bund: AreaResult;
  laender: LandResult[];
  wahlkreise: WahlkreisResult[];
}
export interface HexLayout {
  side: number;
  dx: number;
  dy: number;
  cells: { id: number; land: string; col: number; row: number; x: number; y: number }[];
}
export interface CircleItem<T> {
  id: T;
  x: number;
  y: number;
  r: number;
}
export type SizeMeasure = "eligible" | "valid";
export interface CircleLayout {
  wahlkreis: Record<SizeMeasure, { k: number; items: CircleItem<number>[] }>;
  land: Record<SizeMeasure, { k: number; items: CircleItem<string>[] }>;
}
export interface Source {
  id: string;
  file: string;
  url: string;
  page: string;
  title_de: string;
  title_en: string;
  licence: string;
  retrieved: string;
  sha256: string;
  bytes: number;
}
type FeatureProps = { id: number; land: string };
/** Municipality (Gemeinde) × Wahlkreis area; Berlin and Hamburg: the Wahlkreis itself. */
export interface GemResult extends AreaResult {
  id: string;
  wk: number;
  land: string;
  split: boolean;
}
export interface GemData {
  features: FeatureCollection<Geometry, { id: string }>;
  byId: Map<string, GemResult>;
}
export interface Data {
  results: Results;
  wkById: Map<number, WahlkreisResult>;
  landById: Map<string, LandResult>;
  wkFeatures: FeatureCollection<Geometry, FeatureProps>;
  landFeatures: FeatureCollection<Geometry, { land: string }>;
  hex: HexLayout;
  circles: CircleLayout;
  sources: Source[];
  /** loaded on demand by loadGem() */
  gem?: GemData;
}

const base = import.meta.env.BASE_URL;
const getJSON = <T>(f: string): Promise<T> =>
  fetch(`${base}data/${f}`).then((r) => {
    if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
    return r.json() as Promise<T>;
  });

export async function loadData(): Promise<Data> {
  const [results, topo, hex, circles, sources] = await Promise.all([
    getJSON<Results>("results.json"),
    getJSON<Topology>("geo.topo.json"),
    getJSON<HexLayout>("layout_hex.json"),
    getJSON<CircleLayout>("layout_circles.json"),
    getJSON<Source[]>("sources.json"),
  ]);
  const wkFeatures = topojson.feature(
    topo,
    topo.objects.wahlkreise as GeometryCollection<FeatureProps>,
  ) as FeatureCollection<Geometry, FeatureProps>;
  const landFeatures = topojson.feature(
    topo,
    topo.objects.laender as GeometryCollection<{ land: string }>,
  ) as FeatureCollection<Geometry, { land: string }>;
  return {
    results,
    wkById: new Map(results.wahlkreise.map((w) => [w.id, w])),
    landById: new Map(results.laender.map((l) => [l.id, l])),
    wkFeatures,
    landFeatures,
    hex,
    circles,
    sources,
  };
}

export interface Grid {
  cell_km: number;
  lon: number[];
  lat: number[];
  wk: number[];
  e: Record<string, number[]>;
  z: Record<string, number[]>;
}
let gemPromise: Promise<GemData> | null = null;
/** Municipality map (≈2 MB boundaries + 3.5 MB results, loaded only when the level is chosen). */
export function loadGem(data: Data): Promise<GemData> {
  gemPromise ??= Promise.all([getJSON<Topology>("gemeinden.topo.json"), getJSON<GemResult[]>("gemeinden.json")]).then(
    ([topo, rows]) => {
      const features = topojson.feature(
        topo,
        topo.objects.gemeinden as GeometryCollection<{ id: string }>,
      ) as FeatureCollection<Geometry, { id: string }>;
      const gem = { features, byId: new Map(rows.map((r) => [r.id, r])) };
      data.gem = gem;
      return gem;
    },
  );
  return gemPromise;
}

let gridPromise: Promise<Grid> | null = null;
/** 5 km vote grid for the dense spike map (≈1.2 MB, loaded only when needed). */
export const loadGrid = () => (gridPromise ??= getJSON<Grid>("grid.json"));

/** Votes of a selectable party in an area; "UNION" = CDU + CSU. `null` = party not on the ballot there. */
export function partyVotes(a: AreaResult, party: string, vote: VoteKey): number | null {
  const v = a[vote];
  if (party === "UNION") {
    const s = (v["CDU"] ?? 0) + (v["CSU"] ?? 0);
    return "CDU" in v || "CSU" in v ? s : null;
  }
  return party in v ? v[party] : null;
}

export interface Winner {
  party: string;
  share: number; // % of valid votes
  margin: number; // percentage points ahead of the runner-up
  runnerUp: string | null;
}
export function winner(a: AreaResult, vote: VoteKey): Winner {
  const valid = a.valid[vote === "e" ? 0 : 1];
  // "Übrige" = remaining individual candidates taken together, not a party
  const [first, second] = Object.entries(a[vote]).filter(([p]) => p !== "Übrige").sort((x, y) => y[1] - x[1]);
  return {
    party: first[0],
    share: (100 * first[1]) / valid,
    margin: (100 * (first[1] - (second?.[1] ?? 0))) / valid,
    runnerUp: second?.[0] ?? null,
  };
}

export const turnout = (a: AreaResult) => (100 * a.voters) / a.eligible;
