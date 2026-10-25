// Cloudflare Pages Function: /cal?e=jee-main,bitsat
// Builds a calendar feed from data.json. Phones re-fetch it every few hours,
// so when the robot finds a changed date, the student's calendar updates by itself.
// Uses well under 1 ms CPU; free plan allows 100,000 requests/day.

const esc = s => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const ymd = iso => iso.replaceAll("-", "");
const nextDay = iso => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const fold = line => { const out = []; while (line.length > 73) { out.push(line.slice(0, 73)); line = " " + line.slice(73); } out.push(line); return out.join("\r\n"); };

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const ids = new Set((url.searchParams.get("e") || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 40));
  const res = await env.ASSETS.fetch(new URL("/data.json", url));
  const data = await res.json();
  const name = id => (data.sources.find(s => s.id === id) || { name: id }).name;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AdmitzView//Exam dates//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:My exam dates (AdmitzView)", "X-WR-TIMEZONE:Asia/Kolkata",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
  ];
  for (const e of data.events) {
    if (!ids.has(e.source) || data.sample) continue;
    const title = `${name(e.source)}: ${e.title}${e.tentative ? " (tentative)" : ""}`;
    const desc = `${e.evidence}\n\nOfficial source: ${e.url}\nINDICATIVE ONLY - accuracy not guaranteed. Read automatically by AdmitzView. Always confirm on the official website before you act.`;
    lines.push("BEGIN:VEVENT", `UID:${e.id}@admitzview`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(e.start)}`, `DTEND;VALUE=DATE:${ymd(nextDay(e.end || e.start))}`,
      fold(`SUMMARY:${esc(title)}`), fold(`DESCRIPTION:${esc(desc)}`), fold(`URL:${e.url}`), "TRANSP:TRANSPARENT");
    if (["exam", "app", "fee"].includes(e.cat))
      for (const t of ["-P7D", "-P1D"]) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)}`, `TRIGGER:${t}`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="my-exam-dates.ics"',
      "cache-control": "public, max-age=1800",
    },
  });
}
