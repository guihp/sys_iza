import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Bundle do worker gerado por `pnpm worker:build`. É código de terceiros
    // concatenado — lintá-lo só produz centenas de avisos sobre a Supabase e a
    // zod, e esconde os avisos do código que escrevemos.
    "dist/**",
  ]),
]);

export default eslintConfig;
