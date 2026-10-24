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
    # December 11, 2026 To December 13, 2026
    ("range_mdy_full", re.compile(rf"\b{MON}\s+{D},?\s*{Y}{SEP}{MON}\s+{D},?\s*{Y}", re.I)),
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
    ("result",   ["result", "score card", "scorecard", "rank list", "merit list", "answer key", "selection list", "shortlist", "provisional list"]),
    ("admit",    ["admit card", "hall ticket", "city intimation", "city slip"]),
    ("counsel",  ["counselling", "counseling", "choice filling", "seat allotment", "seat allocation", "round 1", "round 2", "option entry", "mock allotment"]),
    ("docs",     ["document verification", "verification of documents", "reporting"]),
    ("fee",      ["fee payment", "pay fee", "payment of fee", "seat acceptance fee"]),
    ("correct",  ["correction"]),
    ("app",      ["registration", "apply online", "application form", "online application", "last date", "last day", "submission of application", "submitting the application", "applications open", "application available", "application window", "date to apply", "apply by"]),
    ("exam",     ["date of exam", "date of examination", "exam date", "examination date", "test date", "computer based test", "cbt", "examination", " exam ", "entrance test", "aptitude test", "interview", "selection process", "skill assessment", "admission test", "written test", "drawing test", "studio test", "session 1", "session 2", "paper 1", "paper 2"]),
]
CAT_TITLE = {
    "result": "Result / shortlist", "admit": "Admit card release", "counsel": "Counselling",
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


AND_RX = re.compile(rf"\b{D}\s*(?:&|and)\s*{D}\s+{MON}[\s,]*{Y}", re.I)


def find_dates(text):
    """Yield (start, end, span) for each date or range in text. Ranges win over singles."""
    taken = []
    out = []
    for m in AND_RX.finditer(text):  # 14 & 16 January 2027 = two separate days
        g = m.groups()
        for day in (g[0], g[1]):
            d = _mk(g[3], _mon(g[2]), day)
            if d:
                out.append((d, d, m.span()))
        taken.append(m.span())
    for kind, rx in PATTERNS:
        for m in rx.finditer(text):
            s, e = m.span()
            if any(s < te and ts < e for ts, te in taken):
                continue
            g = m.groups()
            if kind == "range_mdy_full":
                a, b = _mk(g[2], _mon(g[0]), g[1]), _mk(g[5], _mon(g[3]), g[4])
            elif kind == "range_full":
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
        if len(chunk) >= 12:
            yield chunk[:600]  # long table rows (venue lists) are cut, not dropped


NOISE = re.compile(r"as per (your )?e?-?\s?admit card|refer (to )?(the )?admit card", re.I)


def classify(context):
    low = NOISE.sub(" ", context).lower()
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


PROGRAMMES = [
    ("B.Com", r"\bB\.?\s?Com\b|Bachelor of Commerce"), ("BBA", r"\bBBA\b|Bachelor of Business Administration"),
    ("BCA", r"\bBCA\b|Bachelor of Computer Applications"), ("B.Sc", r"\bB\.?\s?Sc\b|Bachelor of Science"),
    ("BA", r"\bB\.?A\.?\b(?!\s*LL)|Bachelor of Arts"), ("B.Tech", r"\bB\.?\s?Tech\b|\bB\.?E\.?\b|Bachelor of (Technology|Engineering)"),
    ("Law", r"\bLL\.?B\b|BA\s?LLB|Bachelor of Laws"), ("Design", r"\bB\.?\s?Des\b|Bachelor of Design"),
]
NOT_ADMISSION = re.compile(r"inaugurat|orientation|convocation|graduation day|holiday|vacation|workshop|seminar|webinar|conference|symposium|fest\b|festival|sports|cultural|alumni|placement|internship|semester exam|end[- ]semester|supplementary|revaluation|re-?evaluation|faculty|recruitment|tender|walk[- ]in|guest lecture|club|hackathon|competition|commencement of classes|class commencement|classes (will )?(begin|commence)", re.I)
PG = re.compile(r"\b(PG|Master of|M\.\s?Com|M\.\s?Sc|M\.\s?A\.|MBA|MCA|M\.\s?Tech|Ph\.?\s?D|PG Diploma|Postgraduate|Post Graduate)\b", re.I)


def programme_of(text):
    for name, rx in PROGRAMMES:
        if re.search(rx, text):
            return name
    return None


def extract(text, source_id, window_from, window_to):
    """Return candidate events found in text. Each has the evidence sentence."""
    events = {}
    for sent in sentences(text):
        found = find_dates(sent)
        if not found:
            continue
        if NOT_ADMISSION.search(sent):
            continue  # events, fests, semester exams, recruitment: not admission steps
        prog = programme_of(sent)
        if PG.search(sent) and not prog and not re.search(r"\bUG\b|under ?graduate|bachelor", sent, re.I):
            continue  # postgraduate rows are not for this tool
        cells = sent.split(" | ") if " | " in sent else [sent]
        row_cat, row_kw = classify(sent)
        pairs = []
        for cell in cells:
            cf = find_dates(cell)
            if not cf:
                continue
            ccat, ckw = classify(cell)
            if not ccat:
                ccat, ckw = row_cat, row_kw
            if ccat:
                pairs += [(ccat, ckw, x) for x in cf]
        for cat, keyword, (a, b, _) in pairs:
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
                "programme": prog,
                "evidence": sent[:300],
            }
            if cat == "app" and ("last date" in low or "last day" in low or "date to apply" in low):
                ev["title"] = "Application last date"
            elif cat == "app" and b == a and any(w in low for w in ["open", "start", "commence", "begin", "available"]):
                ev["title"] = "Application opens"
            if re.search(r"non[- ]?(entrance test|et\b)", low):
                ev["title"] += " (programmes without entrance test)"
            elif re.search(r"entrance test programmes|\(et\)", low) and cat != "exam":
                ev["title"] += " (programmes with entrance test)"
            if prog:
                ev["title"] = f"{prog}: {ev['title']}"
            key = (cat, ev["start"], ev["end"], prog)
            if key not in events or len(sent) < len(events[key]["evidence"]):
                events[key] = ev
    out = list(events.values())
    for ev in out:
        ev["id"] = hashlib.sha1(f'{source_id}|{ev["cat"]}|{ev["title"]}|{ev.get("programme")}'.encode()).hexdigest()[:10] + "-" + ev["start"]
    return sorted(out, key=lambda e: e["start"])
