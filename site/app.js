/* AdmitzView front end. Plain JS, no build step, no tracking, no sign-up. */
const CONFIG = {
  maker: "Vipin",                                   // shown in the footer
  makerUrl: "https://www.youtube.com/@VipinMakes",
  weeks: 18,                                        // ~4 months on the season map
  repoIssues: "",                                   // optional: GitHub issues URL for "Report a wrong date"
};

const STREAMS = ["Engineering", "Medical", "Commerce", "Management", "Law", "Design", "Arts", "Science", "Architecture"];
const STREAM_LABEL = { Engineering: "B.Tech", Medical: "MBBS / Medical", Commerce: "B.Com", Management: "BBA", Law: "Law", Design: "Design",
  Arts: "BA", Science: "B.Sc", Architecture: "B.Arch" };
const HARD = new Set(["exam"]);                     // things you must physically attend
const DEADLINE = new Set(["app", "fee", "correct"]);
const CAT_NAME = { exam: "Exam / test", app: "Application", fee: "Fee", correct: "Correction window", admit: "Admit card",
  result: "Result", counsel: "Counselling", docs: "Document verification" };
const ALIASES = {
  "jee advanced": "jee-adv", "jee adv": "jee-adv", "advanced": "jee-adv", "jee mains": "jee-main", "jee main": "jee-main", "jee": "jee-main",
  "mains": "jee-main", "neet": "neet-ug", "cuet": "cuet-ug", "bitsat": "bitsat", "bits": "bitsat", "viteee": "viteee", "vit": "viteee",
  "srmjeee": "srmjeee", "srm": "srmjeee", "manipal": "met", "met": "met", "comedk": "comedk", "kcet": "kcet", "kea": "kcet",
  "keam": "keam", "mht cet": "mht-cet", "mhtcet": "mht-cet", "wbjee": "wbjee", "ts eapcet": "ts-eapcet", "ts eamcet": "ts-eapcet",
  "ap eapcet": "ap-eapcet", "eapcet": "ap-eapcet", "eamcet": "ap-eapcet", "clat": "clat", "ailet": "ailet", "nata": "nata",
  "uceed": "uceed", "nid": "nid-dat", "nift": "nift", "ipmat": "ipmat", "josaa": "josaa", "mcc": "mcc",
  "christ": "christ", "st joseph s university": "sju", "st josephs university": "sju", "sju": "sju", "sjcc": "sjcc",
  "st joseph s college of commerce": "sjcc", "st josephs college of commerce": "sjcc", "mount carmel": "mcc-blr", "jain": "jain",
  "kristu jayanti": "kristu", "kristu": "kristu", "jyoti nivas": "jyoti", "ramaiah": "msrcasc", "pes": "pes", "presidency": "presidency",
  "garden city": "gcu", "surana": "surana", "bangalore university": "bu", "npat": "npat", "nmims": "npat", "symbiosis": "set", "set": "set",
};

let DATA, S;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const D = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const fmt = (iso, o = { day: "numeric", month: "short" }) => D(iso).toLocaleDateString("en-IN", o);
const fmtY = iso => fmt(iso, { day: "numeric", month: "short", year: "numeric" });
const dayDiff = (a, b) => Math.round((b - a) / 864e5);
const today = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; })();
const store = {
  get(k, d) { try { const v = localStorage.getItem("admitzview." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("admitzview." + k, JSON.stringify(v)); } catch {} },
};

function srcOf(id) { return DATA.sources.find(s => s.id === id) || { name: id, authority: "", stream: [] }; }
function evEnd(e) { return e.end || e.start; }
function rangeText(e) { return e.end ? `${fmt(e.start)} – ${fmt(e.end)}` : fmt(e.start); }

/* ---------- clash engine (rules from the product spec) ---------- */
function minutes(t) { if (!t) return null; const [a, b] = t.split("-"); const m = x => +x.slice(0, 2) * 60 + +x.slice(3, 5); return [m(a), m(b)]; }
function clashes(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    const a = events[i], b = events[j];
    if (a.source === b.source) continue;
    if (!(a.start <= evEnd(b) && b.start <= evEnd(a))) continue;
    const ah = HARD.has(a.cat), bh = HARD.has(b.cat);
    if (ah && bh) {
      const ta = minutes(a.time), tb = minutes(b.time);
      if (ta && tb && !a.end && !b.end) {
        if (ta[0] < tb[1] && tb[0] < ta[1]) out.push({ kind: "clash", a, b, why: `Both on ${fmt(a.start)} and the timings overlap.` });
        continue; // same day, different shifts: fine
      }
      const sure = !a.end && !b.end && !a.tentative && !b.tentative;
      out.push({ kind: sure ? "clash" : "maybe", a, b,
        why: sure ? `${srcOf(a.source).name} and ${srcOf(b.source).name} are both on ${fmt(a.start)}. Timings aren't published for both yet, so check shifts.`
                  : `${srcOf(a.source).name} (${rangeText(a)}) and ${srcOf(b.source).name} (${rangeText(b)}) overlap. Your exact slots may or may not clash.` });
    } else if ((ah && !a.end && DEADLINE.has(b.cat) && !b.end) || (bh && !b.end && DEADLINE.has(a.cat) && !a.end)) {
      const [x, y] = ah ? [a, b] : [b, a];
      if (y.start >= x.start && y.start <= evEnd(x))
        out.push({ kind: "risk", a: x, b: y, why: `${srcOf(y.source).name} ${y.title.toLowerCase()} is on the same day as your ${srcOf(x.source).name} exam (${fmt(x.start)}). Finish it the day before.` });
    }
  }
  return out;
}

/* ---------- state ---------- */
function selectedEvents() { return DATA.events.filter(e => S.sel.has(e.source)).sort((a, b) => a.start.localeCompare(b.start)); }
function save() { store.set("sel", [...S.sel]); store.set("stream", S.stream); }

/* ---------- plain-English helper ---------- */
function parseAsk(q) {
  let text = " " + q.toLowerCase().replace(/[^a-z0-9 ]/g, " ") + " ";
  const ids = [];
  for (const k of Object.keys(ALIASES).sort((a, b) => b.length - a.length)) {
    const rx = new RegExp(` ${k} `, "g");
    if (rx.test(text)) { ids.push(ALIASES[k]); text = text.replace(rx, " "); }
  }
  const stream = STREAMS.find(s => text.includes(s.toLowerCase()) || (s === "Medical" && text.includes("mbbs")) || (s === "Law" && text.includes("llb"))
    || (s === "Commerce" && /\bb ?com\b/.test(text)) || (s === "Engineering" && /\bb ?tech\b/.test(text)) || (s === "Management" && /\bbba\b/.test(text)));
  return { ids: [...new Set(ids)].filter(id => DATA.sources.some(s => s.id === id)), stream, wantsClash: /clash|overlap|same day|conflict/.test(text) };
}

function summary(evs, cl) {
  if (!S.sel.size) return [];
  if (!evs.length) return [`None of your picks have announced ${esc(DATA.cycle)} dates yet. Most exam bodies and colleges publish them a few months ahead, and the robot checks their official sites every morning.`,
    `Meanwhile, tap <b>Which sites?</b> at the top to open each official page yourself.`];
  const lines = [];
  const end = new Date(today); end.setDate(end.getDate() + CONFIG.weeks * 7);
  const upcoming = evs.filter(e => D(evEnd(e)) >= today);
  const inMap = upcoming.filter(e => D(e.start) <= end);
  const exams = new Set(inMap.map(e => e.source)).size;
  lines.push(`In the next 4 months you have <b class="num">${inMap.length}</b> dates across <b class="num">${exams}</b> exam${exams === 1 ? "" : "s"}.`);
  const dl = upcoming.find(e => DEADLINE.has(e.cat));
  if (dl) {
    const n = dayDiff(today, D(evEnd(dl)));
    lines.push(`Next deadline: <b>${esc(srcOf(dl.source).name)} ${esc(dl.title.toLowerCase())}</b> on ${fmtY(evEnd(dl))}${n >= 0 ? `, <b class="num">${n}</b> day${n === 1 ? "" : "s"} from today` : ""}.`);
  }
  const ex = upcoming.find(e => HARD.has(e.cat));
  if (ex) lines.push(`First exam: <b>${esc(srcOf(ex.source).name)}</b> on ${rangeText(ex)}.`);
  // busiest week
  const weeks = {};
  inMap.forEach(e => { const k = Math.floor(dayDiff(mapStart(), D(e.start)) / 7); weeks[k] = (weeks[k] || 0) + 1; });
  const [bw, bc] = Object.entries(weeks).sort((a, b) => b[1] - a[1])[0] || [];
  if (bc > 2) { const d = new Date(mapStart()); d.setDate(d.getDate() + bw * 7); lines.push(`Busiest week: starting ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, with <b class="num">${bc}</b> dates.`); }
  const hard = cl.filter(c => c.kind === "clash"), maybe = cl.filter(c => c.kind === "maybe");
  if (hard.length) lines.push(`<span class="clashline">${hard.length} clash${hard.length > 1 ? "es" : ""}: ${hard.map(c => `${esc(srcOf(c.a.source).name)} and ${esc(srcOf(c.b.source).name)} on ${fmt(c.a.start)}`).join("; ")}.</span>`);
  if (maybe.length) lines.push(`${maybe.length} possible clash${maybe.length > 1 ? "es" : ""} where dates overlap. Check your slot when admit cards come out.`);
  if (!hard.length && !maybe.length) lines.push(`No clashes among the dates found so far.`);
  const stale = evs.filter(e => e.stale).length;
  if (stale) lines.push(`${stale} date${stale > 1 ? "s" : ""} couldn't be re-checked today. Confirm those on the official site.`);
  return lines;
}

/* ---------- season map ---------- */
function mapStart() { const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }
function seasonMap(evs, cl) {
  const ids = [...S.sel];
  if (!ids.length) return `<div class="empty"><b>Pick your exams above</b> to draw your season. Or type them, like "JEE, BITSAT and KCET".</div>`;
  const start = mapStart(), days = CONFIG.weeks * 7, W = days * 7;
  const x = d => Math.max(0, Math.min(days, dayDiff(start, d))) * 7;
  const clashIds = new Set(cl.filter(c => c.kind !== "risk").flatMap(c => [c.a.id, c.b.id]));
  let months = "", weeks = "", busy = "";
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    if (d.getDate() === 1 || i === 0) months += `<span style="left:${i * 7}px">${d.toLocaleDateString("en-IN", { month: "long" })}</span>`;
    if (i % 7 === 0) weeks += `<i class="week" style="left:${i * 7}px"></i>`;
  }
  const counts = Array(CONFIG.weeks).fill(0);
  evs.forEach(e => { const k = Math.floor(dayDiff(start, D(e.start)) / 7); if (k >= 0 && k < CONFIG.weeks) counts[k]++; });
  const max = Math.max(1, ...counts);
  counts.forEach((c, k) => { if (c) busy += `<i style="left:${k * 49 + 4}px;width:41px;opacity:${(0.15 + 0.85 * c / max).toFixed(2)}" title="${c} date${c > 1 ? "s" : ""} this week"></i>`; });
  const todayX = x(today);
  const bands = cl.filter(c => c.kind !== "risk").map(c => {
    const s = c.a.start > c.b.start ? c.a.start : c.b.start, e = evEnd(c.a) < evEnd(c.b) ? evEnd(c.a) : evEnd(c.b);
    return `<i class="clashband" style="left:${x(D(s))}px;width:${Math.max(7, x(D(e)) - x(D(s)) + 7)}px"></i>`;
  }).join("");
  let rows = `<div class="lab" style="height:28px;border-top:0"></div><div class="months" style="width:${W}px">${months}</div>
    <div class="lab" style="height:22px;font-weight:400;font-size:.78rem;color:var(--muted)">Busy weeks</div><div class="busy" style="width:${W}px">${busy}</div>`;
  ids.forEach(id => {
    const s = srcOf(id);
    const mine = evs.filter(e => e.source === id && D(evEnd(e)) >= start && dayDiff(start, D(e.start)) < days);
    const bubbles = mine.map(e => {
      const l = x(D(e.start)), w = e.end ? Math.max(20, x(D(e.end)) - l + 7) : 20;
      const cls = ["ev", e.cat, e.tentative ? "tent" : "", clashIds.has(e.id) ? "clash" : "", e.stale ? "stale" : ""].join(" ");
      return `<button class="${cls}" style="left:${l - (e.end ? 0 : 6)}px;width:${w}px" data-ev="${esc(e.id)}" aria-label="${esc(s.name)}: ${esc(e.title)}, ${rangeText(e)}"></button>`;
    }).join("");
    const note = mine.length ? `<small>${esc(s.authority)}</small>` : s.status === "failed" ? `<small>Couldn't read today</small>` : `<small>No 2027 dates yet</small>`;
    rows += `<div class="lab">${esc(s.name)}${note}</div><div class="lane" style="width:${W}px">${weeks}${bands}${todayX ? `<i class="today" style="left:${todayX}px"></i>` : `<i class="today" style="left:0"></i>`}${bubbles}</div>`;
  });
  return `<div class="scroller"><div class="grid">${rows}</div></div>`;
}

/* ---------- list + changes ---------- */
function listView(evs, cl) {
  if (!evs.length) return `<p class="meta">No dates for your exams yet. Most bodies announce dates a few months ahead; the robot checks every morning.</p>`;
  const clashIds = new Set(cl.filter(c => c.kind === "clash").map(c => [c.a.id, c.b.id]).flat());
  return evs.map(e => {
    const s = srcOf(e.source), past = D(evEnd(e)) < today;
    const pills = [
      clashIds.has(e.id) ? `<span class="pill p-clash">Clash</span>` : "",
      e.changed_from ? `<span class="pill p-changed">Changed</span>` : "",
      e.stale ? `<span class="pill p-stale">Couldn't re-check</span>` : e.tentative ? `<span class="pill p-tent">Tentative</span>` : `<span class="pill p-auto">Auto-read</span>`,
    ].join("");
    return `<div class="row ${past ? "past" : ""}"><div class="when num">${rangeText(e)}<small>${D(e.start).getFullYear()}${e.time ? " · " + esc(e.time.replace("-", "–")) : ""}</small></div>
      <div><h4>${esc(s.name)}: ${esc(e.title)}</h4><div class="meta">${pills}<button class="linkish" data-ev="${esc(e.id)}" style="background:none;border:0;padding:0;color:var(--blue);text-decoration:underline">See proof</button></div></div></div>`;
  }).join("");
}
function changesView() {
  const ch = (DATA.changes || []).filter(c => S.sel.size === 0 || S.sel.has(c.source));
  if (!ch.length) return `<p class="meta">Nothing has changed for your exams recently. When an official site moves a date, it shows up here and in your calendar.</p>`;
  return ch.map(c => `<div class="row"><div class="when num">${fmt(c.when.slice(0, 10))}<small>found</small></div><div><h4>${esc(srcOf(c.source).name)}: ${esc(c.title)}</h4>
    <div class="meta">${c.from ? `Moved from ${esc(c.from)} to <b>${esc(c.to)}</b>` : `New date: <b>${esc(c.to)}</b>`} · <a href="${esc(c.url)}" target="_blank" rel="noopener">Official source</a></div></div></div>`).join("");
}

/* ---------- calendar + share ---------- */
function calUrls() {
  const live = /^https?:$/.test(location.protocol) && !DATA.sample && location.hostname !== "localhost";
  const q = "/cal?e=" + [...S.sel].join(",");
  const https = location.origin + q, webcal = https.replace(/^https?:/, "webcal:");
  return { live, https, webcal, google: "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(webcal) };
}

/* ---------- render ---------- */
function render() {
  const evs = selectedEvents(), cl = clashes(evs);
  const ok = DATA.sources.filter(s => s.status === "ok").length;
  const visible = DATA.sources.filter(s => !s.hidden && (!S.stream || (s.stream || []).includes(S.stream)));
  const cal = calUrls();
  const aiReady = "LanguageModel" in self;
  $("#app").innerHTML = `
  <header class="wrap top">
    <div><h1 class="mark"><svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="2.5" y="5.5" width="27" height="21" rx="5" fill="none" stroke="var(--lead)" stroke-width="3"/><rect x="8" y="12" width="12" height="3.5" rx="1.75" fill="var(--lead)"/><circle cx="22" cy="19.5" r="3.5" fill="var(--red)"/></svg>AdmitzView</h1>
      <p class="tag">Every entrance exam and college admission date you care about, on one map. Clashes show up in red. Free, no sign-up.</p></div>
    <div class="health">${DATA.sample ? "" : `Checked <b class="num">${ok}</b> of ${DATA.sources.length} official sites<br>${fmtY(DATA.generated.slice(0, 10))}, ${DATA.generated.slice(11, 16)} IST · `}<button id="sitesBtn">Which sites?</button></div>
  </header>
  <main class="wrap">
    ${DATA.sample ? `<div class="banner"><b>Preview with sample dates.</b> These are not real dates. Real dates appear after the robot's first daily run.</div>` : ""}
    <section class="pick" aria-label="Choose your exams">
      <form class="ask" id="askForm"><input id="askIn" aria-label="Type your exams" placeholder='Type exams or colleges, e.g. "Christ, Mount Carmel and CUET"' autocomplete="off"><button>Show</button></form>
      ${S.pickOpen ? `<div class="streams" role="group" aria-label="Filter by stream"><button class="stream" data-stream="" aria-pressed="${!S.stream}">All</button>${STREAMS.filter(st => DATA.sources.some(s => (s.stream || []).includes(st))).map(st => `<button class="stream" data-stream="${st}" aria-pressed="${S.stream === st}">${STREAM_LABEL[st] || st}</button>`).join("")}</div>
      <input id="pickSearch" class="pickq" aria-label="Search exams and colleges" placeholder="Search, e.g. Christ, KCET, Mount Carmel" value="${esc(S.q || "")}" autocomplete="off">
      ${[["exam", "Entrance exams"], ["counselling", "Counselling"], ["college", "Colleges (Bengaluru)"]].map(([k, label]) => {
        const list = visible.filter(s => (s.kind || "exam") === k && (!S.q || (s.name + " " + s.authority).toLowerCase().includes(S.q.toLowerCase())));
        return list.length ? `<div class="grp"><div class="grph">${label}</div><div class="exams" role="group" aria-label="${label}">${list.map(s => `<button class="exam ${s.status === "failed" ? "down" : ""}" data-src="${s.id}" aria-pressed="${S.sel.has(s.id)}"><span class="b"></span>${esc(s.name)}</button>`).join("")}</div></div>` : "";
      }).join("") || `<p class="hint">Nothing matches "${esc(S.q)}". Try a shorter name.</p>`}
      <div><button class="more" id="pickToggle">Done</button></div>` :
      `<div class="exams" role="group" aria-label="Your exams">${DATA.sources.filter(s => S.sel.has(s.id)).map(s => `<button class="exam" data-src="${s.id}" aria-pressed="true" title="Remove ${esc(s.name)}"><span class="b"></span>${esc(s.name)}</button>`).join("")}<button class="more" id="pickToggle">${S.sel.size ? "Add exams or colleges" : "Choose exams or colleges"}</button></div>`}
      ${S.msg ? `<p class="hint">${S.msg}</p>` : ""}
    </section>

    <section class="map" aria-label="Season map">
      <div class="maphead"><h2>Your next 4 months</h2>
        <div class="legend"><span><i class="lg"></i>Exam</span><span><i class="lg app"></i>Application</span><span><i class="lg counsel"></i>Counselling / fees</span><span><i class="lg result"></i>Admit card / result</span><span><i class="lg tent"></i>Tentative</span><span><i class="lg clash"></i>Clash</span></div>
      </div>
      ${seasonMap(evs, cl)}
    </section>

    <section class="below">
      <div class="say" aria-live="polite"><h3>Your season in plain words</h3>${summary(evs, cl).map(l => `<p>${l}</p>`).join("") || `<p class="meta">Pick exams to get your summary.</p>`}
        ${cl.filter(c => c.kind === "risk").map(c => `<p class="meta">Planning tip: ${c.why}</p>`).join("")}
      </div>
      <div class="actions">
        <h3>Keep it on your phone</h3>
        ${S.sel.size ? (cal.live ? `<a class="btn main" href="${cal.google}" target="_blank" rel="noopener">Add to Google Calendar</a>
          <a class="btn" href="${cal.webcal}">Add to iPhone / other calendar</a>
          <button class="btn" id="copyCal">Copy calendar link</button>
          <p class="hint">Your calendar updates by itself when an exam body changes a date.</p>`
          : `<button class="btn main" disabled>Add to my calendar</button><p class="hint">Works once the site is live on Cloudflare.</p>`) : `<p class="hint">Pick exams first.</p>`}
        <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent("I check all my entrance exam dates and clashes on one map here, free: " + location.origin)}">Share on WhatsApp</a>
        ${aiReady && S.sel.size ? `<div class="aiask"><h3>Ask about your dates</h3><textarea id="aiq" placeholder="e.g. Which week should I keep free for travel?"></textarea><button class="btn" id="aiGo">Ask (runs on your device)</button><div class="aiout" id="aiOut"></div></div>` : ""}
      </div>
    </section>

    <section>
      <div class="tabs" role="tablist"><button role="tab" data-tab="list" aria-selected="${S.tab === "list"}">All dates</button><button role="tab" data-tab="changes" aria-selected="${S.tab === "changes"}">What changed${(DATA.changes || []).some(c => S.sel.has(c.source)) ? " •" : ""}</button></div>
      ${S.tab === "list" ? listView(evs, cl) : changesView()}
    </section>
  </main>
  <footer class="wrap foot">
    <p><b>Always confirm dates on the official website before you act.</b> Dates are read automatically every morning from official exam websites and may contain mistakes. AdmitzView is not affiliated with any college or exam authority.</p>
    <p>No sign-up, no tracking. Your exam choices stay on this device.</p>
    <p>Made by <a href="${CONFIG.makerUrl}" target="_blank" rel="noopener">${esc(CONFIG.maker)}</a>, free for every student.</p>
  </footer>
  ${S.open ? sheet(S.open, cl) : ""}`;
}

function sheet(id, cl) {
  if (id === "__sites") return `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-label="Official sites checked"><div class="in"><button class="x" data-close aria-label="Close">×</button>
    <h3>Official sites the robot reads every morning</h3>
    ${DATA.sources.map(s => `<div class="meta"><b style="color:var(--lead)">${esc(s.name)}</b>${s.city ? ` (${esc(s.city)})` : ""}, ${esc(s.authority)}: ${s.status === "failed" ? `<span style="color:var(--red)">${esc(s.reason || "couldn't read")}</span>` : s.status === "ok" ? `read OK, ${s.found} dates${s.ai ? ", tidied by AI" : ""}` : "sample"} · <a href="${esc(s.url)}" target="_blank" rel="noopener">open site</a></div>`).join("")}
  </div></div>`;
  const e = DATA.events.find(x => x.id === id); if (!e) return "";
  const s = srcOf(e.source);
  const c = cl.filter(k => k.a.id === id || k.b.id === id);
  return `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-label="Date details"><div class="in"><button class="x" data-close aria-label="Close">×</button>
    <h3>${esc(s.name)}: ${esc(e.title)}</h3>
    <div class="num" style="font-size:1.3rem;font-weight:600">${e.end ? `${fmtY(e.start)} – ${fmtY(e.end)}` : fmtY(e.start)}${e.time ? `, ${esc(e.time.replace("-", "–"))}` : ""}</div>
    <div class="meta">${esc(CAT_NAME[e.cat] || e.cat)} · ${esc(s.authority)}${e.tentative ? " · marked tentative by the source" : ""}</div>
    ${e.changed_from ? `<p style="color:var(--red);margin:0">Changed: earlier it said ${esc(e.changed_from)}.</p>` : ""}
    ${c.map(k => `<p style="color:var(--red);margin:0"><b>${k.kind === "clash" ? "Clash" : k.kind === "maybe" ? "Possible clash" : "Planning tip"}:</b> ${esc(k.why)}</p>`).join("")}
    <div class="meta">What the official page says:</div>
    <blockquote>${esc(e.evidence)}</blockquote>
    <a href="${esc(e.url)}" target="_blank" rel="noopener">Open the official source</a>
    <div class="meta">${e.stale ? "Couldn't re-check this today. " : ""}Read automatically on ${e.checked ? fmtY(e.checked.slice(0, 10)) : "—"}${e.ai ? ", title tidied by AI (the date itself is copied from the source)" : ""}. Always confirm on the official site.</div>
    ${CONFIG.repoIssues ? `<a href="${CONFIG.repoIssues}/new?title=${encodeURIComponent("Wrong date: " + s.name + " " + e.title)}&body=${encodeURIComponent("Event id: " + e.id)}" target="_blank" rel="noopener">Report a wrong date</a>` : ""}
  </div></div>`;
}

function toast(t) { const n = document.createElement("div"); n.className = "toast"; n.textContent = t; document.body.append(n); setTimeout(() => n.remove(), 2200); }

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button,[data-close]"); if (!t) return;
  if (t.dataset.src) { S.sel.has(t.dataset.src) ? S.sel.delete(t.dataset.src) : S.sel.add(t.dataset.src); S.msg = ""; save(); render(); }
  else if (t.dataset.stream !== undefined) { S.stream = t.dataset.stream; save(); render(); }
  else if (t.dataset.ev) { S.open = t.dataset.ev; render(); }
  else if (t.hasAttribute("data-close")) { S.open = null; render(); }
  else if (t.id === "pickToggle") { S.pickOpen = !S.pickOpen; render(); }
  else if (t.id === "sitesBtn") { S.open = "__sites"; render(); }
  else if (t.dataset.tab) { S.tab = t.dataset.tab; render(); }
  else if (t.id === "copyCal") {
    const u = calUrls().https;
    try { await navigator.clipboard.writeText(u); toast("Calendar link copied"); } catch { prompt("Copy this link", u); }
  } else if (t.id === "aiGo") { askAI(); }
});
document.addEventListener("input", e => {
  if (e.target.id !== "pickSearch") return;
  S.q = e.target.value; const pos = e.target.selectionStart; render();
  const n = $("#pickSearch"); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.open) { S.open = null; render(); } });
document.addEventListener("submit", e => {
  if (e.target.id !== "askForm") return;
  e.preventDefault();
  const r = parseAsk($("#askIn").value);
  if (!r.ids.length && !r.stream) { S.msg = "I couldn't spot an exam name there. Try names like JEE, NEET, CUET, BITSAT, KCET or CLAT."; render(); return; }
  if (r.ids.length) { S.sel = new Set(r.ids); }
  if (r.stream) S.stream = r.stream;
  const cl = clashes(selectedEvents()).filter(c => c.kind !== "risk");
  S.msg = r.wantsClash ? (cl.length ? `Found ${cl.length} clash${cl.length > 1 ? "es" : ""}. They're ringed in red on the map.` : "No clashes among the dates announced so far.") : `Showing ${r.ids.map(i => srcOf(i).name).join(", ") || r.stream}.`;
  save(); render();
});

async function askAI() {
  const out = $("#aiOut"), q = $("#aiq").value.trim(); if (!q) return;
  out.textContent = "Thinking on your device…";
  try {
    if ((await LanguageModel.availability()) === "unavailable") throw new Error("not available on this device");
    const list = selectedEvents().map(e => `${srcOf(e.source).name} | ${e.title} | ${e.start}${e.end ? " to " + e.end : ""}${e.time ? " | " + e.time : ""}`).join("\n");
    const s = await LanguageModel.create({ initialPrompts: [{ role: "system", content:
      `You help an Indian Class 12 student plan exam season. Today is ${today.toISOString().slice(0, 10)}. Use ONLY these dates; never invent dates. If something isn't in the list, say it isn't announced yet. Keep answers under 80 words and remind them to confirm on official sites.\n${list}` }] });
    out.textContent = await s.prompt(q);
  } catch (err) { out.textContent = "The on-device assistant isn't available in this browser. Your map and summary above have everything."; }
}

async function boot() {
  DATA = window.ADMITZVIEW_DATA || await fetch("data.json", { cache: "no-cache" }).then(r => r.json()).catch(() => null);
  if (!DATA) { document.getElementById("app").innerHTML = `<p class="wrap" style="padding-top:40px">Couldn't load exam dates. Check your internet connection and reload.</p>`; return; }
  const saved = store.get("sel", null);
  S = { sel: new Set((saved || ["jee-main", "bitsat", "viteee", "comedk", "kcet"]).filter(id => DATA.sources.some(s => s.id === id))),
        stream: store.get("stream", ""), tab: "list", open: null, msg: "", pickOpen: false };
  if (!S.sel.size) S.pickOpen = true;
  render();
}
boot();
