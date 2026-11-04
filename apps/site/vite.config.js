import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const page = (path) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Общие шапка и подвал: в страницах стоит <!-- include:header -->,
 * при сборке на его место подставляется partials/header.html.
 */
function includes() {
  return {
    name: "twm-includes",
    transformIndexHtml(html) {
      return html.replace(/<!--\s*include:([a-z-]+)\s*-->/g, (_, name) => readFileSync(`${root}partials/${name}.html`, "utf8"));
    },
  };
}

export default defineConfig({
  plugins: [includes(), tailwindcss()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        index: page("index.html"),
        rules: page("rules/index.html"),
        privacy: page("privacy/index.html"),
        safety: page("safety/index.html"),
        notFound: page("404.html"),
      },
    },
  },
});
