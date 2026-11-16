import type { Requester } from "./core";

export type VendorSummary = { id: number; name: string; email: string; createdAt: string };
export type VendorProfile = VendorSummary & { updatedAt: string };
export type BuyerProfile = { id: number; name: string | null; email: string; createdAt: string };

export type VendorRegisterInput = { name: string; email: string; password: string };
export type BuyerRegisterInput = { name?: string; email: string; password: string };
export type LoginInput = { email: string; password: string };

export function createAccountsApi(request: Requester) {
  return {
    vendor: {
      register: (input: VendorRegisterInput) =>
        request<{ token: string; vendor: VendorSummary }>("POST", "/vendor/register", { body: input }),
      login: (input: LoginInput) => request<{ token: string }>("POST", "/vendor/login", { body: input }),
      me: (token: string) => request<VendorProfile>("GET", "/vendor/me", { token }),
    },
    buyer: {
      register: (input: BuyerRegisterInput) =>
        request<{ token: string; user: BuyerProfile }>("POST", "/buyers/register", { body: input }),
      login: (input: LoginInput) => request<{ token: string }>("POST", "/buyers/login", { body: input }),
      me: (token: string) => request<BuyerProfile>("GET", "/buyers/me", { token }),
    },
    admin: {
      login: (input: LoginInput) => request<{ token: string }>("POST", "/auth/login", { body: input }),
      stats: (token: string) =>
        request<{ total_vendors: number; total_products: number; total_orders: number }>("GET", "/auth/stats", { token }),
      expireOrders: (token: string) => request<{ expired: number }>("POST", "/auth/expire-orders", { token }),
    },
  };
}
