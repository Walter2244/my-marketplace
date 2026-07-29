import { createClient, type InferClient } from "@mercurjs/client"
import type { Routes } from "@acme/api/_generated"

const BACKEND_URL = import.meta.env.VITE_MEDUSA_BACKEND_URL || "http://192.168.1.241:9000"

export const client: InferClient<Routes> = createClient({
  baseUrl: BACKEND_URL,
  fetchOptions: {
    credentials: "include",
  },
})
