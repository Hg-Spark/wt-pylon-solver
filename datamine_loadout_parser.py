from __future__ import annotations

import csv
import io
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import quote

import requests



REPOSITORY = "gszabi99/War-Thunder-Datamine"
DEFAULT_REF = "master"
RAW_BASE = "https://raw.githubusercontent.com"


MASS_FIELDS = (
    "totalBombRocketMass",
    "totalGuidedBombMass",
    "totalNapalmBombMass",
)


class DatamineError(RuntimeError):
    pass


class DatamineNotFound(DatamineError):
    """Raised when an exact Datamine path/unit ID does not exist."""

    pass


@dataclass(frozen=True)
class LeafWeapon:
    path: str
    weapon_id: str
    count: int
    trigger: str
    edit_preset_chapter: str
    data: Mapping[str, Any]


class DatamineSource:
    """Read War Thunder Datamine files from a local checkout or GitHub raw files.

    A local checkout is preferred when ``WT_PYLON_SOLVER_DATAMINE_ROOT`` is set. Otherwise
    files are fetched lazily from GitHub and cached on disk.
    """

    def __init__(
        self,
        *,
        root: Optional[str | Path] = None,
        ref: Optional[str] = None,
        cache_dir: Optional[str | Path] = None,
        cache_ttl_seconds: Optional[int] = None,
    ) -> None:
        env_root = os.environ.get("WT_PYLON_SOLVER_DATAMINE_ROOT")
        self.root = Path(root or env_root).expanduser().resolve() if (root or env_root) else None
        self.ref = str(ref or os.environ.get("WT_PYLON_SOLVER_DATAMINE_REF") or DEFAULT_REF).strip() or DEFAULT_REF
        default_cache = Path(__file__).resolve().parent / ".cache" / "datamine"
        self.cache_dir = Path(cache_dir or os.environ.get("WT_PYLON_SOLVER_DATAMINE_CACHE") or default_cache)
        ttl_env = os.environ.get("WT_PYLON_SOLVER_DATAMINE_CACHE_TTL")
        self.cache_ttl_seconds = int(cache_ttl_seconds if cache_ttl_seconds is not None else (ttl_env or 21600))
        self._text_cache: Dict[str, str] = {}
        self._json_cache: Dict[str, Any] = {}
        self._lock = threading.RLock()


    def read_text(self, relative_path: str) -> str:
        path = _normalize_repo_path(relative_path)
        with self._lock:
            cached = self._text_cache.get(path)
        if cached is not None:
            return cached

        if self.root:
            local_path = self._resolve_local_path(path)
            try:
                text = local_path.read_text(encoding="utf-8-sig")
            except OSError as exc:
                raise DatamineNotFound(f"Datamine file not found: {path}") from exc
        else:
            cache_path = self.cache_dir / self.ref / path
            if self._cache_is_fresh(cache_path):
                try:
                    text = cache_path.read_text(encoding="utf-8-sig")
                except OSError:
                    text = self._fetch_remote(path, cache_path)
            else:
                text = self._fetch_remote(path, cache_path)

        with self._lock:
            self._text_cache[path] = text
        return text

    def read_json(self, relative_path: str) -> Any:
        path = _normalize_repo_path(relative_path)
        with self._lock:
            cached = self._json_cache.get(path)
        if cached is not None:
            return cached
        text = self.read_text(path)
        try:
            value = json.loads(text)
        except json.JSONDecodeError as exc:
            raise DatamineError(f"Invalid Datamine JSON: {path}: {exc}") from exc
        with self._lock:
            self._json_cache[path] = value
        return value

    def prefetch(self, relative_paths: Iterable[str], *, max_workers: int = 8) -> None:
        if self.root:
            return
        paths = sorted({_normalize_repo_path(path) for path in relative_paths if path})
        pending = []
        for path in paths:
            with self._lock:
                if path in self._text_cache:
                    continue
            cache_path = self.cache_dir / self.ref / path
            if self._cache_is_fresh(cache_path):
                continue
            pending.append(path)
        if not pending:
            return

        def fetch(path: str) -> None:
            cache_path = self.cache_dir / self.ref / path
            self._fetch_remote(path, cache_path)

        with ThreadPoolExecutor(max_workers=min(max_workers, len(pending))) as executor:
            futures = [executor.submit(fetch, path) for path in pending]
            for future in as_completed(futures):
                try:
                    future.result()
                except DatamineError:
                    # Best-effort warmup only. The normal read path below will
                    # decide whether a missing file is fatal for that option.
                    pass

    def _resolve_local_path(self, path: str) -> Path:
        assert self.root is not None
        direct = self.root / path
        if direct.exists():
            return direct
        parts = Path(path).parts
        if parts and self.root.name.casefold() == parts[0].casefold():
            nested = self.root.joinpath(*parts[1:])
            if nested.exists():
                return nested
        return direct

    def _cache_is_fresh(self, path: Path) -> bool:
        if not path.is_file():
            return False
        if self.cache_ttl_seconds < 0:
            return True
        age = time.time() - path.stat().st_mtime
        return age <= self.cache_ttl_seconds

    def _fetch_remote(self, path: str, cache_path: Path) -> str:
        url = f"{RAW_BASE}/{REPOSITORY}/{quote(self.ref, safe='')}/{quote(path, safe='/')}"
        timeout = 120 if path.endswith("wpcost.blkx") else 45
        try:
            response = requests.get(
                url,
                timeout=timeout,
                stream=True,
                headers={"User-Agent": "wt-pylon-solver/0.3"},
            )
            if response.status_code == 404:
                raise DatamineNotFound(f"Datamine file not found: {path}")
            response.raise_for_status()
        except DatamineNotFound:
            raise
        except requests.RequestException as exc:
            raise DatamineError(f"Failed to fetch Datamine file: {path}: {exc}") from exc

        cache_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = cache_path.with_suffix(cache_path.suffix + ".tmp")
        try:
            with tmp_path.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        handle.write(chunk)
            tmp_path.replace(cache_path)
            return cache_path.read_text(encoding="utf-8-sig")
        except OSError as exc:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise DatamineError(f"Failed to cache Datamine file: {path}: {exc}") from exc


def parse_datamine_loadout(
    aircraft: str,
    *,
    source: Optional[DatamineSource] = None,
) -> Dict[str, Any]:
    unit_id = str(aircraft or "").strip().lower()
    if not unit_id:
        raise DatamineError("aircraft is required")
    if not re.fullmatch(r"[a-z0-9_-]+", unit_id):
        raise DatamineNotFound(
            f"Invalid aircraft ID '{aircraft}'. Use the exact Datamine ID, for example f_15e or su_34."
        )

    source = source or DatamineSource()
    flight_path = f"aces.vromfs.bin_u/gamedata/flightmodels/{unit_id.lower()}.blkx"
    flight_model = source.read_json(flight_path)
    weapon_slots = flight_model.get("WeaponSlots")
    if not isinstance(weapon_slots, dict):
        raise DatamineError(f"No WeaponSlots found for {unit_id}")

    wpcost = source.read_json("char.vromfs.bin_u/config/wpcost.blkx")
    unit_cost = wpcost.get(unit_id)
    if not isinstance(unit_cost, dict):
        raise DatamineError(f"No wpcost entry found for {unit_id}")
    wpcost_weapons = unit_cost.get("weapons")
    if not isinstance(wpcost_weapons, dict):
        raise DatamineError(f"No wpcost weapons found for {unit_id}")

    warpoints = source.read_json("char.vromfs.bin_u/config/warpoints.blkx")
    reward_profile = _build_bombing_reward_profile(unit_cost, warpoints)

    localizer = _load_weapon_localizer(source)
    explosive_data = _load_explosive_data(source)
    explosive_types = explosive_data["types"]
    damage_curve = explosive_data["damage_curve"]
    custom_map = _parse_custom_preset_map(wpcost_weapons.get("custom_presets"))

    slots = sorted(
        [slot for slot in _as_list(weapon_slots.get("WeaponSlot")) if isinstance(slot, dict)],
        key=lambda slot: int(slot.get("index") or 0),
    )
    if not slots:
        raise DatamineError(f"No weapon slots found for {unit_id}")

    # Keep non-damaging pods when a weapon explicitly depends on them.
    required_presets = set()
    for slot in slots:
        for preset in _as_list(slot.get("WeaponPreset")):
            if isinstance(preset, dict):
                for dependency in _as_list(preset.get("DependentWeaponPreset")):
                    if isinstance(dependency, dict):
                        required_presets.add((dependency.get("slot"), dependency.get("preset")))

    # Warm the disk cache for all first-level weapon references. This keeps a
    # remote Datamine source usable without turning one aircraft load into a
    # long serial chain of small GitHub requests.
    first_level_paths = []
    for slot in slots:
        for preset in _as_list(slot.get("WeaponPreset")):
            if not isinstance(preset, dict):
                continue
            for weapon in _as_list(preset.get("Weapon")):
                if isinstance(weapon, dict) and weapon.get("blk"):
                    first_level_paths.append(_aces_repo_path(str(weapon["blk"])))
    source.prefetch(first_level_paths)

    weapons: List[Dict[str, Any]] = []
    for slot in slots:
        slot_index = _positive_int(slot.get("index"), 0)
        if slot_index <= 0:
            continue
        for preset in _as_list(slot.get("WeaponPreset")):
            if not isinstance(preset, dict):
                continue
            option = _build_option(
                unit_id,
                slot_index,
                preset,
                source=source,
                localizer=localizer,
                explosive_types=explosive_types,
                damage_curve=damage_curve,
                wpcost_weapons=wpcost_weapons,
                custom_map=custom_map,
                required_presets=required_presets,
            )
            if option is not None:
                weapons.append(option)

    if not weapons:
        raise DatamineError(f"No suspended-armament options found for {unit_id}")

    slot_count = max(int(slot.get("index") or 0) for slot in slots)
    pylons = _build_pylons(slot_count, weapons)
    return {
        "aircraft": unit_id,
        "reward_profile": reward_profile,
        "weapons": weapons,
        "pylons": pylons,
    }



def _related_option_ids(unit_id: str, preset: Mapping[str, Any], field: str) -> List[str]:
    result = []
    for entry in _as_list(preset.get(field)):
        if not isinstance(entry, dict):
            continue
        slot, name = entry.get("slot"), entry.get("preset")
        if isinstance(slot, int) and slot > 0 and isinstance(name, str) and name:
            result.append(f"datamine:{unit_id}:{slot}:{name}")
    return result


def _build_option(
    unit_id: str,
    slot_index: int,
    preset: Mapping[str, Any],
    *,
    source: DatamineSource,
    localizer: Mapping[str, str],
    explosive_types: Mapping[str, Any],
    damage_curve: Sequence[Tuple[float, float]],
    wpcost_weapons: Mapping[str, Any],
    custom_map: Mapping[Tuple[int, str], Mapping[str, int]],
    required_presets: set[Tuple[int, str]],
) -> Optional[Dict[str, Any]]:
    preset_name = str(preset.get("name") or "").strip()
    if not preset_name:
        return None
    required_ids = _related_option_ids(unit_id, preset, "DependentWeaponPreset")
    banned_ids = _related_option_ids(unit_id, preset, "BannedWeaponPreset")
    relations = {
        **({"required_option_ids": required_ids} if required_ids else {}),
        **({"banned_option_ids": banned_ids} if banned_ids else {}),
    }
    raw_weapons = [weapon for weapon in _as_list(preset.get("Weapon")) if isinstance(weapon, dict)]
    if not raw_weapons:
        return None

    leaves: List[LeafWeapon] = []
    for weapon in raw_weapons:
        blk = weapon.get("blk")
        if not blk:
            continue
        trigger = str(weapon.get("trigger") or "").strip().lower()
        edit_preset_chapter = str(weapon.get("editPresetChapter") or "").strip().lower()
        multiplier = _positive_int(weapon.get("bullets"), 1)
        leaves.extend(
            _resolve_leaf_weapons(
                source,
                str(blk),
                multiplier=multiplier,
                trigger=trigger,
                edit_preset_chapter=edit_preset_chapter,
                seen=(),
            )
        )
    leaves = _aggregate_leaves(leaves)
    if not leaves:
        return None

    identity_leaves = [leaf for leaf in leaves if _is_payload_leaf(leaf)]
    if not identity_leaves:
        if (slot_index, preset_name) not in required_presets:
            return None
        mass = _leaf_total_mass(leaves)
        return {
            "option_id": f"datamine:{unit_id}:{slot_index}:{preset_name}",
            "weapon_id": preset_name,
            "weapon_display_name": _humanize_id(preset_name),
            "count": 1,
            "slots": [slot_index],
            "weight_kg": mass,
            "damage": 0.0,
            "counted_base_damage": 0.0,
            "weapon_category": "other",
            "support": True,
            "icon_type": preset.get("iconType"),
            **relations,
        }
    total_count = sum(max(leaf.count, 0) for leaf in identity_leaves)
    total_count = max(total_count, 1)

    weapon_ids = sorted({leaf.weapon_id for leaf in identity_leaves})
    weapon_id = weapon_ids[0] if len(weapon_ids) == 1 else "+".join(weapon_ids)
    names = []
    localized_count = 0
    for weapon_name in weapon_ids:
        localized = (
            localizer.get(f"weapons/{weapon_name}/short")
            or localizer.get(f"weapons/{weapon_name}")
        )
        if localized:
            localized_count += 1
        name = localized or _humanize_id(weapon_name)
        if name not in names:
            names.append(name)
    display_name = " + ".join(names) if names else _humanize_id(weapon_id)
    if len(weapon_ids) == 1 and localized_count == 0:
        preset_base = _candidate_preset_keys(preset_name)[-1]
        preset_label = _humanize_id(preset_base)
        if any(ch.isdigit() for ch in preset_label) and len(preset_label) < len(display_name):
            display_name = preset_label

    classification = _classify_weapon(identity_leaves)
    official_map = custom_map.get((slot_index, preset_name), {})

    counted_base_damage = _official_counted_damage(official_map, wpcost_weapons)

    # Prefer complete official weaponDamage values; estimate only as a fallback.
    damage = _official_mapped_damage(official_map, identity_leaves, wpcost_weapons)
    if damage is None:
        damage = _official_leaf_damage(identity_leaves, wpcost_weapons)
    if damage is None:
        damage = _official_preset_damage(preset_name, wpcost_weapons)
    if damage is None:
        damage = _formula_damage_summary(identity_leaves, explosive_types, damage_curve)
    weight_kg = _official_mapped_mass(official_map, wpcost_weapons)
    if weight_kg is None:
        weight_kg = _leaf_total_mass(identity_leaves)

    damage_per_unit: Optional[float]
    if isinstance(damage, (int, float)) and total_count > 0:
        damage_per_unit = float(damage) / total_count
    else:
        damage_per_unit = None

    option_id = f"datamine:{unit_id}:{slot_index}:{preset_name}"
    option = {
        "option_id": option_id,
        "weapon_id": weapon_id,
        "weapon_display_name": display_name,
        "count": total_count,
        "slots": [slot_index],
        "weight_kg": round(weight_kg, 3) if isinstance(weight_kg, (int, float)) else None,
        "base_damage_per_unit": damage_per_unit,
        "damage": float(damage) if isinstance(damage, (int, float)) else None,
        "counted_base_damage": float(counted_base_damage),
        "icon_type": preset.get("iconType"),
        **classification,
        **relations,
    }
    return option


def _resolve_leaf_weapons(
    source: DatamineSource,
    blk_path: str,
    *,
    multiplier: int,
    trigger: str,
    edit_preset_chapter: str,
    seen: Sequence[str],
) -> List[LeafWeapon]:
    repo_path = _aces_repo_path(blk_path)
    if repo_path in seen:
        raise DatamineError(f"Recursive weapon container reference: {repo_path}")
    try:
        data = source.read_json(repo_path)
    except DatamineError:
        # Keep the option usable even when an ancillary weapon file is missing.
        return [
            LeafWeapon(
                path=repo_path,
                weapon_id=Path(repo_path).stem,
                count=max(multiplier, 1),
                trigger=trigger,
                edit_preset_chapter=edit_preset_chapter,
                data={},
            )
        ]

    inner_blk = data.get("blk") if isinstance(data, dict) else None
    is_container = bool(isinstance(data, dict) and (data.get("container") or (inner_blk and not data.get("bomb") and not data.get("rocket"))))
    if is_container and inner_blk:
        inner_count = _positive_int(data.get("bullets"), _positive_int(data.get("amountPerTier"), 1))
        return _resolve_leaf_weapons(
            source,
            str(inner_blk),
            multiplier=max(multiplier, 1) * max(inner_count, 1),
            trigger=trigger,
            edit_preset_chapter=edit_preset_chapter,
            seen=(*seen, repo_path),
        )

    weapon_data = data if isinstance(data, dict) else {}
    payload = _payload_block(weapon_data)
    bullet_name = str(payload.get("bulletName") or weapon_data.get("bulletName") or "").strip()
    return [
        LeafWeapon(
            path=repo_path,
            weapon_id=bullet_name or Path(repo_path).stem,
            count=max(multiplier, 1),
            trigger=trigger,
            edit_preset_chapter=edit_preset_chapter,
            data=weapon_data,
        )
    ]


def _aggregate_leaves(leaves: Sequence[LeafWeapon]) -> List[LeafWeapon]:
    aggregated: Dict[Tuple[str, str, str], LeafWeapon] = {}
    for leaf in leaves:
        key = (leaf.path, leaf.trigger, leaf.edit_preset_chapter)
        previous = aggregated.get(key)
        if previous is None:
            aggregated[key] = leaf
        else:
            aggregated[key] = LeafWeapon(
                path=leaf.path,
                weapon_id=leaf.weapon_id,
                count=previous.count + leaf.count,
                trigger=leaf.trigger,
                edit_preset_chapter=leaf.edit_preset_chapter,
                data=leaf.data or previous.data,
            )
    return list(aggregated.values())


def _parse_custom_preset_map(value: Any) -> Dict[Tuple[int, str], Dict[str, int]]:
    result: Dict[Tuple[int, str], Dict[str, int]] = {}
    if not isinstance(value, dict):
        return result
    for slot in _as_list(value.get("slot")):
        if not isinstance(slot, dict):
            continue
        slot_index = _positive_int(slot.get("index"), 0)
        if slot_index <= 0:
            continue
        for preset_name, mapping in slot.items():
            if preset_name == "index" or not isinstance(mapping, dict):
                continue
            clean: Dict[str, int] = {}
            for weapon_key, amount in mapping.items():
                if weapon_key == "BannedWeaponPreset":
                    continue
                if isinstance(amount, (int, float)) and amount > 0:
                    clean[str(weapon_key)] = int(amount)
            result[(slot_index, str(preset_name))] = clean
    return result


def _official_counted_damage(
    mapping: Mapping[str, int],
    wpcost_weapons: Mapping[str, Any],
) -> float:
    """Mirror the game's getWeaponDamage() calculation for custom presets."""
    # getBasesEstimatedDamageRewardArray() takes only the first parameter
    # from each custom-preset block before calling getWeaponDamage().
    for weapon_key, amount in mapping.items():
        info = wpcost_weapons.get(weapon_key)
        value = info.get("weaponDamage") if isinstance(info, dict) else None
        if isinstance(value, (int, float)) and value > 0:
            return float(value) * max(int(amount), 0)
        return 0.0
    return 0.0


def _official_mapped_damage(
    mapping: Mapping[str, int],
    leaves: Sequence[LeafWeapon],
    wpcost_weapons: Mapping[str, Any],
) -> Optional[float]:
    if not mapping:
        return None

    # custom_presets may omit payloads, so require an exact count match.
    matched_counts: Dict[str, int] = {}
    for leaf in leaves:
        key = next((key for key in _candidate_wpcost_keys_for_leaf(leaf) if key in mapping), None)
        if key is None:
            return None
        matched_counts[key] = matched_counts.get(key, 0) + leaf.count
    if matched_counts != mapping:
        return None

    total = 0.0
    for key, count in mapping.items():
        info = wpcost_weapons.get(key)
        value = info.get("weaponDamage") if isinstance(info, dict) else None
        if not isinstance(value, (int, float)) or value <= 0:
            return None
        total += float(value) * count
    return total


def _official_preset_damage(preset_name: str, wpcost_weapons: Mapping[str, Any]) -> Optional[float]:
    for key in _candidate_preset_keys(preset_name):
        info = wpcost_weapons.get(key)
        value = info.get("weaponDamage") if isinstance(info, dict) else None
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
    return None


def _official_leaf_damage(leaves: Sequence[LeafWeapon], wpcost_weapons: Mapping[str, Any]) -> Optional[float]:
    if not leaves:
        return None
    total = 0.0
    for leaf in leaves:
        value = None
        for key in _candidate_wpcost_keys_for_leaf(leaf):
            info = wpcost_weapons.get(key)
            candidate = info.get("weaponDamage") if isinstance(info, dict) else None
            if isinstance(candidate, (int, float)) and candidate > 0:
                value = float(candidate)
                break
        if value is None:
            return None
        total += value * max(leaf.count, 1)
    return total


def _candidate_preset_keys(preset_name: str) -> List[str]:
    keys = [preset_name]
    stripped = re.sub(r"_slot\d+(?:_x\d+)?$", "", preset_name)
    stripped = re.sub(r"_x\d+_slot\d+$", "", stripped)
    if stripped and stripped not in keys:
        keys.append(stripped)
    return keys


def _candidate_wpcost_keys_for_leaf(leaf: LeafWeapon) -> List[str]:
    keys = [
        _wpcost_key_from_repo_path(leaf.path),
        leaf.weapon_id,
        Path(leaf.path).stem,
    ]
    return list(dict.fromkeys(key for key in keys if key))


def _official_mapped_mass(mapping: Mapping[str, int], wpcost_weapons: Mapping[str, Any]) -> Optional[float]:
    if not mapping:
        return None
    total = 0.0
    found = False
    for weapon_key, amount in mapping.items():
        info = wpcost_weapons.get(weapon_key)
        if not isinstance(info, dict):
            continue
        mass = next((info.get(field) for field in MASS_FIELDS if isinstance(info.get(field), (int, float))), None)
        if isinstance(mass, (int, float)):
            total += float(mass) * max(int(amount), 0)
            found = True
    return total if found else None


def _leaf_total_mass(leaves: Sequence[LeafWeapon]) -> Optional[float]:
    total = 0.0
    found = False
    for leaf in leaves:
        block = _payload_block(leaf.data)
        mass = block.get("mass") if isinstance(block, dict) else None
        if isinstance(mass, (int, float)):
            total += float(mass) * max(leaf.count, 1)
            found = True
    return total if found else None


def _leaf_explosive_info(
    leaf: LeafWeapon,
    explosive_types: Mapping[str, Any],
) -> Optional[Dict[str, Any]]:
    block = _payload_block(leaf.data)
    if not isinstance(block, dict):
        return None

    explosive_mass = block.get("explosiveMass")
    explosive_type = str(block.get("explosiveType") or "").strip()
    if not isinstance(explosive_mass, (int, float)) or explosive_mass <= 0:
        return None

    if not explosive_type or explosive_type == "tnt":
        strength = 1.0
        normalized_type = explosive_type or "tnt"
    else:
        info = explosive_types.get(explosive_type)
        strength = info.get("strengthEquivalent") if isinstance(info, dict) else None
        if not isinstance(strength, (int, float)) or strength <= 0:
            return None
        normalized_type = explosive_type

    mass = float(explosive_mass)
    strength_value = float(strength)
    return {
        "explosive_mass_kg": mass,
        "explosive_type": normalized_type,
        "strength_equivalent": strength_value,
        "tnt_equivalent_kg": mass * strength_value,
    }


def _formula_damage_summary(
    leaves: Sequence[LeafWeapon],
    explosive_types: Mapping[str, Any],
    damage_curve: Sequence[Tuple[float, float]],
) -> Optional[float]:
    if not leaves or not damage_curve:
        return None

    total = 0.0
    for leaf in leaves:
        info = _leaf_explosive_info(leaf, explosive_types)
        if info is None:
            return None
        per_unit = _interpolate_curve(float(info["tnt_equivalent_kg"]), damage_curve)
        if per_unit is None:
            return None
        total += per_unit * max(leaf.count, 1)
    return total


def _interpolate_curve(
    value: float,
    points: Sequence[Tuple[float, float]],
) -> Optional[float]:
    if not points or value <= 0:
        return None
    ordered = sorted(points)
    if value <= ordered[0][0]:
        return ordered[0][1]
    for (x0, y0), (x1, y1) in zip(ordered, ordered[1:]):
        if value <= x1:
            if x1 == x0:
                return y1
            ratio = (value - x0) / (x1 - x0)
            return y0 + (y1 - y0) * ratio
    return ordered[-1][1]


def _parse_curve(value: Any) -> List[Tuple[float, float]]:
    if not isinstance(value, dict):
        return []
    points: List[Tuple[float, float]] = []
    for pair in value.values():
        if not isinstance(pair, list) or len(pair) < 2:
            continue
        x, y = pair[0], pair[1]
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            points.append((float(x), float(y)))
    return sorted(set(points))

def _payload_block(data: Mapping[str, Any]) -> Mapping[str, Any]:
    for key in ("bomb", "rocket", "bullet"):
        value = data.get(key)
        if isinstance(value, dict):
            return value
    return data


def _normalize_chapter(value: str) -> str:
    chapter = str(value or "").strip().lower().replace("_", " ")
    aliases = {
        "agm": "atgm",
        "guided bomb": "guided bombs",
        "fuel tank": "fuel tanks",
    }
    return aliases.get(chapter, chapter)


def _effective_chapter(leaf: LeafWeapon) -> str:
    return _normalize_chapter(leaf.edit_preset_chapter or leaf.trigger)


def _radar_seeker(leaf: LeafWeapon) -> Mapping[str, Any]:
    payload = _payload_block(leaf.data)
    guidance = payload.get("guidance") if isinstance(payload, dict) else None
    if not isinstance(guidance, dict) and isinstance(leaf.data, dict):
        guidance = leaf.data.get("guidance")
    seeker = guidance.get("radarSeeker") if isinstance(guidance, dict) else None
    return seeker if isinstance(seeker, dict) else {}


def _is_anti_radiation_missile(leaves: Sequence[LeafWeapon]) -> bool:
    return any(
        str(_radar_seeker(leaf).get("targetSignatureType") or "").strip().lower() == "radarintercept"
        for leaf in leaves
    )


def _is_anti_ship_missile(leaves: Sequence[LeafWeapon]) -> bool:
    for leaf in leaves:
        seeker = _radar_seeker(leaf)
        if not seeker:
            continue
        signature = str(seeker.get("targetSignatureType") or "").strip().lower()
        if signature == "radarintercept":
            continue
        if seeker.get("active") is True and seeker.get("aircraftAsTarget") is False:
            return True
    return False


def _mapping_has_value(value: Any, key: str, predicate) -> bool:
    if isinstance(value, dict):
        for current_key, current_value in value.items():
            if str(current_key).lower() == key.lower() and predicate(current_value):
                return True
            if _mapping_has_value(current_value, key, predicate):
                return True
    elif isinstance(value, list):
        return any(_mapping_has_value(item, key, predicate) for item in value)
    return False


def _is_special_bomb(leaves: Sequence[LeafWeapon]) -> bool:
    for leaf in leaves:
        data = leaf.data
        if _mapping_has_value(data, "isDepthCharge", lambda value: value is True):
            return True
        if _mapping_has_value(data, "nukePower", lambda value: isinstance(value, (int, float)) and value > 0):
            return True
        if _mapping_has_value(
            data,
            "damageType",
            lambda value: isinstance(value, str) and value.strip().lower() == "napalm",
        ):
            return True
    return False


def _leaf_icon_type(leaf: LeafWeapon) -> str:
    payload = _payload_block(leaf.data)
    value = payload.get("iconType") if isinstance(payload, dict) else None
    if not value and isinstance(leaf.data, dict):
        value = leaf.data.get("iconType")
    return str(value or "").strip().lower()


def _is_high_drag_bomb(leaves: Sequence[LeafWeapon]) -> bool:
    # editPresetChapter/trigger only identify the bomb chapter; the game's
    # high-drag display class is carried by the projectile iconType.  Keep
    # this one narrowly-scoped exception instead of using iconType for the
    # primary category.
    return any("high_drag" in _leaf_icon_type(leaf) for leaf in leaves)


def _classify_weapon(leaves: Sequence[LeafWeapon]) -> Dict[str, Any]:
    chapters = {_effective_chapter(leaf) for leaf in leaves if _effective_chapter(leaf)}
    primary_categories = set()
    for chapter in chapters:
        if chapter in {"aam", "atgm"}:
            primary_categories.add("missile")
        elif chapter in {"bombs", "guided bombs"}:
            primary_categories.add("bomb")
        elif chapter == "rockets":
            primary_categories.add("rocket")
        else:
            primary_categories.add("other")

    category = next(iter(primary_categories)) if len(primary_categories) == 1 else "other"
    subcategory: Optional[str] = None

    if category == "missile":
        if chapters == {"aam"}:
            subcategory = "air_to_air"
        elif _is_anti_radiation_missile(leaves):
            subcategory = "anti_radiation"
        elif _is_anti_ship_missile(leaves):
            subcategory = "anti_ship"
        else:
            subcategory = "air_to_ground"
    elif category == "bomb":
        if "guided bombs" in chapters:
            subcategory = "guided_bomb"
        elif _is_high_drag_bomb(leaves):
            subcategory = "high_drag_bomb"
        elif _is_special_bomb(leaves):
            subcategory = "other_bomb"
        else:
            subcategory = "general_bomb"

    return {
        "weapon_category": category,
        "weapon_subcategory": subcategory,
    }


def _is_payload_leaf(leaf: LeafWeapon) -> bool:
    trigger = leaf.trigger.lower()
    path = leaf.path.lower()
    if trigger in {"fuel tanks", "countermeasures", "cannon", "guns"}:
        return False
    if "/equipment/" in path or "/drop_tank/" in path or path.endswith("/dummy_weapon.blkx"):
        return False
    return True


def _load_explosive_data(source: DatamineSource) -> Dict[str, Any]:
    data = source.read_json("aces.vromfs.bin_u/gamedata/damage_model/explosive.blkx")
    if not isinstance(data, dict):
        return {"types": {}, "damage_curve": []}
    types = data.get("explosiveTypes")
    splash = data.get("explosiveTypeToSplashParams")
    curve = splash.get("explosiveMassToDamage") if isinstance(splash, dict) else None
    return {
        "types": types if isinstance(types, dict) else {},
        "damage_curve": _parse_curve(curve),
    }


def _load_weapon_localizer(source: DatamineSource) -> Dict[str, str]:
    try:
        text = source.read_text("lang.vromfs.bin_u/lang/units_weaponry.csv")
    except DatamineError:
        return {}
    result: Dict[str, str] = {}
    reader = csv.reader(io.StringIO(text), delimiter=";")
    for row in reader:
        if len(row) < 2:
            continue
        key = str(row[0] or "").strip()
        english = str(row[1] or "").strip()
        if key and english:
            result[key] = english
    return result



def _build_bombing_reward_profile(
    unit_cost: Mapping[str, Any],
    warpoints: Mapping[str, Any],
) -> Dict[str, Any]:
    block = warpoints.get("BombingRewardMultipliers")
    if not isinstance(block, dict):
        raise DatamineError("BombingRewardMultipliers missing from warpoints")

    table = block.get("piecewiseLinearTable")
    points_raw = table.get("v") if isinstance(table, dict) else None
    points: List[List[float]] = []
    for point in _as_list(points_raw):
        if (
            isinstance(point, list)
            and len(point) >= 2
            and isinstance(point[0], (int, float))
            and isinstance(point[1], (int, float))
        ):
            points.append([float(point[0]), float(point[1])])
    points.sort(key=lambda point: point[0])
    if not points:
        raise DatamineError("BombingRewardMultipliers.piecewiseLinearTable is empty")

    def required_number(name: str) -> float:
        value = block.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise DatamineError(f"BombingRewardMultipliers.{name} missing or invalid")
        return float(value)

    preset_dmg_min = required_number("presetDmgMin")
    preset_dmg_max = required_number("presetDmgMax")
    bombing_reward_modifier = required_number("bombingRewardModifier")
    fighter_bombing_reward_mul = required_number("fighterBombingRewardMul")
    prem_bombing_reward_mul = required_number("premBombingRewardMul")
    span = preset_dmg_max - preset_dmg_min
    if (
        preset_dmg_min <= 1
        or span <= 0
        or bombing_reward_modifier <= 1
        or fighter_bombing_reward_mul <= 0
        or prem_bombing_reward_mul <= 0
    ):
        raise DatamineError("Invalid BombingRewardMultipliers parameters")
    modifier_delta = bombing_reward_modifier - 1.0

    return {
        "is_fighter": unit_cost.get("unitClass") == "exp_fighter",
        "is_premium": unit_cost.get("costGold") is not None,
        "fighter_bombing_reward_mul": fighter_bombing_reward_mul,
        "prem_bombing_reward_mul": prem_bombing_reward_mul,
        # Algebraically reduced once at load time:
        # presetDmgScale * presetDmgMin / D == constant + inverseDamage / D.
        "low_reward_constant": preset_dmg_min * modifier_delta / span,
        "low_reward_inverse_damage": preset_dmg_min * (1.0 - modifier_delta * preset_dmg_min / span),
        "piecewise_linear_table": points,
    }

def _humanize_id(value: str) -> str:
    text = re.sub(r"^(?:su|us|fr|uk|ger|jp|cn|it|swd|il)_", "", value, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text.replace("_", " ")).strip().upper()
    if not text:
        return value
    # Keep common weapon designations recognizable when no localization key
    # exists (AGM-130 is one current Datamine example).
    text = re.sub(r"\b(AGM|AIM|GBU|KH|KAB|FAB|S|R)\s+(?=\d)", r"\1-", text)
    return text


def _aces_repo_path(blk_path: str) -> str:
    path = str(blk_path or "").strip().replace("\\", "/").lstrip("/")
    if path.lower().startswith("aces.vromfs.bin_u/"):
        result = path
    else:
        result = f"aces.vromfs.bin_u/{path}"
    if result.lower().endswith(".blk"):
        result = result[:-4] + ".blkx"
    # Datamine paths are normalized to lowercase in the repository even when
    # the in-game BLK reference uses GameData/Weapons/BombGuns casing.
    return result.lower()


def _wpcost_key_from_repo_path(repo_path: str) -> str:
    path = _normalize_repo_path(repo_path).lower()
    prefix = "aces.vromfs.bin_u/gamedata/weapons/"
    if path.startswith(prefix):
        path = path[len(prefix):]
    path = re.sub(r"\.blkx?$", "", path)
    return path.replace("/", "_")


def _normalize_repo_path(path: str) -> str:
    return str(path or "").strip().replace("\\", "/").lstrip("/")


def _as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _positive_int(value: Any, fallback: int) -> int:
    if isinstance(value, bool):
        return fallback
    if isinstance(value, (int, float)) and value > 0:
        return int(value)
    try:
        parsed = int(str(value))
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def _build_pylons(slot_count: int, weapons: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    pylons = [{"slot": slot, "options": []} for slot in range(1, slot_count + 1)]
    for weapon in weapons:
        option_id = str(weapon.get("option_id") or "")
        if not option_id:
            continue
        for slot in weapon.get("slots", []):
            if isinstance(slot, int) and 1 <= slot <= slot_count:
                pylons[slot - 1]["options"].append({"option_id": option_id})
    return pylons

