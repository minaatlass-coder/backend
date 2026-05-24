export type ProductSlug = "vitalstride" | "restwave" | "floraease";

interface CatalogProduct {
  slug: ProductSlug;
  nameFr: string;
  price: number;
  upsellPrice: number;
}

export const products: Record<ProductSlug, CatalogProduct> = {
  vitalstride: {
    slug: "vitalstride",
    nameFr: "VitalStride — Confort articulations & dos",
    price: 279,
    upsellPrice: 219,
  },
  restwave: {
    slug: "restwave",
    nameFr: "RestWave — Magnésium glycinate, formule nuit",
    price: 189,
    upsellPrice: 139,
  },
  floraease: {
    slug: "floraease",
    nameFr: "FloraEase — Confort digestif quotidien",
    price: 199,
    upsellPrice: 149,
  },
};
