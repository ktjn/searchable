/** Mean Earth radius in km (IUGG), same constant used by python/searchable/src/searchable/client/geo.py. */
const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance between two (lat, lon) points in km, via the
 * haversine formula (docs/guides/facets.md#geo-facets). Accurate enough for
 * facet-radius filtering at this project's "small corpus JSON tier" scale
 * (docs/guides/indexing.md#what-to-simplify-at-this-scale) -- the ~0.5%
 * error from treating Earth as a perfect sphere is negligible next to a
 * typical filter radius.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}
