import { tryParseInt32 } from './int32';

/**
 * An "x, y" pair as people type and paste it: "960,540", "960, 540", "960;540" or "960 540",
 * signed (a monitor left of / above the primary is negative). Both numbers are required, and both
 * must fit the C# int they become — past it the backend refuses the whole edit, so this says no
 * first. null = not a pair.
 *
 * One reader for the two surfaces that take a pair: the grid's inline coords editor and the
 * Sheet's Paste coordinates. They used to carry their own regexes, and only the grid's took ";".
 */
export function parseCoordPair(text: string): { x: number; y: number } | null {
  const m = text.trim().match(/^(-?\d+)\s*[,;\s]\s*(-?\d+)$/);
  if (!m) return null;
  const x = tryParseInt32(m[1]);
  const y = tryParseInt32(m[2]);
  return x == null || y == null ? null : { x, y };
}
