# NOTES — internal notes

This file is for the maintainer. External readers should use README.md.

## Decisions
- Asset: **Pixar Kitchen Set** (official). Control = **recolor appliance meshes**
  (`displayColor`), no standing lights, no robot arm.
- 4 appliances: fridge, toaster, kettle, ceil_light.
- Colors: blue=running, amber=warning, red=error (3 distinct hues).
- GPU is only used to validate `.usda` file open/load, not interactive 3D.

## Real vs simulated
- REAL: OpenUSD API, official Pixar asset reference, agent LLM tool-calling when key is present,
  compliance asserts, Mac + GPU rendering.
- SIMULATED: random telemetry; "control" means mesh recolor only (no actuation/physics/closed-loop);
  LLM runs only when `OPENROUTER_API_KEY` is set, otherwise local heuristic.
- Kitchen Set is static mesh; no door/joint animation.

## B4 — GPU verify (historical)
- Previously validated on DigitalOcean H100: Isaac Sim 6.0.1 container load + RTX OK.
- Headless capture was blocked by Isaac 6.0.1 `--headless` windowing limitation; GPU capture scripts
  were removed to keep the repo clean.
- Current verification: `make test` + Mac previews via `usdrecord` (Storm/CPU).

## References
- Kitchen Set: https://openusd.org/release/dl_kitchen_set.html
- Franka FR3 arm (if robot is needed later): https://franka.de/3d-assets
- Isaac Lab Cabinet: https://isaac-sim.github.io/IsaacLab

## Vietnamese notes for employer

Tiêu chí portability:
- Dependencies rõ ràng: `usd-core==26.8`, Node 20+, npm install 2 chỗ.
- Không hardcode path: dùng `os.path.relpath` cho USD reference, `CONTROLLER_URL` qua env.
- Chạy được trên macOS + Linux: không dùng API đặc-platform.
- Artifact gitignored: repo chỉ cần clone + `npm install` + tải asset là chạy.
- Default `localStorage.lang="en"` + reason tiếng Anh để demo ra CV không bị lỗi ngôn ngữ.
- Bỏ script GPU capture: demo không phụ thuộc Isaac headless, chỉ cần Mac preview.

Lý do tuân theo:
- NVIDIA best practice: repo sạch, artifact không commit, script cũ bỏ đi.
- Dễ clone + chạy trong 5 phút cho người xem CV/demo.
- Chứng minh tư duy production: không để file sinh ra, log, cache lẫn vào git.
- Môi trường demo ổn định: Mac `usdrecord` đủ để verify, không cần H100 mỗi lần chạy.
