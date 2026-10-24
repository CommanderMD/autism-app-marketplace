import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.js";

describe("Autism App Marketplace Worker API", () => {
  // Phase 3: the status payload moved from / to /api/status; / is now the storefront.
  it("GET /api/status returns system status", async () => {
    const request = new Request("http://example.com/api/status");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const body = await response.json();
    expect(body).toEqual({ name: "Autism App Marketplace API", status: "online" });
  });

  it("GET / returns the storefront HTML", async () => {
    const request = new Request("http://example.com/");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
  });

  it("GET /health checks D1 database connection", async () => {
    const request = new Request("http://example.com/health");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe(true);
  });

  it("GET /apps returns list of apps from D1", async () => {
    const request = new Request("http://example.com/apps");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("GET /apps/act1-sensory-learning returns specific app details", async () => {
    const request = new Request("http://example.com/apps/act1-sensory-learning");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe("act1-sensory-learning");
    expect(body.name).toBe("Act 1 — Sensory Learning");
  });

  it("GET /apps/non-existent returns 404", async () => {
    const request = new Request("http://example.com/apps/non-existent");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
  });
});
