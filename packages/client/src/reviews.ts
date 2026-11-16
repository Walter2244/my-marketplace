import type { Requester } from "./core.js";

export type Review = { id: number; rating: number; comment: string | null };

export type DisputeDecision = "RESOLVED_FOR_BUYER" | "RESOLVED_FOR_VENDOR";

export type DisputeStatus = "OPEN" | DisputeDecision;

export type DisputeSummary = { id: number; status: DisputeStatus };

// Public figures only. Disputes are never part of a vendor's rating.
export type VendorRating = { vendorId: number; reviewCount: number; averageRating: number | null };

export function createReviewsApi(request: Requester) {
  return {
    reviews: {
      create: (token: string, subOrderId: number, input: { rating: number; comment?: string }) =>
        request<Review>("POST", `/reviews/sub-orders/${subOrderId}/review`, { token, body: input }),
      vendorRating: (vendorId: number) =>
        request<VendorRating>("GET", `/reviews/vendors/${vendorId}/rating`),
    },
    disputes: {
      open: (token: string, subOrderId: number, reason: string) =>
        request<DisputeSummary>("POST", `/reviews/sub-orders/${subOrderId}/dispute`, { token, body: { reason } }),
      decide: (adminToken: string, disputeId: number, decision: DisputeDecision, note: string) =>
        request<DisputeSummary>("POST", `/reviews/disputes/${disputeId}/decide`, {
          token: adminToken,
          body: { decision, note },
        }),
    },
  };
}
