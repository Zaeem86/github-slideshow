#!/usr/bin/env python3
"""Generate one index.html per page of the ZEMO SIIRTO site map.

Run from anywhere:  python3 zemo-siirto/tools/build_pages.py
Every page is a thin shell; app.js renders it from <body data-portal data-page data-root>.
"""
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
PAGES = {
    "customer": [("login", "Sign in"), ("dashboard", "Dashboard"), ("create-order", "New transfer"), ("tracking", "Tracking")],
    "driver": [("login", "Sign in"), ("available-jobs", "Available jobs"), ("my-jobs", "My jobs"), ("inspection", "Inspection"),
               ("navigation", "Navigation"), ("earnings", "Earnings"), ("profile", "Profile")],
    "admin": [("login", "Sign in"), ("dashboard", "Dashboard"), ("drivers", "Drivers"), ("customers", "Customers"), ("orders", "Orders"),
              ("pricing", "Pricing"), ("payments", "Payments"), ("settings", "Settings")],
}
LABEL = {"customer": "Customer", "driver": "Driver", "admin": "Admin"}

TEMPLATE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <meta name="description" content="ZEMO SIIRTO – Your car. Our driver. Your destination. Auton siirto Suomessa, luotettavasti.">
  {robots}<link rel="stylesheet" href="{root}style.css">
</head>
<body data-portal="{portal}" data-page="{page}" data-root="{root}">
  <header class="top"><div class="wrap" id="topbar"></div></header>
  <div class="wrap"><main id="app"><noscript><p>Please enable JavaScript to use ZEMO SIIRTO.</p></noscript></main></div>
  <dialog id="modal"></dialog>
  <script src="{root}config.js"></script>
  <script src="{root}app.js"></script>
</body>
</html>
"""


def write(path: Path, **kw):
    path.parent.mkdir(parents=True, exist_ok=True)
    kw.setdefault("robots", "")
    path.write_text(TEMPLATE.format(**kw), encoding="utf-8")
    print("wrote", path.relative_to(SITE))


write(SITE / "index.html", title="ZEMO SIIRTO – Auton siirto Suomessa", portal="public", page="home", root="./")
for portal, pages in PAGES.items():
    robots = '<meta name="robots" content="noindex">\n  ' if portal == "admin" else ""
    # /portal/ redirects to the portal's start page
    write(SITE / portal / "index.html", title=f"ZEMO SIIRTO {LABEL[portal]}", portal=portal, page="home", root="../", robots=robots)
    for page, label in pages:
        write(SITE / portal / page / "index.html", title=f"{label} · ZEMO SIIRTO {LABEL[portal]}",
              portal=portal, page=page, root="../../", robots=robots)
