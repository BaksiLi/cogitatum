import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// Workspace packages export their TypeScript sources under a private condition,
// so published consumers' development builds keep resolving the built files.
const source = "@cogitatum/source";

export default defineConfig({
  resolve: { conditions: [source, ...defaultClientConditions] },
  ssr: { resolve: { conditions: [source, ...defaultServerConditions] } },
  test: {
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts", "apps/**/*.test.ts", "site/**/*.test.ts"]
  }
});
