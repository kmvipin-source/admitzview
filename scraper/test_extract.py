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
    ev = extract(text, "jee-main", W0, W1, admission_page=True)  # an exam body's whole site is about admission
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


def test_long_rows_and_ug_pg():
    row = "Date: Entrance Test Programmes December 11, 2026 To December 13, 2026 | Time: As per your E-Admit card | Particulars: Personal interview (PI) | Venue: " + " | ".join(["Campus"] * 120)
    assert [(e["cat"], e["start"], e["end"]) for e in extract(row, "c", W0, W1)] == [("exam", "2026-12-11", "2026-12-13")]
    assert extract("UG & PG applications: last date 25 November 2026", "c", W0, W1)


def test_admission_page_relaxes_anchor():
    row = "Date: December 05, 2026 | Particulars: Entrance Test: Online"
    assert extract(row, "c", W0, W1, admission_page=True)
    assert extract("The examination will be held on 10 March 2027.", "c", W0, W1, admission_page=True)


def test_junk_is_dropped():
    junk = """PG (MBA & MCA) Inauguration for the Academic Year 2026–27 will be held on 29 October 2026.
    The Annual Sports Day will be held on 12 December 2026.
    End semester examination will be held from 1 December 2026 to 15 December 2026.
    Recruitment of faculty: last date 20 November 2026.
    Regular Lectures & Practicals for students of SYJC: 29 October 2026 to 4 November 2026 examination.
    Last Date for Full Paper Submission or Extended abstract | 10 November 2026.
    Cancellation request received: 31 March – 07 April 2027 | Refund.
    Regular Lectures & Practicals for students of FYJC Arts are cancelled from 22.10.2026 to 28.10.2026 due to the Common First Terminal Exam of SYJC.
    The annual examination will be held from 5 March 2027 to 20 March 2027."""
    assert extract(junk, "x", W0, W1) == []


def test_card_layout_label_then_date():
    t = "Phase 1 applications close\n6 Dec 2026\nEntrance tests, Phase 1\n10–11 Dec 2026\nApplication deadline (Phase I)\nSunday, 6 December 2026"
    evs = extract(t, "x", date(2026, 6, 1), date(2027, 12, 31), admission_page=True)
    got = {(e["start"], e.get("end"), e["cat"]) for e in evs}
    assert ("2026-12-06", None, "app") in got and ("2026-12-10", "2026-12-11", "exam") in got, got
    assert all(e["title"] != "Application" or e["cat"] != "app" for e in evs if e["start"] == "2026-12-06")


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f(); print("ok", n)
