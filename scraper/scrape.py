"""Daily robot: read official exam websites, pull out dates, write site/data.json.

Runs free on GitHub Actions. No manual checking.
Safety rules:
- Respects each site's robots.txt and waits between requests.
- Never invents a date: every date must appear in the official text.
- The optional AI step can only REMOVE junk or RENAME an event. It cannot add dates.
- If a site can't be read, the old dates for it are kept but marked "couldn't re-check".
"""
import io
import json
import os
import re
import sys
import time
import urllib.robotparser as robotparser
from datetime import date, datetime, timezone, timedelta
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from extract import extract

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "site", "data.json")
UA = "AdmitzViewBot/1.0 (free student exam-date helper; reads public notices once a day)"
IST = timezone(timedelta(hours=5, minutes=30))
PDF_HINT = re.compile(r"(information\s*bulletin|brochure|notice|notification|schedule|important\s*dates|prospectus|press\s*release|public\s*notice)", re.I)
MAX_PDFS = 4
MAX_BYTES = 25_000_000

session = requests.Session()
session.headers["User-Agent"] = UA
_robots = {}


def allowed(url):
    host = "{0.scheme}://{0.netloc}".format(urlparse(url))
    if host not in _robots:
        rp = robotparser.RobotFileParser()
        try:
            r = session.get(host + "/robots.txt", timeout=15)
            rp.parse(r.text.splitlines() if r.status_code == 200 else [])
        except requests.RequestException:
            rp.parse([])
        _robots[host] = rp
    return _robots[host].can_fetch(UA, url)


def get(url):
    if not allowed(url):
        raise PermissionError("site's robots.txt asks bots not to read this page")
    time.sleep(2)
    r = session.get(url, timeout=30, stream=True)
    r.raise_for_status()
    body = r.raw.read(MAX_BYTES + 1, decode_content=True)
    if len(body) > MAX_BYTES:
        raise ValueError("file too large")
    return r.headers.get("content-type", ""), body


def pdf_text(data):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((p.extract_text() or "") for p in reader.pages[:40])


LINK_RX = re.compile(r"admission|important[- _]?dates|key[- _]?dates|selection|schedule|notification|notice|undergraduate|\bug\b|b\.?com|apply|prospectus|entrance|calendar|2027", re.I)
SKIP_RX = re.compile(r"\bpg\b|post ?graduate|ph\.?d|\bmba\b|login|sign ?in|facebook|twitter|instagram|youtube|linkedin|whatsapp|mailto:|tel:|javascript:|\.(jpe?g|png|gif|zip|docx?|xlsx?)(\?|$)", re.I)
PRIORITY_RX = re.compile(r"important[- _]?dates|key[- _]?dates|selection[- _]?process|schedule|2027", re.I)
MAX_PAGES = 10


def site_of(url):
    host = urlparse(url).netloc.lower().split(":")[0]
    parts = host.split(".")
    n = 3 if len(parts) >= 3 and ".".join(parts[-2:]) in ("edu.in", "ac.in", "gov.in", "co.in", "org.in", "nic.in", "res.in") else 2
    return ".".join(parts[-n:])


def table_lines(table):
    """Turn a table into one line per row: 'Header: cell | Header: cell'. Dates in tables need their column label."""
    rows = table.find_all("tr")
    if not rows:
        return []
    def cells(r):
        return [re.sub(r"\s+", " ", c.get_text(" ")).strip() for c in r.find_all(["th", "td"])]
    head = cells(rows[0])
    has_head = rows[0].find("th") is not None or not any(re.search(r"20\d\d", h) for h in head)
    out = []
    for r in rows[1:] if has_head else rows:
        c = cells(r)
        if not any(c):
            continue
        if has_head and len(c) == len(head):
            out.append(" | ".join(f"{h}: {v}" if h else v for h, v in zip(head, c)))
        else:
            out.append(" | ".join(c))
    return out


def parse_html(url, body):
    soup = BeautifulSoup(body, "html.parser")
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    links = []
    for a in soup.find_all("a", href=True):
        href = urljoin(url, a["href"]).split("#")[0]
        label = re.sub(r"\s+", " ", a.get_text(" ")).strip()
        links.append((href, label))
    for table in soup.find_all("table"):
        table.replace_with("\n" + "\n".join(table_lines(table)) + "\n")
    return soup.get_text("\n"), links


def read_source(src, w0, w1):
    """Read the source page, any listed pages, and same-site admission/date pages up to two clicks deep."""
    home = site_of(src["url"])
    queue = [(src["url"], 0)] + [(p, 0) for p in src.get("pages", [])]
    seen, pdfs, events, pages_read = set(), [], [], 0
    while queue and pages_read < MAX_PAGES:
        url, depth = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        try:
            ctype, body = get(url)
        except PermissionError:
            if depth == 0 and url == src["url"]:
                raise
            continue
        except Exception as ex:
            if depth == 0 and url == src["url"]:
                raise
            print(f"  skipped {url}: {ex}")
            continue
        pages_read += 1
        if "pdf" in ctype or url.lower().split("?")[0].endswith(".pdf"):
            text, links = pdf_text(body), []
        else:
            text, links = parse_html(url, body)
        events += [dict(e, url=url) for e in extract(text, src["id"], w0, w1)]
        if depth >= 2:
            continue
        cand = []
        for href, label in links:
            if not href.startswith("http") or site_of(href) != home or href in seen:
                continue
            both = label + " " + href
            if SKIP_RX.search(both):
                continue
            if href.lower().split("?")[0].endswith(".pdf"):
                if PDF_HINT.search(both) or "2027" in both:
                    pdfs.append(href)
            elif LINK_RX.search(both):
                cand.append((0 if PRIORITY_RX.search(both) else 1, href))
        for _, href in sorted(set(cand))[:8]:
            queue.append((href, depth + 1))
    for p in list(dict.fromkeys(pdfs))[:MAX_PDFS]:
        try:
            _, body = get(p)
            events += [dict(e, url=p) for e in extract(pdf_text(body), src["id"], w0, w1)]
        except Exception as ex:
            print(f"  pdf skipped {p}: {ex}")
    print(f"  read {pages_read} pages, {len(events)} raw dates")
    seen_ev = {}
    for e in events:  # same step found on several pages: keep one, prefer the most specific page
        k = (e["cat"], e["start"], e["end"], e.get("programme"))
        if k not in seen_ev or len(e["url"]) > len(seen_ev[k]["url"]):
            seen_ev[k] = e
    return sorted(seen_ev.values(), key=lambda e: e["start"])


# ---------- optional free AI tidy-up (GitHub Models, uses the built-in GITHUB_TOKEN) ----------
def ai_tidy(src, events):
    token = os.environ.get("GITHUB_TOKEN")
    if not token or os.environ.get("ADMITZVIEW_AI", "on") == "off" or not events:
        return events, False
    items = [{"id": e["id"], "dates": [e["start"], e["end"]], "guess": e["title"], "sentence": e["evidence"]} for e in events[:60]]
    prompt = (
        f"These sentences come from the official website of {src['name']} ({src['authority']}) for the 2027 admission cycle. "
        "For each item decide if the date is a real step a student must act on or attend (application, correction, admit card, exam, result, "
        "counselling, document verification, fee). Reject anything else (holidays, old years, unrelated programmes, PG/PhD). "
        "Give a short clear title a 17-year-old understands, max 6 words, e.g. 'Session 1 exam', 'Registration closes'. "
        "Do not change dates. Reply ONLY with JSON: {\"keep\":[{\"id\":\"...\",\"title\":\"...\"}]}\n\n" + json.dumps(items)
    )
    try:
        r = requests.post(
            "https://models.github.ai/inference/chat/completions",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"model": os.environ.get("ADMITZVIEW_MODEL", "openai/gpt-4o-mini"),
                  "messages": [{"role": "user", "content": prompt}], "temperature": 0,
                  "response_format": {"type": "json_object"}},
            timeout=60,
        )
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
        content = r.json()["choices"][0]["message"]["content"] or ""
        content = re.sub(r"^```(?:json)?|```$", "", content.strip()).strip()
        keep = json.loads(content).get("keep", [])
    except Exception as ex:
        print(f"  AI step skipped ({ex}); using rule-based results")
        return events, False
    by_id = {e["id"]: e for e in events}
    out = []
    for k in keep:
        e = by_id.get(k.get("id"))
        if e:  # AI can only keep/rename events that exist; it cannot add any
            title = str(k.get("title") or e["title"]).strip()[:60]
            out.append(dict(e, title=title or e["title"], ai=True))
    if not out and events:  # AI rejected everything: distrust it, keep rules
        return events, False
    return out, True


def main():
    cfg = json.load(open(os.path.join(ROOT, "sources.json")))
    w0, w1 = (date.fromisoformat(cfg["window"][k]) for k in ("from", "to"))
    old = {}
    try:
        old = json.load(open(OUT))
    except Exception:
        pass
    if old.get("sample"):
        old = {}
    old_events = {e["id"]: e for e in old.get("events", [])}
    old_by_slot = {}
    for e in old.get("events", []):
        old_by_slot[(e["source"], e["cat"], e["title"])] = e
    now = datetime.now(IST).isoformat(timespec="minutes")
    sources_out, events_out, changes = [], [], list(old.get("changes", []))[:40]

    only = sys.argv[1:]  # optional: scrape.py jee-main bitsat
    for src in cfg["sources"]:
        if only and src["id"] not in only:
            continue
        print(f"-> {src['name']}")
        s = {k: src[k] for k in ("id", "name", "authority", "stream", "url")}
        for k in ("hidden", "city", "state"):
            if k in src:
                s[k] = src[k]
        s["kind"] = src.get("kind", "exam")
        try:
            evs = read_source(src, w0, w1)
            evs, used_ai = ai_tidy(src, evs)
            if src.get("split"):
                moved = []
                for e in evs:
                    low = e["evidence"].lower()
                    target = next((t for k, t in src["split"].items() if k in low), None)
                    if target:
                        e = dict(e, source=target, via=src["id"])
                        e["id"] = target + "-" + e["id"]
                        moved.append(e)
                evs = moved
            s.update(status="ok", checked=now, found=len(evs), ai=used_ai)
            for e in evs:
                e.pop("keyword", None)
                prev = old_events.get(e["id"])
                e["first_seen"] = prev["first_seen"] if prev else now
                e["checked"] = now
                slot = old_by_slot.get((e["source"], e["cat"], e["title"]))
                if not prev and slot and (slot["start"], slot.get("end")) != (e["start"], e.get("end")):
                    e["changed_from"] = slot["start"] + (" to " + slot["end"] if slot.get("end") else "")
                    changes.insert(0, {"when": now, "source": e["source"], "title": e["title"],
                                       "from": e["changed_from"], "to": e["start"] + (" to " + e["end"] if e.get("end") else ""),
                                       "url": e["url"]})
                elif not prev and old_events:
                    changes.insert(0, {"when": now, "source": e["source"], "title": e["title"], "from": None,
                                       "to": e["start"] + (" to " + e["end"] if e.get("end") else ""), "url": e["url"]})
                events_out.append(e)
        except Exception as ex:
            print(f"  could not read: {ex}")
            reason = "Site asks bots not to read it" if isinstance(ex, PermissionError) else "Couldn't read the official site today"
            s.update(status="failed", checked=now, reason=reason)
            stale = [dict(e, stale=True) for e in old.get("events", [])
                     if e.get("via", e["source"]) == src["id"]]
            events_out += stale
            prev_src = next((x for x in old.get("sources", []) if x["id"] == src["id"]), {})
            s["last_ok"] = prev_src.get("checked") if prev_src.get("status") == "ok" else prev_src.get("last_ok")
        sources_out.append(s)

    data = {"generated": now, "cycle": cfg["cycle"], "sample": False,
            "sources": sources_out, "events": events_out, "changes": changes[:40]}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    ok = sum(1 for s in sources_out if s["status"] == "ok")
    print(f"done: {ok}/{len(sources_out)} sources read, {len(events_out)} dates")


if __name__ == "__main__":
    main()
