// Bundles functions/vercel.ts into a self-contained api/_handler.cjs for the
// Vercel Node function. Runs as part of the Vercel buildCommand (see
// vercel.json); api/[[...route]].ts re-exports its default handler. The
// underscore prefix keeps Vercel from treating the bundle as its own function.
import { build } from "esbuild";

await build({
  entryPoints: ["functions/vercel.ts"],
  outfile: "api/_handler.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});
