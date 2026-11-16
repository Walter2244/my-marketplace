import { createRequester } from "./core.js";
import { createAccountsApi } from "./accounts.js";
import { createCatalogueApi } from "./catalogue.js";

export { ApiError } from "./core.js";
export type { Requester, RequestOptions } from "./core.js";
export * from "./accounts.js";
export * from "./catalogue.js";

export function createApi(baseUrl: string) {
  const request = createRequester(baseUrl);
  return {
    accounts: createAccountsApi(request),
    catalogue: createCatalogueApi(request),
  };
}

