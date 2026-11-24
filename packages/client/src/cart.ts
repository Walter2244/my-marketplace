import type { Requester } from "./core.js";

export type CartProduct = {
  id: number;
  title: string;
  priceCents: number;
  currency: string;
  vendor: { id: number; name: string };
  quantity: number | null;
  inStock: boolean;
};

export type CartLine = {
  id: number;
  quantity: number;
  available: boolean;
  product: CartProduct;
  lineTotalCents: number;
};

// The whole cart, returned after every change so the screen can redraw from one response
export type Cart = {
  currency: string | null;
  totalCents: number;
  allAvailable: boolean;
  items: CartLine[];
};

export function createCartApi(request: Requester) {
  return {
    get: (token: string) => request<Cart>("GET", "/cart", { token }),
    addItem: (token: string, productId: number, quantity = 1) =>
      request<Cart>("POST", "/cart/items", { token, body: { productId, quantity } }),
    setQuantity: (token: string, itemId: number, quantity: number) =>
      request<Cart>("PATCH", `/cart/items/${itemId}`, { token, body: { quantity } }),
    remove: (token: string, itemId: number) =>
      request<Cart>("DELETE", `/cart/items/${itemId}`, { token }),
  };
}
