/**
 * Synthetic product-catalog corpus for the Stage 2 feature gallery
 * (docs/archive/roadmaps/github-pages-showcase.md#stage-2--feature-gallery-needs-phases-2-5):
 * enough products, spread across categories/price buckets/tags, to make
 * facets, boosts, and pins demonstrable, without being a real dataset a
 * visitor might mistake for actual inventory.
 */

export interface Product {
  id: number;
  slug: string;
  name: string;
  category: string;
  price: number;
  /** Bucketed terms facet retained for this gallery UI; the engine also supports numeric range facets. */
  priceBucket: string;
  tags: string[];
  featured: boolean;
  description: string;
  /** Pickup-store name, indexed via searchable-facet-geo-storeLocation (docs/guides/facets.md#geo-facets). */
  storeName: string;
  storeLocation: { lat: number; lon: number };
  /** Stored (not indexed, not faceted) via searchable-stored-sku (docs/guides/facets.md#exact-match-on-stored-fields). */
  sku: string;
}

interface StoreDef {
  name: string;
  lat: number;
  lon: number;
}

/**
 * One pickup location per product, assigned deterministically below.
 * London/New York/Tokyo/Sydney/Berlin stay ~5500-9700 km apart so a modest
 * search radius cleanly separates them for the "near me" demo. Stockholm is
 * the deliberate exception -- only ~811 km from Berlin -- so the geo quick
 * example (centered on Stockholm) has a near neighbor that a widened radius
 * pulls in, not just an all-or-nothing radius toggle.
 */
const STORES: StoreDef[] = [
  { name: "London", lat: 51.5074, lon: -0.1278 },
  { name: "New York", lat: 40.7128, lon: -74.006 },
  { name: "Tokyo", lat: 35.6762, lon: 139.6503 },
  { name: "Sydney", lat: -33.8688, lon: 151.2093 },
  { name: "Berlin", lat: 52.52, lon: 13.405 },
  { name: "Stockholm", lat: 59.3293, lon: 18.0686 },
];

interface CategoryDef {
  nouns: string[];
  adjectives: string[];
  tags: string[];
}

const CATEGORIES: Record<string, CategoryDef> = {
  Furniture: {
    nouns: [
      "Accent Table",
      "Standing Desk",
      "Bookshelf",
      "Recliner Chair",
      "Bar Stool",
      "Storage Ottoman",
      "Coffee Table",
      "Bed Frame",
    ],
    adjectives: [
      "Walnut",
      "Oak",
      "Modern",
      "Compact",
      "Mid-Century",
      "Industrial",
      "Scandinavian",
      "Reclaimed-Wood",
    ],
    tags: ["wood", "modern", "compact", "handmade", "assembly-required"],
  },
  Electronics: {
    nouns: [
      "Wireless Mouse",
      "Bluetooth Speaker",
      "Noise-Canceling Headphones",
      "Mechanical Keyboard",
      "Portable Charger",
      "Webcam",
      "Smart Plug",
      "USB-C Hub",
    ],
    adjectives: [
      "Compact",
      "Rechargeable",
      "Wireless",
      "Ergonomic",
      "Premium",
      "Travel",
      "Studio",
      "Pro",
    ],
    tags: [
      "wireless",
      "rechargeable",
      "compact",
      "travel-friendly",
      "bluetooth",
    ],
  },
  "Office Supplies": {
    nouns: [
      "Notebook Set",
      "Desk Organizer",
      "Pen Collection",
      "Whiteboard",
      "File Cabinet",
      "Sticky Note Pack",
      "Stapler",
      "Label Maker",
    ],
    adjectives: [
      "Eco-Friendly",
      "Bulk",
      "Compact",
      "Recycled",
      "Premium",
      "Classic",
      "Minimalist",
      "Desk",
    ],
    tags: ["eco-friendly", "bulk", "desk", "recycled", "classic"],
  },
  Outdoor: {
    nouns: [
      "Camping Tent",
      "Hiking Backpack",
      "Insulated Cooler",
      "Folding Chair",
      "Rain Jacket",
      "Water Bottle",
      "Trekking Poles",
      "Sleeping Bag",
    ],
    adjectives: [
      "Waterproof",
      "Portable",
      "Durable",
      "Lightweight",
      "All-Season",
      "Compact",
      "Rugged",
      "Insulated",
    ],
    tags: ["waterproof", "portable", "durable", "lightweight", "all-season"],
  },
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function priceBucketFor(price: number): string {
  if (price < 25) return "Under $25";
  if (price < 100) return "$25–$100";
  if (price < 500) return "$100–$500";
  return "$500+";
}

/** [min, max) for each bucket, in the same order priceBucketFor checks them. */
const PRICE_BUCKET_RANGES: [number, number][] = [
  [5, 25],
  [25, 100],
  [100, 500],
  [500, 1000],
];

/**
 * Deterministic (not random) so the corpus -- and every demo assertion
 * against it -- is stable across builds. Two adjective/noun variants
 * per category noun give 64 products across 4 categories, spread
 * across all four price buckets by construction.
 */
export function generateProducts(): Product[] {
  const products: Product[] = [];
  let id = 1;
  for (const [category, { nouns, adjectives, tags }] of Object.entries(
    CATEGORIES,
  )) {
    for (let i = 0; i < nouns.length; i++) {
      for (let variant = 0; variant < 2; variant++) {
        const noun = nouns[i] as string;
        const adjective = adjectives[
          (i + variant * 3) % adjectives.length
        ] as string;
        const name = `${adjective} ${noun}`;
        const [bucketMin, bucketMax] = PRICE_BUCKET_RANGES[
          id % PRICE_BUCKET_RANGES.length
        ] as [number, number];
        const price =
          bucketMin + ((id * 47 + variant * 131) % (bucketMax - bucketMin));
        const tag1 = tags[id % tags.length] as string;
        const tag2 = tags[(id + 2) % tags.length] as string;
        const itemTags = [...new Set([tag1, tag2])];
        const featured = id % 9 === 0;
        const store = STORES[id % STORES.length] as StoreDef;
        products.push({
          id,
          slug: slugify(`${category}-${name}-${id}`),
          name,
          category,
          price,
          priceBucket: priceBucketFor(price),
          tags: itemTags,
          featured,
          storeName: store.name,
          storeLocation: { lat: store.lat, lon: store.lon },
          sku: `SKU-${String(id).padStart(5, "0")}`,
          description:
            `${featured ? "Featured pick. " : ""}The ${name} is a ${itemTags.join(" and ")} product ` +
            `in our ${category} catalog, priced at $${price}. Available for pickup at our ${store.name} store.`,
        });
        id++;
      }
    }
  }
  return products;
}
