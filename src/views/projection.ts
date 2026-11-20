import { geoPath, geoTransverseMercator } from "d3";
import type { Data } from "../data";
import { H, W } from "./common";

/** Transverse Mercator centred on Germany, fitted to the SVG box (cached per data set). */
let cached: { data: Data; proj: ReturnType<typeof geoTransverseMercator> } | null = null;
export function projectionFor(data: Data) {
  if (cached?.data !== data) {
    const proj = geoTransverseMercator().rotate([-10.4, 0]).fitExtent([[20, 20], [W - 20, H - 20]], data.landFeatures);
    cached = { data, proj };
  }
  return { proj: cached.proj, path: geoPath(cached.proj) };
}
