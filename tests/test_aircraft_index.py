import csv
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from build_static_data import (
    AIRCRAFT_NAME_MARKERS, aircraft_names, aircraft_nation,
    clean_aircraft_name, optimize_pylon_icon, write_aircraft_index,
)


class AircraftIndexTest(unittest.TestCase):
    def test_shop_name_precedence_and_language_fallback(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            folder = root / "lang.vromfs.bin_u/lang"
            folder.mkdir(parents=True)
            with (folder / "units.csv").open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle, delimiter=";")
                writer.writerow(["<ID|readonly|noverify>", "<English>", "<Chinese>"])
                writer.writerow(["su_34_shop", "\u2417Su-34", "\u2417\u200b苏\t-34"])
                writer.writerow(["su_34_0", "Sukhoi Su-34", "苏-34 完整名称"])
                writer.writerow(["f_15e_0", "F-15E Strike Eagle", ""])
            names = aircraft_names(root)
            self.assertEqual(names["su_34"], ("苏-34", "Su-34"))
            self.assertEqual(names["f_15e"], ("", "F-15E Strike Eagle"))

    def test_all_datamine_name_markers_are_removed(self):
        for marker in AIRCRAFT_NAME_MARKERS:
            with self.subTest(marker=hex(ord(marker))):
                self.assertEqual(clean_aircraft_name(f"{marker}\u200bF-16V"), "F-16V")
        self.assertEqual(clean_aircraft_name("Weizman's \uf059Spitfire"), "Weizman's Spitfire")
        self.assertEqual(clean_aircraft_name("F-86F-30 \u2585"), "F-86F-30")
        self.assertEqual(clean_aircraft_name("AV-8B+\u00a0 8×8"), "AV-8B+ 8×8")

    def test_nation_from_wpcost(self):
        self.assertEqual(aircraft_nation({"country": "country_china"}), "china")
        self.assertEqual(aircraft_nation({"country": "country_usa"}), "usa")
        self.assertIsNone(aircraft_nation({"country": "unexpected"}))
        self.assertIsNone(aircraft_nation({}))

    def test_index_has_correct_nations_and_clean_names(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            folder = root / "lang.vromfs.bin_u/lang"
            folder.mkdir(parents=True)
            with (folder / "units.csv").open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle, delimiter=";")
                writer.writerow(["<ID>", "<English>", "<Chinese>"])
                writer.writerow(["f_16a_block_72v_china_shop", "\u2417F-16V", "\u2417\u200bF-16V"])
                writer.writerow(["p_47m_shop", "\u22e0P-47M-1-RE", "\u22e0\u200bP-47M-1-RE"])
                writer.writerow(["f_15e_shop", "F-15E", "F-15E"])
            output = root / "output"
            output.mkdir()
            for unit_id in ("f_16a_block_72v_china", "f_15e", "p_47m"):
                (output / f"{unit_id}.json").write_text("{}", encoding="utf-8")
            write_aircraft_index(output, root, {
                "f_16a_block_72v_china": {"country": "country_china"},
                "f_15e": {"country": "country_usa"},
                "p_47m": {"country": "country_usa"},
            })
            index = {item["id"]: item for item in json.loads((output / "aircraft-index.json").read_text(encoding="utf-8"))}
            self.assertEqual(index["f_16a_block_72v_china"]["zh"], "F-16V")
            self.assertEqual(index["f_16a_block_72v_china"]["en"], "F-16V")
            self.assertEqual(index["f_16a_block_72v_china"]["nation"], "china")
            self.assertEqual(index["f_15e"]["nation"], "usa")
            self.assertEqual(index["p_47m"]["zh"], "P-47M-1-RE")

    def test_lossless_webp_preserves_resolution_and_rgba(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source.png"
            destination = root / "icon.webp"
            image = Image.new("RGBA", (160, 120), (25, 47, 68, 0))
            for x in range(40, 120):
                for y in range(30, 90):
                    image.putpixel((x, y), (255, 50, 10, 255))
            image.putpixel((8, 9), (33, 55, 77, 128))
            image.save(source)

            source_size, output_size = optimize_pylon_icon(source, destination)
            self.assertEqual(source_size, source.stat().st_size)
            self.assertEqual(output_size, destination.stat().st_size)
            self.assertFalse((root / "icon.png").exists())
            with Image.open(destination) as optimized:
                self.assertEqual(optimized.format, "WEBP")
                self.assertEqual(optimized.size, (160, 120))
                self.assertEqual(optimized.convert("RGBA").tobytes(), image.tobytes())

    def test_index_uses_only_generated_aircraft_data(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "su_34.json").write_text("{}", encoding="utf-8")
            (root / "f_15e.json").write_text("{}", encoding="utf-8")
            write_aircraft_index(root, None)
            catalog = json.loads((root / "aircraft-index.json").read_text(encoding="utf-8"))
            self.assertEqual([entry["id"] for entry in catalog], ["f_15e", "su_34"])
            self.assertEqual(catalog[0]["en"], "")
            self.assertIsNone(catalog[0]["nation"])
            write_aircraft_index(root, None)
            self.assertEqual(len(json.loads((root / "aircraft-index.json").read_text())), 2)


if __name__ == "__main__":
    unittest.main()
