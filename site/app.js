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
const upcomingFor = id => DATA.events.filter(e => e.source === id && D(evEnd(e)) >= today).sort((a, b) => a.start.localeCompare(b.start));
function save() { store.set("sel", S.sel); store.set("f", S.f); }

/* ---------- clash engine (rules from the product spec) ---------- */
function minutes(t) { if (!t) return null; const [a, b] = t.split("-"); const m = x => +x.slice(0, 2) * 60 + +x.slice(3, 5); return [m(a), m(b)]; }
function clashes(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    const a = events[i], b = events[j];
    if (a.source === b.source || !(a.start <= evEnd(b) && b.start <= evEnd(a))) continue;
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
  const f = S.f, c = COURSES.find(x => x.id === f.course);
  if (s.hidden) return false;
  if (c && c.id && ![c.id, ...(c.also || [])].some(x => (s.stream || []).includes(x))) return false;
  if (f.state && s.state !== f.state && s.state !== "All India") return false;
  if (f.city && s.city && s.city !== f.city) return false;
  if (f.q && !(s.name + " " + s.authority).toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}
function itemRow(s) {
  const on = S.sel.includes(s.id), n = upcomingFor(s.id).length;
  const where = s.city ? `${s.city}, ${s.state}` : s.state || "";
  return `<div class="item" draggable="true" data-drag="${s.id}">
    <span class="grip" aria-hidden="true">⠿</span>
    <div class="txt"><b>${esc(s.name)}</b><small>${(s.kind || "exam") === "college" ? "College" : (s.kind === "counselling" ? "Counselling" : "Entrance exam")} · ${esc(where)}</small>
      <div>${n ? `<span class="tag ok">${n} date${n > 1 ? "s" : ""} announced</span>` : `<span class="tag">Dates not announced yet</span>`}</div></div>
    <button class="add ${on ? "on" : ""}" data-toggle="${s.id}" aria-pressed="${on}">${on ? "Added" : "Add"}</button></div>`;
}
function tray() {
  const n = S.sel.length;
  return `<aside class="tray" id="tray" aria-label="My list">
    <div class="row1"><div><h2 class="h2">My list</h2><span class="fine num">${n} of ${CONFIG.max}</span></div>
      <button class="cta" data-go="view" ${n ? "" : "disabled"}>View dates</button></div>
    <div class="meter"><i style="width:${(n / CONFIG.max) * 100}%"></i></div>
    <p class="fine hint">${n ? "Drag more here, or tap Add." : "Drag colleges and exams here, or tap Add."}</p>
    <div class="chips">${S.sel.map(id => `<button class="chipx" data-toggle="${id}" aria-label="Remove ${esc(srcOf(id).name)}">${esc(srcOf(id).name)}<span>×</span></button>`).join("")}</div>
  </aside>`;
}
function viewFind() {
  const states = [...new Set(DATA.sources.filter(s => !s.hidden && s.state && s.state !== "All India").map(s => s.state))].sort();
  const cities = [...new Set(DATA.sources.filter(s => s.city && (!S.f.state || s.state === S.f.state)).map(s => s.city))].sort();
  const list = DATA.sources.filter(matches);
  const colleges = list.filter(s => s.kind === "college"), exams = list.filter(s => s.kind !== "college");
  return `<div class="wrap find"><section>
    <h1 class="h1">All your admission dates in one view.</h1>
    <p class="lede">Choose your course and city, add up to ${CONFIG.max} colleges and exams, and see every deadline side by side. Updated from official websites every morning.</p>
    <div class="filters">
      <label class="field">Course<select id="fCourse">${COURSES.map(c => `<option value="${c.id}" ${S.f.course === c.id ? "selected" : ""}>${c.label}</option>`).join("")}</select></label>
      <label class="field">State<select id="fState"><option value="">All states</option>${states.map(s => `<option ${S.f.state === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
      <label class="field">City<select id="fCity"><option value="">All cities</option>${cities.map(c => `<option ${S.f.city === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
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
  if (!dl) return `<div class="next calm"><h2 class="h2">No dates announced yet for your list</h2>
    <p class="fine">Colleges and exam bodies usually publish ${esc(DATA.cycle)} dates a few months ahead. We read their official websites every morning, and new dates appear here the same day. Add your list to your phone calendar below and they'll show up there automatically.</p></div>`;
  const target = DEADLINE.has(dl.cat) ? evEnd(dl) : dl.start, n = dayDiff(today, D(target));
  return `<div class="next"><div class="count"><b class="num">${n}</b><span>day${n === 1 ? "" : "s"} left</span></div>
    <div><small>Next deadline</small><h2 class="h2">${esc(srcOf(dl.source).name)}: ${esc(dl.title)}</h2>
    <p>${fmtY(target)} · <button class="link" data-ev="${esc(dl.id)}">See proof</button></p></div></div>`;
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
          <span class="s">${esc(e.title)}${e.tentative ? " (tentative)" : ""}${m.length > 1 ? ` · +${m.length - 1} more` : ""}</span></button></td>`;
      }).join("")}</tr>`;
    }).join("")}</tbody></table></div>`;
}
function mapStart() { const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }
function timeline(withDates, clashIds, cl) {
  const start = mapStart(), days = CONFIG.weeks * 7, PX = 7, W = days * PX;
  const x = d => Math.max(0, Math.min(days, dayDiff(start, d))) * PX;
  let months = "", weeks = "";
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    if (d.getDate() === 1 || i === 0) months += `<span style="left:${i * PX}px">${d.toLocaleDateString("en-IN", { month: "short" })}</span>`;
    if (i % 7 === 0) weeks += `<i class="week" style="left:${i * PX}px"></i>`;
  }
  const bands = cl.filter(c => c.kind !== "risk").map(c => {
    const s = c.a.start > c.b.start ? c.a.start : c.b.start, e = evEnd(c.a) < evEnd(c.b) ? evEnd(c.a) : evEnd(c.b);
    return `<i class="clashband" style="left:${x(D(s))}px;width:${Math.max(PX, x(D(e)) - x(D(s)) + PX)}px"></i>`;
  }).join("");
  let rows = `<div class="lab top"></div><div class="months" style="width:${W}px">${months}</div>`;
  withDates.forEach(id => {
    const marks = upcomingFor(id).filter(e => dayDiff(start, D(e.start)) < days).map(e => {
      const l = x(D(e.start)), w = e.end ? Math.max(18, x(D(e.end)) - l + PX) : 18;
      return `<button class="${["ev", e.cat, e.tentative ? "tent" : "", clashIds.has(e.id) ? "clash" : ""].join(" ")}" style="left:${e.end ? l : l - 5}px;width:${w}px" data-ev="${esc(e.id)}" aria-label="${esc(srcOf(id).name)}: ${esc(e.title)}, ${rangeText(e)}"></button>`;
    }).join("");
    rows += `<div class="lab">${esc(srcOf(id).name)}</div><div class="lane" style="width:${W}px">${weeks}${bands}<i class="today" style="left:${x(today)}px"></i>${marks}</div>`;
  });
  return `<div class="legend"><span><i class="lg"></i>Exam</span><span><i class="lg app"></i>Application</span><span><i class="lg counsel"></i>Counselling / fees</span><span><i class="lg result"></i>Admit card / result</span><span><i class="lg clash"></i>Clash</span></div>
    <div class="scroller"><div class="grid">${rows}</div></div>`;
}
function viewView() {
  const evs = DATA.events.filter(e => S.sel.includes(e.source) && D(evEnd(e)) >= today).sort((a, b) => a.start.localeCompare(b.start));
  const cl = clashes(evs), clashIds = new Set(cl.filter(c => c.kind !== "risk").flatMap(c => [c.a.id, c.b.id]));
  const withDates = S.sel.filter(id => upcomingFor(id).length), notYet = S.sel.filter(id => !upcomingFor(id).length);
  const cal = calUrls();
  return `<div class="wrap">
    <div class="viewtop"><h1 class="h2">My admission dates <span class="fine num">(${S.sel.length} picks)</span></h1><button class="btn" data-go="find">Edit my list</button></div>
    ${nextCard(evs, cl)}
    ${cl.map(c => `<div class="alert ${c.kind}"><b>${c.kind === "clash" ? "Clash" : c.kind === "maybe" ? "Possible clash" : "Plan ahead"}:</b> ${esc(c.why)}</div>`).join("")}
    ${withDates.length ? `<div class="tabs" role="tablist"><button role="tab" data-tab="table" aria-selected="${S.tab === "table"}">Table</button><button role="tab" data-tab="timeline" aria-selected="${S.tab === "timeline"}">Timeline</button></div>
    <div class="panel">${S.tab === "timeline" ? timeline(withDates, clashIds, cl) : table(withDates, clashIds)}</div>` : ""}
    ${notYet.length ? `<div class="notyet"><b>Dates not announced yet for ${notYet.length} of your picks.</b>
      <p class="fine">They usually publish closer to admission season. We check their official websites every morning and add dates the day they appear.</p>
      <ul>${notYet.map(id => `<li>${esc(srcOf(id).name)} · <a href="${esc(srcOf(id).url)}" target="_blank" rel="noopener">official site</a></li>`).join("")}</ul></div>` : ""}
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
  const t = ev.target.closest("button,[data-close]"); if (!t) return;
  if (t.dataset.toggle) toggle(t.dataset.toggle);
  else if (t.dataset.go) go(t.dataset.go);
  else if (t.dataset.ev) { S.open = t.dataset.ev; render(); }
  else if (t.dataset.tab) { S.tab = t.dataset.tab; store.set("tab", S.tab); render(); }
  else if (t.hasAttribute("data-close")) { S.open = null; render(); }
  else if (t.id === "sitesBtn") { S.open = "__sites"; render(); }
  else if (t.id === "copyCal") { const u = calUrls().https; try { await navigator.clipboard.writeText(u); toast("Calendar link copied"); } catch { toast(u); } }
});
document.addEventListener("change", e => {
  const map = { fCourse: "course", fState: "state", fCity: "city" }, k = map[e.target.id]; if (!k) return;
  S.f[k] = e.target.value; if (k === "state") S.f.city = ""; save(); render();
});
document.addEventListener("input", e => {
  if (e.target.id !== "fQ") return;
  S.f.q = e.target.value; const pos = e.target.selectionStart; render();
  const n = $("#fQ"); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.open) { S.open = null; render(); } });
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
      { id: c.id, name: c.name, authority: c.authority, stream: c.stream, url: c.url, kind: c.kind || "exam", state: c.state, city: c.city, hidden: c.hidden }));
  }
  if (!DATA) { $("#app").innerHTML = `<p class="wrap" style="padding-top:40px">Couldn't load the dates. Check your internet connection and reload.</p>`; return; }
  const sel = (store.get("sel", []) || []).filter(id => DATA.sources.some(s => s.id === id)).slice(0, CONFIG.max);
  S = { sel, f: Object.assign({ course: "", state: "", city: "", q: "" }, store.get("f", {})), view: sel.length ? "view" : "find", tab: store.get("tab", "table"), open: null };
  render();
}
boot();
