import countriesRaw from "@/data/countries.json";
import worldRaw from "@/data/world.json";

type RawFeature = { id: string };
type RawCountry = { id: string; independent: boolean; area: number };

const shapeIds = new Set((worldRaw as unknown as RawFeature[]).map((f) => f.id));

const pool = (countriesRaw as unknown as RawCountry[])
  .filter((c) => c.independent && c.area > 2500 && shapeIds.has(c.id))
  .map((c) => c.id);

export const ROUNDS = 5;

export function pickCountries(n = ROUNDS): string[] {
  const copy = [...pool];
  const out: string[] = [];
  while (out.length < n && copy.length) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]!);
  }
  return out;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeCode() {
  let s = "";
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
