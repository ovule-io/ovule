# Visuals

`io.ovule.visuals` owns rich message rendering and document previews/editing:

- `echarts` and `excalidraw` message blocks use isolated Web Components.
- `interactive-ui` uses the host's sandbox iframe renderer. It does not load the
  isolated snapshot. Only its bounded compose bridge reaches the host.
- Office file editors preview Word, spreadsheets, presentations and PDF files;
  XLSX and CSV support editing and export through the host's bounded byte bridge.

Message kinds, element tags and file editor IDs remain stable when loading older
messages. The package owns its source, styles, dependencies, isolated adapter,
snapshot and PDF worker; it imports no UI source from another extension.

Build this package with `bun run build` in this directory, or run
`bun run --cwd desktop build:visuals` from the repository root. `dist/ui.js` is
registered by the native host. Only `dist/web/pdf.worker.mjs` is a browser asset.
Third-party licenses and notices are regenerated from the build inputs.
