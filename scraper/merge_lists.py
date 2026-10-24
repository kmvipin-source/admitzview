"""Merge researched college lists (JSON arrays) into sources.json.

Usage: python scraper/merge_lists.py lists/*.json
Only official pages that a researcher actually opened are used. Existing sources are never removed;
an existing source only gets `pages` filled in when it had none (or when a list entry says it is better).
"""
import json
import re
import sys
from urllib.parse import urlparse

ROOT = __file__.rsplit("/scraper/", 1)[0]
VALID_USES = {"cuet-ug", "du-csas", "ipmat", "jipmat", "npat", "set", "mu", "bu"}
AGGREGATORS = re.compile(r"shiksha|careers360|collegedunia|cracku|getmyuni|collegedekho|jagranjosh|indiatoday|iquanta|wikipedia", re.I)


def slug(name, city):
    base = re.sub(r"\(.*?\)", "", name.lower())
    base = re.sub(r"\b(the|college|of|and|for|autonomous|university)\b", " ", base)
    words = re.findall(r"[a-z0-9]+", base)[:3]
    s = "-".join(words) or "college"
    c = re.sub(r"[^a-z]", "", (city or "").lower())[:3]
    return f"{s}-{c}" if c else s


def norm(n):
    return re.sub(r"[^a-z]", "", re.sub(r"\(.*?\)|,.*$", "", n.lower()))


def official(url, home):
    try:
        u, h = urlparse(url), urlparse(home)
    except Exception:
        return False
    if AGGREGATORS.search(u.netloc):
        return False
    root = lambda d: ".".join(d.lower().split(".")[-3:]) if d.lower().endswith((".ac.in", ".edu.in", ".gov.in", ".org.in", ".co.in", ".nic.in")) else ".".join(d.lower().split(".")[-2:])
    return u.scheme in ("http", "https") and (root(u.netloc) == root(h.netloc) or u.netloc.endswith(("nta.ac.in", "nic.in")))


def main(paths):
    cfg = json.load(open(f"{ROOT}/sources.json"))
    by_name = {norm(s["name"]): s for s in cfg["sources"]}
    ids = {s["id"] for s in cfg["sources"]}
    added = updated = skipped = 0
    for p in paths:
        try:
            items = json.load(open(p))
        except Exception as ex:
            print(f"skip {p}: {ex}")
            continue
        for it in items:
            name, home = (it.get("name") or "").strip(), (it.get("url") or "").strip()
            if not name or not home.startswith("http") or AGGREGATORS.search(home):
                skipped += 1
                continue
            pages = [u for u in (it.get("pages") or []) if isinstance(u, str) and official(u, home)][:2]
            uses = [u for u in (it.get("uses") or []) if u in VALID_USES]
            stream = [x for x in (it.get("stream") or ["Commerce"]) if x in ("Commerce", "Management")] or ["Commerce"]
            old = by_name.get(norm(name))
            if old:
                if pages and (not old.get("pages") or "better" in (it.get("note") or "").lower()):
                    old["pages"] = pages
                    updated += 1
                continue
            sid = slug(name, it.get("city"))
            while sid in ids:
                sid += "x"
            ids.add(sid)
            src = {"id": sid, "name": name, "authority": it.get("authority") or name, "stream": stream, "url": home,
                   "kind": "college", "state": it.get("state") or "", "city": it.get("city") or ""}
            if pages:
                src["pages"] = pages
            if uses:
                src["uses"] = uses
            if "Management" in stream and re.search(r"\bIIM\b|indian institute of management", name, re.I):
                src["require"] = r"\bIPM\b|IPMAT|integrated programme|integrated program in management|five[- ]year integrated|\bBBA\b|\bBMS\b|undergraduate"
            cfg["sources"].append(src)
            by_name[norm(name)] = src
            added += 1
    for path in (f"{ROOT}/sources.json", f"{ROOT}/site/sources.json"):
        json.dump(cfg, open(path, "w"), indent=1, ensure_ascii=False)
    print(f"added {added}, updated {updated}, skipped {skipped}, total {len(cfg['sources'])}")


if __name__ == "__main__":
    main(sys.argv[1:])
