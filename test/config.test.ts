import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";

test("config: loopback HOST and TRUST_PROXY=false by default", () => {
  const c = loadConfig({});
  assert.equal(c.HOST, "127.0.0.1");
  assert.equal(c.TRUST_PROXY, false);
  assert.equal(c.API_KEY, undefined);
});

test("config: TRUST_PROXY accepts only true/false", () => {
  assert.equal(loadConfig({ TRUST_PROXY: "true" }).TRUST_PROXY, true);
  assert.equal(loadConfig({ TRUST_PROXY: "FALSE" }).TRUST_PROXY, false);
  assert.equal(loadConfig({ TRUST_PROXY: "" }).TRUST_PROXY, false);
  assert.throws(() => loadConfig({ TRUST_PROXY: "yes" }), /TRUST_PROXY/);
});
