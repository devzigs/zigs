import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPreviewServer, PAGES } from "../tools/test_wallet_server.mjs";
import { assertInertSnapshot } from "../harness/test-wallet-snapshots.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "zigs-ui-sample-test-"));
  const directory = join(root, "sample"), webRoot = join(root, "web");
  await Promise.all([mkdir(directory), mkdir(webRoot)]);
  const html = '<!doctype html><html lang="en"><body>Test wallet · 2 of 3</body></html>';
  await Promise.all(PAGES.map((page) => writeFile(join(directory, page + ".html"), html)));
  await writeFile(join(directory, "sample.css"), "body{margin:0}");
  await writeFile(join(webRoot, "app.css"), "body{color:black}");
  await writeFile(join(webRoot, "app.js"), "secret runtime");
  await writeFile(join(directory, "build-validation.json"), "private build data");
  const server = createPreviewServer({ directory, webRoot });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port;
  t.after(async () => {
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  });
  return { directory, webRoot, root, port };
}

function get(port, path, { method = "GET", host = "127.0.0.1:" + port } = {}) {
  return new Promise((ok, bad) => {
    const req = request({ hostname: "127.0.0.1", port, path, method, headers: { Host: host } },
      (res) => {
        let body = "";
        res.setEncoding("utf8"); res.on("data", (part) => { body += part; });
        res.on("end", () => ok({ status: res.statusCode, headers: res.headers, body }));
      });
    req.on("error", bad); req.end();
  });
}

test("sample pages are read-only and cannot execute or connect to wallet services", async (t) => {
  const { port } = await fixture(t);
  for (const page of ["/", ...PAGES.map((id) => "/" + id + ".html")]) {
    const answer = await get(port, page);
    assert.equal(answer.status, 200, page);
    assert.match(answer.body, /Test wallet · 2 of 3/);
    assert.match(answer.headers["content-security-policy"], /script-src 'none'/);
    assert.match(answer.headers["content-security-policy"], /connect-src 'none'/);
    assert.match(answer.headers["content-security-policy"], /form-action 'none'/);
    assert.equal(answer.headers["cache-control"], "no-store");
    assert.equal(answer.headers["x-content-type-options"], "nosniff");
    assert.equal(answer.headers["access-control-allow-origin"], undefined);
  }
  const head = await get(port, "/", { method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(head.body, "");
  assert.equal((await get(port, "/app.css")).status, 200);
});

test("appearance accepts only explicit light/dark or browser system preference", async (t) => {
  const { port } = await fixture(t);
  for (const theme of ["dark", "light"]) {
    assert.match((await get(port, "/?theme=" + theme)).body,
      new RegExp('data-theme="' + theme + '"'));
  }
  for (const theme of ["system", "invalid", "%22%3E%3Cscript%3E"]) {
    const answer = await get(port, "/?theme=" + theme);
    assert.equal(answer.status, 200);
    assert.doesNotMatch(answer.body, /data-theme|<script>/);
  }
});

test("runtime, private files, service endpoints and traversal fail closed", async (t) => {
  const { port } = await fixture(t);
  const paths = ["/app.js", "/app-keystore.js", "/pkg/zigs.js", "/pkg/zigs_bg.wasm",
    "/api", "/sol/config", "/build-validation.json", "/source.sha256", "/manifest.json",
    "/../web/app.js", "/%2e%2e/web/app.js", "/%2fapp.js", "//localhost/app.css",
    "/app.css.map", "/sample.css/extra", "/fonts/unknown.woff2"];
  for (const path of paths) assert.equal((await get(port, path)).status, 404, path);
  assert.equal((await get(port, "/", { host: "remote.invalid:" + port })).status, 403);
  assert.equal((await get(port, "/", { host: "localhost:9999" })).status, 403);
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    assert.equal((await get(port, "/", { method })).status, 405, method);
  }
});

test("allowed names cannot expose symlinked files or parent directories", async (t) => {
  const { port, directory, webRoot, root } = await fixture(t);
  const outside = join(root, "private.txt"); await writeFile(outside, "never serve");
  await rm(join(directory, "overview.html"));
  await symlink(outside, join(directory, "overview.html"));
  assert.equal((await get(port, "/")).status, 404);
  await mkdir(join(root, "external"));
  await writeFile(join(root, "external/zcash.svg"), "never serve");
  await symlink(join(root, "external"), join(webRoot, "assets"));
  const answer = await get(port, "/assets/zcash.svg");
  assert.equal(answer.status, 404); assert.doesNotMatch(answer.body, /never serve/);
});

test("snapshot audit rejects active markup, remote links and enabled wallet controls", () => {
  const unsafe = ['<script src="/app.js"></script>', '<img onerror="alert(1)">',
    '<a href="https://example.invalid/">remote</a>', '<form action="/api"></form>',
    '<input value="private">', '<button>Sign</button>', '<iframe src="/"></iframe>',
    '<a href="data:text/html,unsafe">unsafe</a>'];
  for (const html of unsafe) assert.throws(() => assertInertSnapshot(html));
  assert.doesNotThrow(() => assertInertSnapshot('<a href="overview.html">Overview</a>'
    + '<button disabled>Sign</button><input disabled>'));
});
