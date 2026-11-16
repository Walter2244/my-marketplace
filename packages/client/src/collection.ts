import type { Requester } from "./core.js";

export type CollectionChoice = {
  id: number;
  fulfilment: "DELIVERY" | "COLLECTION";
  collectionPreferredTime: string | null;
};

// The code is returned once, to the vendor, to pass to the buyer. It is never shown again.
export type CollectionReady = { id: number; readyAt: string; collectionCode: string; note: string };

export type SubOrderStatus = "PENDING_PAYMENT" | "PAID" | "FULFILLED" | "CANCELLED" | "EXPIRED";

export type HandoverResult = { id: number; status: SubOrderStatus };

export function createCollectionApi(request: Requester) {
  return {
    choose: (token: string, subOrderId: number, preferredTime: string) =>
      request<CollectionChoice>("POST", `/collection/sub-orders/${subOrderId}/choose`, {
        token,
        body: { preferredTime },
      }),
    markReady: (token: string, subOrderId: number) =>
      request<CollectionReady>("POST", `/collection/sub-orders/${subOrderId}/ready`, { token }),
    handover: (token: string, subOrderId: number, code: string) =>
      request<HandoverResult>("POST", `/collection/sub-orders/${subOrderId}/handover`, {
        token,
        body: { code },
      }),
  };
}
