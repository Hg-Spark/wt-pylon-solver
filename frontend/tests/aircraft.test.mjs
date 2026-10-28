import assert from "node:assert/strict";
import {test} from "node:test";
import {
  aircraftLabel, normalizeAircraftSearch, searchAircraft, updatedRecentAircraft,
} from "../src/domain/aircraft.ts";

const entries = [
  {id: "su_34", zh: "苏-34", en: "Su-34"},
  {id: "f_15e", zh: "F-15E", en: "F-15E Strike Eagle"},
  {id: "f_16c_block_50", zh: "", en: "F-16C Block 50"},
  {id: "su_25", zh: "苏-25", en: "Su-25"},
];

test("aircraft search recognizes Chinese, English, IDs and spacing variants", () => {
  assert.deepEqual(searchAircraft(entries, "苏34").map((x) => x.id), ["su_34"]);
  assert.deepEqual(searchAircraft(entries, "SU_34").map((x) => x.id), ["su_34"]);
  assert.deepEqual(searchAircraft(entries, "su-34").map((x) => x.id), ["su_34"]);
  assert.deepEqual(searchAircraft(entries, "Strike Eagle").map((x) => x.id), ["f_15e"]);
  assert.deepEqual(searchAircraft(entries, "f16cblock50").map((x) => x.id), ["f_16c_block_50"]);
  assert.equal(normalizeAircraftSearch("苏-34"), "苏34");
  assert.equal(aircraftLabel(entries[2]), "F-16C Block 50");
});

test("recent aircraft are ordered first and deduplicated within eight IDs", () => {
  assert.deepEqual(
    searchAircraft(entries, "", ["su_25", "f_15e"], 2).map((x) => x.id),
    ["su_25", "f_15e"],
  );
  const initial = ["su_25", "su_34", "f_15e"];
  assert.deepEqual(updatedRecentAircraft(initial, "su_34"), ["su_34", "su_25", "f_15e"]);
  const many = Array.from({length: 10}, (_, i) => `plane_${i}`);
  assert.equal(updatedRecentAircraft(many, "su_34").length, 8);
  assert.deepEqual(updatedRecentAircraft(initial, "not a valid id"), initial);
});
