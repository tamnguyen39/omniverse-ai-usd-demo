"""usd_connector/fixtures.py
Fixed sensor snapshots so a demo run reliably shows varied appliance states.
Devices are NAMED electrical appliances from the Pixar Kitchen Set (not dev_1..N),
so the scene maps to real USD assets referenced by sync_to_usd.py.

Used by sync_to_usd.py --fixture=<name>. NOT used by the live endpoint.
"""
import sys

# Each fixture: appliance telemetry. Values chosen to hit the decision matrix:
#   error:   temp>=85 OR vib>=9
#   warning: temp>75 OR vib>7
#   running: else
FIXTURES = {
    "normal": [
        {"id": "fridge", "x": -3, "y": 2, "z": 1, "temperature": 50, "vibration": 2},
        {"id": "toaster", "x": 0, "y": -4, "z": 3, "temperature": 60, "vibration": 3},
        {"id": "kettle", "x": 4, "y": 1, "z": -2, "temperature": 45, "vibration": 1},
        {"id": "ceil_light", "x": -1, "y": 5, "z": 0, "temperature": 40, "vibration": 1},
    ],
    "warning": [
        {"id": "fridge", "x": -3, "y": 2, "z": 1, "temperature": 80, "vibration": 8},  # warning
        {"id": "toaster", "x": 0, "y": -4, "z": 3, "temperature": 60, "vibration": 3},  # running
        {"id": "kettle", "x": 4, "y": 1, "z": -2, "temperature": 78, "vibration": 5},  # warning
        {"id": "ceil_light", "x": -1, "y": 5, "z": 0, "temperature": 40, "vibration": 1},  # running
    ],
    "error": [
        {"id": "fridge", "x": -3, "y": 2, "z": 1, "temperature": 90, "vibration": 3},  # error
        {"id": "toaster", "x": 0, "y": -4, "z": 3, "temperature": 60, "vibration": 9},  # error
        {"id": "kettle", "x": 4, "y": 1, "z": -2, "temperature": 88, "vibration": 5},  # error
        {"id": "ceil_light", "x": -1, "y": 5, "z": 0, "temperature": 40, "vibration": 1},  # running
    ],
    "mixed": [
        {"id": "fridge", "x": -3, "y": 2, "z": 1, "temperature": 90, "vibration": 3},  # error  -> đỏ
        {"id": "toaster", "x": 0, "y": -4, "z": 3, "temperature": 80, "vibration": 8},  # warning -> vàng cam
        {"id": "kettle", "x": 4, "y": 1, "z": -2, "temperature": 50, "vibration": 2},  # running -> xanh lam
        {"id": "ceil_light", "x": -1, "y": 5, "z": 0, "temperature": 78, "vibration": 5},  # warning -> vàng cam
    ],
}


def get(name):
    if name not in FIXTURES:
        raise KeyError(f"unknown fixture {name!r}; choose from {list(FIXTURES)}")
    return FIXTURES[name]


if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else "normal"
    import json
    print(json.dumps(get(name), indent=2))
