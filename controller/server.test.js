// controller/server.test.js
// Unit tests (no HTTP, no global fetch) for the agent decision contract:
// 4 named appliances (fridge/toaster/kettle/ceil_light), valid status, non-empty reason.
// Integration (real HTTP + curl) is verified manually — see README B1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, reasonFor, makeSensors, reconcile } from "./server.js";

const SENSORS = [
  { id: "fridge", x: 0, y: 0, z: 0, temperature: 60, vibration: 2 },
  { id: "toaster", x: 1, y: 1, z: 1, temperature: 80, vibration: 8 },
  { id: "kettle", x: 2, y: 2, z: 2, temperature: 90, vibration: 3 },
  { id: "ceil_light", x: 3, y: 3, z: 3, temperature: 40, vibration: 1 },
];

test("matrix: error/warning/running boundaries", () => {
  assert.equal(decide({ temperature: 85, vibration: 0 }), "error");
  assert.equal(decide({ temperature: 0, vibration: 9 }), "error");
  assert.equal(decide({ temperature: 76, vibration: 0 }), "warning");
  assert.equal(decide({ temperature: 0, vibration: 8 }), "warning");
  assert.equal(decide({ temperature: 75, vibration: 7 }), "running");
  assert.ok(reasonFor(SENSORS[2], SENSORS[2]).length > 0);
});

test("/sensors returns 4 named appliances in valid ranges", () => {
  const body = makeSensors();
  assert.equal(body.length, 4);
  assert.deepEqual(body.map((d) => d.id), ["fridge", "toaster", "kettle", "ceil_light"]);
  assert.ok(body.every((d) => d.temperature >= 20 && d.temperature <= 90));
  assert.ok(body.every((d) => d.vibration >= 0 && d.vibration <= 10));
  assert.ok(body.every((d) => d.x >= -10 && d.x <= 10));
});

test("reconcile: full LLM output -> exactly 4 valid decisions, no dup", () => {
  const agentOut = {
    decisions: [
      { device_id: "fridge", status: "running", reason: "ok" },
      { device_id: "toaster", status: "warning", reason: "nóng" },
      { device_id: "kettle", status: "error", reason: "quá nóng" },
      { device_id: "ceil_light", status: "running", reason: "ok" },
    ],
  };
  const out = reconcile(SENSORS, agentOut);
  assert.equal(out.length, 4);
  const ids = out.map((d) => d.device_id).sort();
  assert.deepEqual(ids, ["ceil_light", "fridge", "kettle", "toaster"]);
  for (const d of out) {
    assert.ok(["running", "warning", "error"].includes(d.status));
    assert.ok(d.reason && d.reason.length > 0);
  }
});

test("reconcile: fallback heuristic fills missing device (free-model safety)", () => {
  const agentOut = {
    decisions: [
      { device_id: "fridge", status: "running", reason: "ok" },
      { device_id: "toaster", status: "warning", reason: "nóng" },
      { device_id: "kettle", status: "error", reason: "quá nóng" },
    ],
  };
  const out = reconcile(SENSORS, agentOut);
  assert.equal(out.length, 4);
  const ceil = out.find((d) => d.device_id === "ceil_light");
  assert.equal(ceil.status, "running"); // temp40 vib1 -> running
});

test("reconcile: invalid status from LLM -> heuristic overrides", () => {
  const agentOut = {
    decisions: [
      { device_id: "fridge", status: "bogus", reason: "x" },
      { device_id: "toaster", status: "running", reason: "" },
    ],
  };
  const out = reconcile(SENSORS, agentOut);
  assert.equal(out.length, 4);
  const fridge = out.find((d) => d.device_id === "fridge");
  assert.equal(fridge.status, "running"); // temp60 vib2 -> running via heuristic
  assert.ok(fridge.reason.length > 0);
});
