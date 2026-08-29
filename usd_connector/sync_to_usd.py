"""usd_connector/sync_to_usd.py
AI agent -> OpenUSD connector. Pulls sensor + decision data, authors a USD
stage that REFERENCES the real Pixar Kitchen Set and RECOLORS each monitored
electrical appliance by its agent status (control = change the device color),
writes scenes/latest.usda.

The appliances (refrigerator, toaster, kettle, ceiling light) are REAL USD assets
from the Pixar Kitchen Set (downloaded to ../assets/KitchenSet/Kitchen_set/Kitchen_set.usd).
The agent's decision drives each appliance's displayColor (visible state change:
blue=running, amber=warning, red=error). This is the "control" signal — smart-building
style monitor. No physics/IK; the asset is referenced read-only, we only recolor meshes.

NVIDIA best-practice references (pinned SHA, not `main`):
- Create stage / default prim / up-axis:
  NVIDIA-Omniverse/OpenUSD-Code-Samples @ 8854155 (Release 1.3.0)
- Reference external asset into a stage (Sdf.Reference):
  usd-exchange-samples @ 1aa39d5 (v3.0.0) -> "reference a USD layer"
- displayColor authoring (primvars:displayColor as color3f):
  OpenUSD tutorial -> https://openusd.org/release/tut_inspect_and_author_props.html
"""
import os
import sys
import json
import urllib.request
from datetime import datetime, timezone

from pxr import Usd, UsdGeom, Sdf, Gf

# ponytail: 3 hues maximally distinct (blue / amber / red) for instant readability
STATUS_COLOR = {
    "running": Gf.Vec3f(0.0, 0.45, 1.0),  # xanh lam
    "warning": Gf.Vec3f(1.0, 0.85, 0.0),  # vàng cam
    "error":   Gf.Vec3f(1.0, 0.05, 0.05), # đỏ
}

# Appliances monitored. `asset_path` = prim path inside the referenced Kitchen Set.
# This is what makes the demo "real": we reference Pixar's actual modeled appliances.
KITCHENSET = os.path.join(os.path.dirname(__file__), "..", "assets", "KitchenSet",
                         "Kitchen_set", "Kitchen_set.usd")
APPLIANCES = {
    "fridge":     "/Props_grp/North_grp/FridgeArea_grp/Refridgerator_1",
    "toaster":    "/Props_grp/North_grp/SinkArea_grp/Countertop_grp/Toaster_1",
    "kettle":     "/Props_grp/North_grp/StoveArea_grp/TeaKettle_1",
    "ceil_light": "/Props_grp/Ceiling_grp/CeilingLight_1",
}

CONTROLLER_URL = os.environ.get("CONTROLLER_URL", "http://127.0.0.1:3000").rstrip("/")
SCENES_DIR = os.path.join(os.path.dirname(__file__), "..", "scenes")


def fetch_json(path):
    url = f"{CONTROLLER_URL}{path}"
    with urllib.request.urlopen(url, timeout=20) as r:  # ponytail: stdlib, no extra dep
        return json.loads(r.read().decode())


def decide_local(s):
    # ponytail: thresholds from env, default unchanged
    t_err = float(os.environ.get("THRESH_TEMP_ERR", 85))
    t_warn = float(os.environ.get("THRESH_TEMP_WARN", 75))
    v_err = float(os.environ.get("THRESH_VIB_ERR", 9))
    v_warn = float(os.environ.get("THRESH_VIB_WARN", 7))
    if s["temperature"] >= t_err or s["vibration"] >= v_err:
        return "error", f"error threshold (local heuristic, T>={t_err} or V>={v_err})"
    if s["temperature"] > t_warn or s["vibration"] > v_warn:
        return "warning", f"warning threshold (local heuristic, T>{t_warn} or V>{v_warn})"
    return "running", "normal (local heuristic)"


def get_data(fixture=None):
    """Return (sensors, decisions, model)."""
    if fixture:
        import fixtures
        sensors = fixtures.get(fixture)
        decisions = [{"device_id": s["id"], "status": decide_local(s)[0],
                      "reason": decide_local(s)[1]} for s in sensors]
        return sensors, decisions, "fixture(local)"
    sensors = fetch_json("/sensors")
    try:
        req = urllib.request.Request(
            f"{CONTROLLER_URL}/agent/decide",
            data=json.dumps({"sensors": sensors}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read().decode())
    except Exception as e:  # ponytail: degrade to local heuristic, demo never blocks
        print(f"[warn] controller unreachable ({e}); using local heuristic", file=sys.stderr)
        resp = {"model": "heuristic(local)",
                "decisions": [{"device_id": s["id"], "status": decide_local(s)[0],
                                "reason": decide_local(s)[1]} for s in sensors]}
    by_id = {d["device_id"]: d for d in resp.get("decisions", [])}
    decisions = [by_id.get(s["id"], {"device_id": s["id"], **dict(zip(
        ("status", "reason"), decide_local(s)))}) for s in sensors]
    return sensors, decisions, resp.get("model", "unknown")


def author_stage(sensors, decisions, model, run_id):
    """Create a compliant USD stage referencing the Kitchen Set + recoloring each
    monitored appliance by its agent status. Writes a single latest scene file.
    Returns (stage, out_path)."""
    out = os.path.join(SCENES_DIR, "latest.usda")
    stage = Usd.Stage.CreateNew(out)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    stage.SetMetadata("metersPerUnit", 1.0)
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    kitchen = UsdGeom.Xform.Define(stage, "/World/Kitchen")
    kitchen.GetPrim().GetReferences().AddReference(os.path.relpath(KITCHENSET, SCENES_DIR))

    # Control each appliance: recolor its meshes by agent status (visible state change).
    for s, d in zip(sensors, decisions):
        status = d.get("status", "running")
        rgb = STATUS_COLOR.get(status, STATUS_COLOR["running"])
        dev_prim = stage.GetPrimAtPath(f"/World/Kitchen{APPLIANCES.get(s['id'], '')}")
        dev_path = dev_prim.GetPath().pathString if dev_prim else ""
        colored = 0
        if dev_prim:
            for mesh in stage.Traverse():
                pp = mesh.GetPath().pathString
                if pp.startswith(dev_path + "/") or pp == dev_path:
                    if mesh.IsA(UsdGeom.Mesh):
                        # ponytail: displayColor is VtArray<GfVec3f> (per-vertex/uniform)
                        attr = mesh.GetAttribute("primvars:displayColor")
                        if not attr:
                            attr = UsdGeom.PrimvarsAPI(mesh).CreateColorPrimvar(
                                "displayColor", Sdf.ValueTypeNames.Color3fArray, UsdGeom.Tokens.uniform)
                        attr.Set([Gf.Vec3f(rgb[0], rgb[1], rgb[2])])
                        colored += 1

        # virtual control prim: holds metadata proving data lineage (review honesty)
        ctrl = UsdGeom.Xform.Define(stage, f"/World/Devices/{s['id']}")
        p = ctrl.GetPrim()
        p.CreateAttribute("control:coloredMeshes", Sdf.ValueTypeNames.Int).Set(colored)
        p.CreateAttribute("action:status", Sdf.ValueTypeNames.Token).Set(status)
        p.CreateAttribute("action:color", Sdf.ValueTypeNames.Color3f).Set(rgb)
        p.CreateAttribute("telemetry:temperature", Sdf.ValueTypeNames.Float).Set(float(s["temperature"]))
        p.CreateAttribute("telemetry:vibration", Sdf.ValueTypeNames.Float).Set(float(s["vibration"]))
        p.CreateAttribute("action:reason", Sdf.ValueTypeNames.String).Set(str(d.get("reason", "")))
        p.CreateAttribute("appliance:asset", Sdf.ValueTypeNames.String).Set(APPLIANCES.get(s["id"], ""))
        p.CreateAttribute("run:model", Sdf.ValueTypeNames.String).Set(str(model))
        p.CreateAttribute("run:id", Sdf.ValueTypeNames.String).Set(run_id)

    stage.Save()
    return stage, stage.GetRootLayer().realPath


def author_baseline():
    """Baseline stage: Kitchen Set only, NO recolor. Used for before/after compare."""
    out = os.path.join(SCENES_DIR, "kitchen_baseline.usda")
    stage = Usd.Stage.CreateNew(out)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    kitchen = UsdGeom.Xform.Define(stage, "/World/Kitchen")
    kitchen.GetPrim().GetReferences().AddReference(os.path.relpath(KITCHENSET, SCENES_DIR))
    stage.Save()
    return stage.GetRootLayer().realPath


def summarize(sensors, decisions, model, out_path):
    print(f"\n=== scene: {os.path.basename(out_path)} (model={model}) ===")
    print(f"{'appliance':<12} {'status':<9} {'color':>14} {'temp':>5} {'vib':>5}  reason")
    print("-" * 70)
    for s, d in zip(sensors, decisions):
        st = d.get("status", "running")
        rgb = STATUS_COLOR.get(st, STATUS_COLOR["running"])
        print(f"{s['id']:<12} {st:<9} ({rgb[0]:.1f},{rgb[1]:.1f},{rgb[2]:.1f}) "
              f"{s['temperature']:>5} {s['vibration']:>5}  {d.get('reason','')}")


def main():
    args = sys.argv[1:]
    if "--baseline" in args:
        if not os.path.exists(KITCHENSET):
            print(f"[ERR] Kitchen Set not found at {KITCHENSET}", file=sys.stderr)
            sys.exit(1)
        out = author_baseline()
        print(f"[ok] wrote baseline (no lights): {out}")
        return
    fixture = args[0] if args and not args[0].startswith("--") else None
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    os.makedirs(SCENES_DIR, exist_ok=True)
    if not os.path.exists(KITCHENSET):
        print(f"[ERR] Kitchen Set not found at {KITCHENSET}; run download step", file=sys.stderr)
        sys.exit(1)
    sensors, decisions, model = get_data(fixture)
    _, out_path = author_stage(sensors, decisions, model, run_id)
    summary = {
        "run_id": run_id,
        "model": model,
        "scene": os.path.basename(out_path),
        "devices": [
            {"id": s["id"], "status": d.get("status", "running"),
             "temperature": float(s["temperature"]), "vibration": float(s["vibration"]),
             "reason": str(d.get("reason", ""))}
            for s, d in zip(sensors, decisions)
        ],
    }
    with open(os.path.join(SCENES_DIR, "run_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    summarize(sensors, decisions, model, out_path)
    print(f"[ok] wrote {out_path}")


if __name__ == "__main__":
    main()
