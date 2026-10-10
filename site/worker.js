// zigs.app: static site plus one endpoint that stores early-access emails in D1.
// Only the email and the signup time are stored: no IP, no user agent, no third parties.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function subscribe(req, env) {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return json({ error: "Forbidden." }, 403);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Send the form as JSON." }, 400); }
  // Bots fill the hidden "website" field; answer as if it worked.
  if (body.website) return json({ ok: true });
  const email = String(body.email || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return json({ error: "Enter a valid email address." }, 400);
  // ponytail: no rate limit; the primary key stops duplicates. Add a rate-limit binding if spam appears.
  await env.DB.prepare("INSERT INTO signups (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING")
    .bind(email, Date.now())
    .run();
  // Same answer for new and known emails, so the form cannot reveal who signed up.
  return json({ ok: true });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/subscribe") return subscribe(req, env);
    return env.ASSETS.fetch(req);
  },
};
