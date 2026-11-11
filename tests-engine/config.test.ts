import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";

// A last line of defence: things that must be true of the shipped config no matter who edits it.
const strip = (t: string) => t.replace(/^\s*\/\/.*$/gm, "");
const cfg = JSON.parse(strip(readFileSync("wrangler.jsonc", "utf8")));
const headers = readFileSync("public/_headers", "utf8");

describe("deploy config guards", () => {
  test("dev content flags are OFF in the shipped config (they only exist for local runs)", () => {
    expect(cfg.vars.DEV_CONTENT).toBe("0");
    expect(cfg.vars.ALLOW_TEST_CONTENT).toBe("0");
  });
  test("one SQLite Durable Object class 'Room' and one D1 binding, nothing else (locked decision 8)", () => {
    expect(cfg.exports).toEqual({ Room: { type: "durable-object", storage: "sqlite" } });
    expect(cfg.durable_objects.bindings).toEqual([{ name: "ROOM", class_name: "Room" }]);
    expect(cfg.d1_databases).toHaveLength(1);
    for (const k of ["kv_namespaces", "r2_buckets", "queues", "services", "hyperdrive", "vectorize", "ai"]) expect(cfg[k]).toBeUndefined();
  });
  test("compatibility date is new enough that deleteAll() also deletes the alarm", () => {
    expect(cfg.compatibility_date >= "2026-02-24").toBe(true);
  });
  test("only /api and /ws wake the Worker; everything else is free static assets", () => {
    expect(cfg.assets.run_worker_first).toEqual(["/api/*", "/ws/*"]);
  });
  test("security headers: strict CSP, no framing, no sniffing", () => {
    expect(headers).toMatch(/Content-Security-Policy: default-src 'self'/);
    expect(headers).toMatch(/script-src 'self'(;|\s*$)/m);
    expect(headers).toMatch(/frame-ancestors 'none'/);
    expect(headers).toMatch(/X-Content-Type-Options: nosniff/);
    expect(headers).not.toMatch(/unsafe-eval/);
    expect(headers).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
  test("the word 'WhatsApp' appears in no name, domain or UI string (locked decision 1)", () => {
    const files = ["index.html", "public/manifest.webmanifest", "wrangler.jsonc", "package.json"];
    for (const d of ["src/client", "src/client/styles", "src/engine", "src/worker"]) for (const f of readdirSync(d)) if (/\.(ts|css)$/.test(f)) files.push(`${d}/${f}`);
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/whatsapp/i);
  });
});
