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
    allowedOptions: new Set(
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
  const reversed = [
    pylon(1, option(1, "A", 100)),
    pylon(2, option(2, "B", 100, {banned_option_ids: ["A"]})),
  ];
  assert.deepEqual(solve(reversed, 200), []);
  assert.deepEqual(solve(reversed, 200, {fixedPylons: {1: "A", 2: "B"}}), []);
});

test("dependency in a later slot automatically selects a zero-damage pod", () => {
  const pylons = [
    pylon(1, option(1, "GBU", 100, {required_option_ids: ["POD"]})),
    pylon(2, option(2, "POD", 0, {support: true, counted_base_damage: 0})),
  ];
  const results = solve(pylons, 100);
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => names(r).has("GBU") && names(r).has("POD")));
  assert.deepEqual(solve(pylons, 100, {fixedPylons: {2: null}}), []);
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


test("non-required support stores are absent from results", () => {
  const pylons = [
    pylon(1, option(1, "POD", 0, {support: true, counted_base_damage: 0})),
    pylon(2, option(2, "BOMB", 100)),
  ];
  const results = solve(pylons, 100);
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => !names(r).has("POD")));
  const fixedResults = solve(pylons, 100, {fixedPylons: {1: "POD"}});
  assert.ok(fixedResults.length > 0);
  assert.ok(fixedResults.every((r) => names(r).has("POD") && names(r).has("BOMB")));
});

test("fixed preset stays in its slot despite allowed-weapon filtering", () => {
  const pylons = [
    pylon(1, option(1, "A", 100)),
    pylon(2, option(2, "B", 100)),
  ];
  const results = solve(pylons, 200, {
    allowedOptions: new Set(["B"]),
    fixedPylons: {1: "A"},
  });
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.selections.some((s) => s.option_id === "A" && s.slot === 1)));
  assert.ok(results.every((r) => names(r).has("B")));
});

test("fixed empty slot is never filled", () => {
  const pylons = [
    pylon(1, option(1, "A", 100)),
    pylon(2, option(2, "B", 100)),
  ];
  assert.deepEqual(solve(pylons, 200, {fixedPylons: {1: null}}), []);
  const results = solve(pylons, 100, {fixedPylons: {1: null}});
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => !names(r).has("A") && names(r).has("B")));
});

test("at-least quantity counts only added weapons, never pinned weapons", () => {
  const pylons = [
    pylon(1, option(1, "PIN", 100, {weapon_id: "bomb", count: 2})),
    pylon(2, option(2, "NEW", 100, {weapon_id: "bomb", count: 2})),
  ];
  const quantityConstraints = [{
    constraint_id: "bomb", option_ids: ["PIN", "NEW"],
    count_by: "weapon", count: 2, mode: "at_least",
  }];
  const results = solve(pylons, 200, {fixedPylons: {1: "PIN"}, quantityConstraints});
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => names(r).has("PIN") && names(r).has("NEW")));
  const lowTarget = solve(pylons, 100, {
    fixedPylons: {1: "PIN"}, quantityConstraints, maxOverkill: 100,
  });
  assert.ok(lowTarget.length > 0);
  assert.ok(lowTarget.every((r) => names(r).has("NEW")));
  assert.deepEqual(solve(pylons, 100, {
    fixedPylons: {1: "PIN", 2: null}, quantityConstraints,
  }), []);
});

test("exact additional quantity ignores fixed mount and requires the specified new count", () => {
  const pylons = [
    pylon(1, option(1, "PIN", 100, {count: 2})),
    pylon(2, option(2, "NEW", 100, {count: 2})),
    pylon(3, option(3, "EXTRA", 100, {count: 1})),
  ];
  const quantityConstraints = [{
    constraint_id: "bomb", option_ids: ["PIN", "NEW", "EXTRA"],
    count_by: "weapon", count: 2, mode: "exact",
  }];
  const results = solve(pylons, 200, {fixedPylons: {1: "PIN"}, quantityConstraints});
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => names(r).has("PIN") && names(r).has("NEW") && !names(r).has("EXTRA")));
});

test("a fixed weapon still receives its required support pod", () => {
  const pylons = [
    pylon(1, option(1, "GBU", 100, {required_option_ids: ["POD"]})),
    pylon(2, option(2, "POD", 0, {support: true, counted_base_damage: 0})),
  ];
  const results = solve(pylons, 100, {fixedPylons: {1: "GBU"}});
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => names(r).has("GBU") && names(r).has("POD")));
  assert.deepEqual(solve(pylons, 100, {fixedPylons: {1: "GBU", 2: null}}), []);
});

test("a manually fixed pod can be retained even when no weapon depends on it", () => {
  const pylons = [
    pylon(1, option(1, "POD", 0, {support: true, counted_base_damage: 0})),
    pylon(2, option(2, "BOMB", 100)),
  
test("invalid fixed preset cannot silently disappear", () => {
  const pylons = [pylon(1, option(1, "A", 100)), pylon(2, option(2, "B", 100))];
  assert.deepEqual(solve(pylons, 100, {fixedPylons: {1: "MISSING"}}), []);
});

test("fixed weapons respect mutual-exclusion constraints", () => {
  const pylons = [
    pylon(1, option(1, "A", 100, {banned_option_ids: ["B"]})),
    pylon(2, option(2, "B", 100)),
  ];
  assert.deepEqual(solve(pylons, 200, {fixedPylons: {1: "A", 2: "B"}}), []);
});

test("fixed air-to-air or other non-bombing stores consume a station", () => {
  const pylons = [
    pylon(1, option(1, "AAM", 0, {weap
test("pinned-empty station outside allowed station subset remains valid", () => {
  const pylons = [
    pylon(1, option(1, "A", 100)),
    pylon(2, option(2, "B", 100)),
  ];
  const results = solve(pylons, 100, {
    allowedSlots: new Set([2]), fixedPylons: {1: null},
  });
  assert.ok(results.length > 0);
  assert.ok(results.every((result) => !names(result).has("A") && names(result).has("B")));
});
