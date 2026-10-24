from datetime import date
from extract import extract, find_dates

W0, W1 = date(2026, 9, 1), date(2027, 10, 31)


def test_formats():
    t = "22 to 31 January 2027. 28 Jan to 2 Feb 2027. April 5, 2027. 05.04.2027. 3rd May, 2027"
    got = [(a.isoformat(), b.isoformat()) for a, b, _ in find_dates(t)]
    assert ("2027-01-22", "2027-01-31") in got
    assert ("2027-01-28", "2027-02-02") in got
    assert ("2027-04-05", "2027-04-05") in got
    assert ("2027-05-03", "2027-05-03") in got


def test_extract_keeps_only_keyword_dates():
    text = """Online registration for JEE Main 2027 Session 1: 1 November 2026 to 30 November 2026.
    The examination will be held from 22 to 31 January 2027, 9:00 AM to 12:00 PM (tentative).
    Holiday on 26 January 2027.
    Old notice: Result declared on 12 February 2025."""
    ev = extract(text, "jee-main", W0, W1)
    cats = {(e["cat"], e["start"], e["end"]) for e in ev}
    assert ("app", "2026-11-01", "2026-11-30") in cats
    assert ("exam", "2027-01-22", "2027-01-31") in cats
    assert not any(e["start"] == "2027-01-26" for e in ev), "holiday has no admission keyword"
    assert not any(e["start"].startswith("2025") for e in ev), "outside window"
    exam = [e for e in ev if e["cat"] == "exam"][0]
    assert exam["tentative"] and exam["time"] == "09:00-12:00"


def test_no_invalid_dates():
    assert find_dates("Last date: 31.02.2027") == []


def test_table_rows():
    christ = """November 25, 2026 | 17:00 Hrs | Last day of submitting the application online for Entrance Test Programmes | x
December 05, 2026 | As per your E-Admit card | Entrance Test: Online | x
Entrance Test Programmes December 11, 2026 To December 13, 2026 | As per your E-Admit card | Personal interview (PI) | x"""
    got = {(e["cat"], e["start"], e["end"]) for e in extract(christ, "christ", W0, W1)}
    assert ("app", "2026-11-25", None) in got and ("exam", "2026-12-05", None) in got and ("exam", "2026-12-11", "2026-12-13") in got
    sju = """Programme Name: Bachelor of Commerce (B.Com.) | Last Date to Apply: 05 January 2027 | Date of Interview: 14 & 16 January 2027
Programme Name: Master of Commerce (M.Com.) | Last Date to Apply: 06 January 2027"""
    ev = extract(sju, "sju", W0, W1)
    assert all(e["programme"] == "B.Com" for e in ev), "PG rows must be dropped"
    assert {e["start"] for e in ev if e["cat"] == "exam"} == {"2027-01-14", "2027-01-16"}


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f(); print("ok", n)
