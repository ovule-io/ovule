import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { clientDirectives } from "./scripts/client-directives-plugin.mjs";
import { bundledResources } from "./scripts/bundled-resources-plugin.mjs";

import { shellApiChannel } from "./scripts/shell-api-channel.mjs";
import { loadTuffiteVite } from "./scripts/tuffite-sdk.mjs";

const { tuffite } = await loadTuffiteVite();

export default defineConfig(({ command }) => {
  const { bindings } = shellApiChannel(command);
  return {
    base: "/",
    cacheDir: process.env.OVULE_VITE_CACHE_DIR,
    publicDir: false,
    plugins: [
      htmlEntries(),
      clientDirectives(),
      tailwindcss(),
      bundledResources(),
      tuffite({
        shellApi: {
          url: "/shell_api.js",
          file: bindings,
        },
      }),
    ],
    // Scan every feature before serving, including views reached only through IOC/lazy imports.
    // Discovering a dependency on the first Settings/Setup click otherwise reloads the app.
    optimizeDeps: {
      entries: [
        "src/**/*.{ts,tsx}",
        "features/*/src/**/*.{ts,tsx}",
        "!**/*.test.*",
        "!src/app/routes.ts",
      ],
      include: [
        "@milkdown/crepe",
        "@ovule/ui > @shadcn/react/message-scroller",
        "streamdown",
        "@ovule/ui > cmdk",
        "@ovule/ui > input-otp",
        "@ovule/ui > @radix-ui/react-alert-dialog",
        "@ovule/ui > @radix-ui/react-avatar",
        "@ovule/ui > @radix-ui/react-collapsible",
        "@ovule/ui > @radix-ui/react-context-menu",
        "@ovule/ui > @radix-ui/react-dialog",
        "@ovule/ui > @radix-ui/react-dropdown-menu",
        "@ovule/ui > @radix-ui/react-hover-card",
        "@ovule/ui > @radix-ui/react-popover",
        "@ovule/ui > @radix-ui/react-scroll-area",
        "@ovule/ui > @radix-ui/react-select",
        "@ovule/ui > @radix-ui/react-tabs",
        "@ovule/ui > @radix-ui/react-toggle",
        "@xterm/addon-fit",
        "@xterm/addon-search",
        "@xterm/xterm",
        "spice-client",
        "@ovule/ui > vaul",
      ],
    },
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    resolve: {
      alias: [
        {
          find: /^@ovule\/shell-api$/,
          replacement: fileURLToPath(new URL(`../${bindings}`, import.meta.url)),
        },
        { find: "@", replacement: fileURLToPath(new URL("./src/app", import.meta.url)) },
      ],
    },
    build: {
      emptyOutDir: true,
      outDir: `${process.env.OVULE_UI_OUT_DIR || "dist"}/client`,
      rollupOptions: {
        input: {
          app: fileURLToPath(new URL("./src/app/index.html", import.meta.url)),
          preview: fileURLToPath(new URL("./src/preview/preview.html", import.meta.url)),
        },
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
  };
});

/** Keep public HTML entry names stable in packages and route to source HTML in dev. */
function htmlEntries() {
  return {
    name: "ovule-html-entries",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url || "/", "http://localhost");
        if (["/", "/index.html", "/main", "/thread", "/pane", "/explorer"].includes(url.pathname))
          request.url = `/src/app/index.html${url.search}`;
        else if (url.pathname === "/preview.html")
          request.url = `/src/preview/preview.html${url.search}`;
        next();
      });
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        for (const [source, target] of [
          ["src/app/index.html", "index.html"],
          ["src/preview/preview.html", "preview.html"],
        ]) {
          const entry = bundle[source];
          if (!entry) throw new Error(`Missing HTML entry: ${source}`);
          if (entry.type !== "asset") throw new Error(`Invalid HTML entry: ${source}`);
          delete bundle[source];
          this.emitFile({ type: "asset", fileName: target, source: entry.source });
        }
      },
    },
  };
}
