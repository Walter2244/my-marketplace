import type { Requester } from "./core.js";

export type Category = { id: number; name: string; slug: string; level: number; parentId: number | null };
export type CategoryNode = Category & { children: CategoryNode[] };
export type CategoryDetail = Category & { children: { id: number; name: string; slug: string }[] };

export type ProductAttribute = { name: string; value: string };
export type ProductSummary = {
  id: number;
  vendorId: number;
  categoryId: number | null;
  status: "DRAFT" | "PUBLISHED";
  title: string;
  description: string | null;
  priceCents: number;
  currency: string;
  quantity: number | null;
  inStock: boolean;
  unitOfSale: "EACH" | "PER_HEAD" | "PER_KG" | "PER_CRATE";
  collectable: boolean;
  province: string | null;
  district: string | null;
  createdAt: string;
  updatedAt: string;
  attributes: ProductAttribute[];
  vendor: { id: number; name: string };
  category: Category | null;
};

export type StoreSummary = {
  id: number;
  name: string;
  city: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  vendor: { id: number; name: string };
};

export type StockState = { id: number; title: string; quantity: number | null; status: "DRAFT" | "PUBLISHED"; updatedAt: string; inStock: boolean };

export type ListParams = { limit?: number; skip?: number };

export type ProductSearchParams = ListParams & {
  q?: string;
  sort?: "relevance" | "newest" | "price_asc" | "price_desc";
  categoryId?: number;
  minPriceCents?: number;
  maxPriceCents?: number;
  inStock?: boolean;
  province?: string;
  district?: string;
};

export type ProductCreateInput = {
  title: string;
  description?: string | null;
  priceCents: number;
  currency?: string;
  quantity?: number;
  categoryId?: number | null;
  status?: "DRAFT" | "PUBLISHED";
  unitOfSale?: "EACH" | "PER_HEAD" | "PER_KG" | "PER_CRATE";
  collectable?: boolean;
  province?: string | null;
  district?: string | null;
  attributes?: Record<string, string | number>;
};

export type ProductUpdateInput = Partial<ProductCreateInput>;

export type StoreCreateInput = { name: string; city: string; description?: string | null };
export type StoreUpdateInput = Partial<StoreCreateInput>;

function searchQuery(params: ProductSearchParams): Record<string, string | number | boolean | undefined> {
  return {
    q: params.q,
    sort: params.sort,
    categoryId: params.categoryId,
    minPriceCents: params.minPriceCents,
    maxPriceCents: params.maxPriceCents,
    inStock: params.inStock,
    province: params.province,
    district: params.district,
    limit: params.limit,
    skip: params.skip,
  };
}

export function createCatalogueApi(request: Requester) {
  return {
    categories: {
      tree: () => request<CategoryNode[]>("GET", "/categories"),
      get: (id: number) => request<CategoryDetail>("GET", `/categories/${id}`),
    },
    stores: {
      list: (params: ListParams & { city?: string } = {}) =>
        request<StoreSummary[]>("GET", "/stores", { query: { limit: params.limit, skip: params.skip, city: params.city } }),
      get: (id: number) => request<StoreSummary>("GET", `/stores/${id}`),
      mine: (token: string) => request<StoreSummary>("GET", "/stores/me", { token }),
      create: (token: string, input: StoreCreateInput) =>
        request<StoreSummary>("POST", "/stores", { token, body: input }),
      update: (token: string, input: StoreUpdateInput) =>
        request<StoreSummary>("PATCH", "/stores/me", { token, body: input }),
    },
    products: {
      list: (params: ListParams & { vendorId?: number; categoryId?: number } = {}) =>
        request<ProductSummary[]>("GET", "/products", { query: params }),
      get: (id: number) => request<ProductSummary>("GET", `/products/${id}`),
      deliveryOptions: (id: number) =>
        request<{ kind: "COLLECTION" | "FLAT_FEE" | "QUOTE"; feeCents: number; note: string | null }[]>("GET", `/products/${id}/delivery-options`),
      mine: (token: string, params: ListParams = {}) =>
        request<ProductSummary[]>("GET", "/products/mine", { token, query: params }),
      create: (token: string, input: ProductCreateInput) =>
        request<ProductSummary>("POST", "/products", { token, body: input }),
      update: (token: string, id: number, input: ProductUpdateInput) =>
        request<ProductSummary>("PATCH", `/products/${id}`, { token, body: input }),
      remove: (token: string, id: number) =>
        request<{ message: string; id: number }>("DELETE", `/products/${id}`, { token }),
      setStock: (token: string, id: number, quantity: number) =>
        request<StockState>("PUT", `/products/${id}/stock`, { token, body: { quantity } }),
      adjustStock: (token: string, id: number, change: number) =>
        request<StockState>("POST", `/products/${id}/adjust`, { token, body: { change } }),
    },
    search: {
      products: (params: ProductSearchParams = {}) =>
        request<ProductSummary[]>("GET", "/search", { query: searchQuery(params) }),
    },
  };
}



