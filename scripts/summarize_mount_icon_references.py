#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

DATA_ROOT = Path(sys.argv[1])
ICON_ROOT = Path(sys.argv[2])
OUT_ROOT = Path(sys.argv[3])
OUT_ROOT.mkdir(parents=True, exist_ok=True)

references = Counter()
aircraft_by_icon = defaultdict(set)
options_total = 0
aircraft_total = 0
options_without_icon = 0

for path in sorted(DATA_ROOT.glob("*.json")):
    if path.stem == "aircraft-index":
        continue
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        continue
    aircraft_total += 1
    options = data.get("options", [])
    pylons = data.get("pylons", [])
    mounted_ids = {
        option_id
        for pylon in pylons if isinstance(pylon, dict)
        for option_id in pylon.get("option_ids", [])
        if isinstance(option_id, str)
    }
    for option in options:
        if not isinstance(option, dict) or option.get("option_id") not in mounted_ids:
            continue
        options_total += 1
        icon_type = option.get("icon_type")
        if not isinstance(icon_type, str) or not icon_type:
            options_without_icon += 1
            continue
        references[icon_type] += 1
        aircraft_by_icon[icon_type].add(path.stem)

rows = []
missing = []
for icon_type, count in references.most_common():
    exists = (ICON_ROOT / f"{icon_type}.png").is_file()
    row = {
        "icon_type": icon_type,
        "option_references": count,
        "aircraft_count": len(aircraft_by_icon[icon_type]),
        "png_exists": exists,
    }
    rows.append(row)
    if not exists:
        missing.append(icon_type)

with (OUT_ROOT / "mount_icon_references.csv").open("w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=["icon_type", "option_references", "aircraft_count", "png_exists"])
    writer.writeheader()
    writer.writerows(rows)

summary = {
    "aircraft_count": aircraft_total,
    "mounted_option_count": options_total,
    "mounted_options_without_icon_type": options_without_icon,
    "unique_mounted_icon_types": len(references),
    "available_mounted_icon_pngs": sum(1 for row in rows if row["png_exists"]),
    "missing_mounted_icon_pngs": len(missing),
    "missing_icon_types": missing,
    "mounted_icon_references": sum(references.values()),
}
(OUT_ROOT / "mount_icon_reference_summary.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(json.dumps(summary, ensure_ascii=False, indent=2))
