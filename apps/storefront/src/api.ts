import { createApi } from "@acme/client";
import { config } from "./config";

export const api = createApi(config.apiUrl);
