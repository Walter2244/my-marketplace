import type { Requester } from "./core.js";

// A district shows its price only once it has enough completed sales. Below that it says so.
export type PriceGuideEntry =
  | { province: string; district: string; status: "NOT_ENOUGH_DATA"; sales: number }
  | { province: string; district: string; status: "OK"; sales: number; medianUnitCents: number };

export type PriceGuide = {
  categoryId: number;
  minimumSales: number;
  districts: PriceGuideEntry[];
};

export function createPriceIndexApi(request: Requester) {
  return {
    guide: (params: { categoryId: number; province?: string; district?: string }) =>
      request<PriceGuide>("GET", "/price-index", { query: params }),
  };
}
