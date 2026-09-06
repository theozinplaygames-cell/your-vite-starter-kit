import { geoNaturalEarth1, geoPath } from "d3-geo";
import worldRaw from "@/data/world.json";
import countriesRaw from "@/data/countries.json";

export type CountryMeta = {
  id: string;
  name: string;
  en: string;
  region: string;
  subregion: string;
  languages: string[];
  independent: boolean;
  area: number;
};

type RawFeature = { id: string; name: string; geometry: GeoJSON.Geometry };

export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 500;

const features = worldRaw as unknown as RawFeature[];
export const countries = countriesRaw as unknown as CountryMeta[];
export const countryById = new Map(countries.map((c) => [c.id, c]));

const collection = {
  type: "FeatureCollection" as const,
  features: features.map((f) => ({
    type: "Feature" as const,
    id: f.id,
    properties: {},
    geometry: f.geometry,
  })),
};

const projection = geoNaturalEarth1().fitExtent(
  [
    [8, 8],
    [MAP_WIDTH - 8, MAP_HEIGHT - 8],
  ],
  collection,
);
const path = geoPath(projection);

export type Shape = {
  id: string;
  d: string;
  bounds: [[number, number], [number, number]];
};

export const shapes: Shape[] = collection.features
  .map((f) => ({
    id: f.id as string,
    d: path(f) ?? "",
    bounds: path.bounds(f) as [[number, number], [number, number]],
  }))
  .filter((s) => s.d.length > 0);

const shapeById = new Map(shapes.map((s) => [s.id, s]));

/** Combined outline (in map coordinates) hugging every country of a group. */
export function groupOutline(ids: string[]) {
  let d = "";
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const id of ids) {
    const s = shapeById.get(id);
    if (!s) continue;
    d += s.d;
    const [[bx0, by0], [bx1, by1]] = s.bounds;
    if (bx0 < x0) x0 = bx0;
    if (by0 < y0) y0 = by0;
    if (bx1 > x1) x1 = bx1;
    if (by1 > y1) y1 = by1;
  }
  if (!d) return null;
  return { d, labelX: (x0 + x1) / 2, labelY: y0 };
}



export function idsInRegion(region: string) {
  return countries.filter((c) => c.region === region).map((c) => c.id);
}

export function idsInSubregion(subregion: string) {
  return countries.filter((c) => c.subregion === subregion).map((c) => c.id);
}

/** Countries used as quiz answers: independent and big enough to click. */
export const quizPool = countries.filter(
  (c) => c.independent && c.area > 2500 && shapeById.has(c.id),
);
