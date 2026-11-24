import { createRequester } from "./core.js";
import { createAccountsApi } from "./accounts.js";
import { createCatalogueApi } from "./catalogue.js";
import { createLivestockApi } from "./livestock.js";
import { createCollectionApi } from "./collection.js";
import { createVerificationApi } from "./verification.js";
import { createAgentsApi } from "./agents.js";
import { createGroupsApi } from "./groups.js";
import { createReviewsApi } from "./reviews.js";
import { createPriceIndexApi } from "./priceIndex.js";
import { createCartApi } from "./cart.js";
import { createOrdersApi } from "./orders.js";

export { ApiError } from "./core.js";
export type { Requester, RequestOptions } from "./core.js";
export * from "./accounts.js";
export * from "./catalogue.js";
export * from "./livestock.js";
export * from "./collection.js";
export * from "./verification.js";
export * from "./agents.js";
export * from "./groups.js";
export * from "./reviews.js";
export * from "./priceIndex.js";
export * from "./cart.js";
export * from "./orders.js";

export function createApi(baseUrl: string) {
  const request = createRequester(baseUrl);
  return {
    accounts: createAccountsApi(request),
    catalogue: createCatalogueApi(request),
    livestock: createLivestockApi(request),
    collection: createCollectionApi(request),
    verification: createVerificationApi(request),
    agents: createAgentsApi(request),
    groups: createGroupsApi(request),
    reviews: createReviewsApi(request),
    priceIndex: createPriceIndexApi(request),
    cart: createCartApi(request),
    orders: createOrdersApi(request),
  };
}
