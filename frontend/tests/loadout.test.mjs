import assert from "node:assert/strict";
import {test} from "node:test";
import {loadoutText, weaponTypeCount} from "../src/domain/loadout.ts";

test("counts distinct weapons, excluding support stores", () => {
  const solution = {selections: [
    {option_id: "a1", weapon_id: "FAB-500", weapon_display_name: "FAB-500", count: 1},
    {option_id: "a2", weapon_id: "FAB-500", weapon_display_name: "FAB-500", count: 2},
    {option_id: "b", weapon_id: "R-73", weapon_display_name: "R-73", count: 1},
    {option_id: "pod", weapon_id: "POD", weapon_display_name: "POD", count: 1, support: true},
  ], weapon_counts: {"FAB-500": 3, "R-73": 1, "POD": 1}};
  assert.equal(weaponTypeCount(solution), 2);
  assert.equal(loadoutText(solution), "FAB-500 ×3 · POD · R-73");
});

test("empty or legacy solutions display gracefully", () => {
  assert.equal(weaponTypeCount({selections: []}), 0);
  assert.equal(loadoutText({selections: []}), "无挂载");
  assert.equal(weaponTypeCount({weapon_counts: {A: 2, B: 1}}), 2);
  assert.equal(loadoutText({weapon_counts: {A: 2, B: 1}}), "A ×2 · B");
});
