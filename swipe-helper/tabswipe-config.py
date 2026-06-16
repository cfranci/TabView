#!/usr/bin/env python3
"""Adjust TabSwipe sensitivity.

Writes ~/Library/Application Support/TabSwipe/config.json, which TabSwipe.app
live-reloads at the start of the next gesture (no restart needed).

  tabswipe-config.py                      # show current config
  tabswipe-config.py low|medium|high      # apply a preset
  tabswipe-config.py low --fingers 4      # preset + override finger count
  tabswipe-config.py --threshold 0.22 --minSpeed 0.9 --fingers 3

threshold : fraction of trackpad width to travel for one tab switch (bigger = less sensitive)
minSpeed  : minimum flick speed in width/second; a slow 3-finger DRAG stays below it (0 = off)
fingers   : number of fingers (3 default; 4 avoids the macOS 3-finger-drag conflict entirely)
"""
import json
import os
import sys

DIR = os.path.expanduser("~/Library/Application Support/TabSwipe")
CFG = os.path.join(DIR, "config.json")

PRESETS = {
    "high":   {"threshold": 0.12, "minSpeed": 0.0},   # easy to trigger
    "medium": {"threshold": 0.18, "minSpeed": 0.6},   # balanced
    "low":    {"threshold": 0.26, "minSpeed": 1.1},   # resists 3-finger drag (needs a fast flick)
}


def load():
    try:
        with open(CFG) as f:
            return json.load(f)
    except Exception:
        return {}


def save(cfg):
    os.makedirs(DIR, exist_ok=True)
    with open(CFG, "w") as f:
        json.dump(cfg, f, indent=2)


def main():
    args = sys.argv[1:]
    if not args:
        print("Current config:", json.dumps(load()) or "{}")
        print(__doc__)
        return

    cfg = load()
    i = 0
    if args[0] in PRESETS:
        cfg.update(PRESETS[args[0]])
        i = 1
    while i < len(args):
        a = args[i]
        if a == "--threshold":
            cfg["threshold"] = float(args[i + 1]); i += 2
        elif a == "--minSpeed":
            cfg["minSpeed"] = float(args[i + 1]); i += 2
        elif a == "--fingers":
            cfg["fingers"] = int(args[i + 1]); i += 2
        else:
            print("unknown argument:", a)
            sys.exit(1)
    save(cfg)
    print("Saved:", json.dumps(cfg))
    print("TabSwipe will use it on your next swipe.")


if __name__ == "__main__":
    main()
