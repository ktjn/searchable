/**
 * Purpose-built corpus for the geo-search examples. Each document represents
 * one distinct pickup location so distance ranking cannot fill the visible
 * result window with several products that share the same coordinates.
 */

export interface PickupLocation {
  id: number;
  slug: string;
  title: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  description: string;
}

export const PICKUP_LOCATIONS: readonly PickupLocation[] = [
  {
    id: 1,
    slug: "stockholm-central",
    title: "Stockholm Central Pickup",
    city: "Stockholm",
    country: "Sweden",
    lat: 59.3309,
    lon: 18.0583,
    description:
      "Pickup location beside Stockholm Central Station, open every day.",
  },
  {
    id: 2,
    slug: "helsinki-central",
    title: "Helsinki Central Pickup",
    city: "Helsinki",
    country: "Finland",
    lat: 60.1699,
    lon: 24.9384,
    description:
      "Pickup location near Helsinki Central Station, open every day.",
  },
  {
    id: 3,
    slug: "oslo-central",
    title: "Oslo Central Pickup",
    city: "Oslo",
    country: "Norway",
    lat: 59.9139,
    lon: 10.7522,
    description: "Pickup location beside Oslo Central Station, open daily.",
  },
  {
    id: 4,
    slug: "copenhagen-central",
    title: "Copenhagen Central Pickup",
    city: "Copenhagen",
    country: "Denmark",
    lat: 55.6761,
    lon: 12.5683,
    description:
      "Pickup location near Copenhagen Central Station, open every day.",
  },
  {
    id: 5,
    slug: "berlin-mitte",
    title: "Berlin Mitte Pickup",
    city: "Berlin",
    country: "Germany",
    lat: 52.52,
    lon: 13.405,
    description: "Pickup location in Berlin Mitte, open Monday to Saturday.",
  },
  {
    id: 6,
    slug: "london-city",
    title: "London City Pickup",
    city: "London",
    country: "United Kingdom",
    lat: 51.5074,
    lon: -0.1278,
    description: "Pickup location in central London, open every day.",
  },
  {
    id: 7,
    slug: "paris-centre",
    title: "Paris Centre Pickup",
    city: "Paris",
    country: "France",
    lat: 48.8566,
    lon: 2.3522,
    description: "Pickup location in central Paris, open Monday to Saturday.",
  },
  {
    id: 8,
    slug: "new-york-midtown",
    title: "New York Midtown Pickup",
    city: "New York",
    country: "United States",
    lat: 40.7128,
    lon: -74.006,
    description: "Pickup location in Midtown Manhattan, open every day.",
  },
  {
    id: 9,
    slug: "san-francisco-market",
    title: "San Francisco Market Pickup",
    city: "San Francisco",
    country: "United States",
    lat: 37.7749,
    lon: -122.4194,
    description: "Pickup location near Market Street, open every day.",
  },
  {
    id: 10,
    slug: "tokyo-station",
    title: "Tokyo Station Pickup",
    city: "Tokyo",
    country: "Japan",
    lat: 35.6762,
    lon: 139.6503,
    description: "Pickup location near Tokyo Station, open every day.",
  },
  {
    id: 11,
    slug: "singapore-downtown",
    title: "Singapore Downtown Pickup",
    city: "Singapore",
    country: "Singapore",
    lat: 1.3521,
    lon: 103.8198,
    description: "Pickup location in downtown Singapore, open every day.",
  },
  {
    id: 12,
    slug: "sydney-central",
    title: "Sydney Central Pickup",
    city: "Sydney",
    country: "Australia",
    lat: -33.8688,
    lon: 151.2093,
    description: "Pickup location near Sydney Central, open every day.",
  },
];
