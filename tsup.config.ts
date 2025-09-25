import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts"],
  esbuildOptions(options) {
    options.banner = { js: "#!/usr/bin/env node" };
  },
  format: ["esm"],
  minify: true,
  sourcemap: true,
  target: "node18",
});
