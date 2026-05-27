import assert from "node:assert/strict";
import test from "node:test";
import handler from "./[...path].js";

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end(body) {
      this.body = body;
      return this;
    },
  };
}

test("health returns ok", () => {
  const res = mockResponse();
  handler({ method: "GET", url: "/health", headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("API health returns ok", () => {
  const res = mockResponse();
  handler({ method: "GET", url: "/api/health", headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("protected API routes return JSON 401", () => {
  const res = mockResponse();
  handler({ method: "GET", url: "/api/deadlines", headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { detail: "not authenticated" });
  assert.equal(res.headers["content-type"], "application/json");
});
