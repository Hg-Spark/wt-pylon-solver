#!/usr/bin/env python3
from __future__ import annotations

import csv
import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("datamine/atlases.vromfs.bin_u/gameuiskin")
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("audit-output")
OUT.mkdir(parents=True, exist_ok=True)

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def image_metrics(path: Path) -> dict:
    raw = path.read_bytes()
    with Image.open(path) as im:
        rgba = im.convert("RGBA")
        w, h = rgba.size
        alpha = rgba.getchannel("A")
        bbox = alpha.getbbox()
        alpha_arr = np.asarray(alpha, dtype=np.uint8)
        visible = alpha_arr > 0
        visible_count = int(visible.sum())
        total = w * h
        if bbox:
            x0, y0, x1, y1 = bbox
            content_w, content_h = x1 - x0, y1 - y0
            edge_occupancy = (content_w * content_h) / total
        else:
            x0 = y0 = x1 = y1 = content_w = content_h = 0
            edge_occupancy = 0.0
        rgba_bytes = rgba.tobytes()
        alpha_bytes = alpha.tobytes()
        hsv_v = np.asarray(rgba.convert("HSV").getchannel("V"), dtype=np.uint8)
        visible_v = hsv_v[visible].astype(np.float32)
        return {
            "file": path.name,
            "width": w,
            "height": h,
            "area": total,
            "file_bytes": len(raw),
            "raw_sha256": sha(raw),
            "rgba_sha256": sha(rgba_bytes),
            "alpha_sha256": sha(alpha_bytes),
            "alpha_opaque": bool(visible_count == total),
            "visible_pixels": visible_count,
            "transparent_ratio": 1.0 - visible_count / total,
            "bbox_x": x0, "bbox_y": y0,
            "bbox_width": content_w, "bbox_height": content_h,
            "bbox_area_ratio": edge_occupancy,
            "aspect_ratio": w / h,
            "_visible_v": visible_v,
            "_alpha_full": visible_count == total,
        }

def correlation(a: np.ndarray, b: np.ndarray) -> float:
    if len(a) != len(b) or len(a) < 8:
        return -1.0
    sa, sb = float(a.std()), float(b.std())
    if sa < 1e-6 or sb < 1e-6:
        return 1.0 if np.array_equal(a, b) else -1.0
    return float(np.corrcoef(a, b)[0, 1])

files = sorted(ROOT.glob("*.png"))
if not files:
    raise SystemExit(f"No PNG files found under {ROOT}")

records = [image_metrics(p) for p in files]
dimensions = Counter((r["width"], r["height"]) for r in records)

def duplicate_groups(key: str):
    grouped = defaultdict(list)
    for r in records:
        grouped[r[key]].append(r)
    return [g for g in grouped.values() if len(g) > 1]

raw_dupes = duplicate_groups("raw_sha256")
pixel_dupes = duplicate_groups("rgba_sha256")

alpha_groups = defaultdict(list)
for r in records:
    if not r["_alpha_full"]:
        alpha_groups[(r["width"], r["height"], r["alpha_sha256"])].append(r)
alpha_groups = [g for g in alpha_groups.values() if len(g) > 1]

# Candidate recolors: exact same non-rectangular alpha silhouette and highly
# correlated HSV value channel. This is a conservative candidate detector,
# not an automatic replacement rule.
variant_clusters = []
for group in alpha_groups:
    parent = list(range(len(group)))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
    pair_scores = []
    for i in range(len(group)):
        for j in range(i + 1, len(group)):
            score = correlation(group[i]["_visible_v"], group[j]["_visible_v"])
            pair_scores.append((i, j, score))
            if score >= 0.985:
                union(i, j)
    clusters = defaultdict(list)
    for i, rec in enumerate(group):
        clusters[find(i)].append(rec)
    for cluster in clusters.values():
        if len(cluster) > 1:
            names = {r["file"] for r in cluster}
            scores = [s for i, j, s in pair_scores
                      if group[i]["file"] in names and group[j]["file"] in names]
            variant_clusters.append({
                "files": sorted(names),
                "width": cluster[0]["width"],
                "height": cluster[0]["height"],
                "count": len(cluster),
                "min_value_correlation": min(scores) if scores else 1.0,
            })

def write_csv(name, rows, fields):
    with (OUT / name).open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

file_rows = []
for r in records:
    file_rows.append({k: v for k, v in r.items() if not k.startswith("_")})
write_csv("all_icons.csv", file_rows, list(file_rows[0].keys()))

dim_rows = [
    {"width": w, "height": h, "count": n, "total_canvas_pixels": w*h*n}
    for (w, h), n in dimensions.most_common()
]
write_csv("dimension_distribution.csv", dim_rows,
          ["width", "height", "count", "total_canvas_pixels"])

def flatten_groups(groups, kind):
    rows = []
    for i, group in enumerate(groups, 1):
        for r in group:
            rows.append({"group_id": i, "kind": kind, "file": r["file"],
                         "width": r["width"], "height": r["height"],
                         "file_bytes": r["file_bytes"]})
    return rows

for name, groups in [("exact_file_duplicates.csv", raw_dupes),
                     ("exact_pixel_duplicates.csv", pixel_dupes),
                     ("same_alpha_silhouette.csv", alpha_groups)]:
    rows = flatten_groups(groups, name.removesuffix(".csv"))
    write_csv(name, rows, ["group_id", "kind", "file", "width", "height", "file_bytes"])

variant_rows = []
for i, group in enumerate(variant_clusters, 1):
    for name in group["files"]:
        variant_rows.append({"group_id": i, "count": group["count"],
                             "width": group["width"], "height": group["height"],
                             "min_value_correlation": group["min_value_correlation"],
                             "file": name})
write_csv("recolor_candidates.csv", variant_rows,
          ["group_id", "count", "width", "height", "min_value_correlation", "file"])

sizes = sorted(r["file_bytes"] for r in records)
areas = sorted(r["area"] for r in records)
def pct(values, p):
    return values[min(len(values)-1, math.ceil(p*len(values))-1)]

summary = {
    "source": "Exact iconType PNGs referenced by parsed aircraft mount options",
    "mount_icon_count": len(records),
    "total_file_bytes": sum(sizes),
    "total_file_mib": round(sum(sizes)/(1024*1024), 3),
    "file_size_median": pct(sizes, .5),
    "file_size_p90": pct(sizes, .9),
    "file_size_max": max(sizes),
    "unique_dimensions": len(dimensions),
    "dimension_distribution": [
        {"width": w, "height": h, "count": n}
        for (w, h), n in dimensions.most_common()
    ],
    "transparent_image_count": sum(not r["_alpha_full"] for r in records),
    "mean_transparent_pixel_ratio": round(float(np.mean([r["transparent_ratio"] for r in records])), 5),
    "mean_bbox_area_ratio": round(float(np.mean([r["bbox_area_ratio"] for r in records])), 5),
    "exact_file_duplicate_groups": len(raw_dupes),
    "exact_pixel_duplicate_groups": len(pixel_dupes),
    "same_alpha_silhouette_groups": len(alpha_groups),
    "recolor_candidate_groups": len(variant_clusters),
    "recolor_candidate_files": sum(g["count"] for g in variant_clusters),
}
(OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

lines = [
    "# Datamine gameuiskin PNG audit", "",
    f"- Actual mounted icon PNGs: **{summary['mount_icon_count']}**",
    f"- Total file size: **{summary['total_file_mib']} MiB**",
    f"- Unique dimensions: **{summary['unique_dimensions']}**",
    f"- Images with transparency: **{summary['transparent_image_count']}**",
    f"- Mean transparent pixel ratio: **{summary['mean_transparent_pixel_ratio']:.2%}**",
    f"- Mean alpha-bbox canvas occupancy: **{summary['mean_bbox_area_ratio']:.2%}**",
    f"- Exact file duplicate groups: **{summary['exact_file_duplicate_groups']}**",
    f"- Exact decoded-pixel duplicate groups: **{summary['exact_pixel_duplicate_groups']}**",
    f"- Same alpha silhouette groups: **{summary['same_alpha_silhouette_groups']}**",
    f"- Conservative recolor candidate groups: **{summary['recolor_candidate_groups']}**",
    "", "## Dimension distribution", "",
    "| Size | Count | Canvas pixels |",
    "|---:|---:|---:|",
]
for row in dim_rows:
    lines.append(f"| {row['width']}×{row['height']} | {row['count']} | {row['total_canvas_pixels']:,} |")
lines += ["", "## Interpretation", "",
          "This input directory is generated by build_static_data.py from iconType values in parsed aircraft WeaponPreset options referenced by pylons. It excludes unrelated gameuiskin UI assets.",
          "Recolor candidates are conservative candidates only: identical non-rectangular alpha masks plus HSV value-channel correlation >= 0.985. Review contact sheets before replacing assets.",
          ""]
(OUT / "report.md").write_text("\n".join(lines), encoding="utf-8")

# Contact sheets for visual review of detected recolor candidate groups.
contact_dir = OUT / "recolor_contact_sheets"
contact_dir.mkdir(exist_ok=True)
font = ImageFont.load_default()
for idx, group in enumerate(variant_clusters, 1):
    if idx > 100:
        break
    thumbs = []
    for name in group["files"]:
        p = ROOT / name
        im = Image.open(p).convert("RGBA")
        im.thumbnail((112, 112))
        tile = Image.new("RGBA", (140, 144), (45, 45, 45, 255))
        tile.alpha_composite(im, ((140-im.width)//2, 4+(112-im.height)//2))
        ImageDraw.Draw(tile).text((4, 120), name[:21], fill=(255,255,255,255), font=font)
        thumbs.append(tile.convert("RGB"))
    cols = min(5, len(thumbs))
    rows = math.ceil(len(thumbs)/cols)
    sheet = Image.new("RGB", (cols*140, rows*144), (24,24,24))
    for i, tile in enumerate(thumbs):
        sheet.paste(tile, ((i%cols)*140, (i//cols)*144))
    sheet.save(contact_dir / f"cluster_{idx:03d}.jpg", quality=92)

print(json.dumps(summary, ensure_ascii=False, indent=2))
