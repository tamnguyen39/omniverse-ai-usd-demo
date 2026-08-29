#!/usr/bin/env python3
# usd_connector/make_views.py <scene> <out>
# Copy scene -> add a front camera -> save to <out> (does not modify source scene).
# Do NOT use `usdcat --flatten`: shared flat file would race between baseline/latest renders
# and break `custom color3f` parsing.
# Copy stays in scenes/ so relative reference @../assets/... still resolves.
import sys
import shutil
from pxr import Usd, UsdGeom, Gf

SCENE = sys.argv[1]
OUT = sys.argv[2]
CAM = Gf.Vec3d(0, -900, 250)  # camera chính diện, hướng vào gốc tọa độ

shutil.copyfile(SCENE, OUT)
stage = Usd.Stage.Open(OUT)
UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
cam = UsdGeom.Camera.Define(stage, "/World/Cam")
cam.GetFocalLengthAttr().Set(35)
xf = UsdGeom.Xformable(cam.GetPrim())
xf.AddTranslateOp().Set(CAM)
stage.Save()
print(OUT)
