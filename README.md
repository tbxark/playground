# Universal AI Image Playground

A fully client-side AI image-generation workbench built with **React 19 + shadcn/ui + Vite + Tailwind CSS + Zustand + idb**.

## Three workspaces

- **Free Canvas (`/`)** — the main studio: the main image, reference images and generated results all live on one pannable/zoomable canvas, with inpaint masking plus a full-screen image workspace for per-image changes.
- **Simple (`/simple`)** — the most direct generate entry: both images and prompt are optional. Generation history shares the same Results panel and queue data source as the free canvas.
- **Workflow (`/workflow`)** — node-based workflow: prompt, reference image, inspiration assistant, generation and preview nodes wired together.

The legacy `/canvas` path redirects to `/workflow`, and `/?mode=simple` redirects to `/simple`, so old bookmarks keep working. `/gallery` and `/settings` remain standalone pages. On first launch (no image or assistant key stored, and the guide never finished or skipped), the app opens the `/onboarding` guide, which can be reopened from Settings → System.

## Highlights

- **Adaptive generation modes**:
  - **Text-to-Image**: enter a prompt and generate directly.
  - **Image-to-Image / reference blending**: reference images are references only and never modify the main image. The first 4 participate in order; from the 5th on they are marked as alternates and can be moved up to reorder.
  - **Inpainting**: a built-in professional mask layer (brush size, eraser, invert mask) produces a binary mask and submits the repaint.
  - **Local margin**: the Margin tool adds blank pixels around the image without generating content. AI outpainting is not implemented yet; generating from the canvas with an image-capable model may fill the margin depending on the provider.
- **Prompt command bar**:
  - Positive prompt plus negative prompt.
  - Categorized style / texture / camera tag pills.
  - **AI prompt assistant**: one-click deep polish and Chinese-to-English optimization through an LLM.
  - **Vision image-to-prompt**: deep reverse-engineering of a reference image with a multimodal Vision model.
- **Unified OpenAI-compatible image API**:
  - Configure one image endpoint and API key in Settings, and manage the models available on that endpoint.
  - The prompt assistant can be configured separately with OpenAI-compatible text and Vision endpoints.
- **Workflow orchestration**:
  - Prompt, reference image, assistant, generator and preview nodes wire together; a node's own output can never be connected back to its own input.
  - Export the whole graph as a standalone OpenAI SDK TypeScript script with an in-app preview, warnings, copy and `.ts` download. API keys are read from environment variables and never embedded.
- **First-run onboarding (`/onboarding`)**:
  - When the app first opens with no image or assistant key, it enters a standalone guide: enter the endpoint and key, test the connection, fetch or manually add and enable image models, and optionally configure the prompt assistant.
  - You can import a JSON config exported from Settings → System (existing content is confirmed first). "Set up later" is remembered, so clearing a key afterwards never pulls you back into the guide.
- **Concurrency-limited task queue**:
  - Configurable maximum concurrency of 1–4 to avoid upstream 429 errors.
  - Tasks support cancellation (`AbortController`), retry, clearing completed tasks, and unload protection while offline or navigating away (`beforeunload`).
- **Free-canvas cards (Main / Reference / Result)**:
  - The main image uses a strong solid border with a "Main" badge; reference images use a dashed, muted border with a "Reference n" badge; generated results use their own border with a "Result" badge.
  - Cards can be selected and moved by dragging the card header; drag empty space or hold Space to pan, ⌘/Ctrl + wheel zooms around the cursor, and a plain wheel pans.
  - Clicking a result or reference no longer implicitly replaces the main image: it opens the shared image workspace (tools, original comparison, download, set as reference, …), and only an explicit "Set as main" continues editing. The original stays on the canvas for comparison.
  - Switching or clearing the main image keeps the bitmap as-is; the pending inpaint mask is discarded and requires confirmation first.
  - The empty canvas offers guidance: upload an image, generate straight from a prompt, and an explanation of what reference images do and how many participate.
- **Image workspace (viewer + editor in one)**:
  - One PS-like shell for every lightbox entry: a left tool rail (View, Crop, Margin, Annotate, Remove BG, Upscale), a contextual options bar, the canvas, a right inspector with image info, pending changes and caller actions, and a status bar with zoom and original comparison. There is no separate "edit mode" to enter or leave.
  - Any image opened — main, reference, result or free card — can be cropped (with ratios, 90° rotation and flips), given a local margin, annotated, background-removed, or upscaled with on-device tools (MODNet via transformers.js and pica Lanczos). Drag on the image to draw a crop, wheel-zoom at the cursor, Space/middle-drag to pan, and use `V C E B R U` for the tools.
  - "Apply" replaces that card's bitmap in one undoable step and keeps the pre-edit original for comparison; the card menu also offers "Apply as new card" to keep the original on the canvas. "Reset all" discards pending edits without closing the workspace.
  - Nothing is uploaded. Background removal runs in a worker; its runtime and model are downloaded once and cached by the browser, while upscaling is immediate and offline. Transparent results get a checkerboard preview.
- **Closed action loop**:
  - Results land on the canvas automatically once generated (idempotent by `result.nanoid`), with one click to explicitly set as main image, set as reference, or locate the card.
  - Results that were not saved to the gallery keep their local Blob and metadata, so "retry save" works from the result card or the Results panel even after a refresh.
  - One click sends a result to the workflow as an image node for further orchestration.
  - The workspace can toggle the original comparison for any edited image (only while no edits are pending); reference thumbnails open the large view.
  - One click restores all generation parameters into the command bar.
- **Local, intelligent asset gallery (IndexedDB)**:
  - Zero server dependency: result blobs and full metadata persist in the user's browser.
  - Keyword search, model filtering and favorites (star). Clicking a detail image opens the full-screen lightbox with the same zoom and close gestures used by the canvas and workflow.
  - "Load as main image" replaces the current main card atomically; an existing mask is confirmed first.
  - Automatic LRU quota trimming plus one-click ZIP export (all images with a parameters JSON).
- **Security and privacy**:
  - All API keys and custom settings live in local `localStorage`, with one-click export/import backup.

---

## Development and build

From the repository root:

```bash
# Start the dev server (default port 5180)
pnpm playground

# Build for production
pnpm playground:build
```

Or run directly inside `playground/`:

```bash
cd playground
pnpm dev
pnpm build
```

---

## Common shortcuts

- `⌘/Ctrl + Z`: undo the last edit on the current canvas; `⌘/Ctrl + ⇧ + Z` or `⌘/Ctrl + Y` redoes it. The free canvas covers card add/remove/drag/set-as-main/mask strokes/applied image edits/clear-canvas; the workflow covers node and edge add/remove/edit/drag/clear/import/reset.
- `Delete` / `Backspace`: delete the selected card on the free canvas, or the selected node/edge in the workflow (the main image cannot be deleted directly — confirm "Clear main image" instead). Not triggered while focus is in an input, textarea, select, `contentEditable`, or during IME composition.
- `⌘ + Enter` or `Ctrl + Enter`: submit a generation from the prompt box on the free canvas or Simple mode; render all image-generation nodes in the workflow.
- `⌘ + K` or `Ctrl + K`: open the command palette (page navigation, undo/redo, clear canvas, switch model, export config, …); the `⌘K` button in the header does the same.
- `⌘ + V` or `Ctrl + V`: paste an image (screenshot, copied web image or copied file) onto the free canvas. It follows the upload rules — the first image becomes the main image, later ones become references — and one paste is one undo step. Text pastes inside the prompt box keep the browser's native behaviour.
- `Esc`: close the image workspace / current dialog. In the workspace it first cancels a running background-removal/upscale job, then leaves compare mode (asking before discarding pending changes), and only then closes. On the canvas a later Esc clears the selection. It never navigates. `←` / `→` switch lightbox images while viewing, `+` / `-` zoom, `0` fits.
- In the free-canvas mask layer: undo the previous stroke and invert the mask in one click.

The canvas toolbar (vertical toolbar at the bottom of the free canvas, workflow header) links to shortcut help; the command palette also has a "Keyboard shortcuts" entry.

> Undo is **session-scoped** structural history: up to 50 steps in the workflow and 30 on the free canvas, cleared on reload. Workflow undo restores only node structure and editable fields — generated results are not restored with undo (deleting a node and undoing it requires re-rendering); free-canvas undo keeps result cards that arrived after the snapshot.
