import csv
import json
import tempfile
import unittest
from pathlib import Path

from build_static_data import aircraft_names, aircraft_nation, write_aircraft_index


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
                writer.writerow(["f_15e_shop", "F-15E", "F-15E"])
            output = root / "output"
            output.mkdir()
            for unit_id in ("f_16a_block_72v_china", "f_15e"):
                (output / f"{unit_id}.json").write_text("{}", encoding="utf-8")
            write_aircraft_index(output, root, {
                "f_16a_block_72v_china": {"country": "country_china"},
                "f_15e": {"country": "country_usa"},
            })
            index = {item["id"]: item for item in json.loads((output / "aircraft-index.json").read_text(encoding="utf-8"))}
            self.assertEqual(index["f_16a_block_72v_china"]["zh"], "F-16V")
            self.assertEqual(index["f_16a_block_72v_china"]["en"], "F-16V")
            self.assertEqual(index["f_16a_block_72v_china"]["nation"], "china")
            self.assertEqual(index["f_15e"]["nation"], "usa")

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
