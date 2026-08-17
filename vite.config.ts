import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// A versão atual do gerador (0.26.2) transforma caminhos absolutos do Windows
// em imports `npm:C:\\...`, que não compilam no Deno/Supabase. O bundle portátil
// versionado foi assumido pelo projeto (sem o banner AUTO-GENERATED); no Linux
// o plugin reconhece que não deve sobrescrever esse arquivo.
const canGeneratePortableMcp = process.platform !== "win32";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), canGeneratePortableMcp && mcpPlugin(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
