import csv
import json
import tempfile
import unittest
from pathlib import Path

from build_static_data import aircraft_names, write_aircraft_index


class AircraftIndexTest(unittest.TestCase):
    def test_shop_name_precedence_and_language_fallback(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            folder = root / "lang.vromfs.bin_u/lang"
            folder.mkdir(parents=True)
            with (folder / "units.csv").open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle, delimiter=";")
                writer.writerow(["<ID|readonly|noverify>", "<English>", "<Chinese>"])
                writer.writerow(["su_34_shop", "Su-34", "苏\t-34"])
                writer.writerow(["su_34_0", "Sukhoi Su-34", "苏-34 完整名称"])
                writer.writerow(["f_15e_0", "F-15E Strike Eagle", ""])
            names = aircraft_names(root)
            self.assertEqual(names["su_34"], ("苏-34", "Su-34"))
            self.assertEqual(names["f_15e"], ("", "F-15E Strike Eagle"))

    def test_index_uses_only_generated_aircraft_data(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "su_34.json").write_text("{}", encoding="utf-8")
            (root / "f_15e.json").write_text("{}", encoding="utf-8")
            write_aircraft_index(root, None)
            catalog = json.loads((root / "aircraft-index.json").read_text(encoding="utf-8"))
            self.assertEqual([entry["id"] for entry in catalog], ["f_15e", "su_34"])
            self.assertEqual(catalog[0]["en"], "")
            write_aircraft_index(root, None)
            self.assertEqual(len(json.loads((root / "aircraft-index.json").read_text())), 2)


if __name__ == "__main__":
    unittest.main()
