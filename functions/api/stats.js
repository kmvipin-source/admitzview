/* Anonymous visit counter. Stores only totals (no IP, no cookies, no personal data).
   Needs a D1 database bound to this Pages project as "DB". */
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequest({ request, env }) {
  const db = env.DB;
  if (!db) return json({ ok: false });
  const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // India date
  try {
    await db.prepare("CREATE TABLE IF NOT EXISTS counters (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)").run();
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const key = ["visit", "plan"].includes(body.k) ? body.k : null;
      if (key) {
        const up = "INSERT INTO counters (k, n) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1";
        await db.batch([db.prepare(up).bind(key), db.prepare(up).bind(`${key}:${day}`)]);
      }
    }
    const { results } = await db.prepare("SELECT k, n FROM counters WHERE k IN ('visit', 'plan', ?, ?)").bind(`visit:${day}`, `plan:${day}`).all();
    const get = k => (results.find(r => r.k === k) || {}).n || 0;
    return json({ ok: true, visits: get("visit"), plans: get("plan"), today: get(`visit:${day}`) });
  } catch (e) {
    return json({ ok: false });
  }
}
