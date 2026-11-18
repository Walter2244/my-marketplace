const apiUrl = import.meta.env.VITE_API_URL;

if (!apiUrl) {
  throw new Error("VITE_API_URL is not set. Add it to apps/storefront/.env.development or .env.production.");
}

export const config = {
  apiUrl: apiUrl.replace(/\/$/, ""),
};
