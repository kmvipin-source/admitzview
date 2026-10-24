/* AdmitzView front end. Plain JS, no build step, no tracking, no sign-up.
   Two screens:
   1. Find  — filter by course, state and city; drag or tap colleges/exams into "My list" (max 12).
   2. View  — next deadline, clashes, comparison table (or timeline), and a note listing picks with no dates yet. */
const CONFIG = { maker: "Vipin", makerUrl: "https://www.youtube.com/@VipinMakes", weeks: 18, max: 12 };

const COURSES = [
  { id: "", label: "All courses" },
  { id: "Commerce", label: "B.Com" },
  { id: "Engineering", label: "B.Tech / B.E." },
  { id: "Medical", label: "MBBS / Medical" },
  { id: "Management", label: "BBA / IPM" },
  { id: "Law", label: "Law (BA LLB)" },
  { id: "Design", label: "Design / B.Arch", also: ["Architecture"] },
  { id: "Arts", label: "BA", also: [] },
  { id: "Science", label: "B.Sc", also: [] },
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
const srcOf = id => DATA.sources.find(s => s.id === id) || { name: id, authority: "", stream: [] };
const evEnd = e => e.end || e.start;
const rangeText = e => e.end ? `${fmt(e.start)} – ${fmt(e.end)}` : fmt(e.start);
const COURSE_PROG = { Commerce: ["B.Com"], Management: ["BBA"], Arts: ["BA"], Science: ["B.Sc", "BCA"], Engineering: ["B.Tech"], Law: ["Law"], Design: ["Design"] };
const forCourse = e => {
  if (!e.programme || !S.f.course.length) return true;
  const ok = S.f.course.flatMap(c => COURSE_PROG[c] || []);
  return !ok.length || S.f.course.some(c => !COURSE_PROG[c]) || ok.includes(e.programme);
};
const ownFor = id => DATA.events.filter(e => e.source === id && D(evEnd(e)) >= today && forCourse(e));
/* a college that admits through a shared exam (IPMAT, JIPMAT, CUET...) gets that exam's dates, marked "via" */
const upcomingFor = id => {
  const own = ownFor(id), via = (srcOf(id).uses || []).flatMap(x => ownFor(x).map(e => Object.assign({}, e, { via: x, viaFor: id })));
  return [...own, ...via.filter(v => !own.some(o => o.cat === v.cat && o.start === v.start))].sort((a, b) => a.start.localeCompare(b.start));
};
/* the same exam seen through several colleges is one event, not several (and never a clash with itself) */
const examKey = e => e.via || ((srcOf(e.source).uses || [])[0] && e.cat === "exam" ? srcOf(e.source).uses[0] : e.source);
function planEvents() {
  const all = S.sel.flatMap(id => upcomingFor(id)), seen = new Map();
  for (const e of all) {
    const k = [examKey(e), e.cat, e.start, e.end || ""].join("|");
    if (!seen.has(k)) seen.set(k, Object.assign({}, e, { forList: [] }));
    const f = seen.get(k).forList, who = e.viaFor || e.source;
    if (!f.includes(who)) f.push(who);
  }
  return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
}
function save() { store.set("sel", S.sel); store.set("f", S.f); }

/* ---------- clash engine (rules from the product spec) ---------- */
function minutes(t) { if (!t) return null; const [a, b] = t.split("-"); const m = x => +x.slice(0, 2) * 60 + +x.slice(3, 5); return [m(a), m(b)]; }
function clashes(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    const a = events[i], b = events[j];
    if (a.source === b.source || examKey(a) === examKey(b) || !(a.start <= evEnd(b) && b.start <= evEnd(a))) continue;
    const ah = HARD.has(a.cat), bh = HARD.has(b.cat), an = srcOf(a.source).name, bn = srcOf(b.source).name;
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
      if (y.start === x.start) out.push({ kind: "risk", a: x, b: y, why: `${srcOf(y.source).name} ${y.title.toLowerCase()} falls on your ${srcOf(x.source).name} exam day. Finish it the day before.` });
    }
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
  const where = s.campuses && s.campuses.length > 1 ? `Campuses: ${s.campuses.map(c => c.city).join(", ")}` : s.city ? `${s.city}, ${s.state}` : s.state || "";
  return `<div class="item ${on ? "picked" : ""}" draggable="true" data-drag="${s.id}" data-card="${s.id}" role="button" tabindex="0" aria-pressed="${on}" title="Tap to add, or drag into My list">
    <span class="grip" aria-hidden="true">⠿</span>
    <div class="txt"><b>${esc(s.name)}</b><small>${(s.kind || "exam") === "college" ? "College" : (s.kind === "counselling" ? "Counselling" : "Entrance exam")} · ${esc(where)}</small>
      <div>${n ? `<span class="tag ok">${n} date${n > 1 ? "s" : ""} announced</span>` : `<span class="tag warn">No dates found by us · check official site</span>`}</div></div>
    <button class="add ${on ? "on" : ""}" data-toggle="${s.id}" aria-pressed="${on}">${on ? "Added" : "Add"}</button></div>`;
}
function tray() {
  const n = S.sel.length;
  return `<aside class="tray" id="tray" aria-label="My list">
    <div class="row1"><div><h2 class="h2">My list</h2><span class="fine num">${n} of ${CONFIG.max}</span></div>
      <button class="cta" data-go="view" ${n ? "" : "disabled"}>View dates</button></div>
    <div class="meter"><i style="width:${(n / CONFIG.max) * 100}%"></i></div>
    <div class="drop hint">${n ? "Drop more here" : "Drag colleges here<br><small>or just tap them</small>"}</div>
    <div class="chips">${S.sel.map(id => `<button class="chipx" data-toggle="${id}" aria-label="Remove ${esc(srcOf(id).name)}">${esc(srcOf(id).name)}<span>×</span></button>`).join("")}</div>
  </aside>`;
}
function multi(key, label, opts, all) {
  const sel = S.f[key], names = opts.filter(([v]) => sel.includes(v)).map(o => o[1]);
  const summary = !names.length ? all : names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  return `<div class="field"><span>${label}</span><details class="ms" data-ms="${key}" ${S.openMs === key ? "open" : ""}><summary>${esc(summary)}</summary>
    <div class="opts">${opts.length ? opts.map(([v, l]) => `<label class="opt"><input type="checkbox" data-f="${key}" value="${esc(v)}" ${sel.includes(v) ? "checked" : ""}><span>${esc(l)}</span></label>`).join("") : `<p class="fine">Pick a state first</p>`}
    ${sel.length ? `<button class="link clr" data-clear="${key}">Clear</button>` : ""}</div></details></div>`;
}
function viewFind() {
  const places = DATA.sources.filter(s => !s.hidden).flatMap(s => s.campuses && s.campuses.length ? s.campuses : [{ city: s.city, state: s.state }]);
  const states = [...new Set(places.filter(p => p.state && p.state !== "All India").map(p => p.state))].sort();
  const cities = [...new Set(places.filter(p => p.city && (!S.f.state.length || S.f.state.includes(p.state))).map(p => p.city))].sort();
  const list = DATA.sources.filter(matches);
  const colleges = list.filter(s => s.kind === "college"), exams = list.filter(s => s.kind !== "college");
  return `<div class="wrap find"><section>
    <h1 class="h1">All your admission dates in one view.</h1>
    <p class="lede">Choose your course and city, add up to ${CONFIG.max} colleges and exams, and see their deadlines side by side, read from official websites every morning.</p>
    <p class="warnline"><b>Early preview.</b> Our robot can miss or misread dates. Always confirm on each college's official website before you rely on a date.</p>
    <div class="filters">
      ${multi("course", "Course", COURSES.filter(c => c.id).map(c => [c.id, c.label]), "All courses")}
      ${multi("state", "State", states.map(x => [x, x]), "All states")}
      ${multi("city", "City", cities.map(x => [x, x]), "All cities")}
      <label class="field q">Search<input id="fQ" placeholder="College or exam name" value="${esc(S.f.q || "")}" autocomplete="off"></label>
    </div>
    ${colleges.length ? `<div class="rhead"><h2 class="h3">Colleges (${colleges.length})</h2></div><div class="results">${colleges.map(itemRow).join("")}</div>` : ""}
    ${exams.length ? `<div class="rhead"><h2 class="h3">Entrance exams and counselling (${exams.length})</h2></div><div class="results">${exams.map(itemRow).join("")}</div>` : ""}
    ${!list.length ? `<p class="fine">Nothing matches these filters yet. Try "All states", or a different course. We're adding more colleges regularly.</p>` : ""}
  </section>${tray()}</div>`;
}

/* ---------- screen 2: view ---------- */
function nextCard(evs, cl) {
  const up = evs.filter(e => D(evEnd(e)) >= today);
  const dl = up.filter(e => DEADLINE.has(e.cat)).sort((a, b) => evEnd(a).localeCompare(evEnd(b)))[0] || up[0];
  if (!dl) return `<div class="next calm warnbox"><h2 class="h2">We haven't found dates for your list yet</h2>
    <p>This does <b>not</b> mean applications are closed or not open. Our robot may have missed them. <b>Open each official website below and check today.</b></p></div>`;
  const target = DEADLINE.has(dl.cat) ? evEnd(dl) : dl.start, n = dayDiff(today, D(target));
  return `<div class="next"><div class="count"><b class="num">${n}</b><span>day${n === 1 ? "" : "s"} left</span></div>
    <div><small>Next deadline</small><h2 class="h2">${esc(srcOf(dl.source).name)}: ${esc(dl.title)}</h2>
    <p>${fmtY(target)} · <button class="link" data-ev="${esc(dl.id)}">See proof</button></p></div></div>`;
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
function table(withDates, clashIds) {
  return `<div class="tablewrap"><table><thead><tr><th>College / exam</th>${COLS.map(c => `<th>${c.label}</th>`).join("")}</tr></thead><tbody>
    ${withDates.map(id => {
      const evs = upcomingFor(id);
      return `<tr><td><b>${esc(srcOf(id).name)}</b><div class="s"><a href="${esc(srcOf(id).url)}" target="_blank" rel="noopener">Official site</a></div></td>${COLS.map(col => {
        const m = evs.filter(e => col.cats.includes(e.cat));
        if (!m.length) return `<td><span class="dash">—</span></td>`;
        const e = m[0], hit = m.some(x => clashIds.has(x.id));
        return `<td class="${hit ? "clash" : ""}"><button class="cell" data-ev="${esc(e.id)}"><span class="d num">${rangeText(e)}</span>
          <span class="s">${e.via ? `via ${esc(srcOf(e.via).name)} · ` : ""}${esc(e.title)}${e.tentative ? " (tentative)" : ""}${m.length > 1 ? ` · +${m.length - 1} more` : ""}</span>${chip(e)}</button></td>`;
      }).join("")}</tr>`;
    }).join("")}</tbody></table></div>`;
}
const PALETTE = ["#2f4fd8", "#d43a3a", "#1d8a5b", "#b5650a", "#7b3fc4", "#0f8a9a", "#c2367a", "#5b6b00", "#8a5a2b", "#3d6fb5", "#a33d3d", "#4b4b9a"];
const colorOf = id => PALETTE[Math.max(0, S.sel.indexOf(id)) % PALETTE.length];
const whoText = e => {
  const name = srcOf(e.via || e.source).name, f = (e.forList || []).filter(x => x !== (e.via || e.source));
  return f.length ? `${name} · for ${f.map(x => srcOf(x).name).join(", ")}` : name;
};
function action(e) {
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
      <span class="st ${urgent ? "urg" : n <= 30 ? "soon" : "later"}">${when}</span></button>`;
  });
  return `<div class="agenda"><h2 class="h2">What to do, step by step</h2>${out}</div>`;
}
function viewView() {
  const evs = planEvents();
  const cl = clashes(evs), clashIds = new Set(cl.filter(c => c.kind !== "risk").flatMap(c => [c.a.id, c.b.id]));
  const withDates = S.sel.filter(id => upcomingFor(id).length), notYet = S.sel.filter(id => !upcomingFor(id).length);
  const sharedNote = S.sel.filter(id => (srcOf(id).uses || []).length).map(id => `${srcOf(id).name} admits through ${srcOf(id).uses.map(x => srcOf(x).name).join(" and ")}`);
  const cal = calUrls();
  return `<div class="wrap">
    <div class="viewtop"><h1 class="h2">My admission dates <span class="fine num">(${S.sel.length} picks)</span></h1><button class="btn" data-go="find">Edit my list</button></div>
    ${nextCard(evs, cl)}
    ${evs.length ? stats(evs, cl) : ""}
    ${cl.map(c => `<div class="alert ${c.kind}"><b>${c.kind === "clash" ? "Clash" : c.kind === "maybe" ? "Possible clash" : "Plan ahead"}:</b> ${esc(c.why)}</div>`).join("")}
    ${withDates.length ? `<div class="tabs" role="tablist"><button role="tab" data-tab="table" aria-selected="${S.tab === "table"}">Table</button><button role="tab" data-tab="calendar" aria-selected="${S.tab === "calendar"}">Calendar</button></div>
    ${S.tab === "calendar" ? `<div class="panel pad">${calendar(evs, clashIds)}</div>${agenda(evs, clashIds)}` : `<div class="panel">${table(withDates, clashIds)}</div>`}` : ""}
    ${sharedNote.length ? `<p class="fine shared">Shared exams are shown once: ${esc(sharedNote.join("; "))}.</p>` : ""}
    ${notYet.length ? `<div class="notyet warnbox"><b>We couldn't find dates for ${notYet.length} of your picks.</b>
      <p>Applications may already be open. Our robot can miss dates, so <b>please check each official website yourself</b>:</p>
      <ul>${notYet.map(id => `<li><b>${esc(srcOf(id).name)}</b> · <a href="${esc(srcOf(id).url)}" target="_blank" rel="noopener">check official site now</a></li>`).join("")}</ul></div>` : ""}
    <div class="side">
      <div class="card"><h2 class="h2">Get these dates on your phone</h2>
        ${cal.live ? `<a class="cta full" href="${cal.google}" target="_blank" rel="noopener">Add to Google Calendar</a><a class="btn full" href="${cal.webcal}">iPhone / other calendars</a><button class="btn full" id="copyCal">Copy calendar link</button><p class="fine">New and changed dates appear in your calendar by themselves.</p>`
        : `<button class="cta full" disabled>Add to my calendar</button><p class="fine">Available on the live site.</p>`}</div>
      <div class="card"><h2 class="h2">Share with a friend</h2><p class="fine">Help a classmate who's applying too.</p>
        <a class="btn full" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent("All my college admission dates side by side, free and no sign-up: " + location.origin)}">Share on WhatsApp</a></div>
      ${(DATA.changes || []).some(c => S.sel.includes(c.source)) ? `<div class="card"><h2 class="h2">Recently changed</h2>${DATA.changes.filter(c => S.sel.includes(c.source)).slice(0, 5).map(c => `<p class="fine"><b>${esc(srcOf(c.source).name)}</b> ${esc(c.title)}: ${c.from ? `${esc(c.from)} → ` : "new: "}<b>${esc(c.to)}</b></p>`).join("")}</div>` : ""}
    </div></div>`;
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
  const e = DATA.events.find(x => x.id === id); if (!e) return "";
  const s = srcOf(e.source);
  return `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-label="Date details"><div class="in"><button class="x" data-close aria-label="Close">×</button>
    <small class="fine">${esc(s.name)} · ${esc(CAT_NAME[e.cat] || e.cat)}</small><h2 class="h2">${esc(e.title)}</h2>
    <div class="big num">${e.end ? `${fmtY(e.start)} – ${fmtY(e.end)}` : fmtY(e.start)}${e.time ? `, ${esc(e.time.replace("-", "–"))}` : ""}</div>
    ${e.tentative ? `<p class="fine">The official site marks this as tentative.</p>` : ""}${e.changed_from ? `<p class="bad">Changed: earlier it said ${esc(e.changed_from)}.</p>` : ""}
    <p class="fine">What the official page says:</p><blockquote>${esc(e.evidence)}</blockquote>
    <a class="btn full" href="${esc(e.url)}" target="_blank" rel="noopener">Open the official source</a>
    <p class="fine">Read automatically${e.checked ? " on " + fmtY(e.checked.slice(0, 10)) : ""}. Always confirm on the official site before you act.</p></div></div>`;
}

function render() {
  $("#app").innerHTML = `
  <header class="top"><div class="wrap topin">
    <button class="brand" data-go="find" aria-label="AdmitzView home"><svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="2.5" y="5.5" width="27" height="21" rx="5" fill="none" stroke="currentColor" stroke-width="3"/><rect x="8" y="12" width="12" height="3.5" rx="1.75" fill="currentColor"/><circle cx="22" cy="19.5" r="3.5" fill="var(--red)"/></svg>AdmitzView</button>
    <button class="link" id="sitesBtn">${DATA.sample ? "Sample data" : `Updated ${fmt(DATA.generated.slice(0, 10))}, ${DATA.generated.slice(11, 16)}`}</button>
  </div></header>
  ${DATA.sample ? `<div class="wrap"><p class="banner">Preview with sample dates. These are not real dates.</p></div>` : ""}
  <main>${S.view === "view" ? viewView() : viewFind()}</main>
  <footer class="wrap foot"><p><b>Always confirm dates on the official website before you act.</b> Dates are read automatically and may contain mistakes. AdmitzView is not affiliated with any college or exam body.</p>
    <p>No sign-up, no tracking. Your list stays on this device. Made by <a href="${CONFIG.makerUrl}" target="_blank" rel="noopener">${esc(CONFIG.maker)}</a>, free for every student.</p></footer>
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
  if (t.dataset.clear) { S.f[t.dataset.clear] = []; S.openMs = null; save(); render(); }
  else if (t.dataset.toggle) { ev.stopPropagation(); toggle(t.dataset.toggle); }
  else if (t.dataset.go) go(t.dataset.go);
  else if (t.dataset.ev) { S.open = t.dataset.ev; render(); }
  else if (t.dataset.day) { S.open = "day:" + t.dataset.day; render(); }
  else if (t.dataset.tab) { S.tab = t.dataset.tab; store.set("tab", S.tab); render(); }
  else if (t.hasAttribute("data-close")) { S.open = null; render(); }
  else if (t.id === "sitesBtn") { S.open = "__sites"; render(); }
  else if (t.id === "copyCal") { const u = calUrls().https; try { await navigator.clipboard.writeText(u); toast("Calendar link copied"); } catch { toast(u); } }
});
document.addEventListener("change", e => {
  const k = e.target.dataset?.f; if (!k) return;
  const v = e.target.value, arr = S.f[k];
  e.target.checked ? arr.includes(v) || arr.push(v) : arr.splice(arr.indexOf(v), 1);
  if (k === "state") { const ok = new Set(DATA.sources.flatMap(s => s.campuses || [{ city: s.city, state: s.state }]).filter(p => !S.f.state.length || S.f.state.includes(p.state)).map(p => p.city)); S.f.city = S.f.city.filter(c => ok.has(c)); }
  S.openMs = k; save(); render();
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
    DATA.sources = cfg.sources.map(c => Object.assign({ status: "pending", found: 0 }, seen[c.id] || {},
      { id: c.id, name: c.name, authority: c.authority, stream: c.stream, url: c.url, kind: c.kind || "exam", state: c.state, city: c.city, hidden: c.hidden, campuses: c.campuses, uses: c.uses }));
  }
  if (!DATA) { $("#app").innerHTML = `<p class="wrap" style="padding-top:40px">Couldn't load the dates. Check your internet connection and reload.</p>`; return; }
  const sel = (store.get("sel", []) || []).filter(id => DATA.sources.some(s => s.id === id)).slice(0, CONFIG.max);
  S = { sel, f: (() => { const f = Object.assign({ course: [], state: [], city: [], q: "" }, store.get("f", {}));
      ["course", "state", "city"].forEach(k => { if (!Array.isArray(f[k])) f[k] = f[k] ? [f[k]] : []; }); return f; })(), openMs: null, view: sel.length ? "view" : "find", tab: store.get("tab", "calendar") === "timeline" ? "calendar" : store.get("tab", "calendar"), open: null };
  render();
}
boot();
