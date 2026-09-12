#!/usr/bin/env python3
"""
Fetch NFL team logos into:
  public/images/nfl/teams/

Goal:
- Reliable local logos for the abbreviations actually used by your site data.
- Avoid Wikimedia/Wikipedia thumbnail rate limits (HTTP 429).

What it does now:
1) Reads your schedule JSON (src/data/nfl/{team}.json) to get the exact set of team abbreviations you need.
2) Downloads those logos from ESPN first (stable CDN).
3) Creates alias copies for common abbreviation mismatches.
4) Optionally backfills from nflverse CSV ONLY for teams that are still missing after ESPN.
   (This avoids spamming Wikipedia thumbs and getting 429.)

Run from repo root:
  python3 scripts/fetch-nfl-logos.py
"""

import csv
import json
import os
import sys
import time
import urllib.request
from urllib.parse import urlparse

CSV_URL = "https://raw.githubusercontent.com/nflverse/nflverse-pbp/master/teams_colors_logos.csv"
OUT_DIR = os.path.join("public", "images", "nfl", "teams")
SCHEDULE_JSON = os.path.join("src", "data", "nfl", "{team}.json")

# Alias pairs: if one exists, copy to the other if missing
ALIASES = [
    ("LA", "LAR"),     # Rams
    ("WSH", "WAS"),    # Washington
    ("JAX", "JAC"),    # Jaguars (rare)
    ("LV", "LVR"),     # Raiders (rare)
]

# ESPN team ID mapping (fallback/stable primary source)
ESPN_TEAM_IDS = {
    "ARI": 22,
    "ATL": 1,
    "BAL": 33,
    "BUF": 2,
    "CAR": 29,
    "CHI": 3,
    "CIN": 4,
    "CLE": 5,
    "DAL": 6,
    "DEN": 7,
    "DET": 8,
    "GB": 9,
    "HOU": 34,
    "IND": 11,
    "JAX": 30,
    "KC": 12,
    "LA": 14,   # Rams
    "LAR": 14,
    "LAC": 24,
    "LV": 13,
    "MIA": 15,
    "MIN": 16,
    "NE": 17,
    "NO": 18,
    "NYG": 19,
    "NYJ": 20,
    "PHI": 21,
    "PIT": 23,
    "SEA": 26,
    "SF": 25,
    "TB": 27,
    "TEN": 10,
    "WAS": 28,
    "WSH": 28,
}

EXTS = [".svg", ".png", ".jpg", ".jpeg", ".img"]

def download_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "{team}fanzone/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()

def find_existing_file(abbr: str):
    for ext in EXTS:
        p = os.path.join(OUT_DIR, f"{abbr}{ext}")
        if os.path.exists(p) and os.path.getsize(p) > 0:
            return p
    return None

def copy_if_missing(src_abbr: str, dst_abbr: str):
    src_file = find_existing_file(src_abbr)
    if not src_file:
        return 0

    _, ext = os.path.splitext(src_file)
    dst_file = os.path.join(OUT_DIR, f"{dst_abbr}{ext}")
    if os.path.exists(dst_file) and os.path.getsize(dst_file) > 0:
        return 0

    try:
        with open(src_file, "rb") as f:
            data = f.read()
        with open(dst_file, "wb") as f:
            f.write(data)
        print(f"alias {src_abbr} -> {dst_abbr} ({os.path.basename(dst_file)})")
        return 1
    except Exception as e:
        print(f"FAILED alias {src_abbr} -> {dst_abbr}: {e}", file=sys.stderr)
        return 0

def read_schedule_abbrs():
    if not os.path.exists(SCHEDULE_JSON):
        return set()

    with open(SCHEDULE_JSON, "r") as f:
        data = json.load(f)

    # Accept both shapes:
    # 1) { games: [...] }
    # 2) { gamesRegular: [...], gamesPostseason: [...] }
    games = []
    if isinstance(data.get("games"), list):
        games = data["games"]
    else:
        gr = data.get("gamesRegular") or []
        gp = data.get("gamesPostseason") or []
        if isinstance(gr, list):
            games.extend(gr)
        if isinstance(gp, list):
            games.extend(gp)

    abbrs = set()
    for g in games:
        vt = g.get("visitor_team", {}) or {}
        ht = g.get("home_team", {}) or {}
        if vt.get("abbreviation"):
            abbrs.add(str(vt["abbreviation"]).upper())
        if ht.get("abbreviation"):
            abbrs.add(str(ht["abbreviation"]).upper())

    return abbrs

def espn_logo_url(abbr: str) -> str:
    team_id = ESPN_TEAM_IDS.get(abbr)
    if not team_id:
        return ""
    return f"https://a.espncdn.com/i/teamlogos/nfl/500/{team_id}.png"

def ensure_from_espn(abbr: str) -> bool:
    url = espn_logo_url(abbr)
    if not url:
        return False
    out_path = os.path.join(OUT_DIR, f"{abbr}.png")
    if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
        return True
    try:
        data = download_bytes(url)
        with open(out_path, "wb") as f:
            f.write(data)
        print(f"espn saved {abbr} -> {out_path}")
        time.sleep(0.12)  # gentle pacing
        return True
    except Exception as e:
        print(f"FAILED espn {abbr} ({url}): {e}", file=sys.stderr)
        return False

def ext_from_url(url: str) -> str:
    p = urlparse(url).path.lower()
    if p.endswith(".svg"):
        return ".svg"
    if p.endswith(".png"):
        return ".png"
    if p.endswith(".jpg") or p.endswith(".jpeg"):
        return ".jpg"
    return ".img"

def try_nflverse_backfill(missing_abbrs):
    """
    Only backfill for remaining missing abbreviations.
    This can still hit Wikimedia thumbs; we do it last and only for a few.
    """
    if not missing_abbrs:
        return (0, 0)

    downloaded = 0
    failed = 0

    try:
        with urllib.request.urlopen(CSV_URL, timeout=30) as r:
            text = r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"Failed to fetch nflverse CSV: {e}", file=sys.stderr)
        return (0, len(missing_abbrs))

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    reader = csv.DictReader(text.splitlines())
    if not reader.fieldnames:
        return (0, len(missing_abbrs))

    # Find likely columns in a robust way
    headers = [h.strip() for h in reader.fieldnames if h and h.strip()]
    def pick(cands):
        headers_lc = {h.lower(): h for h in headers}
        for c in cands:
            if c.lower() in headers_lc:
                return headers_lc[c.lower()]
        return None

    abbr_col = pick(["team_abbr", "abbr", "team"])
    logo_col = pick(["team_logo_wikipedia", "team_logo_espn", "team_logo", "logo", "logo_url"])
    if not abbr_col or not logo_col:
        return (0, len(missing_abbrs))

    want = set(missing_abbrs)

    for row in reader:
        abbr = (row.get(abbr_col) or "").strip().upper()
        if abbr not in want:
            continue

        logo_url = (row.get(logo_col) or "").strip()
        if not logo_url:
            continue

        ext = ext_from_url(logo_url)
        out_path = os.path.join(OUT_DIR, f"{abbr}{ext}")
        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            want.discard(abbr)
            continue

        try:
            data = download_bytes(logo_url)
            with open(out_path, "wb") as f:
                f.write(data)
            print(f"nflverse saved {abbr} -> {out_path}")
            downloaded += 1
            want.discard(abbr)
            time.sleep(0.2)  # slower to reduce chance of 429
        except Exception as e:
            print(f"FAILED nflverse {abbr} ({logo_url}): {e}", file=sys.stderr)
            failed += 1
            time.sleep(0.4)

    failed += len(want)
    return (downloaded, failed)

def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)

    schedule_abbrs = read_schedule_abbrs()
    if not schedule_abbrs:
        # Generated schedule data is not always present in a clean checkout.
        # Fetch every current team so pages still receive their local assets.
        schedule_abbrs = set(ESPN_TEAM_IDS) - {"LA", "WSH"}
        print(f"No abbreviations found in {SCHEDULE_JSON}. Fetching all NFL teams.")

    # 1) ESPN first for exactly what you need
    ensured = 0
    for abbr in sorted(schedule_abbrs):
        if find_existing_file(abbr):
            continue
        if ensure_from_espn(abbr):
            ensured += 1

    # 2) Alias copies
    alias_made = 0
    for a, b in ALIASES:
        alias_made += copy_if_missing(a, b)
        alias_made += copy_if_missing(b, a)

    # 3) Backfill remaining missing via nflverse (last resort)
    remaining = [a for a in sorted(schedule_abbrs) if not find_existing_file(a)]
    nflverse_downloaded, nflverse_failed = try_nflverse_backfill(remaining)

    # Re-run aliases after backfill
    for a, b in ALIASES:
        alias_made += copy_if_missing(a, b)
        alias_made += copy_if_missing(b, a)

    still_missing = [a for a in sorted(schedule_abbrs) if not find_existing_file(a)]

    print("\nDone.")
    print(f"Schedule teams: {len(schedule_abbrs)}")
    print(f"Ensured via ESPN: {ensured}")
    print(f"Aliases created: {alias_made}")
    print(f"Backfilled via nflverse: {nflverse_downloaded}")
    print(f"Still missing: {', '.join(still_missing) if still_missing else 'none'}")
    print(f"Output dir: {OUT_DIR}")

    return 0 if not still_missing else 2

if __name__ == "__main__":
    raise SystemExit(main())
