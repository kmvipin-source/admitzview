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
MAX_PDFS = 3
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


def page_text_and_pdfs(url):
    ctype, body = get(url)
    if "pdf" in ctype:
        return pdf_text(body), [url]
    soup = BeautifulSoup(body, "html.parser")
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    text = soup.get_text("\n")
    pdfs = []
    for a in soup.find_all("a", href=True):
        href = urljoin(url, a["href"])
        label = (a.get_text(" ") or "") + " " + href
        if href.lower().split("?")[0].endswith(".pdf") and PDF_HINT.search(label) and href not in pdfs:
            pdfs.append(href)
    return text, pdfs[:MAX_PDFS]


def read_source(src, w0, w1):
    text, pdfs = page_text_and_pdfs(src["url"])
    events = [dict(e, url=src["url"]) for e in extract(text, src["id"], w0, w1)]
    for p in pdfs:
        try:
            _, body = get(p)
            events += [dict(e, url=p) for e in extract(pdf_text(body), src["id"], w0, w1)]
        except Exception as ex:  # one broken PDF shouldn't sink the source
            print(f"  pdf skipped {p}: {ex}")
    # de-duplicate: same category + same dates -> keep one (prefer PDF notice)
    seen = {}
    for e in events:
        k = (e["cat"], e["start"], e["end"])
        if k not in seen or e["url"].lower().endswith(".pdf"):
            seen[k] = e
    return sorted(seen.values(), key=lambda e: e["start"])


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
        for k in ("hidden", "city"):
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
