#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Clone only the Datamine paths required for aircraft loadout generation.
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
datamine_root="$work_dir/War-Thunder-Datamine"

git clone --quiet --depth=1 --filter=blob:none --sparse \
  https://github.com/gszabi99/War-Thunder-Datamine.git "$datamine_root"

git -C "$datamine_root" sparse-checkout set --no-cone \
  "aces.vromfs.bin_u/gamedata/flightmodels" \
  "aces.vromfs.bin_u/gamedata/weapons" \
  "aces.vromfs.bin_u/gamedata/damage_model/explosive.blkx" \
  "char.vromfs.bin_u/config/wpcost.blkx" \
  "char.vromfs.bin_u/config/warpoints.blkx" \
  "lang.vromfs.bin_u/lang/units_weaponry.csv"

python -m pip install -r requirements.txt
python build_static_data.py --all --clean --datamine-root "$datamine_root"

npm --prefix frontend install
npm --prefix frontend run typecheck
npm --prefix frontend run build

test -f dist/index.html
