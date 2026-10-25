// Run with: npm test   (uses Node's built-in test runner, Node 18+)
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tmm-"));
process.env.DATA_FILE = path.join(tmpDir, "users.json");
const { app, updateMedicineTimers } = require("../server");

let server;
let base;

before(async () => {
  fs.writeFileSync(process.env.DATA_FILE, ""); // empty file must not crash anything
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const call = async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
};

const asha = {
  name: "Asha Rao",
  phone: "9000000001",
  email: "asha@example.com",
  address: "MG Road",
  medicines: [{ name: "Metformin", daysLeft: 1.5 }],
};

test("health endpoint", async () => {
  const r = await call("GET", "/api/health");
  assert.deepStrictEqual(r.json, { ok: true, app: "trackmymeds" });
});

test("empty data file returns an empty list", async () => {
  const r = await call("GET", "/users");
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json, []);
});

test("create, duplicate and validation", async () => {
  assert.strictEqual((await call("POST", "/users", asha)).status, 201);
  assert.strictEqual((await call("POST", "/users", asha)).status, 409);
  assert.strictEqual((await call("POST", "/users", { ...asha, phone: "123" })).status, 400);
  assert.strictEqual((await call("POST", "/users", { ...asha, phone: "9000000009", name: "<script>" })).status, 400);
  assert.strictEqual(
    (await call("POST", "/users", { ...asha, phone: "9000000009", medicines: [{ name: "X", daysLeft: "abc" }] })).status,
    400
  );
  assert.strictEqual((await call("POST", "/users", "{bad json")).status, 400);
  const list = (await call("GET", "/users")).json;
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual(Object.keys(list[0]).sort(), ["address", "email", "medicines", "name", "phone"]);
});

test("unknown fields are dropped", async () => {
  await call("POST", "/users", { ...asha, phone: "9000000002", isAdmin: true });
  const u = (await call("GET", "/users")).json.find((x) => x.phone === "9000000002");
  assert.strictEqual(u.isAdmin, undefined);
});

test("update, including changing the phone number", async () => {
  const r = await call("PUT", "/users/9000000001", { ...asha, phone: "9000000003", name: "Asha R" });
  assert.strictEqual(r.status, 200);
  const list = (await call("GET", "/users")).json;
  assert.ok(list.some((u) => u.phone === "9000000003" && u.name === "Asha R"));
  assert.ok(!list.some((u) => u.phone === "9000000001"));
  // moving onto another customer's phone is rejected
  assert.strictEqual((await call("PUT", "/users/9000000003", { ...asha, phone: "9000000002" })).status, 409);
  assert.strictEqual((await call("PUT", "/users/9999999999", asha)).status, 404);
});

test("delete", async () => {
  assert.strictEqual((await call("DELETE", "/users/9000000002")).status, 200);
  assert.strictEqual((await call("DELETE", "/users/9000000002")).status, 404);
});

test("background job subtracts half a day and never goes below zero", () => {
  updateMedicineTimers();
  let u = JSON.parse(fs.readFileSync(process.env.DATA_FILE, "utf8"))[0];
  assert.strictEqual(u.medicines[0].daysLeft, 1);
  for (let i = 0; i < 5; i++) updateMedicineTimers();
  u = JSON.parse(fs.readFileSync(process.env.DATA_FILE, "utf8"))[0];
  assert.strictEqual(u.medicines[0].daysLeft, 0);
});

test("serves the front end but not server files", async () => {
  assert.strictEqual((await call("GET", "/")).status, 200);
  assert.strictEqual((await call("GET", "/index.js")).status, 200);
  assert.strictEqual((await call("GET", "/styles.css")).status, 200);
  assert.strictEqual((await call("GET", "/server.js")).status, 404);
  assert.strictEqual((await call("GET", "/users.json")).status, 404);
  assert.strictEqual((await call("GET", "/package.json")).status, 404);
});

test("CORS allows GitHub Pages and not other origins", async () => {
  const ok = await fetch(base + "/users", { headers: { Origin: "https://khameer13.github.io" } });
  assert.strictEqual(ok.headers.get("access-control-allow-origin"), "https://khameer13.github.io");
  const bad = await fetch(base + "/users", { headers: { Origin: "https://evil.example" } });
  assert.strictEqual(bad.headers.get("access-control-allow-origin"), null);
});
