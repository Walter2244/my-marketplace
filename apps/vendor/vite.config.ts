import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { mercurDashboardPlugin } from "@mercurjs/dashboard-sdk"

export default defineConfig({
  plugins: [
    react(),
    mercurDashboardPlugin({
      medusaConfigPath: "../../packages/api/medusa-config.ts",
      backendUrl: process.env.VITE_MEDUSA_BACKEND_URL || "http://192.168.1.241:9000",
    }),
  ],
  server: {
     host: "192.168.1.241",
     port: 7001,
     strictPort: true
},
  resolve: {
    alias: {
      "virtual:medusa/displays": path.resolve(__dirname, "empty-module.js"),
      "virtual:medusa/forms": path.resolve(__dirname, "empty-module.js"),
      "virtual:medusa/i18n": path.resolve(__dirname, "empty-module.js"),
      "virtual:medusa/menu-items": path.resolve(__dirname, "empty-module.js"),
      "virtual:medusa/routes": path.resolve(__dirname, "empty-module.js"),
      "virtual:medusa/widgets": path.resolve(__dirname, "empty-module.js"),
      "virtual:medusa/links": path.resolve(__dirname, "empty-module.js"),
    },
  },
  define: {
    "process.env": process.env,
  },
})