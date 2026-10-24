import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.js";

// Phase 3B: the static UI under public/, asserted against the files the
// ASSETS binding really serves.

const HTML_FILES = ["/index.html", "/app.html", "/login.html", "/parent.html", "/school.html", "/admin.html"];
const CSS_FILES = ["/css/app.css"];
const JS_FILES = [
  "/js/api.js",
  "/js/session.js",
  "/js/router.js",
  "/js/ui.js",
  "/js/views/storefront.js",
  "/js/views/app-detail.js",
  "/js/views/parent.js",
  "/js/views/school.js",
  "/js/views/admin.js",
  "/js/views/login.js",
];
const ALL_FILES = [...HTML_FILES, ...CSS_FILES, ...JS_FILES];

// The asset layer's default html_handling redirects /parent.html to /parent
// and serves parent.html there, so HTML files are fetched by clean path.
function servedPath(path) {
  if (path === "/index.html") return "/";
  return path.replace(/\.html$/, "");
}

async function call(path) {
  const request = new Request(`http://example.com${servedPath(path)}`);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function contentType(response) {
  return (response.headers.get("Content-Type") || "").toLowerCase();
}

// Asset text by path. HTML files are fetched by their real file name.
async function text(path) {
  const response = await call(path);
  expect(response.status, path).toBe(200);
  return response.text();
}

function stripComments(path, source) {
  if (path.endsWith(".html")) return source.replace(/<!--[\s\S]*?-->/g, "");
  let out = source.replace(/\/\*[\s\S]*?\*\//g, "");
  if (path.endsWith(".js")) out = out.replace(/^\s*\/\/.*$/gm, "");
  return out;
}

describe("UI shell", () => {
  it("GET / is HTML with doctype, a module script, a stylesheet and lang=en", async () => {
    const response = await call("/");
    expect(response.status).toBe(200);
    expect(contentType(response)).toContain("text/html");
    const body = await response.text();
    expect(body.toLowerCase()).toContain("<!doctype html");
    expect(body).toMatch(/<script[^>]+type="module"/i);
    expect(body).toMatch(/<link[^>]+rel="stylesheet"[^>]+href="\/css\/app\.css"/i);
    expect(body).toMatch(/<html[^>]+lang="en"/i);
  });

  it("the shell has landmarks and content that render without JS", async () => {
    const body = await text("/");
    expect(body).toMatch(/<header[\s>]/);
    expect(body).toMatch(/<nav[^>]+aria-label="Main"/);
    expect(body).toMatch(/<main[^>]+id="main"/);
    expect(body).toMatch(/<h1>[^<]+<\/h1>/);
    expect(body).toMatch(/<a[^>]+href="\/login"/);
    expect(body).toMatch(/aria-live="polite"/);
  });

  it("every HTML shell loads the same entry module and stylesheet, each with its own title", async () => {
    const titles = new Set();
    for (const path of HTML_FILES) {
      const body = await text(path);
      expect(body, path).toContain('<script type="module" src="/js/router.js"></script>');
      expect(body, path).toContain('<link rel="stylesheet" href="/css/app.css">');
      expect(body, path).toMatch(/<html lang="en">/);
      titles.add(body.match(/<title>([^<]+)<\/title>/)[1]);
    }
    expect(titles.size).toBe(HTML_FILES.length);
  });
});

describe("UI assets", () => {
  for (const path of ALL_FILES) {
    it(`${path} is served with a sane content type`, async () => {
      const response = await call(path);
      expect(response.status).toBe(200);
      const type = contentType(response);
      if (path.endsWith(".html")) expect(type).toContain("text/html");
      if (path.endsWith(".css")) expect(type).toContain("text/css");
      if (path.endsWith(".js")) expect(type).toMatch(/^(text|application)\/javascript/);
      await response.arrayBuffer();
    });
  }

  it("no HTML file has an inline on*= event handler", async () => {
    for (const path of HTML_FILES) {
      expect(await text(path), path).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
    }
  });

  it("app.css has the token block, reduced-motion, focus-visible and high-contrast rules", async () => {
    const css = await text("/css/app.css");
    const root = css.match(/:root\s*\{([^}]*)\}/)[1];
    for (const token of ["--bg", "--surface", "--text", "--text-muted", "--border", "--accent", "--accent-text",
      "--danger", "--focus", "--radius", "--space", "--hit", "--motion"]) {
      expect(root, token).toMatch(new RegExp(`${token}\\s*:`));
    }
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*--motion:\s*0ms[\s\S]*transition: none !important/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\)/);
    expect(css).toMatch(/@media \(prefers-contrast: more\)/);
    expect(css).toMatch(/min-height:\s*var\(--hit\)/);
    expect(css).toMatch(/min-width:\s*var\(--hit\)/);
  });

  it("no asset references an external origin (Cloudflare only, no CDN)", async () => {
    for (const path of ALL_FILES) {
      const source = stripComments(path, await text(path));
      const urls = (source.match(/https?:\/\/[^\s"'`<>)]*/g) || [])
        .filter((u) => !u.startsWith("http://www.w3.org"));
      expect(urls, path).toEqual([]);
    }
  });

  it("the storefront fetches /apps and hardcodes no app name", async () => {
    const js = await text("/js/views/storefront.js");
    expect(js).toContain("'/apps'");
    expect(js).not.toContain("Act 1");
    expect(js).not.toMatch(/Money Bingo|Word Builder|Emotion Matcher|Pattern Puzzles/);
  });
});

describe("UI child-data rules (A4)", () => {
  it("no module touches localStorage/sessionStorage or builds HTML from strings", async () => {
    for (const path of JS_FILES) {
      const source = stripComments(path, await text(path));
      expect(source, path).not.toMatch(/localStorage|sessionStorage|indexedDB/);
      expect(source, path).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    }
  });

  it("only ui.js creates DOM nodes", async () => {
    for (const path of JS_FILES.filter((p) => p !== "/js/ui.js")) {
      expect(stripComments(path, await text(path)), path).not.toContain("document.createElement");
    }
  });

  it("every API call sends the session cookie and is never cached", async () => {
    const js = await text("/js/api.js");
    expect(js).toContain("credentials: 'same-origin'");
    expect(js).toContain("cache: 'no-store'");
  });
});

describe("UI modules", () => {
  // Importing parses every module (a syntax error fails here). No module
  // touches the DOM at import time; router.js only boots when #main exists.
  it("every module parses and each view exports render()", async () => {
    for (const path of JS_FILES) {
      const mod = await import(/* @vite-ignore */ `../public${path}`);
      if (path.startsWith("/js/views/")) expect(typeof mod.render, path).toBe("function");
    }
  });

  it("safeNext accepts same-origin paths only (open-redirect guard)", async () => {
    const { safeNext } = await import("../public/js/session.js");
    const saved = globalThis.location;
    globalThis.location = { origin: "https://shop.example" };
    try {
      expect(safeNext("/parent", "/")).toBe("/parent");
      expect(safeNext("/app/money-bingo?x=1#top", "/")).toBe("/app/money-bingo?x=1#top");
      for (const bad of [
        "https://evil.example/", "//evil.example/", "/\\evil.example", "\\\\evil.example",
        "/\t/evil.example", "javascript:alert(1)", "evil.example", "", null, undefined,
      ]) {
        expect(safeNext(bad, "/fallback"), String(bad)).toBe("/fallback");
      }
    } finally {
      globalThis.location = saved;
    }
  });

  it("router resolves every UI path, including .html fallbacks and trailing slashes", async () => {
    const { resolve } = await import("../public/js/router.js");
    const view = (p) => resolve(p)?.module;
    expect(view("/")).toBe("./views/storefront.js");
    expect(view("/index.html")).toBe("./views/storefront.js");
    expect(view("/parent")).toBe("./views/parent.js");
    expect(view("/parent/")).toBe("./views/parent.js");
    expect(view("/parent.html")).toBe("./views/parent.js");
    expect(view("/school")).toBe("./views/school.js");
    expect(view("/admin")).toBe("./views/admin.js");
    expect(view("/login")).toBe("./views/login.js");
    expect(resolve("/app/money-bingo")).toMatchObject({ module: "./views/app-detail.js", params: ["money-bingo"] });
    expect(resolve("/app/%E0%A4%A")).toBeNull();
    expect(resolve("/nope")).toBeNull();
    expect(resolve("/app")).toBeNull();
  });
});

describe("contrast table in app.css", () => {
  function luminance(hex) {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function ratio(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  // Each table line names two tokens, their hex values, the ratio and the minimum.
  // Recompute from the live :root values so the comment can never go stale.
  it("every listed pair matches the current tokens and meets its minimum", async () => {
    const css = await text("/css/app.css");
    const tokens = Object.fromEntries(
      [...css.match(/:root\s*\{([^}]*)\}/)[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)]
        .map(([, name, value]) => [name, value.toLowerCase()]));
    const table = css.match(/CONTRAST-TABLE-START([\s\S]*?)CONTRAST-TABLE-END/)[1];
    const rows = [...table.matchAll(/(--[\w-]+) (#[0-9a-f]{6}) on (--[\w-]+) (#[0-9a-f]{6})\s+([\d.]+):1\s+\(min ([\d.]+):1\)/g)];

    expect(rows.length).toBeGreaterThanOrEqual(10);
    // Collect every problem first, so one run reports all computed values.
    const problems = [];
    for (const [, fg, fgHex, bg, bgHex, listed, min] of rows) {
      const where = `${fg} on ${bg}`;
      if (tokens[fg] !== fgHex) problems.push(`${where}: ${fg} is ${tokens[fg]}, table says ${fgHex}`);
      if (tokens[bg] !== bgHex) problems.push(`${where}: ${bg} is ${tokens[bg]}, table says ${bgHex}`);
      const actual = ratio(tokens[fg], tokens[bg]);
      if (actual.toFixed(2) !== listed) problems.push(`${where}: computed ${actual.toFixed(2)}:1, table says ${listed}:1`);
      if (actual < Number(min)) problems.push(`${where}: ${actual.toFixed(2)}:1 is below ${min}:1`);
    }
    expect(problems).toEqual([]);
    // Every body-text pair the brief names is covered.
    const covered = rows.map(([, fg, , bg]) => `${fg} ${bg}`);
    for (const pair of ["--text --bg", "--text-muted --bg", "--text-muted --surface", "--accent-text --accent", "--danger --bg"]) {
      expect(covered).toContain(pair);
    }
  });
});
