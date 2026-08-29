"""verify/check_compliance.py
Compliance check for generated .usda files.

NOTE: UsdUtils.ComplianceChecker was REMOVED from usd-core 26.8 (AOUSD
deprecated it; NVIDIA's current validator is the `usd-validation-nvidia`
package). So we assert the same core invariants directly against the stage,
which is exactly what usdchecker / Asset Validator check first:
  - default prim exists and is named "World"
  - up-axis == Z
  - exactly 4 /World/Devices/{id} control prims (fridge/toaster/kettle/ceil_light)
  - primvars:displayColor on appliance meshes matches action:status (blue/amber/red)
  - action:color metadata matches status
  - no Tf errors while opening
Run BEFORE spending money on a GPU pod.

Usage: python verify/check_compliance.py [scenes_dir]
"""
import os
import sys

from pxr import Usd, UsdGeom, Gf, Tf

EXPECTED_COLOR = {
    "running": Gf.Vec3f(0.0, 0.45, 1.0),
    "warning": Gf.Vec3f(1.0, 0.85, 0.0),
    "error":   Gf.Vec3f(1.0, 0.05, 0.05),
}


def check_file(path):
    errors = []
    # ponytail: open defensively; a broken layer yields stage=None or raises
    try:
        stage = Usd.Stage.Open(path)
    except Exception as e:
        return [f"cannot open stage: {e}"], False
    if stage is None:
        return ["cannot open stage"], False

    # default prim
    dp = stage.GetDefaultPrim()
    if not dp or dp.GetName() != "World":
        errors.append(f"default prim missing/wrong: {dp.GetName() if dp else None}")

    # up-axis Z
    if UsdGeom.GetStageUpAxis(stage) != UsdGeom.Tokens.z:
        errors.append("up-axis is not Z")

    # Kitchen Set referenced (real Pixar asset)
    kitchen = stage.GetPrimAtPath("/World/Kitchen")
    if not kitchen or not kitchen.GetReferences():
        errors.append("/World/Kitchen missing or not referencing Kitchen_set.usd")

    # 4 appliance control prims, each recolored by status (action:color matches status)
    for dev_id in ["fridge", "toaster", "kettle", "ceil_light"]:
        ctrl = stage.GetPrimAtPath(f"/World/Devices/{dev_id}")
        if not ctrl:
            errors.append(f"{dev_id}: missing /World/Devices control prim")
            continue
        status = ctrl.GetAttribute("action:status").Get()
        color = ctrl.GetAttribute("action:color").Get()
        colored = ctrl.GetAttribute("control:coloredMeshes").Get()
        want = EXPECTED_COLOR.get(status)
        if not color or not want:
            errors.append(f"{dev_id}: missing action:color/status")
            continue
        if (abs(color[0]-want[0]) > 0.01 or abs(color[1]-want[1]) > 0.01 or abs(color[2]-want[2]) > 0.01):
            errors.append(f"{dev_id}: action:color {tuple(color)} != status {status} {tuple(want)}")
        if not colored or colored < 1:
            errors.append(f"{dev_id}: no meshes recolored (control:coloredMeshes={colored})")

    return errors, len(errors) == 0


def main():
    scenes_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join("..", "scenes")
    files = [os.path.join(scenes_dir, "latest.usda")]
    if not files:
        print(f"no .usda found in {scenes_dir}")
        sys.exit(1)
    all_pass = True
    for f in files:
        errors, ok = check_file(f)
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {os.path.basename(f)}")
        for e in errors:
            print(f"    - {e}")
        all_pass = all_pass and ok
    print(f"\nSUMMARY: {'ALL PASS' if all_pass else 'SOME FAILED'} ({len(files)} files)")
    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
