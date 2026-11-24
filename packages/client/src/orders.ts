import type { Requester } from "./core.js";

export type OrderStatus = "PENDING_PAYMENT" | "PAID" | "FULFILLED" | "CANCELLED" | "EXPIRED";
export type UnitOfSale = "EACH" | "PER_HEAD" | "PER_KG" | "PER_CRATE";
export type DeliveryMethod = "NONE" | "COLLECTION" | "FLAT_FEE" | "QUOTE";

export type DeliveryAddress = {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
};

// One choice per vendor, keyed by the vendor's id as a string
export type DeliveryChoices = Record<string, { method: DeliveryMethod; quoteRef?: string }>;

export type CheckoutInput = { delivery: DeliveryAddress; deliveryChoices?: DeliveryChoices };

export type OrderItem = {
  productId: number;
  title: string | null;
  quantity: number;
  unitCents: number;
  unitOfSale: UnitOfSale;
};

export type SubOrder = {
  id: number;
  status: OrderStatus;
  totalCents: number;
  vendor: { id: number; name: string };
  items: OrderItem[];
};

export type Order = {
  id: number;
  status: OrderStatus;
  currency: string;
  totalCents: number;
  expiresAt: string;
  createdAt: string;
  subOrders: SubOrder[];
};

export function createOrdersApi(request: Requester) {
  return {
    checkout: (token: string, input: CheckoutInput) =>
      request<Order>("POST", "/orders/checkout", { token, body: input }),
    list: (token: string) => request<Order[]>("GET", "/orders", { token }),
    get: (token: string, id: number) => request<Order>("GET", `/orders/${id}`, { token }),
    cancel: (token: string, id: number) => request<Order>("POST", `/orders/${id}/cancel`, { token }),
  };
}
