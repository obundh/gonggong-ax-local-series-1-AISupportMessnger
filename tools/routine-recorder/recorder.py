import argparse
import json
import math
import sys
import threading
import time

from pynput import keyboard, mouse


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def now():
    return time.time()


def key_name(key):
    if isinstance(key, keyboard.KeyCode):
        return key.char
    name = getattr(key, "name", None)
    if name:
        return name
    text = str(key)
    return text.replace("Key.", "")


def button_name(button):
    name = getattr(button, "name", None)
    return name or str(button).replace("Button.", "")


def distance(a, b):
    if not a or not b:
        return 999999
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def in_ignored_region(x, y, region):
    if not region:
        return False
    rx, ry, rw, rh = region
    return rx <= x <= rx + rw and ry <= y <= ry + rh


class RoutineRecorder:
    def __init__(self, delay, ignore_region=None):
        self.delay = max(0, float(delay or 0))
        self.ignore_region = ignore_region
        self.steps = []
        self.stop_event = threading.Event()
        self.paused_event = threading.Event()
        self.state_lock = threading.RLock()
        self.started_at = None
        self.last_event_time = None
        self.text_buffer = []
        self.text_started_at = None
        self.mouse_down = {}
        self.modifiers = set()
        self.mouse_listener = None
        self.keyboard_listener = None

    def delay_before(self, event_time):
        base = self.last_event_time or self.started_at or event_time
        return round(max(0, event_time - base), 2)

    def add_step(self, step, event_time=None):
        with self.state_lock:
            event_time = event_time or now()
            step["delayBefore"] = self.delay_before(event_time)
            step["recordedAt"] = round(event_time - (self.started_at or event_time), 3)
            self.steps.append(step)
            self.last_event_time = event_time
            emit({"type": "step", "step": step, "count": len(self.steps)})

    def flush_text(self, event_time=None):
        with self.state_lock:
            if not self.text_buffer:
                return
            event_time = event_time or now()
            text = "".join(self.text_buffer)
            self.text_buffer = []
            self.add_step(
                {
                    "action": "typeText",
                    "value": text,
                    "repeat": 1,
                    "durationSeconds": round(max(0.1, event_time - (self.text_started_at or event_time)), 2),
                },
                self.text_started_at or event_time,
            )
            self.text_started_at = None

    def pause_capture(self):
        with self.state_lock:
            self.flush_text(now())
            self.paused_event.set()
            self.modifiers.clear()
            self.mouse_down.clear()
        emit({"type": "status", "state": "paused"})

    def resume_capture(self):
        with self.state_lock:
            self.last_event_time = now()
            self.paused_event.clear()
        emit({"type": "status", "state": "recording"})

    def redact_last_text(self):
        with self.state_lock:
            self.text_buffer = []
            self.text_started_at = None
            for index in range(len(self.steps) - 1, -1, -1):
                if self.steps[index].get("action") == "typeText":
                    self.steps.pop(index)
                    emit({"type": "text-redacted", "count": len(self.steps)})
                    return True
        emit({"type": "text-redacted", "count": len(self.steps), "changed": False})
        return False

    def maybe_merge_double_click(self, x, y, button, event_time):
        if button != "left" or not self.steps:
            return False
        previous = self.steps[-1]
        if previous.get("action") != "click":
            return False
        if previous.get("button", "left") != "left":
            return False
        if event_time - (self.last_event_time or 0) > 0.45:
            return False
        if distance((x, y), (previous.get("x"), previous.get("y"))) > 6:
            return False
        previous["action"] = "doubleClick"
        previous["recordedAt"] = round(event_time - (self.started_at or event_time), 3)
        self.last_event_time = event_time
        emit({"type": "step-updated", "step": previous, "count": len(self.steps)})
        return True

    def on_click(self, x, y, button, pressed):
        if self.paused_event.is_set():
            return
        event_time = now()
        if in_ignored_region(x, y, self.ignore_region):
            return
        name = button_name(button)
        if pressed:
            self.flush_text(event_time)
            self.mouse_down[name] = (x, y, event_time)
            return

        start = self.mouse_down.pop(name, None)
        if not start:
            return

        sx, sy, start_time = start
        moved = distance((sx, sy), (x, y))
        if moved > 10:
            self.add_step(
                {
                    "action": "dragTo",
                    "x": int(round(sx)),
                    "y": int(round(sy)),
                    "x2": int(round(x)),
                    "y2": int(round(y)),
                    "button": name,
                    "durationSeconds": round(max(0.1, event_time - start_time), 2),
                    "repeat": 1,
                },
                start_time,
            )
            return

        action = {
            "left": "click",
            "right": "rightClick",
            "middle": "middleClick",
        }.get(name, "click")
        if action == "click" and self.maybe_merge_double_click(x, y, name, event_time):
            return
        self.add_step(
            {
                "action": action,
                "x": int(round(x)),
                "y": int(round(y)),
                "button": name,
                "repeat": 1,
            },
            event_time,
        )

    def on_scroll(self, x, y, dx, dy):
        if self.paused_event.is_set():
            return
        event_time = now()
        if in_ignored_region(x, y, self.ignore_region):
            return
        self.flush_text(event_time)
        if dy:
            self.add_step(
                {
                    "action": "scroll",
                    "x": int(round(x)),
                    "y": int(round(y)),
                    "value": str(int(dy)),
                    "repeat": 1,
                },
                event_time,
            )
        if dx:
            self.add_step(
                {
                    "action": "horizontalScroll",
                    "x": int(round(x)),
                    "y": int(round(y)),
                    "value": str(int(dx)),
                    "repeat": 1,
                },
                event_time,
            )

    def on_key_press(self, key):
        if self.paused_event.is_set():
            return
        event_time = now()
        name = key_name(key)
        if name in {"ctrl", "ctrl_l", "ctrl_r", "alt", "alt_l", "alt_r", "shift", "shift_l", "shift_r", "cmd", "cmd_l", "cmd_r"}:
            self.modifiers.add(name.split("_")[0])
            return

        if isinstance(key, keyboard.KeyCode) and key.char:
            if self.modifiers:
                self.flush_text(event_time)
                combo = "+".join(sorted(self.modifiers) + [key.char.lower()])
                self.add_step({"action": "hotkey", "value": combo, "repeat": 1}, event_time)
                return
            if not self.text_buffer:
                self.text_started_at = event_time
            self.text_buffer.append(key.char)
            return

        if name == "space" and not self.modifiers:
            if not self.text_buffer:
                self.text_started_at = event_time
            self.text_buffer.append(" ")
            return

        self.flush_text(event_time)
        if self.modifiers and name not in {"shift", "ctrl", "alt", "cmd"}:
            combo = "+".join(sorted(self.modifiers) + [name])
            self.add_step({"action": "hotkey", "value": combo, "repeat": 1}, event_time)
            return

        self.add_step({"action": "pressKey", "value": name, "repeat": 1}, event_time)

    def on_key_release(self, key):
        if self.paused_event.is_set():
            return
        name = key_name(key)
        if name in {"ctrl", "ctrl_l", "ctrl_r", "alt", "alt_l", "alt_r", "shift", "shift_l", "shift_r", "cmd", "cmd_l", "cmd_r"}:
            self.modifiers.discard(name.split("_")[0])

    def stdin_reader(self):
        for line in sys.stdin:
            command = line.strip().lower()
            if command == "stop":
                self.stop_event.set()
                return
            if command == "pause":
                self.pause_capture()
            elif command == "resume":
                self.resume_capture()
            elif command == "redact-last-text":
                self.redact_last_text()

    def run(self):
        emit({"type": "status", "state": "countdown", "delaySeconds": self.delay})
        if self.delay:
            end_time = now() + self.delay
            while now() < end_time:
                if self.stop_event.wait(0.05):
                    emit({"type": "final", "steps": [], "canceled": True})
                    return

        self.started_at = now()
        self.last_event_time = self.started_at
        emit({"type": "status", "state": "recording", "startedAt": self.started_at})

        threading.Thread(target=self.stdin_reader, daemon=True).start()
        self.mouse_listener = mouse.Listener(on_click=self.on_click, on_scroll=self.on_scroll)
        self.keyboard_listener = keyboard.Listener(on_press=self.on_key_press, on_release=self.on_key_release)
        self.mouse_listener.start()
        self.keyboard_listener.start()

        self.stop_event.wait()
        self.flush_text(now())
        if self.mouse_listener:
            self.mouse_listener.stop()
        if self.keyboard_listener:
            self.keyboard_listener.stop()
        emit({"type": "final", "steps": self.steps, "count": len(self.steps)})


def parse_region(value):
    if not value:
        return None
    parts = [float(item) for item in value.split(",")]
    if len(parts) != 4:
        return None
    return tuple(parts)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--delay", type=float, default=2)
    parser.add_argument("--ignore-region", default="")
    args = parser.parse_args()

    try:
        recorder = RoutineRecorder(args.delay, parse_region(args.ignore_region))
        recorder.run()
    except Exception as error:
        emit({"type": "error", "message": str(error)})
        raise


if __name__ == "__main__":
    main()
