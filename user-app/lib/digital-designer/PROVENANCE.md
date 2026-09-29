# Digital Designer checkpoint integration

Latest addition, 25 September: [Q0 and a bounded Q1 pilot](../../docs/STAGE-4-QWEN-PILOT.md). `lib/design-system/semantic-{contract,pilot}.ts` adapts the `figma-scene-13` compact map, native groups, fixed markers, source citations, per-node accounting and one targeted clarification. The web contract preserves full source text and snapshot identity, validates web references, and keeps immutable rule quotes separate from explicit future-instance slots. `lib/uploads/model-run.ts` supplies R2 jobs, conditional claims and a revalidated exact cache. This is a separate partial semantic layer; it does not replace the source catalog or claim the entire v13 scanner is connected. Older checkpoint descriptions below remain specific to that path.

Source: user-supplied `digital-designer-codex-checkpoint-2026-09-24.zip`, repository `505Company/digital-designer`, ref `codex/checkpoint-2026-09-24`, commit `d827ca271ab3dcc599ee4f2dce3e26959974da19`.

Copied unchanged:
- `packages/contracts/design-analysis.ts` → `design-analysis.ts`: schema, evidence/reference validation, candidate quarantine, category coverage and same-slide molecule checks.
- `knowledge/design-research.v1.json` → `knowledge.json`. Only the cross-brand catalogue and its version enter the context; example brand rules do not.
- The 51-file transitive dependency graph of the checkpoint's `vendor/drag/src/formats/pptx/{catalog,scene,preview}.ts` was initially copied into `vendor/drag/src`. The web-specific changes below now apply to this local copy.

Adapted:
- Source-system parity, 25 September: `lib/design-system/source-scene.ts`, `source-system.ts` and `compiler.ts` adapt the current root project's `canvas-structure.ts`, `canvas-fast-survey.ts`, `canvas-batches-fast.ts`, `canvas-source-rules.ts`, `canvas-plan.ts` and source-molecule invariants to web IR. They retain complete source accounting, native tables, multi-part bindings, actual styles, fixed source text and explicit pending cases. No Figma APIs, node IDs, user libraries or receipts are imported. `compiler-v1.ts` freezes the prior MSP compiler for existing catalogs. Read [the parity matrix and validation](../../docs/STAGE-4-FIGMA-PARITY.md) for precise boundaries; the complete model-driven v13 pipeline is not yet connected.
- Current importer comparison: 46 of 51 transitive Drag files still match the Figma project's current copy byte-for-byte. The remaining five carry the web fixes listed below. `tests/browser/import-parity.spec.ts` adapts regression scenarios for stale Content Types, missing referenced masters, empty decorative text and identity image alpha. The browser adapter preserves a failed slide's raw text/resources and explicitly reports incomplete geometry instead of failing the entire deck.
- Stage 4 catalog/export, 25 September: the local Drag copy now retains text baseline shifts, uses shared alphabetic baselines and measured ink extents, and draws bottom-aligned paragraphs with their actual laid-out height. `roundRect` uses cubic circular quadrants within the existing path contract. `browser/fonts.ts` resolves actual faces and serves licensed Play Regular/Bold from `public/fonts/play/PROVENANCE.json`. These changes have red/green browser pixel regressions and an independent LibreOffice comparison.
- `lib/design-system/catalog.ts` and `lib/slides` are new MSP modules. Native OOXML export preserves supported text, vector and image objects and rejects unsupported properties; it does not call or copy the Figma renderer at runtime. Its packaging was checked against Microsoft's PresentationML documentation and an independent LibreOffice render. See `docs/STAGE-4-CATALOG-AND-EXPORT.md` for boundaries and exact checks.
- Stage 4, 25 September: `core/model.ts` and `core/page-ir.ts` retain OOXML source references and validate stored scene trees separately from resource loading. `formats/pptx/scene.ts` retains original object names and source part/shape IDs. `formats/pptx/preview.ts` exposes the same text measurement used by its painter, preserves word boundaries when wrapping, paints line primitives and consistently orders top-level layers.
- `browser/presentation-source.ts` now remaps table references alongside node IDs and includes fonts from styled runs. The adapted renderer is identified as `msp-web-2026-09-25`; the upload API still accepts the older checkpoint package identifier.
- New `lib/design-system`, `browser/component-execution.ts` and the component workbench implement a web-native library. The design follows the original project's source-accounting, group preservation, fixed-marker, text-slot and fail-closed reference principles studied in `canvas-fast-survey.ts`, `canvas-plan.ts` and `source-molecules.ts`. Their Figma node contracts and receipts are not used in the web runtime.
- `apps/service/presentation-source.ts` → `browser/presentation-source.ts`: native browser DOM and WebCrypto replace Node/JSDOM; same source IDs, assets, inherited layouts, normalized geometry and font/color collection. Browser-rendered previews are encoded as JPEG at quality .85, avoiding unnecessarily large PNG model requests.
- `apps/service/design-context.ts` → `design-context.ts`: original Russian analysis instructions, bounded object selection, ancestor preservation, compact styles and complete category catalogue. Adds an explicit reconstruction caveat and MIME-aware images.
- `apps/service/design-worker.ts` → `visual-analysis.ts` and existing `process-upload.ts`: prepare, save exact context/messages, Qwen JSON-schema response, save raw reply, validate/quarantine, persist result. `browser/prepare.ts` creates labelled original-resource contact sheets.

The `visual-v2` path supplies slide images, original resource contact sheets, normalized elements, typography, colors, full extracted text (bounded in model context), crops and parent relationships. Source SHA-256 and asset-byte hashes are validated on upload. Binary resources and preview files are stored separately in R2, with the manifest committed last. The older structural path remains available for earlier uploads; the UI offers a visual upgrade using their saved source.

## Deliberate limits

Browser previews are reconstructions using the adapted Drag renderer, **not** independent LibreOffice/PowerPoint renders. Missing local fonts and unsupported effects can change their appearance. Per-slide warnings persist and are passed to the model. Original resources remain downloadable even when preview reconstruction is incomplete. Raster icons are not represented as editable vectors. The full normalized geometry is downloadable in JSON. The component workbench stores editable scene definitions and text instances. A new single slide and bounded native PPTX export now work; complete deck generation remains outside this slice.

Model claims are candidates with measured / visual / inferred basis, source references and confidence; reference validation does not constitute design approval. Unsupported candidates are quarantined. Missing credentials, invalid model replies or network failures preserve source measurements and assets. No automatic paid retry is performed. The HTTP stream must remain open during model processing; a durable background queue is not yet implemented.

Stage-4 implementation and separate validation evidence: [web component slice](../../docs/STAGE-4-RESULT.md). The controlled PPTX is generated from `tests/fixtures/control-pptx.ts`; no historical user presentation or Figma library was migrated. No new paid model run was required for this slice.


## Stage 4 · full semantic scan, 25 September 2026

`lib/design-system/semantic-scan-plan.ts`, `semantic-scan.ts`, `semantic-rules.ts`, and `semantic-library.ts` adapt the principles of the original project's `canvas-batches-fast.ts` v13 and `canvas-source-rules.ts` to the persisted web scene. They retain complete text, source groups, clipped assets, explicit unresolved decisions and exact rule quotations. No Figma runtime objects or historical libraries are used.

The model's raw replies remain immutable. Audited deterministic normalization restores the native single-raster container, completes only native text fields inside a model-selected block, and quarantines conflicting or non-text content assignments. Invalid IDs, cross-slide compositions and graphic atoms containing text remain rejected. The full pass uses bounded requests, one clarification at most, conditional leases and a revalidated exact cache. Source resources and old catalog/project definitions are preserved.

The normal visual import now uses this full path; the historical checkpoint path above applies to older profile-only imports. The user-facing component catalog contains previews, without manual text forms or the former composition/relations inspector. [Full VK evidence and limits](../../docs/STAGE-4-QWEN-FULL.md): 27 packages, 589 definitions (520 eligible), 13 exact source rules, 35 unresolved nodes. Durable background execution, mixed-text adaptation and complete deck generation remain outstanding.


## Stage 4 · rich text and a second style, 25 September 2026

`lib/design-system/text-fields.ts` extends only explicit model-selected fields: equivalent source runs form one field; mixed runs keep bounded source ranges, native markers and formatting. The semantic compiler is now `web-semantic-components-2`; browser execution is version 5. Legacy catalogs remain immutable. A separately cached, bounded second pass can refine unresolved batches without replacing raw replies or losing resolved source coverage.

Canvas component previews retain transparency; final slide backgrounds are unchanged. Explicit paragraph line spacing now advances baselines instead of recomputing them from each line’s font size. Available local faces are registered under the scene family before rendering; missing fonts still block readiness. No third-party fonts were added.


## Stage 4 · Q2 content structure, 25 September 2026

`lib/presentations/{material-identity,material,outline,structure}.ts` adapts the root project’s `packages/contracts/presentation.ts`, `apps/service/presentations.ts`, and content-block / explicit-annotation principles from `packages/contracts/presentation-content.ts`. Qwen returns references only; code enforces complete ordered coverage and explicit slide boundaries. Whole-fragment blocks preserve original wording; inline marker/title/body span adaptation belongs to the recipe executor. R2 replaces local service files, and the existing exact model cache and conditional claims replace in-process job maps.


## Stage 4 · Q3 recipe selection, 25 September 2026

`lib/presentations/recipe-{brand,selection,plan}.ts` adapts the first model request in the root `apps/service/accepted-recipes.ts` to Q2 source fragments and immutable web catalogs. The model sees exactly ten recipe families, each containing qualified options, and returns a validated family/option pair. The user-linked qualification gallery is authoritative for family names and reference PNGs. The original accepted JSON is preserved verbatim; two legacy base/count mismatches use existing four-metrics/four-cards contracts from refinement. File hashes, source paths and the distinction between authored and native previews are now recorded in `recipes/archive/accepted-10-v1/provenance.json`. On 26 September the user temporarily archived this pipeline for the [stage 6 recipe experiment](../../docs/STAGE-6-LAYOUT-ENGINE.md); its definitions and saved results remain recoverable.

No old user decks, Figma component libraries or native IDs become runtime resources. Brand evidence comes from current web imports. Selection does not imply measured fit: Q4 must bind exact source text/actual resources and validate its scene. Q3 remains text-only; reference PNGs are bundled for Q4. The same model-run cache, raw-response evidence and conditional leases are reused; one contract clarification at most. [Live evidence, invalidation, UI and limitations](../../docs/STAGE-4-Q3-RECIPES.md).


## Binary import safety · 26 September 2026

The local Drag `pptx/{preview,image-fallback,normalize-image}.ts` now copies image bytes with the typed-array constructor instead of `Uint8Array.from`. Byte values, crop, dimensions and rendering policy are unchanged. The web adapter hashes exact buffer views through `lib/uploads/binary-bytes.ts`; PPTX/PDF loaders are versioned to replace cached unsafe implementations. The upstream Figma copy was not modified. [Crash evidence and regression coverage](../../docs/IMPORT-BINARY-CRASH.md).

## VK importer comparison · 28 September 2026

Compared the installed Drag working copy (HEAD `1d38af55ac60ba4b728525587a3a9fbc8a8d4983`, including its existing local changes), without editing it. 54 of 63 shared source files matched; both browser readers preserved equal text records and asset bytes on all 55 VK slides. This is not a fresh native Figma sink acceptance. Its measured `layoutTable` stage is still absent from the web import adapter; native text metrics, shadows/blur and service-frame metadata also differ.

MSP-only fixes preserve valid negative source-crop outsets and permit line breaks after breaking hyphens. Bounds and bitmap budgets remain enforced. The browser font resolver now recognizes Consolas/Menlo as monospace and records Google substitutions explicitly. Independently, the component-box adapter derives title/body fields from two unambiguous styled paragraphs and accepts square native panel paths. Raw source snapshots and model responses are unchanged. [Full evidence, reference render, tests and boundaries](../../docs/VK-EDUCATION-IMPORT-AUDIT.md).
