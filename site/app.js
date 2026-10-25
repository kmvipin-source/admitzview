/* AdmitzView front end. Plain JS, no build step, no tracking, no sign-up.
   Two screens:
   1. Find  — filter by course, state and city; drag or tap colleges/exams into "My list" (max 12).
   2. View  — next deadline, clashes, comparison table (or timeline), and a note listing picks with no dates yet. */
const CONFIG = { maker: "Vipin Madathil", makerUrl: "https://www.youtube.com/@VipinMakes", weeks: 18, max: 12, focus: ["Commerce", "Management"] };

const COURSES = [
  { id: "Commerce", label: "B.Com" },
  { id: "Management", label: "IPM / BBA (IPMAT)" },
];
const COLS = [
  { key: "app", label: "Applications", cats: ["app", "correct", "fee"] },
  { key: "exam", label: "Entrance test", cats: ["exam"] },
  { key: "admit", label: "Admit card", cats: ["admit"] },
  { key: "result", label: "Result / merit list", cats: ["result"] },
  { key: "counsel", label: "Counselling / admission", cats: ["counsel", "docs"] },
];
const HARD = new Set(["exam"]), DEADLINE = new Set(["app", "fee", "correct"]);
const CAT_NAME = { exam: "Exam / test", app: "Application", fee: "Fee", correct: "Correction window", admit: "Admit card",
  result: "Result", counsel: "Counselling", docs: "Document verification" };

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
const ME = { id: "__me", name: "My own dates", authority: "You", stream: [], url: "", kind: "mine" };
const srcOf = id => id === "__me" ? ME : DATA.sources.find(s => s.id === id) || { name: id, authority: "", stream: [] };
const nameOf = e => e.source === "__me" ? e.title : srcOf(e.source).name;
const evEnd = e => e.end || e.start;
const rangeText = e => e.end ? `${fmt(e.start)} – ${fmt(e.end)}` : fmt(e.start);
const COURSE_PROG = { Commerce: ["B.Com"], Management: ["BBA"], Arts: ["BA"], Science: ["B.Sc", "BCA"], Engineering: ["B.Tech"], Law: ["Law"], Design: ["Design"] };
const forCourse = e => {
  if (!e.programme || !S.f.course.length) return true;
  const ok = S.f.course.flatMap(c => COURSE_PROG[c] || []);
  return !ok.length || S.f.course.some(c => !COURSE_PROG[c]) || ok.includes(e.programme);
};
/* programme track: some colleges have separate dates for programmes with / without an entrance test */
const TRACK_RX = { et: /\(programmes without entrance test\)/i, net: /\(programmes with entrance test\)/i };
const hasTracks = id => DATA.events.some(e => e.source === id && TRACK_RX.et.test(e.title)) && DATA.events.some(e => e.source === id && TRACK_RX.net.test(e.title));
const forTrack = e => {
  const t = (S.track || {})[e.source];
  if (!t) return true;
  if (TRACK_RX[t].test(e.title)) return false;
  /* an entrance test or its selection rounds only matter if you chose a programme with an entrance test */
  if (t === "net" && e.cat === "exam" && /entrance test/i.test(e.evidence || "") && !/non[- ]?entrance|without entrance/i.test((e.evidence || "") + e.title)) return false;
  return true;
};
const ownFor = id => DATA.events.filter(e => e.source === id && D(evEnd(e)) >= today && forCourse(e) && forTrack(e));
/* a college that admits through a shared exam (IPMAT, JIPMAT, CUET...) gets that exam's dates, marked "via" */
const upcomingFor = id => {
  const own = ownFor(id), via = (srcOf(id).uses || []).flatMap(x => ownFor(x).map(e => Object.assign({}, e, { via: x, viaFor: id })));
  return [...own, ...via.filter(v => !own.some(o => o.cat === v.cat && o.start === v.start))].sort((a, b) => a.start.localeCompare(b.start));
};
/* the same exam seen through several colleges is one event, not several (and never a clash with itself) */
const examKey = e => e.via || ((srcOf(e.source).uses || [])[0] && e.cat === "exam" ? srcOf(e.source).uses[0] : e.source);
const mineEvents = () => (S.mine || []).filter(e => D(evEnd(e)) >= today).map(e => Object.assign({ source: "__me", verified: "you", evidence: "Added by you" }, e));
function planEvents() {
  const all = [...S.sel.flatMap(id => upcomingFor(id)), ...mineEvents()], seen = new Map();
  for (const e of all) {
    const k = [examKey(e), e.cat, e.start, e.end || ""].join("|");
    if (!seen.has(k)) seen.set(k, Object.assign({}, e, { forList: [] }));
    const f = seen.get(k).forList, who = e.viaFor || e.source;
    if (!f.includes(who)) f.push(who);
  }
  return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
}
function save() { store.set("sel", S.sel); store.set("f", S.f); store.set("done", S.done); store.set("track", S.track); store.set("mine", S.mine); }
const STEPS = [["applied", "Applied"], ["paid", "Fee paid"], ["admit", "Admit card"], ["test", "Test / interview"], ["result", "Result"]];
const isDone = (id, k) => !!((S.done || {})[id] || {})[k];
const STEP_OF = { app: "applied", fee: "paid", correct: "applied", admit: "admit", exam: "test", result: "result" };
/* what we know about a college's official page, in plain words */
function statusOf(s) {
  const n = upcomingFor(s.id).length;
  if (n) return ["ok", `${n} date${n > 1 ? "s" : ""} found · confirm on official site`];
  if (s.status === "failed") {
    if (/bots/i.test(s.reason || "")) return ["warn", "Site blocks our robot · check it yourself"];
    if (/no official dates page/i.test(s.reason || "")) return ["warn", "Not tracked yet · check official site"];
    return ["warn", "Couldn't open the site today · check it yourself"];
  }
  if (s.status === "ok" && s.page_years && s.page_years.length && !s.cycle_published)
    return ["warn", `${DATA.cycle || "2027"} dates not published yet (page shows ${s.page_years.filter(y => y < (DATA.cycle || "2027")).slice(-1)[0] || "older dates"})`];
  if (s.status === "ok") return ["warn", "No clear dates on the official page · check it"];
  return ["warn", "No dates found yet · check official site"];
}
function changedBadge(s) {
  if (!s.page_changed) return "";
  const n = dayDiff(D(s.page_changed.slice(0, 10)), today);
  return n <= 7 ? `<span class="tag new">Official page changed ${n === 0 ? "today" : n === 1 ? "yesterday" : n + " days ago"}</span>` : "";
}
/* applications open right now (own dates only, so we never guess) */
function openInfo(id) {
  const evs = DATA.events.filter(e => e.source === id && e.cat === "app" && forCourse(e) && forTrack(e));
  const closes = evs.filter(e => !/open/i.test(e.title) || e.end).map(e => evEnd(e)).filter(d => D(d) >= today).sort()[0];
  const opened = evs.some(e => D(e.start) <= today);
  return closes && opened ? closes : null;
}

/* ---------- clash engine (rules from the product spec) ---------- */
function minutes(t) { if (!t) return null; const [a, b] = t.split("-"); const m = x => +x.slice(0, 2) * 60 + +x.slice(3, 5); return [m(a), m(b)]; }
function clashes(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    const a = events[i], b = events[j];
    if (a.source === b.source || examKey(a) === examKey(b) || !(a.start <= evEnd(b) && b.start <= evEnd(a))) continue;
    const ah = HARD.has(a.cat), bh = HARD.has(b.cat), an = nameOf(a), bn = nameOf(b);
    if (ah && bh) {
      const ta = minutes(a.time), tb = minutes(b.time);
      if (ta && tb && !a.end && !b.end) {
        if (ta[0] < tb[1] && tb[0] < ta[1]) out.push({ kind: "clash", a, b, why: `${an} and ${bn} are both on ${fmt(a.start)} and the timings overlap.` });
        continue;
      }
      const sure = !a.end && !b.end && !a.tentative && !b.tentative;
      out.push({ kind: sure ? "clash" : "maybe", a, b, why: sure
        ? `${an} and ${bn} are both on ${fmt(a.start)}. Check shift timings on your admit cards.`
        : `${an} (${rangeText(a)}) and ${bn} (${rangeText(b)}) overlap. Your exact slots may or may not clash.` });
    } else if ((ah && !a.end && DEADLINE.has(b.cat) && !b.end) || (bh && !b.end && DEADLINE.has(a.cat) && !a.end)) {
      const [x, y] = ah ? [a, b] : [b, a];
      if (y.start === x.start) out.push({ kind: "risk", a: x, b: y, why: `${nameOf(y)} ${y.title.toLowerCase()} falls on your ${nameOf(x)} exam day. Finish it the day before.` });
    }
  }
  /* back-to-back tests in different cities */
  const cityOf = e => e.source === "__me" ? null : srcOf(e.source).city;
  const tests = events.filter(e => HARD.has(e.cat) && !e.end);
  for (let i = 0; i < tests.length; i++) for (let j = 0; j < tests.length; j++) {
    const a = tests[i], b = tests[j];
    if (a.source === b.source || dayDiff(D(a.start), D(b.start)) !== 1) continue;
    const ca = cityOf(a), cb = cityOf(b);
    if (ca && cb && ca !== cb) out.push({ kind: "risk", a, b, why: `${nameOf(a)} test in ${ca} on ${fmt(a.start)}, then ${nameOf(b)} in ${cb} the next day. Plan your travel early.` });
  }
  /* too many deadlines in one week */
  const dls = events.filter(e => DEADLINE.has(e.cat) && !/open/i.test(e.title)).map(e => evEnd(e)).sort();
  for (let i = 0; i + 2 < dls.length; i++) {
    const j = dls.findLastIndex(d => dayDiff(D(dls[i]), D(d)) <= 6);
    if (j - i >= 2) { out.push({ kind: "risk", why: `${j - i + 1} application deadlines between ${fmt(dls[i])} and ${fmt(dls[j])}. Apply early rather than on the last day.` }); break; }
  }
  return out;
}

/* ---------- screen 1: find ---------- */
function matches(s) {
  const f = S.f;
  if (s.hidden) return false;
  if (f.course.length) {
    const want = f.course.flatMap(id => { const c = COURSES.find(x => x.id === id); return c ? [c.id, ...(c.also || [])] : []; });
    if (!want.some(x => (s.stream || []).includes(x))) return false;
  }
  const places = s.campuses && s.campuses.length ? s.campuses : [{ city: s.city, state: s.state }];
  if (f.state.length && s.state !== "All India" && !places.some(p => f.state.includes(p.state))) return false;
  if (f.city.length && s.city && !places.some(p => f.city.includes(p.city))) return false;
  if (f.q && !(s.name + " " + s.authority).toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}
function itemRow(s) {
  const on = S.sel.includes(s.id), n = upcomingFor(s.id).length;
  const where = s.campuses && s.campuses.length > 1 ? s.campuses.map(c => c.city).join(" · ") : s.city || s.state || "All India";
  const kind = (s.kind || "exam") === "college" ? "" : s.kind === "counselling" ? "Counselling · " : "Entrance exam · ";
  return `<div class="item ${on ? "picked" : ""}" draggable="true" data-drag="${s.id}" data-card="${s.id}" role="button" tabindex="0" aria-pressed="${on}">
    <div class="txt"><b>${esc(s.name)}</b><small>${kind}${esc(where)}</small>
      <span class="tag ${statusOf(s)[0]}">${esc(statusOf(s)[1])}</span>${changedBadge(s)}</div>
    <button class="add ${on ? "on" : ""}" data-toggle="${s.id}" aria-pressed="${on}" aria-label="${on ? "Remove" : "Add"} ${esc(s.name)}">${on ? "✓" : "+"}</button></div>`;
}
function tray() {
  const n = S.sel.length;
  return `<aside class="tray" id="tray" aria-label="My list">
    <div class="row1"><div><b class="trayh">My list</b> <span class="fine num">${n}/${CONFIG.max}</span></div>
      <button class="cta" data-go="view" ${n ? "" : "disabled"}>See my dates →</button></div>
    <div class="chips">${n ? S.sel.map(id => `<button class="chipx" data-toggle="${id}" aria-label="Remove ${esc(srcOf(id).name)}">${esc(srcOf(id).name)}<span>×</span></button>`).join("") : `<span class="fine">Tap + on a college to add it here${matchMedia("(hover:hover)").matches ? ", or drag it in" : ""}.</span>`}</div>
  </aside>`;
}
function multi(key, label, opts, all) {
  const sel = S.f[key], names = opts.filter(([v]) => sel.includes(v)).map(o => o[1]);
  const summary = !names.length ? all : names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  return `<div class="field"><span>${label}</span><details class="ms" data-ms="${key}" ${S.openMs === key ? "open" : ""}><summary>${esc(summary)}</summary>
    <div class="opts">${opts.length ? opts.map(([v, l]) => `<label class="opt"><input type="checkbox" data-f="${key}" value="${esc(v)}" ${sel.includes(v) ? "checked" : ""}><span>${esc(l)}</span></label>`).join("") : `<p class="fine">Pick a state first</p>`}
    ${sel.length ? `<button class="link clr" data-clear="${key}">Clear</button>` : ""}</div></details></div>`;
}
const nextOf = id => { const d = upcomingFor(id).map(keyDate).filter(k => D(k) >= today).sort()[0]; return d || "9999-12-31"; };
const placeOf = s => (s.campuses && s.campuses[0] ? s.campuses[0].city : s.city) || s.state || "";
const SORTS = { dates: ["Dates found first", (a, b) => (upcomingFor(b.id).length > 0) - (upcomingFor(a.id).length > 0) || a.name.localeCompare(b.name)],
  soon: ["Nearest deadline", (a, b) => nextOf(a.id).localeCompare(nextOf(b.id)) || a.name.localeCompare(b.name)],
  name: ["Name A–Z", (a, b) => a.name.localeCompare(b.name)],
  city: ["City", (a, b) => placeOf(a).localeCompare(placeOf(b)) || a.name.localeCompare(b.name)] };
const SHOWS = { all: "All", found: "Only with dates found", none: "Only with no dates found" };
const sel1 = (key, label, opts, val) => `<label class="field sm"><span>${label}</span><select data-pref="${key}">${Object.entries(opts).map(([v, l]) => `<option value="${v}" ${v === val ? "selected" : ""}>${esc(Array.isArray(l) ? l[0] : l)}</option>`).join("")}</select></label>`;
const HOW = `<ol class="how"><li><b>1</b><span>Pick course and city</span></li><li><b>2</b><span>Tap <i>+</i> to add colleges</span></li><li><b>3</b><span>See every date and clash</span></li></ol>`;
const NOTE_SHORT = `<b>Indicative only. Accuracy not guaranteed.</b> Always confirm dates on the official website.`;
const NOTE_LONG = `Dates are read automatically from official websites by a robot every morning. They can be missing, out of date or wrong, and colleges change dates without notice. Before you apply, pay or travel, open the college's or exam body's official website and confirm. AdmitzView is not affiliated with any college and accepts no liability for decisions made using it.`;
const note = () => `<details class="note"><summary>${NOTE_SHORT} <u>Why?</u></summary><p>${NOTE_LONG}</p></details>`;
function viewFind() {
  const places = DATA.sources.filter(s => !s.hidden).flatMap(s => s.campuses && s.campuses.length ? s.campuses : [{ city: s.city, state: s.state }]);
  const states = [...new Set(places.filter(p => p.state && p.state !== "All India").map(p => p.state))].sort();
  const cities = [...new Set(places.filter(p => p.city && (!S.f.state.length || S.f.state.includes(p.state))).map(p => p.city))].sort();
  const show = S.f.show || "all", sortBy = SORTS[S.f.sort] ? S.f.sort : "dates";
  const list = DATA.sources.filter(matches).filter(s => show === "all" || (show === "found") === (upcomingFor(s.id).length > 0)).sort(SORTS[sortBy][1]);
  const colleges = list.filter(s => s.kind === "college"), exams = list.filter(s => s.kind !== "college");
  return `<div class="wrap find"><section class="main">
    <div class="hero"><h1 class="h1">All your admission dates in one view.</h1>
      <p class="lede">B.Com and IPM/BBA colleges. Dates are read from official websites every morning.</p>${HOW}${note()}</div>
    <label class="search"><span class="sr">Search</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="fQ" type="search" placeholder="Search a college or exam" value="${esc(S.f.q || "")}" autocomplete="off"></label>
    <div class="filters">
      ${multi("course", "Course", COURSES.filter(c => c.id).map(c => [c.id, c.label]), "All courses")}
      ${multi("state", "State", states.map(x => [x, x]), "All states")}
      ${multi("city", "City", cities.map(x => [x, x]), "All cities")}
      ${sel1("sort", "Sort", SORTS, sortBy)}${sel1("show", "Show", SHOWS, show)}
    </div>
    <p class="count fine">${list.length} result${list.length === 1 ? "" : "s"}${S.f.course.length || S.f.state.length || S.f.city.length || S.f.q ? ` · <button class="link" data-reset>Clear filters</button>` : ""}</p>
    ${!S.f.q ? openNowStrip(list) : ""}
    ${colleges.length ? `<h2 class="h3">Colleges</h2><div class="results">${colleges.map(itemRow).join("")}</div>` : ""}
    ${exams.length ? `<h2 class="h3">Entrance exams and counselling</h2><div class="results">${exams.map(itemRow).join("")}</div>` : ""}
    ${!list.length ? `<p class="empty">Nothing matches. Try clearing a filter.</p>` : ""}
  </section>${tray()}</div>`;
}

function openNowStrip(list) {
  const open = list.map(s => [s, openInfo(s.id)]).filter(x => x[1]).sort((a, b) => a[1].localeCompare(b[1]));
  if (!open.length) return "";
  return `<h2 class="h3">Applications open right now</h2><div class="opennow">${open.map(([s, c]) => {
    const n = dayDiff(today, D(c)), on = S.sel.includes(s.id);
    return `<div class="oncard ${n <= 7 ? "urgent" : ""}"><b>${esc(s.name)}</b><span>Closes ${fmt(c)} · ${n === 0 ? "today" : `${n} day${n === 1 ? "" : "s"} left`}</span>
      <button class="add ${on ? "on" : ""}" data-toggle="${s.id}" aria-label="${on ? "Remove" : "Add"} ${esc(s.name)}">${on ? "✓" : "+"}</button></div>`;
  }).join("")}</div>`;
}

/* ---------- screen 2: view ---------- */
function nextCard(evs) {
  const up = evs.filter(e => D(evEnd(e)) >= today);
  const dl = up.filter(e => DEADLINE.has(e.cat) && (e.end || !/open/i.test(e.title))).sort((a, b) => evEnd(a).localeCompare(evEnd(b)))[0] || up[0];
  if (!dl) return "";
  const target = DEADLINE.has(dl.cat) ? evEnd(dl) : dl.start, n = dayDiff(today, D(target));
  return `<button class="next" data-ev="${esc(dl.id)}"><span class="count"><b class="num">${n}</b><small>day${n === 1 ? "" : "s"}</small></span>
    <span class="nt"><small>Next deadline · ${fmtY(target)}</small><b>${esc(action(dl))}</b><span>${esc(whoText(dl))}</span></span><span class="go" aria-hidden="true">›</span></button>`;
}
function chip(e) {
  const s = D(e.start), en = D(evEnd(e)), n = dayDiff(today, en), m = dayDiff(today, s);
  if (DEADLINE.has(e.cat) && s <= today && en >= today) return `<span class="st open">Open now · ${n === 0 ? "closes today" : `closes in ${n}d`}</span>`;
  if (m > 0 && m <= 7) return `<span class="st soon">In ${m} day${m === 1 ? "" : "s"}</span>`;
  if (m > 0) return `<span class="st later">In ${m} days</span>`;
  if (en >= today) return `<span class="st soon">On now</span>`;
  return "";
}
function stats(evs, cl) {
  const in30 = evs.filter(e => DEADLINE.has(e.cat) && dayDiff(today, D(evEnd(e))) <= 30).length;
  const open = evs.filter(e => DEADLINE.has(e.cat) && D(e.start) <= today && D(evEnd(e)) >= today).length;
  const tests = evs.filter(e => e.cat === "exam").length, clash = cl.filter(c => c.kind !== "risk").length;
  const box = (n, label, cls = "") => `<div class="stat ${cls}"><b class="num">${n}</b><span>${label}</span></div>`;
  return `<div class="stats">${box(open, "applications open now", open ? "good" : "")}${box(in30, "deadlines in 30 days", in30 ? "warn" : "")}${box(tests, "tests and interviews")}${box(clash, clash === 1 ? "clash" : "clashes", clash ? "bad" : "")}</div>`;
}
const TSORTS = { soon: "Nearest deadline", list: "My list order", name: "Name A–Z" };
function table(withDates, clashIds) {
  const ts = TSORTS[S.tsort] ? S.tsort : "soon";
  withDates = [...withDates];
  if (ts === "soon") withDates.sort((a, b) => nextOf(a).localeCompare(nextOf(b)));
  if (ts === "name") withDates.sort((a, b) => srcOf(a).name.localeCompare(srcOf(b).name));
  return `<div class="tablebar">${sel1("tsort", "Sort rows by", TSORTS, ts)}</div><div class="tablewrap"><table><thead><tr><th>College / exam</th>${COLS.map(c => `<th>${c.label}</th>`).join("")}</tr></thead><tbody>
    ${withDates.map(id => {
      const evs = upcomingFor(id);
      return `<tr><td><b>${esc(srcOf(id).name)}</b><div class="s"><a href="${esc(srcOf(id).url)}" target="_blank" rel="noopener">Confirm on official site</a></div></td>${COLS.map(col => {
        const m = evs.filter(e => col.cats.includes(e.cat));
        if (!m.length) return `<td><span class="dash">—</span></td>`;
        const e = m[0], hit = m.some(x => clashIds.has(x.id));
        return `<td class="${hit ? "clash" : ""}"><button class="cell" data-ev="${esc(e.id)}"><span class="d num">${rangeText(e)}</span>
          <span class="s">${e.via ? `via ${esc(srcOf(e.via).name)} · ` : ""}${esc(e.title)}${e.tentative ? " (tentative)" : ""}${m.length > 1 ? ` · +${m.length - 1} more` : ""}</span>${chip(e)}</button></td>`;
      }).join("")}</tr>`;
    }).join("")}</tbody></table></div>`;
}
function byCollege(withDates, clashIds) {
  return `<div class="colcards">${withDates.map(id => {
    const evs = upcomingFor(id), s = srcOf(id);
    const t = (S.track || {})[id] || "";
    return `<article class="colcard" style="--c:${colorOf(id)}"><header><b>${esc(s.name)}</b><a href="${esc(s.url)}" target="_blank" rel="noopener">Official site ↗</a></header>${changedBadge(s)}
      ${hasTracks(id) ? `<label class="track">My programme <select data-track="${id}"><option value="">All programmes</option><option value="et" ${t === "et" ? "selected" : ""}>With entrance test</option><option value="net" ${t === "net" ? "selected" : ""}>Without entrance test</option></select></label>` : ""}
      <div class="steps" aria-label="My progress">${STEPS.map(([k, l]) => `<button class="step ${isDone(id, k) ? "on" : ""}" data-done="${id}:${k}" aria-pressed="${isDone(id, k)}">${isDone(id, k) ? "✓ " : ""}${l}</button>`).join("")}</div>
      ${evs.length ? "" : `<p class="fine nod">${esc(statusOf(s)[1])}</p>`}
      ${evs.map(e => `<button class="crow ${clashIds.has(e.id) ? "cl" : ""}" data-ev="${esc(e.id)}"><span class="cw">${esc(action(e))}${e.via ? `<small>via ${esc(srcOf(e.via).name)}</small>` : ""}${e.tentative ? `<small>tentative</small>` : ""}</span><span class="cd2 num">${rangeText(e)}</span>${chip(e)}</button>`).join("")}</article>`;
  }).join("")}</div>`;
}
const PALETTE = ["#2f4fd8", "#d43a3a", "#1d8a5b", "#b5650a", "#7b3fc4", "#0f8a9a", "#c2367a", "#5b6b00", "#8a5a2b", "#3d6fb5", "#a33d3d", "#4b4b9a"];
const colorOf = id => id === "__me" ? "#8a8f9c" : PALETTE[Math.max(0, S.sel.indexOf(id)) % PALETTE.length];
const whoText = e => {
  if (e.source === "__me") return "Added by you";
  const name = srcOf(e.via || e.source).name, f = (e.forList || []).filter(x => x !== (e.via || e.source));
  return f.length ? `${name} · for ${f.map(x => srcOf(x).name).join(", ")}` : name;
};
function action(e) {
  if (e.source === "__me") return e.title;
  const q = (e.title.match(/\(([^)]+)\)\s*$/) || [])[1];
  const base = { app: /open/i.test(e.title) ? "Applications open" : "Last date to apply", fee: "Pay fees by", correct: "Correction window",
    admit: "Download admit card", exam: /interview|selection|skill/i.test(e.evidence) && !/entrance test:/i.test(e.evidence) ? "Interview / selection round" : "Entrance test",
    result: "Results / shortlist", counsel: "Counselling", docs: "Document verification" }[e.cat] || e.title;
  return q && !/tentative/i.test(q) ? `${base} (${q})` : base;
}
const keyDate = e => DEADLINE.has(e.cat) && e.end && !/open/i.test(e.title) ? e.end : e.start;
function onDay(evs, iso) { return evs.filter(e => keyDate(e) === iso || (!DEADLINE.has(e.cat) && e.end && e.start <= iso && iso <= e.end)); }
function calendar(evs, clashIds) {
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayIso = iso(today);
  const months = [];
  for (let k = 0; k < 4; k++) {
    const first = new Date(today.getFullYear(), today.getMonth() + k, 1), n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const pad = (first.getDay() + 6) % 7;
    let cells = "";
    for (let i = 0; i < pad; i++) cells += `<span class="cd empty"></span>`;
    for (let d = 1; d <= n; d++) {
      const di = iso(new Date(first.getFullYear(), first.getMonth(), d)), list = onDay(evs, di);
      const dl = list.some(e => DEADLINE.has(e.cat)), cl = list.some(e => clashIds.has(e.id)), past = di < todayIso;
      const dots = [...new Set(list.flatMap(e => e.forList || [e.source]))].slice(0, 4).map(id => `<i style="background:${colorOf(id)}"></i>`).join("");
      cells += list.length
        ? `<button class="cd has ${dl ? "dl" : ""} ${cl ? "cl" : ""} ${di === todayIso ? "now" : ""} ${past ? "past" : ""}" data-day="${di}" aria-label="${fmtY(di)}: ${list.length} date${list.length > 1 ? "s" : ""}"><b>${d}</b><span class="dots">${dots}</span></button>`
        : `<span class="cd ${di === todayIso ? "now" : ""} ${past ? "past" : ""}"><b>${d}</b></span>`;
    }
    months.push(`<div class="mon"><h3>${first.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h3>
      <div class="wk">${["M", "T", "W", "T", "F", "S", "S"].map(x => `<span>${x}</span>`).join("")}</div><div class="days">${cells}</div></div>`);
  }
  const legend = S.sel.filter(id => evs.some(e => (e.forList || [e.source]).includes(id))).map(id => `<span><i style="background:${colorOf(id)}"></i>${esc(srcOf(id).name)}</span>`).join("");
  return `<div class="callegend">${legend}<span class="k"><b class="dlk"></b>Deadline</span><span class="k"><b class="clk"></b>Clash</span></div><div class="cal">${months.join("")}</div>`;
}
function agenda(evs, clashIds) {
  const items = evs.map(e => ({ e, k: keyDate(e) })).filter(x => D(x.k) >= today).sort((a, b) => a.k.localeCompare(b.k));
  let out = "", lastMonth = "";
  items.forEach(({ e, k }) => {
    const d = D(k), mo = d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }), n = dayDiff(today, d);
    if (mo !== lastMonth) { out += `<h3 class="agm">${mo}</h3>`; lastMonth = mo; }
    const when = n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`;
    const urgent = DEADLINE.has(e.cat) && n <= 7;
    out += `<button class="ag ${clashIds.has(e.id) ? "cl" : ""}" data-ev="${esc(e.id)}" style="--c:${colorOf((e.forList || [e.source])[0])}">
      <span class="agd"><b class="num">${d.getDate()}</b><small>${d.toLocaleDateString("en-IN", { weekday: "short" })}</small></span>
      <span class="agt"><b>${esc(action(e))}</b><small>${esc(whoText(e))}${e.end && !DEADLINE.has(e.cat) ? ` · ${rangeText(e)}` : ""}${e.end && DEADLINE.has(e.cat) ? ` · open since ${fmt(e.start)}` : ""}${e.tentative ? " · tentative" : ""}</small></span>
      ${(e.forList || [e.source]).every(id => isDone(id, STEP_OF[e.cat])) && STEP_OF[e.cat] && e.source !== "__me" ? `<span class="st done">✓ Done</span>` : `<span class="st ${urgent ? "urg" : n <= 30 ? "soon" : "later"}">${when}</span>`}</button>`;
  });
  return `<div class="agenda">${out}<p class="fine">Tap any date to see the proof from the official page.</p></div>`;
}
function viewView() {
  const evs = planEvents();
  const cl = clashes(evs), clashIds = new Set(cl.filter(c => c.kind !== "risk").flatMap(c => [c.a.id, c.b.id]));
  const withDates = S.sel.filter(id => upcomingFor(id).length), notYet = S.sel.filter(id => !upcomingFor(id).length);
  const sharedNote = S.sel.filter(id => (srcOf(id).uses || []).length).map(id => `${srcOf(id).name} admits through ${srcOf(id).uses.map(x => srcOf(x).name).join(" and ")}`);
  const cal = calUrls(), tab = ["list", "college", "calendar"].includes(S.tab) ? S.tab : "list";
  const tabBtn = (k, l) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`;
  return `<div class="wrap view">
    <div class="viewtop"><div><h1 class="h2">My dates</h1><span class="fine">${S.sel.length} college${S.sel.length === 1 ? "" : "s"} · ${evs.length} dates · ${S.sel.filter(id => isDone(id, "applied")).length} applied</span></div><button class="btn" data-go="find">Edit list</button></div>
    ${note()}
    ${nextCard(evs)}
    ${alerts(cl)}
    ${withDates.length ? `<div class="tabs" role="tablist">${tabBtn("list", "Timeline")}${tabBtn("college", "By college")}${tabBtn("calendar", "Calendar")}</div>
      ${tab === "list" ? agenda(evs, clashIds) : tab === "college" ? `${byCollege(S.sel, clashIds)}<div class="panel wide-only">${table(withDates, clashIds)}</div>` : `<div class="panel pad">${calendar(evs, clashIds)}</div>`}` : ""}
    ${mineForm()}
    ${sharedNote.length ? `<p class="fine shared">Shared exams are shown once: ${esc(sharedNote.join("; "))}.</p>` : ""}
    ${notYet.length ? `<div class="notyet warnbox"><b>No dates found yet for ${notYet.length} of your picks</b>
      <p>This does <b>not</b> mean applications are closed. The college may not have published them, or our robot missed them. Check today:</p>
      <ul>${notYet.map(id => `<li><a href="${esc(srcOf(id).url)}" target="_blank" rel="noopener">${esc(srcOf(id).name)} ↗</a><small>${esc(statusOf(srcOf(id))[1])}</small></li>`).join("")}</ul></div>` : ""}
    <div class="side">
      <div class="card"><h2 class="h3">Get these dates on your phone</h2>
        ${cal.live ? `<a class="cta full" href="${cal.google}" target="_blank" rel="noopener">Add to Google Calendar</a><a class="btn full" href="${cal.webcal}">iPhone / other calendars</a><button class="btn full" id="copyCal">Copy calendar link</button><p class="fine">New and changed dates appear in your calendar by themselves.</p>`
        : `<button class="cta full" disabled>Add to my calendar</button><p class="fine">Available on the live site.</p>`}</div>
      <div class="card"><h2 class="h3">Open this list on another phone</h2><p class="fine">One link opens the same colleges for your parent or child. Ticks and your own dates stay on each phone.</p><button class="btn full" id="shareList">Copy my list link</button></div>
      <div class="card"><h2 class="h3">Share with a friend</h2>
        <a class="btn full" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent("All my college admission dates side by side, free and no sign-up: " + location.origin)}">Share on WhatsApp</a></div>
      ${(DATA.changes || []).some(c => S.sel.includes(c.source)) ? `<div class="card"><h2 class="h3">Recently changed</h2>${DATA.changes.filter(c => S.sel.includes(c.source)).slice(0, 5).map(c => `<p class="fine"><b>${esc(srcOf(c.source).name)}</b> ${esc(c.title)}: ${c.from ? `${esc(c.from)} → ` : "new: "}<b>${esc(c.to)}</b></p>`).join("")}</div>` : ""}
    </div></div>`;
}
function alerts(cl) {
  const box = c => `<div class="alert ${c.kind}"><b>${c.kind === "clash" ? "Clash" : c.kind === "maybe" ? "Possible clash" : "Plan ahead"}:</b> ${esc(c.why)}</div>`;
  const hard = cl.filter(c => c.kind === "clash"), soft = cl.filter(c => c.kind !== "clash");
  const nm = soft.filter(c => c.kind === "maybe").length, nr = soft.length - nm;
  const label = [nm && `${nm} possible clash${nm > 1 ? "es" : ""}`, nr && `${nr} thing${nr > 1 ? "s" : ""} to plan around`].filter(Boolean).join(" · ");
  return hard.map(box).join("") + (soft.length ? `<details class="alerts"><summary>⚠ ${label} <u>Show</u></summary>${soft.map(box).join("")}</details>` : "");
}
function mineForm() {
  const list = (S.mine || []).filter(e => D(evEnd(e)) >= today);
  return `<details class="mine" ${S.mineOpen ? "open" : ""}><summary>＋ Add my own dates <small>board exams, practicals, family events…</small></summary>
    <form id="mineForm"><label>What<input name="t" required maxlength="60" placeholder="e.g. Board exams (CBSE)"></label>
      <div class="two"><label>From<input name="s" type="date" required></label><label>To (optional)<input name="e" type="date"></label></div>
      <label class="chk"><input type="checkbox" name="x" checked> I can't attend a test on these days (check for clashes)</label>
      <button class="cta" type="submit">Add</button><p class="fine">Only stored on this phone. Board timetables: check your board's official website.</p></form>
    ${list.length ? `<ul class="minel">${list.map(e => `<li><b>${esc(e.title)}</b> ${rangeText(e)} <button class="link" data-unmine="${esc(e.id)}">Remove</button></li>`).join("")}</ul>` : ""}</details>`;
}
function calUrls() {
  const live = /^https?:$/.test(location.protocol) && !DATA.sample && location.hostname !== "localhost";
  const https = location.origin + "/cal?e=" + S.sel.join(","), webcal = https.replace(/^https?:/, "webcal:");
  return { live, https, webcal, google: "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(webcal) };
}

function sheet(id) {
  if (id === "__sites") return `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-label="Official sites we read"><div class="in"><button class="x" data-close aria-label="Close">×</button>
    <h2 class="h2">Official websites we read every morning</h2>
    ${DATA.sources.filter(s => !s.hidden).map(s => `<p class="fine"><b>${esc(s.name)}</b> · ${s.status === "failed" ? "couldn't open today" : s.status === "ok" ? `${s.found} date${s.found === 1 ? "" : "s"} found` : "sample"} · <a href="${esc(s.url)}" target="_blank" rel="noopener">open</a></p>`).join("")}</div></div>`;
  if (id.startsWith("day:")) {
    const di = id.slice(4), list = onDay(planEvents(), di);
    return `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-label="Dates on ${fmtY(di)}"><div class="in"><button class="x" data-close aria-label="Close">×</button>
      <h2 class="h2">${D(di).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h2>
      ${list.map(e => `<button class="ag" data-ev="${esc(e.id)}" style="--c:${colorOf((e.forList || [e.source])[0])}"><span class="agt"><b>${esc(action(e))}</b><small>${esc(whoText(e))}</small></span></button>`).join("")}
      ${list.length > 1 && list.filter(e => e.cat === "exam").length > 1 ? `<p class="bad">More than one test or interview on this day. Check the timings on your admit cards.</p>` : ""}</div></div>`;
  }
  const mine = (S.mine || []).find(x => x.id === id);
  if (mine) return `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-label="My date"><div class="in"><button class="x" data-close aria-label="Close">×</button>
    <small class="fine">Added by you</small><h2 class="h2">${esc(mine.title)}</h2><div class="big num">${mine.end ? `${fmtY(mine.start)} – ${fmtY(mine.end)}` : fmtY(mine.start)}</div>
    <button class="btn full" data-unmine="${esc(mine.id)}">Remove this date</button></div></div>`;
  const e = DATA.events.find(x => x.id === id); if (!e) return "";
  const s = srcOf(e.source);
  return `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-label="Date details"><div class="in"><button class="x" data-close aria-label="Close">×</button>
    <small class="fine">${esc(s.name)} · ${esc(CAT_NAME[e.cat] || e.cat)}</small><h2 class="h2">${esc(e.title)}</h2>
    <div class="big num">${e.end ? `${fmtY(e.start)} – ${fmtY(e.end)}` : fmtY(e.start)}${e.time ? `, ${esc(e.time.replace("-", "–"))}` : ""}</div>
    ${e.tentative ? `<p class="fine">The official site marks this as tentative.</p>` : ""}${e.changed_from ? `<p class="bad">Changed: earlier it said ${esc(e.changed_from)}.</p>` : ""}
    <p class="fine">What the official page says:</p><blockquote>${esc(e.evidence)}</blockquote>
    <a class="cta full" href="${esc(e.url)}" target="_blank" rel="noopener">Open the official page to confirm ↗</a>
    <p class="fine">${e.verified === "2 readers agree" ? "✓ Confirmed by two independent readers of the official page." : "Read from the college's official admission-dates page."} Checked${e.checked ? " " + fmtY(e.checked.slice(0, 10)) : ""}.</p>
    <p class="disclaim sm"><b>Indicative only. Accuracy not guaranteed.</b> Open the official source above and confirm this date before you act.</p></div></div>`;
}

function render() {
  $("#app").innerHTML = `
  <header class="top"><div class="wrap topin">
    <button class="brand" data-go="find" aria-label="AdmitzView home"><svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="2.5" y="5.5" width="27" height="21" rx="5" fill="none" stroke="currentColor" stroke-width="3"/><rect x="8" y="12" width="12" height="3.5" rx="1.75" fill="currentColor"/><circle cx="22" cy="19.5" r="3.5" fill="var(--red)"/></svg>AdmitzView</button>
    <button class="link" id="sitesBtn">${DATA.sample ? "Sample data" : `Updated ${fmt(DATA.generated.slice(0, 10))}, ${DATA.generated.slice(11, 16)}`}</button>
  </div></header>
  ${DATA.sample ? `<div class="wrap"><p class="banner">Preview with sample dates. These are not real dates.</p></div>` : ""}
  <main>${S.view === "view" ? viewView() : viewFind()}</main>
  <footer class="wrap foot"><p><b>Indicative information only. Accuracy is not guaranteed.</b> ${NOTE_LONG}</p>
    <p class="maker">Made by <a href="${CONFIG.makerUrl}" target="_blank" rel="noopener">${esc(CONFIG.maker)}</a> for his son's college applications, and shared free in case it helps you too. No sign-up, no tracking; your list stays on this device.</p></footer>
  ${S.open ? sheet(S.open) : ""}`;
}
function go(v) { S.view = v === "view" && !S.sel.length ? "find" : v; S.open = null; render(); window.scrollTo(0, 0); }
function toast(t) { const n = document.createElement("div"); n.className = "toast"; n.textContent = t; document.body.append(n); setTimeout(() => n.remove(), 2200); }
function toggle(id) {
  const i = S.sel.indexOf(id);
  if (i >= 0) S.sel.splice(i, 1);
  else if (S.sel.length >= CONFIG.max) { toast(`You can compare up to ${CONFIG.max} at a time`); return; }
  else S.sel.push(id);
  save(); render();
}

document.addEventListener("click", async ev => {
  const card = ev.target.closest("[data-card]");
  if (card && !ev.target.closest("button,a")) { toggle(card.dataset.card); return; }
  const t = ev.target.closest("button,[data-close]"); if (!t) return;
  if (t.dataset.done) { const [id, k] = t.dataset.done.split(":"); S.done[id] = S.done[id] || {}; S.done[id][k] = !S.done[id][k]; save(); render(); return; }
  if (t.dataset.unmine) { S.mine = S.mine.filter(x => x.id !== t.dataset.unmine); S.open = null; S.mineOpen = true; save(); render(); return; }
  if (t.id === "shareList") { const u = location.origin + location.pathname + "?l=" + S.sel.join(","); try { await navigator.clipboard.writeText(u); toast("List link copied"); } catch { toast(u); } return; }
  if (t.hasAttribute("data-reset")) { Object.assign(S.f, { course: [], state: [], city: [], q: "" }); save(); render(); return; }
  if (t.dataset.clear) { S.f[t.dataset.clear] = []; S.openMs = null; save(); render(); }
  else if (t.dataset.toggle) { ev.stopPropagation(); toggle(t.dataset.toggle); }
  else if (t.dataset.go) go(t.dataset.go);
  else if (t.dataset.ev) { S.open = t.dataset.ev; render(); }
  else if (t.dataset.day) { S.open = "day:" + t.dataset.day; render(); }
  else if (t.dataset.tab) { S.tab = t.dataset.tab; store.set("tab2", S.tab); render(); }
  else if (t.hasAttribute("data-close")) { S.open = null; render(); }
  else if (t.id === "sitesBtn") { S.open = "__sites"; render(); }
  else if (t.id === "copyCal") { const u = calUrls().https; try { await navigator.clipboard.writeText(u); toast("Calendar link copied"); } catch { toast(u); } }
});
document.addEventListener("change", e => {
  if (e.target.dataset?.track) { S.track[e.target.dataset.track] = e.target.value; save(); render(); return; }
  const pk = e.target.dataset?.pref;
  if (pk) { if (pk === "tsort") { S.tsort = e.target.value; store.set("tsort", S.tsort); } else { S.f[pk] = e.target.value; save(); } render(); return; }
  const k = e.target.dataset?.f; if (!k) return;
  const v = e.target.value, arr = S.f[k];
  e.target.checked ? arr.includes(v) || arr.push(v) : arr.splice(arr.indexOf(v), 1);
  if (k === "state") { const ok = new Set(DATA.sources.flatMap(s => s.campuses || [{ city: s.city, state: s.state }]).filter(p => !S.f.state.length || S.f.state.includes(p.state)).map(p => p.city)); S.f.city = S.f.city.filter(c => ok.has(c)); }
  S.openMs = k; save(); render();
});
document.addEventListener("submit", e => {
  if (e.target.id !== "mineForm") return;
  e.preventDefault();
  const f = new FormData(e.target), st = f.get("s"), en = f.get("e");
  if (!st) return;
  S.mine.push({ id: "mine-" + Date.now(), title: String(f.get("t")).trim().slice(0, 60), start: st, end: en && en > st ? en : null, cat: f.get("x") ? "exam" : "other" });
  S.mineOpen = true; save(); render(); toast("Added to your dates");
});
document.addEventListener("toggle", e => { const d = e.target; if (d.matches?.("details.ms")) { if (d.open) { S.openMs = d.dataset.ms; document.querySelectorAll("details.ms[open]").forEach(o => o !== d && (o.open = false)); } else if (S.openMs === d.dataset.ms) S.openMs = null; } }, true);
document.addEventListener("click", e => { if (!e.target.closest("details.ms") && document.querySelector("details.ms[open]")) { S.openMs = null; document.querySelectorAll("details.ms[open]").forEach(o => o.open = false); } }, true);
document.addEventListener("input", e => {
  if (e.target.id !== "fQ") return;
  S.f.q = e.target.value; const pos = e.target.selectionStart; render();
  const n = $("#fQ"); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && S.open) { S.open = null; render(); }
  const card = e.target.closest?.("[data-card]");
  if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(card.dataset.card); }
});
/* drag and drop (desktop); tapping Add does the same on phones */
document.addEventListener("dragstart", e => { const it = e.target.closest?.("[data-drag]"); if (!it) return; e.dataTransfer.setData("text/plain", it.dataset.drag); it.classList.add("dragging"); });
document.addEventListener("dragend", e => e.target.closest?.("[data-drag]")?.classList.remove("dragging"));
document.addEventListener("dragover", e => { const t = e.target.closest?.("#tray"); if (t) { e.preventDefault(); t.classList.add("over"); } });
document.addEventListener("dragleave", e => { const t = e.target.closest?.("#tray"); if (t && !t.contains(e.relatedTarget)) t.classList.remove("over"); });
document.addEventListener("drop", e => { const t = e.target.closest?.("#tray"); if (!t) return; e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id && !S.sel.includes(id)) toggle(id); else render(); });

async function boot() {
  const [data, cfg] = await Promise.all([
    window.ADMITZVIEW_DATA || fetch("data.json", { cache: "no-cache" }).then(r => r.json()).catch(() => null),
    window.ADMITZVIEW_SOURCES || fetch("sources.json", { cache: "no-cache" }).then(r => r.json()).catch(() => null)]);
  DATA = data;
  if (DATA && cfg) { // the source list is the truth for names, course, state and city; data.json adds what the robot found
    const seen = Object.fromEntries(DATA.sources.map(s => [s.id, s]));
    DATA.sources = cfg.sources.filter(c => (c.stream || []).some(x => CONFIG.focus.includes(x))).map(c => Object.assign({ status: "pending", found: 0 }, seen[c.id] || {},
      { id: c.id, name: c.name, authority: c.authority, stream: c.stream, url: c.url, kind: c.kind || "exam", state: c.state, city: c.city, hidden: c.hidden, campuses: c.campuses, uses: c.uses }));
  }
  if (!DATA) { $("#app").innerHTML = `<p class="wrap" style="padding-top:40px">Couldn't load the dates. Check your internet connection and reload.</p>`; return; }
  const sel = (store.get("sel", []) || []).filter(id => DATA.sources.some(s => s.id === id)).slice(0, CONFIG.max);
  S = { sel, f: (() => { const f = Object.assign({ course: [], state: [], city: [], q: "" }, store.get("f", {}));
      ["course", "state", "city"].forEach(k => { if (!Array.isArray(f[k])) f[k] = f[k] ? [f[k]] : []; }); return f; })(), openMs: null, view: sel.length ? "view" : "find", tab: store.get("tab2", "list"), open: null, tsort: store.get("tsort", "soon"),
    done: store.get("done", {}) || {}, track: store.get("track", {}) || {}, mine: store.get("mine", []) || [] };
  const shared = new URLSearchParams(location.search).get("l");
  if (shared) {
    const ids = shared.split(",").filter(id => DATA.sources.some(s => s.id === id)).slice(0, CONFIG.max);
    if (ids.length) { S.sel = ids; S.view = "view"; save(); setTimeout(() => toast("Opened a shared list"), 300); }
    history.replaceState(null, "", location.pathname);
  }
  render();
}
boot();
