// controller/server.js
// AI controller for the OpenUSD demo.
//   GET  /sensors        -> synthetic devices (named electrical appliances) {id,x,y,z,temperature,vibration}
//   POST /agent/decide   -> LLM tool-calling agent; returns 1 set_device_action per device
//
// NVIDIA-best-practice note: this service is the "perception + decide" half of the
// perception->control->autonomy loop. It is NOT a closed control loop: it proposes
// actions, it does not actuate devices. See REVIEW.md for "real vs simulated" notes.
//
// ponytail: single file, Express only (user's strongest stack). No auth — demo-local
// scope. If deployed to a real VPS, add auth/TLS (out of 2-day scope, see PLAN §2H).

import express from "express";

const PORT = process.env.PORT || 3000;
// Named electrical appliances from the Pixar Kitchen Set (real USD assets we reference).
// Count is NOT fixed at 5 — it matches the appliances we monitor.
const DEVICE_IDS = ["fridge", "toaster", "kettle", "ceil_light"];
const STATUSES = ["running", "warning", "error"]; // idle dropped (no maintenance sensor input)

// ---- synthetic sensors (perception source) ----
// ponytail: Math.random is fine; no seeding needed for the live endpoint.
export function makeSensors() {
  return DEVICE_IDS.map((id) => ({
    id,
    x: +(Math.random() * 20 - 10).toFixed(2), // [-10, 10]
    y: +(Math.random() * 20 - 10).toFixed(2),
    z: +(Math.random() * 20 - 10).toFixed(2),
    temperature: +(20 + Math.random() * 70).toFixed(1), // 20-90
    vibration: +(Math.random() * 10).toFixed(2), // 0-10
  }));
}

// ---- decision matrix (shared by agent prompt AND fallback heuristic) ----
// error: temp>=85 OR vib>=9 ; warning: temp>75 OR vib>7 ; else running
export function decide(status) {
  if (status.temperature >= 85 || status.vibration >= 9) return "error";
  if (status.temperature > 75 || status.vibration > 7) return "warning";
  return "running";
}
export function reasonFor(d, status) {
  const parts = [];
  if (status.temperature >= 85) parts.push(`temp ${status.temperature}°C exceeds error threshold 85`);
  else if (status.temperature > 75) parts.push(`temp ${status.temperature}°C is high`);
  if (status.vibration >= 9) parts.push(`vibration ${status.vibration} exceeds error threshold 9`);
  else if (status.vibration > 7) parts.push(`vibration ${status.vibration} is high`);
  return parts.length ? `Alert: ${parts.join(", ")}` : `Normal (temp=${status.temperature}, vib=${status.vibration})`;
}

// ---- fallback: use matrix when LLM misses/omits a device (free-model safety) ----
function fallbackDecisions(sensors) {
  return sensors.map((d) => ({ device_id: d.id, status: decide(d), reason: reasonFor(d, d) }));
}

// ---- OpenRouter tool-calling ----
// Reference: https://openrouter.ai/docs/guides/features/tool-calling (OpenAI-compatible)
const TOOL = {
  type: "function",
  function: {
    name: "set_device_action",
    description: "Classify the status of ONE appliance from sensor readings.",
    parameters: {
      type: "object",
      properties: {
        device_id: { type: "string", description: "device id, e.g. fridge" },
        status: { type: "string", enum: STATUSES },
        reason: { type: "string", description: "short reason in English" },
      },
      required: ["device_id", "status", "reason"],
    },
  },
};

async function callAgent(sensors) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    // No key -> pure heuristic (lets the demo run offline for B1/B2).
    return { decisions: fallbackDecisions(sensors), model: "heuristic(local)" };
  }
  const model = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";
  const fallbackModel = process.env.OPENROUTER_MODEL_FALLBACK || "";
  const sysPrompt =
    "You are an industrial autonomy agent. " +
    "For EACH device in the sensor payload, you MUST call set_device_action exactly once. " +
    "Rules: temperature>=85 or vibration>=9 -> error; temperature>75 or vibration>7 -> warning; else running.";

  const body = {
    model,
    tool_choice: "required", // ponytail: force >=1 tool call so the model can't skip
    tools: [TOOL],
    max_tokens: 1024,
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: "Sensor readings: " + JSON.stringify(sensors) },
    ],
  };

  const tryOnce = async (m) => {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://localhost",
        "X-Title": "openusd-demo",
      },
      body: JSON.stringify({ ...body, model: m }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    return res.json();
  };

  let data;
  try {
    data = await tryOnce(model);
  } catch (e) {
    if (fallbackModel) data = await tryOnce(fallbackModel);
    else throw e;
  }
  const usedModel = data.model || model;
  const msg = data.choices?.[0]?.message;
  const calls = msg?.tool_calls || [];
  const parsed = calls
    .filter((c) => c.function?.name === "set_device_action")
    .map((c) => {
      try { return JSON.parse(c.function.arguments); } catch { return null; }
    })
    .filter(Boolean);
  return { decisions: parsed, model: usedModel };
}

// ---- validate: exactly 5 unique device_ids, valid status, non-empty reason ----
export function reconcile(sensors, agentOut) {
  const byId = new Map(agentOut.decisions.map((d) => [d.device_id, d]));
  const seen = new Set();
  const out = [];
  for (const s of sensors) {
    const a = byId.get(s.id);
    let status, reason;
    if (a && STATUSES.includes(a.status) && a.reason && !seen.has(s.id)) {
      status = a.status; reason = String(a.reason);
    } else {
      // ponytail: missing/invalid -> heuristic; guarantees 1 row per device
      const fb = fallbackDecisions([s])[0];
      status = fb.status; reason = fb.reason;
    }
    seen.add(s.id);
    out.push({ device_id: s.id, status, reason });
  }
  return out;
}

// ---- Express wiring ----
export function buildApp() {
  const app = express();
  app.use(express.json());
  app.get("/sensors", (_req, res) => res.json(makeSensors()));
  app.post("/agent/decide", async (req, res) => {
    const sensors = Array.isArray(req.body?.sensors) ? req.body.sensors : makeSensors();
    try {
      const agentOut = await callAgent(sensors);
      res.json({ model: agentOut.model, decisions: reconcile(sensors, agentOut) });
    } catch (e) {
      // ponytail: never 500 the demo; degrade to heuristic with the error noted
      res.json({ model: "heuristic(local)", error: String(e.message || e), decisions: fallbackDecisions(sensors) });
    }
  });
  return app;
}

// Only listen when run directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  buildApp().listen(PORT, () => console.log(`controller listening on :${PORT}`));
}
