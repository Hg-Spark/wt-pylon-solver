from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path
from typing import Any, Iterable

from datamine_loadout_parser import DatamineError, DatamineSource, parse_datamine_loadout


DEFAULT_OUTPUT = Path(__file__).resolve().parent / "frontend" / "public" / "data"
FLIGHTMODELS = Path("aces.vromfs.bin_u/gamedata/flightmodels")


def compact_option(weapon: dict[str, Any]) -> dict[str, Any]:
    return {
        "option_id": weapon.get("option_id"),
        "weapon_id": weapon.get("weapon_id"),
        "weapon_display_name": weapon.get("weapon_display_name") or weapon.get("weapon"),
        "count": weapon.get("count", 1),
        "weapon_category": weapon.get("weapon_category"),
        "weapon_subcategory": weapon.get("weapon_subcategory"),
        "damage": weapon.get("damage"),
        "counted_base_damage": weapon.get("counted_base_damage", 0) or 0,
        "weight_kg": weapon.get("weight_kg"),
        "icon_type": weapon.get("icon_type"),
        **{key: weapon[key] for key in ("required_option_ids", "banned_option_ids", "support") if weapon.get(key)},
    }


def compact_loadout(loadout: dict[str, Any], aircraft: str) -> dict[str, Any]:
    options: list[dict[str, Any]] = []
    seen: set[str] = set()
    for weapon in loadout.get("weapons", []):
        if not isinstance(weapon, dict):
            continue
        option_id = str(weapon.get("option_id") or "")
        if not option_id or option_id in seen:
            continue
        seen.add(option_id)
        options.append(compact_option(weapon))

    pylons: list[dict[str, Any]] = []
    for pylon in loadout.get("pylons", []):
        if not isinstance(pylon, dict):
            continue
        try:
            slot = int(pylon.get("slot"))
        except (TypeError, ValueError):
            continue
        option_ids = []
        for option in pylon.get("options", []):
            if not isinstance(option, dict):
                continue
            option_id = str(option.get("option_id") or "")
            if option_id and option_id in seen:
                option_ids.append(option_id)
        pylons.append({"slot": slot, "option_ids": option_ids})

    return {
        "reward_profile": loadout.get("reward_profile"),
        "options": options,
        "pylons": pylons,
    }


def all_aircraft_ids(root: Path) -> Iterable[str]:
    flight_dir = root / FLIGHTMODELS
    if not flight_dir.is_dir():
        raise SystemExit(f"Datamine flightmodels directory not found: {flight_dir}")

    wpcost_path = root / "char.vromfs.bin_u/config/wpcost.blkx"
    try:
        wpcost = json.loads(wpcost_path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Failed to read wpcost: {wpcost_path}: {exc}") from exc
    known_units = set(wpcost) if isinstance(wpcost, dict) else set()

    for path in sorted(flight_dir.glob("*.blkx")):
        aircraft = path.stem.lower()
        if known_units and aircraft not in known_units:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and isinstance(data.get("WeaponSlots"), dict):
            yield aircraft


def write_aircraft(aircraft: str, source: DatamineSource, output: Path, icon_types: set[str]) -> bool:
    try:
        loadout = parse_datamine_loadout(aircraft, source=source)
    except DatamineError as exc:
        print(f"skip {aircraft}: {exc}")
        return False

    payload = compact_loadout(loadout, aircraft)
    if not payload["options"] or not payload["pylons"]:
        print(f"skip {aircraft}: no usable loadout")
        return False

    icon_types.update(
        option["icon_type"] for option in payload["options"]
        if isinstance(option.get("icon_type"), str)
        and re.fullmatch(r"[a-z0-9_-]+", option["icon_type"])
    )
    path = output / f"{aircraft}.json"
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"wrote {aircraft}: {len(payload['options'])} options")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate static wt-pylon-solver aircraft data.")
    parser.add_argument("aircraft", nargs="*", help="Exact Datamine aircraft IDs, e.g. su_34 f_15e")
    parser.add_argument("--all", action="store_true", help="Generate all flightmodels with WeaponSlots (requires --datamine-root).")
    parser.add_argument("--datamine-root", type=Path, help="Local War-Thunder-Datamine checkout.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--clean", action="store_true", help="Delete existing generated JSON before writing.")
    args = parser.parse_args()

    if args.all and not args.datamine_root:
        parser.error("--all requires --datamine-root so aircraft IDs can be enumerated locally")
    if not args.all and not args.aircraft:
        parser.error("provide aircraft IDs or use --all")

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if args.clean:
        for path in output.glob("*.json"):
            path.unlink()

    root = args.datamine_root.resolve() if args.datamine_root else None
    source = DatamineSource(root=root)
    aircraft_ids = list(all_aircraft_ids(root)) if args.all and root else [item.lower() for item in args.aircraft]

    written = 0
    icon_types: set[str] = set()
    for aircraft in aircraft_ids:
        written += int(write_aircraft(aircraft, source, output, icon_types))

    if root is not None:
        icon_root = root / "atlases.vromfs.bin_u/gameuiskin"
        icon_output = output.parent / "icons"
        icon_output.mkdir(parents=True, exist_ok=True)
        if args.clean:
            for path in icon_output.glob("*.png"):
                path.unlink()
        copied = 0
        for icon_type in sorted(icon_types):
            icon_file = icon_root / f"{icon_type}.png"
            if icon_file.is_file():
                shutil.copyfile(icon_file, icon_output / icon_file.name)
                copied += 1
        print(f"copied {copied}/{len(icon_types)} pylon icons")

    if written == 0:
        raise SystemExit("No aircraft data was generated")
    print(f"generated {written}/{len(aircraft_ids)} aircraft files in {output}")


if __name__ == "__main__":
    main()
