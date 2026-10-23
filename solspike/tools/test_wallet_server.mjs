// Local presentation snapshots only. No wallet modules or service endpoints are served.
import { lstat, readFile, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PAGES = ["overview", "approvals", "activity", "recipients", "swap", "chats",
  "recovery", "settings", "send", "receive"];
const FONTS = ["geist-latin", "geist-latin-ext", "geist-mono-latin", "geist-mono-latin-ext"];
const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  png: "image/png", svg: "image/svg+xml", woff2: "font/woff2" };
export const HEADERS = Object.freeze({
  "Content-Security-Policy": "default-src 'none'; script-src 'none'; worker-src 'none'; "
    + "connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; "
    + "form-action 'none'; base-uri 'none'; style-src 'self' 'unsafe-inline'; "
    + "img-src 'self'; font-src 'self'",
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), publickey-credentials-get=()",
});

function resources(directory, webRoot) {
  const entries = PAGES.map((page) => ["/" + page + ".html", directory, page + ".html"]);
  entries.push(["/", directory, "overview.html"], ["/sample.css", directory, "sample.css"]);
  for (const name of ["app.css", "design-system.css", "logo.png"])
    entries.push(["/" + name, webRoot, name]);
  for (const name of ["zcash", "solana", "usdc"])
    entries.push(["/assets/" + name + ".svg", webRoot, "assets/" + name + ".svg"]);
  for (const name of FONTS)
    entries.push(["/fonts/" + name + ".woff2", webRoot, "fonts/" + name + ".woff2"]);
  return new Map(entries.map(([url, base, name]) => [url, { base, name }]));
}

async function content(resource) {
  const file = join(resource.base, resource.name), info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw Error("Not a regular preview file");
  const [actual, base] = await Promise.all([realpath(file), realpath(resource.base)]);
  if (!actual.startsWith(base + sep)) throw Error("Outside preview assets");
  return readFile(actual);
}

function themeOf(html, url) {
  const selected = url.searchParams.get("theme");
  const theme = ["dark", "light"].includes(selected) ? ' data-theme="' + selected + '"' : "";
  return html.replace(/<html\b[^>]*>/i, '<html lang="en"' + theme + ">");
}

const allowedHost = (request) => ["localhost:", "127.0.0.1:"]
  .some((host) => request.headers.host === host + request.socket.localPort);

function reply(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, { ...HEADERS, "Content-Type": type });
  response.end(body);
}

function requestAllowed(request, response) {
  let issue;
  if (!allowedHost(request)) issue = [403, "Local preview only.\n"];
  else if (!["GET", "HEAD"].includes(request.method)) issue = [405, "Read-only preview.\n"];
  else if (!request.url.startsWith("/") || request.url.startsWith("//"))
    issue = [404, "Not found.\n"];
  if (issue) { reply(response, ...issue); return false; }
  return true;
}

async function serve(request, response, files) {
  if (!requestAllowed(request, response)) return;
  const url = new URL(request.url, "http://localhost"), resource = files.get(url.pathname);
  if (!resource) return reply(response, 404, "Not found.\n");
  try {
    const type = resource.name.split(".").at(-1), data = await content(resource);
    const body = type === "html" ? themeOf(data.toString(), url) : data;
    return reply(response, 200, request.method === "HEAD" ? undefined : body, TYPES[type]);
  } catch { return reply(response, 404, "Preview file unavailable. Rebuild the sample.\n"); }
}

/** A separate loopback origin: never a wallet store or general static-file server. */
export function createPreviewServer({ directory, webRoot = join(ROOT, "web") }) {
  const files = resources(resolve(directory), resolve(webRoot));
  return createServer((request, response) => {
    serve(request, response, files).catch(() => reply(response, 400, "Invalid preview request.\n"));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] || join(ROOT, "solspike/.state/test-wallet-preview");
  const server = createPreviewServer({ directory });
  server.listen(8793, "127.0.0.1", () => console.log("Test wallet: http://localhost:8793/"));
}
