import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("SPA rewrite excludes API routes", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  const rewriteSources = config.rewrites.map((rewrite) => rewrite.source);
  assert.ok(
    rewriteSources.some((source) => source.includes("(?!api/)")),
    "SPA fallback rewrite must not catch /api/* function routes",
  );
});
