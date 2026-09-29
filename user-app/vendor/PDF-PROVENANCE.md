# PDF reader in MSP

26 September 2026. `vendor/drag/src/formats/pdf/` is copied from this project's existing `vendor/drag/src/formats/pdf/` reader; upstream provenance and permission are recorded in the root `vendor/PROVENANCE.md` and `vendor/upstream-files.json`. No Figma UI, licensing service or network integration is included. `local-pdf-session.ts` uses a local font type rather than Figma globals.

Runtime: `pdfjs-dist` 6.3.289 (lockfile), Apache-2.0. The reader build includes CMaps, standard fonts and decoder JavaScript locally. Their notices are emitted in `public/pdf-resource-licenses.txt`. `scripts/build-reader.mjs` checks the worker source before disabling operator queue optimization, which is necessary to preserve object indices; an incompatible worker fails the build. The PDF bundle is loaded only for a PDF import.
