import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts"],
  esbuildOptions(options) {
    options.banner = { js: "#!/usr/bin/env node" };
  },
  format: ["cjs"],
  minify: true,
  sourcemap: true,
});
