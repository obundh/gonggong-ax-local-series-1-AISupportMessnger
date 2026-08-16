import argparse
import json
import os
import queue
import re
import secrets
import sys
import threading
import time
from datetime import datetime

try:
    from pynput import keyboard as pynput_keyboard
except Exception:  # pragma: no cover - the in-app stop button remains available
    pynput_keyboard = None

try:
    import pyautogui
except Exception as import_error:  # pragma: no cover - reported at runtime
    pyautogui = None
    PYAUTOGUI_IMPORT_ERROR = import_error
else:
    PYAUTOGUI_IMPORT_ERROR = None

try:
    import pyperclip
except Exception:  # pragma: no cover - fallback exists
    pyperclip = None


EMIT_LOCK = threading.Lock()
MAX_ROUTINE_REPEATS = 999


def emit(payload):
    with EMIT_LOCK:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def finite_number(value, fallback=None):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if number != number:
        return fallback
    return number


def int_number(value, fallback=None):
    number = finite_number(value, fallback)
    if number is None:
        return fallback
    return int(round(number))


def text_value(value):
    return str(value or "").strip()


def step_repeat(step):
    return max(1, min(50, int_number(step.get("repeat"), 1) or 1))


def routine_repeat_count(value):
    return max(1, min(MAX_ROUTINE_REPEATS, int_number(value, 1) or 1))


def listener_key_name(key):
    name = str(getattr(key, "name", "") or "").strip().lower()
    if name:
        return name
    return str(key or "").strip().lower().removeprefix("key.")


def step_duration(step, fallback=0.1):
    return max(0, min(60, finite_number(step.get("durationSeconds"), fallback) or 0))


def has_xy(step):
    return finite_number(step.get("x")) is not None and finite_number(step.get("y")) is not None


def xy(step):
    return int_number(step.get("x"), 0), int_number(step.get("y"), 0)


def normalize_button(step, default="left"):
    value = text_value(step.get("button")).lower()
    if value in {"right", "우", "우클릭"}:
        return "right"
    if value in {"middle", "휠", "wheel"}:
        return "middle"
    return default


KEY_ALIASES = {
    "control": "ctrl",
    "ctl": "ctrl",
    "컨트롤": "ctrl",
    "알트": "alt",
    "시프트": "shift",
    "커맨드": "command",
    "cmd": "command",
    "윈도우": "win",
    "windows": "win",
    "엔터": "enter",
    "return": "enter",
    "스페이스": "space",
    "스페이스바": "space",
    "esc": "escape",
    "이스케이프": "escape",
    "딜리트": "delete",
    "삭제": "delete",
    "백스페이스": "backspace",
    "탭": "tab",
    "위": "up",
    "아래": "down",
    "왼쪽": "left",
    "오른쪽": "right",
}


def normalize_key(value):
    key = text_value(value).lower().replace(" ", "")
    return KEY_ALIASES.get(key, key)


def split_hotkey(value):
    if isinstance(value, list):
        parts = value
    else:
        parts = re.split(r"\s*\+\s*", text_value(value))
    return [normalize_key(part) for part in parts if normalize_key(part)]


def paste_text(value):
    value = str(value or "")
    if pyperclip:
        previous = None
        try:
            previous = pyperclip.paste()
        except Exception:
            previous = None
        pyperclip.copy(value)
        pyautogui.hotkey("ctrl", "v")
        time.sleep(0.05)
        if previous is not None:
            pyperclip.copy(previous)
        return
    pyautogui.write(value, interval=0.01)


class RoutineRunner:
    def __init__(self, steps, countdown, output_dir, repeat_count=1, repeat_forever=False):
        if pyautogui is None:
            raise RuntimeError(f"pyautogui import failed: {PYAUTOGUI_IMPORT_ERROR}")
        self.steps = list(steps or [])[:200]
        self.countdown = max(0, min(60, float(countdown or 0)))
        self.output_dir = output_dir
        self.repeat_count = routine_repeat_count(repeat_count)
        self.repeat_forever = bool(repeat_forever)
        self.stop_event = threading.Event()
        self.started_at = None
        self.executed = 0
        self.skipped = 0
        self.output_files = []
        self.command_queue = queue.Queue()
        self.held_mouse_buttons = []
        self.held_keys = []
        self.held_input_lock = threading.RLock()
        self.emergency_pressed_keys = set()
        self.emergency_stop_listener = None
        pyautogui.PAUSE = 0.05
        pyautogui.FAILSAFE = True

    def stdin_reader(self):
        for line in sys.stdin:
            command = line.strip()
            if command.lower() == "stop":
                self.request_stop("stop-button")
                return
            action, _, token = command.partition(" ")
            if action.lower() in {"approve", "reject"} and token.strip():
                self.command_queue.put((action.lower(), token.strip()))

    def request_stop(self, reason):
        first_request = not self.stop_event.is_set()
        self.stop_event.set()
        self.command_queue.put(("stop", ""))
        self.release_held_inputs()
        if first_request:
            emit({"type": "status", "state": "stopping", "reason": reason})

    def start_emergency_stop_listener(self):
        if pynput_keyboard is None:
            return

        control_keys = {"ctrl", "ctrl_l", "ctrl_r", "control", "control_l", "control_r"}
        shift_keys = {"shift", "shift_l", "shift_r"}

        def on_press(key):
            name = listener_key_name(key)
            if not name:
                return
            self.emergency_pressed_keys.add(name)
            has_control = bool(self.emergency_pressed_keys.intersection(control_keys))
            has_shift = bool(self.emergency_pressed_keys.intersection(shift_keys))
            if name == "f12" and has_control and has_shift:
                self.request_stop("emergency-hotkey")

        def on_release(key):
            self.emergency_pressed_keys.discard(listener_key_name(key))

        try:
            self.emergency_stop_listener = pynput_keyboard.Listener(
                on_press=on_press,
                on_release=on_release,
            )
            self.emergency_stop_listener.start()
        except Exception:
            self.emergency_stop_listener = None

    def stop_emergency_stop_listener(self):
        listener = self.emergency_stop_listener
        self.emergency_stop_listener = None
        self.emergency_pressed_keys.clear()
        if listener is not None:
            try:
                listener.stop()
            except Exception:
                pass

    def sleep(self, seconds):
        end_time = time.time() + max(0, float(seconds or 0))
        while time.time() < end_time:
            if self.stop_event.wait(min(0.05, max(0, end_time - time.time()))):
                return False
        return True

    def run(self):
        threading.Thread(target=self.stdin_reader, daemon=True).start()
        self.start_emergency_stop_listener()
        emit(
            {
                "type": "status",
                "state": "countdown",
                "delaySeconds": self.countdown,
                "repeatCount": None if self.repeat_forever else self.repeat_count,
                "repeatForever": self.repeat_forever,
            }
        )
        if not self.sleep(self.countdown):
            self.stop_emergency_stop_listener()
            emit({"type": "final", "canceled": True, "executed": 0, "skipped": 0, "cyclesCompleted": 0})
            return

        self.started_at = time.time()
        emit(
            {
                "type": "status",
                "state": "running",
                "count": len(self.steps),
                "repeatCount": None if self.repeat_forever else self.repeat_count,
                "repeatForever": self.repeat_forever,
            }
        )
        cycles_completed = 0
        cycle = 0
        try:
            while not self.stop_event.is_set() and (self.repeat_forever or cycle < self.repeat_count):
                cycle += 1
                emit(
                    {
                        "type": "cycle-start",
                        "cycle": cycle,
                        "totalCycles": None if self.repeat_forever else self.repeat_count,
                        "repeatForever": self.repeat_forever,
                    }
                )
                for index, step in enumerate(self.steps):
                    if self.stop_event.is_set():
                        break
                    self.run_step(index, step, cycle)
                if self.stop_event.is_set():
                    break
                cycles_completed += 1
                emit(
                    {
                        "type": "cycle-done",
                        "cycle": cycle,
                        "totalCycles": None if self.repeat_forever else self.repeat_count,
                        "repeatForever": self.repeat_forever,
                    }
                )
                if (self.repeat_forever or cycle < self.repeat_count) and not self.sleep(0.05):
                    break
        finally:
            self.release_held_inputs()
            self.stop_emergency_stop_listener()

        emit(
            {
                "type": "final",
                "canceled": self.stop_event.is_set(),
                "executed": self.executed,
                "skipped": self.skipped,
                "cyclesCompleted": cycles_completed,
                "repeatCount": None if self.repeat_forever else self.repeat_count,
                "repeatForever": self.repeat_forever,
                "outputFiles": self.output_files,
            }
        )

    def run_step(self, index, step, cycle=1):
        delay_before = finite_number(step.get("delayBefore"), 0) or 0
        if delay_before > 0 and not self.sleep(delay_before):
            return

        repeats = step_repeat(step)
        for repeat_index in range(repeats):
            if self.stop_event.is_set():
                return
            emit(
                {
                    "type": "step-start",
                    "index": index,
                    "repeatIndex": repeat_index,
                    "repeat": repeats,
                    "cycle": cycle,
                    "action": text_value(step.get("action")) or "click",
                }
            )
            try:
                note = self.perform(step, index)
            except pyautogui.FailSafeException:
                self.request_stop("pyautogui-failsafe")
                emit({"type": "error", "message": "Failsafe triggered. Move mouse out of the top-left corner before running again."})
                return
            except Exception as error:
                self.request_stop("execution-error")
                emit({"type": "error", "message": str(error), "index": index})
                return

            if note and note.startswith("skipped:"):
                self.skipped += 1
                emit({"type": "step-done", "index": index, "skipped": True, "note": note.replace("skipped:", "", 1).strip()})
            else:
                self.executed += 1
                emit({"type": "step-done", "index": index, "note": note or ""})

    def current_position(self):
        try:
            current = pyautogui.position()
            return int(current[0]), int(current[1])
        except Exception:
            return 0, 0

    def move_to_cancellable(self, destination_x, destination_y, duration=0):
        duration = max(0, float(duration or 0))
        if duration <= 0:
            if self.stop_event.is_set():
                return False
            pyautogui.moveTo(int(destination_x), int(destination_y), duration=0)
            return not self.stop_event.is_set()

        start_x, start_y = self.current_position()
        slices = max(1, int(duration / 0.02))
        per_slice = duration / slices
        original_pause = getattr(pyautogui, "PAUSE", 0)
        try:
            pyautogui.PAUSE = 0
            for slice_index in range(1, slices + 1):
                if self.stop_event.is_set():
                    return False
                progress = slice_index / slices
                next_x = round(start_x + ((destination_x - start_x) * progress))
                next_y = round(start_y + ((destination_y - start_y) * progress))
                pyautogui.moveTo(next_x, next_y, duration=0)
                if not self.sleep(per_slice):
                    return False
            return True
        finally:
            pyautogui.PAUSE = original_pause

    def hold_mouse_button(self, button):
        with self.held_input_lock:
            if self.stop_event.is_set():
                return False
            pyautogui.mouseDown(button=button)
            if button not in self.held_mouse_buttons:
                self.held_mouse_buttons.append(button)
            return True

    def release_mouse_button(self, button):
        with self.held_input_lock:
            try:
                pyautogui.mouseUp(button=button)
            finally:
                if button in self.held_mouse_buttons:
                    self.held_mouse_buttons.remove(button)

    def move_if_present(self, step, duration=0):
        if has_xy(step):
            return self.move_to_cancellable(*xy(step), duration=max(0, duration))
        return not self.stop_event.is_set()

    def await_approval(self, index, action):
        token = f"step-{index + 1}-{secrets.token_hex(8)}"
        emit(
            {
                "type": "approval-required",
                "index": index,
                "action": action,
                "token": token,
            }
        )
        while not self.stop_event.is_set():
            try:
                command, candidate = self.command_queue.get(timeout=0.05)
            except queue.Empty:
                continue
            if command == "stop":
                return False
            if candidate != token:
                continue
            if command == "approve":
                emit({"type": "approval-resolved", "index": index, "approved": True})
                return True
            emit({"type": "approval-resolved", "index": index, "approved": False})
            self.request_stop("approval-rejected")
            return False
        return False

    def release_held_inputs(self):
        with self.held_input_lock:
            for key in reversed(self.held_keys):
                try:
                    pyautogui.keyUp(key)
                except Exception:
                    pass
            self.held_keys.clear()
            for button in reversed(self.held_mouse_buttons):
                try:
                    pyautogui.mouseUp(button=button)
                except Exception:
                    pass
            self.held_mouse_buttons.clear()

    def perform(self, step, index):
        action = text_value(step.get("action")) or "click"
        duration = step_duration(step)
        value = text_value(step.get("value"))

        if action == "wait":
            seconds = finite_number(step.get("waitSeconds"), 1) or 0
            self.sleep(seconds)
            return f"waited {seconds}s"

        if action == "moveTo":
            self.move_to_cancellable(*xy(step), duration=duration)
            return ""

        if action in {"click", "doubleClick", "rightClick", "middleClick"}:
            button = {
                "rightClick": "right",
                "middleClick": "middle",
            }.get(action, normalize_button(step))
            clicks = 2 if action == "doubleClick" else 1
            if has_xy(step):
                pyautogui.click(*xy(step), clicks=clicks, button=button)
            else:
                pyautogui.click(clicks=clicks, button=button)
            return ""

        if action == "dragTo":
            self.move_if_present(step)
            button = normalize_button(step)
            if self.hold_mouse_button(button):
                try:
                    self.move_to_cancellable(int_number(step.get("x2"), 0), int_number(step.get("y2"), 0), duration=duration)
                finally:
                    self.release_mouse_button(button)
            return ""

        if action == "dragRel":
            self.move_if_present(step)
            start_x, start_y = self.current_position()
            button = normalize_button(step)
            if self.hold_mouse_button(button):
                try:
                    self.move_to_cancellable(
                        start_x + int_number(step.get("x2"), 0),
                        start_y + int_number(step.get("y2"), 0),
                        duration=duration,
                    )
                finally:
                    self.release_mouse_button(button)
            return ""

        if action == "mouseDown":
            button = normalize_button(step)
            if has_xy(step):
                self.move_to_cancellable(*xy(step))
            self.hold_mouse_button(button)
            return ""

        if action == "mouseUp":
            button = normalize_button(step)
            if has_xy(step):
                self.move_to_cancellable(*xy(step))
            self.release_mouse_button(button)
            return ""

        if action == "scroll":
            self.move_if_present(step)
            amount = int_number(value, -5)
            pyautogui.scroll(amount)
            return ""

        if action == "horizontalScroll":
            self.move_if_present(step)
            amount = int_number(value, -5)
            if hasattr(pyautogui, "hscroll"):
                pyautogui.hscroll(amount)
                return ""
            return "skipped: horizontal scroll is not supported on this platform"

        if action == "typeText":
            self.move_if_present(step)
            if has_xy(step):
                pyautogui.click(*xy(step))
            paste_text(value)
            return ""

        if action == "pasteText":
            self.move_if_present(step)
            if has_xy(step):
                pyautogui.click(*xy(step))
            paste_text(value)
            return ""

        if action == "setClipboard":
            if pyperclip is None:
                return "skipped: pyperclip is not available"
            pyperclip.copy(value)
            return ""

        if action == "pressKey":
            pyautogui.press(normalize_key(value or "enter"))
            return ""

        if action == "hotkey":
            keys = split_hotkey(value)
            if not keys:
                return "skipped: no hotkey value"
            pyautogui.hotkey(*keys)
            return ""

        if action == "keyDown":
            key = normalize_key(value or "ctrl")
            with self.held_input_lock:
                if not self.stop_event.is_set():
                    pyautogui.keyDown(key)
                    if key not in self.held_keys:
                        self.held_keys.append(key)
            return ""

        if action == "keyUp":
            key = normalize_key(value or "ctrl")
            with self.held_input_lock:
                pyautogui.keyUp(key)
                if key in self.held_keys:
                    self.held_keys.remove(key)
            return ""

        if action == "screenshot":
            os.makedirs(self.output_dir, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
            file_path = os.path.join(self.output_dir, f"routine-screenshot-{stamp}.png")
            pyautogui.screenshot().save(file_path)
            self.output_files.append(file_path)
            return file_path

        if action == "pixelCheck":
            if not has_xy(step):
                return "skipped: no pixel coordinate"
            color = pyautogui.screenshot().getpixel(xy(step))
            expected = value.lstrip("#").lower()
            actual = "".join(f"{part:02x}" for part in color[:3])
            if expected and expected != actual:
                raise RuntimeError(f"pixel mismatch at {xy(step)} expected #{expected}, got #{actual}")
            return f"#{actual}"

        if action in {"openApp", "openFile"}:
            if not value:
                return "skipped: no path or program"
            if hasattr(os, "startfile"):
                os.startfile(value)
                return ""
            return "skipped: opening files is only supported on this platform through os.startfile"

        if action == "runCommand":
            return "skipped: command execution is disabled in the first runner"

        if action in {"checkpoint", "confirm"}:
            return "approved" if self.await_approval(index, action) else "skipped: approval rejected"

        if action in {"loopStart", "loopEnd", "ifImage", "ifText", "errorStop"}:
            return "skipped: flow-control step is not executable"

        if action in {"waitImage", "clickImage", "locateImage", "waitText", "colorWait", "focusWindow", "closeWindow"}:
            return "skipped: this advanced detection/window step is not wired yet"

        return f"skipped: unsupported action {action}"


def load_steps(path_value):
    if path_value:
        with open(path_value, "r", encoding="utf-8") as file:
            return json.load(file)
    return json.load(sys.stdin)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps-file", default="")
    parser.add_argument("--countdown", type=float, default=3)
    parser.add_argument("--output-dir", default=os.getcwd())
    parser.add_argument("--repeat-count", type=int, default=1)
    parser.add_argument("--repeat-forever", action="store_true")
    args = parser.parse_args()

    try:
        runner = RoutineRunner(
            load_steps(args.steps_file),
            args.countdown,
            args.output_dir,
            repeat_count=args.repeat_count,
            repeat_forever=args.repeat_forever,
        )
        runner.run()
    except Exception as error:
        emit({"type": "error", "message": str(error)})
        raise


if __name__ == "__main__":
    main()
