import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.js";

// Phase 3 routing contract.
//
// The Worker now serves both static UI (public/) and the JSON API from one
// origin. The failure mode this file exists to prevent: the asset layer
// answering an /api request with index.html and a 200, so a client that should
// get 401 gets a login page and a parse error instead.
//
// Rule: every /api/* and /auth/* path returns JSON. Every UI path returns HTML.

async function call(path, { method = "GET", headers = {} } = {}) {
  const request = new Request(`http://example.com${path}`, { method, headers });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function contentType(response) {
  return (response.headers.get("Content-Type") || "").toLowerCase();
}

async function bodyText(response) {
  return await response.text();
}

describe("routing: API paths must never return HTML", () => {
  // Unauthenticated /api/* is the exact case where the SPA fallback would
  // otherwise win: no asset matches, so the asset worker serves index.html.
  const unauthenticatedApiPaths = [
    "/api",
    "/api/children",
    "/api/children/some-child-id",
    "/api/children/some-child-id/apps",
    "/api/usage/summary",
    "/api/admin/apps",
    "/api/does-not-exist",
  ];

  for (const path of unauthenticatedApiPaths) {
    it(`GET ${path} returns JSON 401, not the SPA shell`, async () => {
      const response = await call(path);

      expect(response.status).toBe(401);
      expect(contentType(response)).toContain("application/json");

      const text = await bodyText(response);
      expect(text.toLowerCase()).not.toContain("<!doctype html");
      expect(text.toLowerCase()).not.toContain("<html");

      const body = JSON.parse(text);
      expect(body.error).toBe("Unauthorized");
    });
  }

  it("POST /auth/register with no body returns JSON 400, not HTML", async () => {
    const response = await call("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(400);
    expect(contentType(response)).toContain("application/json");
    expect((await bodyText(response)).toLowerCase()).not.toContain("<html");
  });

  it("POST /auth/login with no body returns JSON 401, not HTML", async () => {
    const response = await call("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(401);
    expect(contentType(response)).toContain("application/json");
    expect((await bodyText(response)).toLowerCase()).not.toContain("<html");
  });

  it("unknown /auth/* subpath returns JSON 404, not HTML", async () => {
    const response = await call("/auth/does-not-exist");
    expect(response.status).toBe(404);
    expect(contentType(response)).toContain("application/json");
    expect((await bodyText(response)).toLowerCase()).not.toContain("<html");
  });
});

describe("routing: public JSON stays JSON", () => {
  it("GET /apps returns a JSON array", async () => {
    const response = await call("/apps");
    expect(response.status).toBe(200);
    expect(contentType(response)).toContain("application/json");
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("GET /apps/act1-sensory-learning returns JSON", async () => {
    const response = await call("/apps/act1-sensory-learning");
    expect(response.status).toBe(200);
    expect(contentType(response)).toContain("application/json");
    expect((await response.json()).id).toBe("act1-sensory-learning");
  });

  it("GET /health returns JSON", async () => {
    const response = await call("/health");
    expect(response.status).toBe(200);
    expect(contentType(response)).toContain("application/json");
    expect((await response.json()).ok).toBe(true);
  });
});

describe("routing: UI paths serve the app shell", () => {
  const uiPaths = ["/", "/parent", "/school", "/admin", "/app/act1-sensory-learning"];

  for (const path of uiPaths) {
    it(`GET ${path} returns HTML`, async () => {
      const response = await call(path);
      expect(response.status).toBe(200);
      expect(contentType(response)).toContain("text/html");

      const text = await bodyText(response);
      expect(text.toLowerCase()).toContain("<!doctype html");
      // A UI response must never carry API JSON as its body.
      expect(() => JSON.parse(text)).toThrow();
    });
  }

  it("the storefront shell links its module script and stylesheet", async () => {
    const text = await bodyText(await call("/"));
    expect(text).toMatch(/<script[^>]+type="module"/i);
    expect(text).toMatch(/<link[^>]+rel="stylesheet"/i);
  });
});
