import { plugin } from "bun";
// Model Vite's asset URL import without evaluating the PDF worker in Bun.
await plugin({
  name: "test-vite-asset-urls",
  setup(build) {
    build.onResolve({ filter: /pdf\.worker\.mjs\?url$/ }, () => ({
      path: "pdf-worker",
      namespace: "test-asset",
    }));
    build.onLoad({ filter: /.*/, namespace: "test-asset" }, () => ({
      contents: 'export default "/pdf.worker.mjs";',
      loader: "js",
    }));
  },
});
