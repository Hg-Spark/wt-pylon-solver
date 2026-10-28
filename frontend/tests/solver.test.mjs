import assert from "node:assert/strict";
import {test} from "node:test";
import {solvePylonLoadout} from "../src/domain/solver.ts";

const option = (slot, name, damage, extra = {}) => ({
  option_id: name,
  weapon_id: name,
  weapon_display_name: name,
  count: 1,
  damage,
  counted_base_damage: damage,
  weight_kg: 1,
  ...extra,
});
const pylon = (slot, ...options) => ({slot, options});
function solve(pylons, targetDamage, extra = {}) {
  return solvePylonLoadout({
    pylons, targetDamage, rewardProfile: null,
    top: 20, maxOverkill: 0, sortBy: "weapons",
    allowedSlots: new Set(), allowedOptions: new Set(
      pylons.flatMap((p) => p.options.filter((o) => !o.support).map((o) => o.option_id))),
    damageOverrides: {}, quantityConstraints: [], ...extra,
  });
}
const names = (solution) => new Set(solution.selections?.map((s) => s.option_id));

test("banned pairs are rejected without losing same-damage valid alternatives", () => {
  const pylons = [
    pylon(1, option(1, "A", 100, {banned_option_ids: ["B"]}), option(1, "C", 100)),
    pylon(2, option(2, "B", 100)),
  ];
  const results = solve(pylons, 200);
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => names(r).has("C") && names(r).has("B") && !names(r).has("A")));
  const constrained = solve(pylons, 200, {
    quantityConstraints: [{option_id: "B", count: 1, mode: "exact"}],
  });
  assert.ok(constrained.length > 0);
  assert.ok(constrained.every((r) => names(r).has("C") && names(r).has("B")));
});

test("dependency in a later slot automatically selects a zero-damage pod", () => {
  const pylons = [
    pylon(1, option(1, "GBU", 100, {required_option_ids: ["POD"]})),
    pylon(2, option(2, "POD", 0, {support: true, counted_base_damage: 0})),
  ];
  const results = solve(pylons, 100);
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => names(r).has("GBU") && names(r).has("POD")));
  assert.deepEqual(solve(pylons, 100, {allowedSlots: new Set([1])}), []);
});

test("dependency in an earlier slot requires preselecting its pod", () => {
  const pylons = [
    pylon(1, option(1, "POD", 0, {support: true, counted_base_damage: 0})),
    pylon(2, option(2, "MISSILE", 100, {required_option_ids: ["POD"]})),
  ];
  const results = solve(pylons, 100);
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => names(r).has("MISSILE") && names(r).has("POD")));
});

test("a reverse-direction ban is enforced", () => {
  const pylons = [
    pylon(1, option(1, "A", 100)),
    pylon(2, option(2, "B", 100, {banned_option_ids: ["A"]})),
  ];
  assert.deepEqual(solve(pylons, 200), []);
});

test("non-required support stores are absent from results", () => {
  const pylons = [
    pylon(1, option(1, "POD", 0, {support: true, counted_base_damage: 0})),
    pylon(2, option(2, "BOMB", 100)),
  ];
  const results = solve(pylons, 100);
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => !names(r).has("POD")));
});
