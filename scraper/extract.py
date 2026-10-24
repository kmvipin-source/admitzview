"""Find admission-related dates in plain text.

Rules (from the product spec):
- Never invent a date. Every event carries the exact sentence it came from.
- Only keep dates that sit next to an admission keyword.
- Ignore dates outside the admission-cycle window (e.g. old notices).
"""
import re
import hashlib
from datetime import date

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
MON = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
D = r"(\d{1,2})(?:st|nd|rd|th)?"
Y = r"(20\d\d)"
SEP = r"\s*(?:to|till|until|-|–|—)\s*"

# Order matters: ranges first, then single dates.
PATTERNS = [
    # 1 November 2026 to 30 November 2026
    ("range_full", re.compile(rf"\b{D}\s+{MON}[\s,]*{Y}{SEP}{D}\s+{MON}[\s,]*{Y}", re.I)),
    # 22 to 31 January 2027  /  22-31 Jan 2027
    ("range_dm", re.compile(rf"\b{D}{SEP}{D}\s+{MON}[\s,]*{Y}", re.I)),
    # 28 January to 2 February 2027
    ("range_dmdm", re.compile(rf"\b{D}\s+{MON}{SEP}{D}\s+{MON}[\s,]*{Y}", re.I)),
    # January 22 to 31, 2027
    ("range_md", re.compile(rf"\b{MON}\s+{D}{SEP}{D},?\s*{Y}", re.I)),
    # 22.01.2027 to 31.01.2027
    ("range_num", re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](20\d\d)" + SEP + r"(\d{1,2})[./-](\d{1,2})[./-](20\d\d)")),
    # 22 January 2027 / 22nd Jan, 2027
    ("dmy", re.compile(rf"\b{D}\s+{MON}[\s,]*{Y}", re.I)),
    # January 22, 2027
    ("mdy", re.compile(rf"\b{MON}\s+{D},?\s*{Y}", re.I)),
    # 22.01.2027 / 22-01-2027 / 22/01/2027 (Indian day-first)
    ("num", re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](20\d\d)\b")),
]

CATEGORIES = [
    ("result",   ["result", "score card", "scorecard", "rank list", "merit list", "answer key"]),
    ("admit",    ["admit card", "hall ticket", "city intimation", "city slip"]),
    ("counsel",  ["counselling", "counseling", "choice filling", "seat allotment", "seat allocation", "round 1", "round 2", "option entry", "mock allotment"]),
    ("docs",     ["document verification", "verification of documents", "reporting"]),
    ("fee",      ["fee payment", "pay fee", "payment of fee", "seat acceptance fee"]),
    ("correct",  ["correction"]),
    ("app",      ["registration", "apply online", "application form", "online application", "last date", "submission of application", "applications open", "application window"]),
    ("exam",     ["date of exam", "date of examination", "exam date", "examination date", "test date", "computer based test", "cbt", "will be held", "will be conducted", "entrance test", "aptitude test", "interview", "drawing test", "studio test", "session 1", "session 2", "paper 1", "paper 2"]),
]
CAT_TITLE = {
    "result": "Result / answer key", "admit": "Admit card release", "counsel": "Counselling",
    "docs": "Document verification", "fee": "Fee payment", "correct": "Application correction window",
    "app": "Application", "exam": "Exam / test",
}


def _mon(s):
    return MONTHS[s[:3].lower()]


def _mk(y, m, d):
    try:
        return date(int(y), int(m), int(d))
    except ValueError:
        return None


def find_dates(text):
    """Yield (start, end, span) for each date or range in text. Ranges win over singles."""
    taken = []
    out = []
    for kind, rx in PATTERNS:
        for m in rx.finditer(text):
            s, e = m.span()
            if any(s < te and ts < e for ts, te in taken):
                continue
            g = m.groups()
            if kind == "range_full":
                a, b = _mk(g[2], _mon(g[1]), g[0]), _mk(g[5], _mon(g[4]), g[3])
            elif kind == "range_dm":
                a, b = _mk(g[3], _mon(g[2]), g[0]), _mk(g[3], _mon(g[2]), g[1])
            elif kind == "range_dmdm":
                a, b = _mk(g[4], _mon(g[1]), g[0]), _mk(g[4], _mon(g[3]), g[2])
                if a and b and a > b:  # 28 Dec to 4 Jan 2027
                    a = _mk(int(g[4]) - 1, _mon(g[1]), g[0])
            elif kind == "range_md":
                a, b = _mk(g[3], _mon(g[0]), g[1]), _mk(g[3], _mon(g[0]), g[2])
            elif kind == "range_num":
                a, b = _mk(g[2], g[1], g[0]), _mk(g[5], g[4], g[3])
            elif kind == "dmy":
                a = b = _mk(g[2], _mon(g[1]), g[0])
            elif kind == "mdy":
                a = b = _mk(g[2], _mon(g[0]), g[1])
            else:
                a = b = _mk(g[2], g[1], g[0])
            if not a or not b or b < a or (b - a).days > 120:
                continue
            taken.append((s, e))
            out.append((a, b, (s, e)))
    return sorted(out, key=lambda x: x[2][0])


def sentences(text):
    text = re.sub(r"[ \t ]+", " ", text)
    for chunk in re.split(r"(?<=[.;!?])\s+|\n+", text):
        chunk = chunk.strip()
        if 12 <= len(chunk) <= 600:
            yield chunk


def classify(context):
    low = context.lower()
    for cat, words in CATEGORIES:
        for w in words:
            if w in low:
                return cat, w
    return None, None


TIME_RX = re.compile(r"\b(\d{1,2})(?::|\.)(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:to|-|–)\s*(\d{1,2})(?::|\.)(\d{2})\s*(am|pm|a\.m\.|p\.m\.)", re.I)


def find_time(context):
    m = TIME_RX.search(context)
    if not m:
        return None
    def hm(h, mi, ap):
        h = int(h)
        ap = (ap or "").lower().replace(".", "")
        if ap == "pm" and h != 12:
            h += 12
        if ap == "am" and h == 12:
            h = 0
        return f"{h:02d}:{mi}"
    end_ap = m.group(6)
    start = hm(m.group(1), m.group(2), m.group(3) or end_ap)
    end = hm(m.group(4), m.group(5), end_ap)
    return f"{start}-{end}"


def extract(text, source_id, window_from, window_to):
    """Return candidate events found in text. Each has the evidence sentence."""
    events = {}
    for sent in sentences(text):
        found = find_dates(sent)
        if not found:
            continue
        cat, keyword = classify(sent)
        if not cat:
            continue
        for a, b, _ in found:
            if a < window_from or b > window_to:
                continue
            low = sent.lower()
            ev = {
                "source": source_id,
                "cat": cat,
                "title": CAT_TITLE[cat],
                "start": a.isoformat(),
                "end": b.isoformat() if b != a else None,
                "time": find_time(sent) if cat == "exam" else None,
                "tentative": any(w in low for w in ["tentative", "tentatively", "likely", "expected", "proposed"]),
                "keyword": keyword,
                "evidence": sent[:300],
            }
            if cat == "app" and "last date" in low:
                ev["title"] = "Application last date"
            elif cat == "app" and b == a and any(w in low for w in ["open", "start", "commence", "begin"]):
                ev["title"] = "Application opens"
            key = (cat, ev["start"], ev["end"])
            if key not in events or len(sent) < len(events[key]["evidence"]):
                events[key] = ev
    out = list(events.values())
    for ev in out:
        ev["id"] = hashlib.sha1(f'{source_id}|{ev["cat"]}|{ev["title"]}'.encode()).hexdigest()[:10] + "-" + ev["start"]
    return sorted(out, key=lambda e: e["start"])
