# Third-party notices

`THIRD_PARTY_NOTICES.txt` contains the complete license and notice texts collected
from the actual build inputs, including PDF.js's embedded core-js dependency.
Rebuild it with `bun run --cwd desktop build:visuals` from the repository root.

Office bundles the ExcelJS and JSZip source entries so their dependencies appear
in the build input graph. The pinned PDF.js and PptxViewJS packages retain their
upstream prebuilt browser modules; their embedded notices are preserved alongside
the package license texts. Ovule-owned code is licensed under MIT OR Apache-2.0;
that choice does not relicense third-party code.
