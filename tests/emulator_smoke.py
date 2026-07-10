#!/usr/bin/env python3
import argparse
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UUID = "0784a79d-dd98-4536-8902-3ee5a417f087"

K = {
    "ReqType": 10000,
    "Status": 10006,
    "UpdatedAgoSec": 10007,
    "Source": 10008,
    "StopName0": 10009,
    "StopCodeList0": 10021,
    "StopDistM0": 10033,
    "Line0": 10045,
    "Line1": 10046,
    "Dest0": 10069,
    "Dest1": 10070,
    "Minutes0": 10093,
    "Minutes1": 10094,
    "DelayMin0": 10117,
    "DelayMin1": 10118,
    "Flags0": 10141,
    "Flags1": 10142,
    "SettingsUpdated": 10166,
    "RefreshSec": 10168,
    "DebugEnabled": 10172,
    "DarkMode": 10173,
    "ArrivalRoute0": 10178,
    "ArrivalRoute1": 10179,
    "RouteRef": 10202,
    "RouteCurrentIndex": 10203,
    "RouteStopName0": 10204,
    "RouteStopCount": 10268,
    "RouteStopCode0": 10269,
}


def run(args):
    print("+", " ".join(str(a) for a in args))
    subprocess.run(args, cwd=ROOT, check=True)


def run_optional(args):
    print("+", " ".join(str(a) for a in args))
    return subprocess.run(args, cwd=ROOT, check=False).returncode == 0


def send(platform, ints=None, strings=None):
    args = [
        "pebble",
        "send-app-message",
        "--emulator",
        platform,
        "--app-uuid",
        UUID,
    ]
    if ints:
        args.append("--int")
        args.extend(f"{key}={value}" for key, value in ints.items())
    if strings:
        args.append("--string")
        args.extend(f"{key}={value}" for key, value in strings.items())
    run(args)
    time.sleep(0.7)


def screenshot(platform, out, name):
    path = out / name
    run(["pebble", "screenshot", "--emulator", platform, str(path)])
    return path


def click(platform, button, delay=1.5):
    run(["pebble", "emu-button", "--emulator", platform, "click", button])
    time.sleep(delay)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", default="emery")
    parser.add_argument("--out", default=str(ROOT / "build" / "emulator-smoke"))
    args = parser.parse_args()

    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    out.mkdir(parents=True, exist_ok=True)
    for old_screenshot in out.glob("*.png"):
        old_screenshot.unlink()
    pbw = ROOT / "build" / "BusPebbIL.pbw"
    if not pbw.exists():
        raise SystemExit("build/BusPebbIL.pbw is missing; run pebble build first")

    run_optional(["pebble", "kill", "--force"])
    run_optional(["pebble", "wipe"])
    run_optional(["pebble", "emu-set-content-size", "--emulator", args.platform, "medium"])
    run(["pebble", "install", "--emulator", args.platform, str(pbw)])
    time.sleep(1)
    click(args.platform, "back", 0.2)

    send(
        args.platform,
        {
            K["ReqType"]: 5,
            K["Status"]: 0,
            K["StopCodeList0"]: 20004,
            K["StopDistM0"]: 0,
            K["SettingsUpdated"]: 1,
            K["RefreshSec"]: 30,
            K["DebugEnabled"]: 1,
        },
        {K["StopName0"]: "HaMasger/Yad"},
    )
    screenshot(args.platform, out, "01-settings-home.png")

    click(args.platform, "select", 0.1)
    send(
        args.platform,
        {
            K["ReqType"]: 1,
            K["Status"]: 0,
            K["Source"]: 1,
            K["UpdatedAgoSec"]: 0,
            K["Minutes0"]: 0,
            K["Minutes1"]: 5,
            K["DelayMin0"]: 0,
            K["DelayMin1"]: 0,
            K["Flags0"]: 8,
            K["Flags1"]: 0,
            K["ArrivalRoute0"]: 7700,
            K["ArrivalRoute1"]: 11767,
        },
        {
            K["Line0"]: "26",
            K["Dest0"]: "Tel Aviv-Yafo Central Railway Station",
            K["Line1"]: "501",
            K["Dest1"]: "Ra'anana West Terminal Industrial Zone",
        },
    )
    screenshot(args.platform, out, "02-arrivals-light.png")

    send(
        args.platform,
        {
            K["ReqType"]: 5,
            K["Status"]: 0,
            K["StopCodeList0"]: 20004,
            K["StopDistM0"]: 0,
            K["SettingsUpdated"]: 1,
            K["RefreshSec"]: 30,
            K["DebugEnabled"]: 1,
            K["DarkMode"]: 1,
        },
        {K["StopName0"]: "HaMasger/Yad"},
    )
    screenshot(args.platform, out, "03-arrivals-dark.png")

    send(
        args.platform,
        {
            K["ReqType"]: 1,
            K["Status"]: 0,
            K["Source"]: 1,
            K["UpdatedAgoSec"]: 0,
            K["Minutes0"]: 0,
            K["Minutes1"]: 5,
            K["DelayMin0"]: 0,
            K["DelayMin1"]: 0,
            K["Flags0"]: 8,
            K["Flags1"]: 0,
            K["ArrivalRoute0"]: 7700,
            K["ArrivalRoute1"]: 11767,
        },
        {
            K["Line0"]: "26",
            K["Dest0"]: "Tel Aviv-Yafo Central Railway Station",
            K["Line1"]: "501",
            K["Dest1"]: "Ra'anana West Terminal Industrial Zone",
        },
    )
    screenshot(args.platform, out, "04-arrivals-live.png")

    click(args.platform, "select", 0.1)
    send(
        args.platform,
        {
            K["ReqType"]: 7,
            K["Status"]: 0,
            K["RouteRef"]: 7700,
            K["RouteCurrentIndex"]: 2,
            K["RouteStopCount"]: 5,
            K["RouteStopCode0"]: 21256,
            K["RouteStopCode0"] + 1: 21257,
            K["RouteStopCode0"] + 2: 20004,
            K["RouteStopCode0"] + 3: 23017,
            K["RouteStopCode0"] + 4: 21604,
        },
        {
            K["RouteStopName0"]: "Central Station",
            K["RouteStopName0"] + 1: "HaRakevet/Bne Brak",
            K["RouteStopName0"] + 2: "HaMasger/Yad Harutsim",
            K["RouteStopName0"] + 3: "HaMasger/Israel Tal",
            K["RouteStopName0"] + 4: "Azrieli Center",
        },
    )
    screenshot(args.platform, out, "05-route-current.png")
    click(args.platform, "down")
    screenshot(args.platform, out, "06-route-current-unselected.png")
    click(args.platform, "down")
    screenshot(args.platform, out, "06b-route-scrolled.png")
    click(args.platform, "up")
    click(args.platform, "select", 0.1)
    send(
        args.platform,
        {
            K["ReqType"]: 1,
            K["Status"]: 0,
            K["Source"]: 1,
            K["UpdatedAgoSec"]: 0,
            K["Minutes0"]: 4,
            K["DelayMin0"]: 0,
            K["Flags0"]: 0,
            K["ArrivalRoute0"]: 8123,
        },
        {K["Line0"]: "5", K["Dest0"]: "Central Station"},
    )
    screenshot(args.platform, out, "07-route-station-arrivals.png")
    click(args.platform, "back")
    screenshot(args.platform, out, "08-back-restores-route.png")
    click(args.platform, "back")
    screenshot(args.platform, out, "09-back-restores-origin-arrivals.png")

    print("Saved emulator smoke screenshots:")
    for path in sorted(out.glob("*.png")):
        print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
