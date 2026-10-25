import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.js";

// Regression: a missing /apps/<dir>/dev(.html) used to come back as the
// storefront's index.html with a 200 (the SPA fallback), because the router's
// missing-file guard only covered .js and .css paths.
const DIRS = ["act1", "money-bingo", "word-builder", "emotion-match", "pattern-puzzles"];
const APP_IDS = {
  act1: "act1-sensory-learning",
  "money-bingo": "money-bingo",
  "word-builder": "word-builder",
  "emotion-match": "emotion-match",
  "pattern-puzzles": "pattern-puzzles",
};
const BANNER = "<!-- DEBUG HARNESS — not part of the product -->";

async function call(path, testEnv = env) {
  const request = new Request(`http://example.com${path}`, { redirect: "manual" });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

const contentType = (res) => res.headers.get("Content-Type") || "";

async function expectJson404(res, path) {
  expect(res.status, path).toBe(404);
  expect(contentType(res), path).toContain("application/json");
  const body = await res.text();
  expect(body, path).not.toMatch(/<html|<!doctype/i);
  expect(JSON.parse(body), path).toEqual({ error: "Not Found" });
}

// The real asset layer, except dev.html is "missing": those paths get what the
// SPA fallback serves for any missing file, the storefront's index.html with a 200.
function envWithoutHarnesses() {
  return {
    ...env,
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        if (/\/dev(?:\.html)?$/.test(url.pathname)) {
          const index = await env.ASSETS.fetch(new Request(`${url.origin}/`));
          expect(index.status).toBe(200);
          expect(contentType(index)).toContain("text/html");
          return index;
        }
        return env.ASSETS.fetch(request);
      },
    },
  };
}

describe("dev harnesses are served for all five app dirs", () => {
  for (const dir of DIRS) {
    it(`/apps/${dir}/dev returns the harness with a 200`, async () => {
      const res = await call(`/apps/${dir}/dev`);
      expect(res.status).toBe(200);
      expect(contentType(res)).toContain("text/html");
      const html = await res.text();
      expect(html.startsWith(BANNER)).toBe(true);
      expect(html).toContain(`<script type="module" src="/apps/${dir}/js/dev.js"></script>`);
    });

    it(`/apps/${dir}/dev.html carries noindex and a non-empty app-id meta`, async () => {
      const res = await env.ASSETS.fetch(new Request(`http://example.com/apps/${dir}/dev.html`));
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html.startsWith(BANNER)).toBe(true);
      expect(html).toContain('<meta name="robots" content="noindex">');
      const appId = html.match(/<meta name="app-id" content="([^"]*)">/);
      expect(appId).not.toBeNull();
      expect(appId[1]).not.toBe("");
      expect(appId[1]).toBe(APP_IDS[dir]);
    });

    it(`/apps/${dir}/js/dev.js is served as JavaScript and imports the app's engine`, async () => {
      const res = await call(`/apps/${dir}/js/dev.js`);
      expect(res.status).toBe(200);
      expect(contentType(res)).toContain("javascript");
      const js = await res.text();
      expect(js).toMatch(/from '\.\.\/(?:engine|lessons)\//);
      expect(js).toContain("getElementById('out')");
    });
  }
});

describe("a missing file under an app dir is a JSON 404, never the storefront", () => {
  for (const dir of DIRS) {
    it(`missing dev / dev.html for ${dir} is a JSON 404`, async () => {
      const missing = envWithoutHarnesses();
      for (const path of [`/apps/${dir}/dev`, `/apps/${dir}/dev.html`]) {
        await expectJson404(await call(path, missing), path);
      }
    });

    it(`missing engine/lessons/css/js files for ${dir} are JSON 404s`, async () => {
      for (const path of [
        `/apps/${dir}/engine/no-such-module.js`,
        `/apps/${dir}/lessons/no-such-lesson.js`,
        `/apps/${dir}/css/no-such-sheet.css`,
        `/apps/${dir}/js/no-such-script.js`,
      ]) {
        await expectJson404(await call(path), path);
      }
    });
  }

  it("an unknown app dir's dev harness is a JSON 404", async () => {
    for (const path of ["/apps/nope/dev", "/apps/nope/dev.html"]) {
      await expectJson404(await call(path), path);
    }
  });

  it("HTML served for an admitted path without the harness banner is a JSON 404", async () => {
    // Even a real file: only a dev.html that opens with the banner is let through.
    const fake = {
      ...env,
      ASSETS: {
        fetch: async () => new Response("<!doctype html><title>not a harness</title>", {
          status: 200, headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      },
    };
    await expectJson404(await call("/apps/act1/dev", fake), "/apps/act1/dev");
    await expectJson404(await call("/apps/act1/js/shell.js", fake), "/apps/act1/js/shell.js");
  });
});
