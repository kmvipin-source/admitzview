"""Accuracy checks applied after the rule-based reader.

1. AI cross-check: a free AI model (GitHub Models, using the workflow's own token) reads the same
   official page independently. A date is kept only if BOTH readers found it for the same kind of step.
   The AI can never add a date on its own.
2. Sanity checks: dates must fit the admission cycle and be in a sensible order.
3. Page fingerprint: a hash of the page text, so changes to the official page are noticed.
"""
import hashlib
import json
import os
import re

import requests

MODELS = ["openai/gpt-4o-mini", "openai/gpt-4.1-mini", "openai/gpt-4o"]
STEP_TO_CAT = {
    "application_open": "app", "application_close": "app", "application": "app", "correction": "correct",
    "fee": "fee", "admit_card": "admit", "entrance_test": "exam", "interview": "exam", "selection": "exam",
    "result": "result", "merit_list": "result", "shortlist": "result", "counselling": "counsel", "documents": "docs",
}
COMPATIBLE = {"app": {"app", "fee", "correct"}, "fee": {"app", "fee"}, "correct": {"app", "correct"},
              "exam": {"exam"}, "admit": {"admit"}, "result": {"result"}, "counsel": {"counsel", "docs"}, "docs": {"docs", "counsel"}}


def fingerprint(text):
    return hashlib.sha1(re.sub(r"\s+", " ", text or "").strip().encode()).hexdigest()[:16]


ENDPOINTS = ["https://models.github.ai/inference/chat/completions"]


def _ask(prompt):
    token = os.environ.get("GITHUB_TOKEN")
    if not token or os.environ.get("ADMITZVIEW_AI", "on") == "off":
        return None, "AI off"
    errs = []
    for endpoint in ENDPOINTS:
        for model in MODELS:
            name = model if "github.ai" in endpoint else model.split("/")[-1]
            try:
                r = requests.post(endpoint, timeout=90,
                                  headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                           "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
                                  json={"model": name, "temperature": 0, "stream": False,
                                        "messages": [{"role": "system", "content": "You extract facts from web pages. Reply with JSON only."},
                                                     {"role": "user", "content": prompt}]})
                ctype = r.headers.get("content-type", "")
                if r.status_code != 200 or "json" not in ctype:
                    errs.append(f"{name}: HTTP {r.status_code} {ctype} {r.text[:200]!r}")
                    continue
                content = (r.json()["choices"][0]["message"]["content"] or "").strip()
                m = re.search(r"\[.*\]|\{.*\}", content, re.S)
                if not m:
                    errs.append(f"{name}: no JSON in reply {content[:120]!r}")
                    continue
                return json.loads(m.group(0)), name
            except Exception as ex:
                errs.append(f"{name}: {type(ex).__name__} {str(ex)[:150]}")
    return None, " || ".join(errs[:3])


def ai_dates(src, page_text, cycle):
    """Ask the AI, independently, for admission dates on the page. Returns list of (start, end, cat) or None."""
    text = re.sub(r"\n\s*\n+", "\n", page_text)[:14000]
    prompt = (
        f"This is the official page of {src['name']} ({src['authority']}).\n"
        f"List every date on it that is a step in UNDERGRADUATE admission for the {cycle} intake "
        "(B.Com / BBA / IPM / UG programmes). Ignore postgraduate (MBA, M.Com, PhD), conferences, workshops, "
        "events, internal exams, holidays, refunds and anything for previous years.\n"
        "Reply as a JSON array: [{\"start\":\"YYYY-MM-DD\",\"end\":\"YYYY-MM-DD or null\","
        "\"step\":\"application_open|application_close|correction|fee|admit_card|entrance_test|interview|result|counselling|documents\"}]. "
        "Use only dates written on the page. If there are none, reply [].\n\nPAGE:\n" + text
    )
    data, info = _ask(prompt)
    if data is None:
        return None, info
    if isinstance(data, dict):
        data = data.get("dates") or data.get("items") or []
    out = []
    for d in data if isinstance(data, list) else []:
        try:
            cat = STEP_TO_CAT.get(str(d.get("step", "")).lower())
            s = str(d.get("start", ""))[:10]
            e = d.get("end")
            e = str(e)[:10] if e and str(e).lower() != "null" else None
            if cat and re.match(r"20\d\d-\d\d-\d\d$", s):
                out.append((s, e if e and e != s else None, cat))
        except AttributeError:
            continue
    return out, info


def agree(rule_events, ai_list):
    """Keep a rule-based event only if the AI independently found the same date for a compatible step."""
    kept = []
    for ev in rule_events:
        ok_cats = COMPATIBLE.get(ev["cat"], {ev["cat"]})
        for s, e, cat in ai_list:
            same_day = s == ev["start"] or (ev.get("end") and s == ev["end"]) or (e and e == ev.get("end", ev["start"]))
            if same_day and cat in ok_cats:
                kept.append(dict(ev, verified="2 readers agree"))
                break
    return kept


ORDER = {"app": 0, "correct": 1, "fee": 1, "admit": 2, "exam": 3, "result": 4, "counsel": 5, "docs": 5}


def sane(events):
    """Drop a source's dates if they are clearly inconsistent (e.g. results before the application closes)."""
    by_prog = {}
    for e in events:
        by_prog.setdefault(e.get("programme"), []).append(e)
    for evs in by_prog.values():
        last_app_close = max((e.get("end") or e["start"] for e in evs if e["cat"] == "app"), default=None)
        first_result = min((e["start"] for e in evs if e["cat"] == "result"), default=None)
        if last_app_close and first_result and first_result < last_app_close and len(evs) <= 3:
            return False
    return True
