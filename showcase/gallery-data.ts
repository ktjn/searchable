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
}

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

export function priceBucketFor(price: number): string {
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
        products.push({
          id,
          slug: slugify(`${category}-${name}-${id}`),
          name,
          category,
          price,
          priceBucket: priceBucketFor(price),
          tags: itemTags,
          featured,
          description:
            `${featured ? "Featured pick. " : ""}The ${name} is a ${itemTags.join(" and ")} product ` +
            `in our ${category} catalog, priced at $${price}.`,
        });
        id++;
      }
    }
  }
  return products;
}
