// Structural checks on the importable n8n workflows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../n8n/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".workflow.json"));

test("ships at least one workflow", () => assert.ok(files.length >= 1));

for (const file of files) {
  test(`${file} is a well-formed n8n workflow`, () => {
    const wf = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    assert.equal(typeof wf.name, "string");
    assert.ok(Array.isArray(wf.nodes) && wf.nodes.length > 0);
    const names = new Set<string>();
    for (const n of wf.nodes) {
      assert.match(n.type, /^n8n-nodes-base\./, `${n.name} uses a core node`);
      assert.equal(typeof n.typeVersion, "number");
      assert.ok(Array.isArray(n.position) && n.position.length === 2);
      assert.ok(!names.has(n.name), `duplicate node name ${n.name}`);
      names.add(n.name);
    }
    for (const [source, conn] of Object.entries<{ main: { node: string }[][] }>(wf.connections)) {
      assert.ok(names.has(source), `connection source ${source} exists`);
      for (const output of conn.main) for (const target of output) assert.ok(names.has(target.node), `target ${target.node} exists`);
    }
    const text = JSON.stringify(wf);
    assert.doesNotMatch(text, /sk-ant-|AIza[0-9A-Za-z_-]{20,}|"password"\s*:/, "no secrets embedded");
  });

  test(`${file}: credentials are placeholders and no secrets are embedded`, () => {
    const raw = readFileSync(new URL(file, dir), "utf8");
    const wf = JSON.parse(raw);
    assert.ok(Array.isArray(wf.nodes) && wf.nodes.length > 0 && typeof wf.connections === "object");
    for (const n of wf.nodes) {
      for (const [type, cred] of Object.entries<{ id: string; name: string }>(n.credentials ?? {})) {
        assert.equal(cred.id, "", `${n.name}: ${type} credential id must be empty (selected after import)`);
        assert.ok(cred.name, `${n.name}: ${type} credential has a name`);
      }
    }
    for (const [label, re] of [
      ["Anthropic key", /sk-ant-/],
      ["Bearer token", /Bearer\s+[A-Za-z0-9._~+/-]{8,}/],
      ["Google API key", /AIza[0-9A-Za-z_-]{10,}/],
      ["GitHub token", /gh[pousr]_[A-Za-z0-9]{10,}/],
    ] as const) {
      assert.doesNotMatch(raw, re, `no ${label}`);
    }
  });

  test(`${file}: backend HTTP calls retry and route failures to an error branch`, () => {
    const wf = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    const byName = new Map<string, any>(wf.nodes.map((n: any) => [n.name, n]));
    const backend = wf.nodes.filter((n: any) => n.type === "n8n-nodes-base.httpRequest" && String(n.parameters.url).includes("MEETING_API_URL"));
    assert.ok(backend.length >= 1, "calls the meeting API");
    for (const n of backend) {
      assert.equal(n.retryOnFail, true, `${n.name} retries`);
      assert.ok(n.maxTries >= 2);
      assert.doesNotMatch(JSON.stringify(n), /neverError/, `${n.name} must not swallow HTTP errors`);
      assert.equal(n.onError, "continueErrorOutput", `${n.name} has an error output`);
      assert.ok(n.parameters.options.timeout >= 900_000, `${n.name} waits longer than the backend's worst case`);
      const headers = n.parameters.headerParameters.parameters.map((h: any) => h.name.toLowerCase());
      assert.ok(headers.includes("idempotency-key"), `${n.name} sends an Idempotency-Key so retries cannot duplicate meetings`);
      const errorTargets = (wf.connections[n.name]?.main?.[1] ?? []).map((c: any) => byName.get(c.node));
      assert.ok(errorTargets.length >= 1, `${n.name} error output is connected`);
      for (const t of errorTargets) {
        const ok =
          t.type === "n8n-nodes-base.stopAndError" ||
          (t.type === "n8n-nodes-base.respondToWebhook" && t.parameters.respondWith === "json" && t.parameters.options?.responseCode === 502);
        assert.ok(ok, `${n.name} error output goes to a 502 JSON response or Stop and Error, not ${t.name}`);
      }
    }
  });

  test(`${file}: webhooks require header auth`, () => {
    const wf = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    for (const n of wf.nodes.filter((n: any) => n.type === "n8n-nodes-base.webhook")) {
      assert.equal(n.parameters.authentication, "headerAuth", `${n.name} uses header auth`);
      assert.deepEqual(n.credentials?.httpHeaderAuth, { id: "", name: "Meeting API webhook auth" });
    }
  });
}
