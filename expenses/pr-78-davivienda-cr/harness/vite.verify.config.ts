import { mergeConfig } from "vite";
import base from "./vite.config.ts";

export default mergeConfig(base, {
  server: {
    port: 5174,
    strictPort: true,
    proxy: { "/api": { target: "http://localhost:8001", changeOrigin: true } },
  },
});
