"""Great-circle distance helper for geo facets (mirrors packages/client/src/geo.ts)."""

import math

# Mean Earth radius in km (IUGG), same constant used by the TS client.
_EARTH_RADIUS_KM = 6371


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two (lat, lon) points in km, via the haversine
    formula (docs/guides/facets.md#geo-facets). Accurate enough for facet-radius
    filtering at this project's "small corpus JSON tier" scale -- the ~0.5% error
    from treating Earth as a perfect sphere is negligible next to a typical filter
    radius.
    """
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return _EARTH_RADIUS_KM * c
