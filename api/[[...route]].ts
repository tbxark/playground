// The real handler is bundled by scripts/bundle-vercel-api.mjs during the
// Vercel build (functions/vercel.ts -> api/_handler.cjs). Importing the bundle
// instead of the relative sources keeps the deployed function self-contained:
// @vercel/node does not resolve imports outside api/ for ESM projects.
import handler from "./_handler.cjs";

export const config = {
  api: { bodyParser: false },
};

export default handler;
