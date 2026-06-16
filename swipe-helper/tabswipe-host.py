#!/usr/bin/env python3
"""Chrome native-messaging host for TabSwipe.

The TabView extension launches this on demand (via chrome.runtime.sendNativeMessage)
to flip the swipe helper on or off. It writes a single flag file that the persistent
TabSwipe.app reads at the start of each gesture. One message in, one reply, exit.

Message  : {"enabled": true|false}  or  {"query": true}
Reply    : {"ok": true, "enabled": <bool>}
"""
import json
import os
import struct
import sys

FLAG_DIR = os.path.expanduser("~/Library/Application Support/TabSwipe")
FLAG_PATH = os.path.join(FLAG_DIR, "enabled")


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        return None
    (length,) = struct.unpack("<I", raw_len)
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode("utf-8"))


def send_message(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def current_enabled():
    try:
        with open(FLAG_PATH) as f:
            return f.read().strip() == "1"
    except FileNotFoundError:
        return True  # default on when never set


def write_enabled(value):
    os.makedirs(FLAG_DIR, exist_ok=True)
    with open(FLAG_PATH, "w") as f:
        f.write("1" if value else "0")


def main():
    msg = read_message()
    if msg is None:
        return
    if "enabled" in msg:
        enabled = bool(msg["enabled"])
        write_enabled(enabled)
    else:
        enabled = current_enabled()
    send_message({"ok": True, "enabled": enabled})


if __name__ == "__main__":
    main()
