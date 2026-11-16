import { createRequester } from "./core";
import { createAccountsApi } from "./accounts";
import { createCatalogueApi } from "./catalogue";

export { ApiError } from "./core";
export type { Requester, RequestOptions } from "./core";
export * from "./accounts";
export * from "./catalogue";

export function createApi(baseUrl: string) {
  const request = createRequester(baseUrl);
  return {
    accounts: createAccountsApi(request),
    catalogue: createCatalogueApi(request),
  };
}
