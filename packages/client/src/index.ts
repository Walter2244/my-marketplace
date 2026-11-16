import { createRequester } from "./core";
import { createAccountsApi } from "./accounts";

export { ApiError } from "./core";
export type { Requester, RequestOptions } from "./core";
export * from "./accounts";

export function createApi(baseUrl: string) {
  const request = createRequester(baseUrl);
  return { accounts: createAccountsApi(request) };
}
