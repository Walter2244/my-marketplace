import { createRequester } from "./core.js";
import { createAccountsApi } from "./accounts.js";
import { createCatalogueApi } from "./catalogue.js";
import { createLivestockApi } from "./livestock.js";
import { createCollectionApi } from "./collection.js";
import { createVerificationApi } from "./verification.js";

export { ApiError } from "./core.js";
export type { Requester, RequestOptions } from "./core.js";
export * from "./accounts.js";
export * from "./catalogue.js";
export * from "./livestock.js";
export * from "./collection.js";
export * from "./verification.js";

export function createApi(baseUrl: string) {
  const request = createRequester(baseUrl);
  return {
    accounts: createAccountsApi(request),
    catalogue: createCatalogueApi(request),
    livestock: createLivestockApi(request),
    collection: createCollectionApi(request),
    verification: createVerificationApi(request),
  };
}
