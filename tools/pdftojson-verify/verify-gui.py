#!/usr/bin/env python3
import os
import re
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


TOOL_DIR = Path(__file__).resolve().parent
VERIFY_SCRIPT = TOOL_DIR / "verify-pdf.py"
DEFAULT_OUTPUT_ROOT = TOOL_DIR / "reports"


class PdfVerifyApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PDF to JSON Verify")
        self.geometry("800x560")
        self.minsize(700, 500)

        self.pdf_path = tk.StringVar()
        self.max_pages = tk.StringVar()
        self.output_root = tk.StringVar(value=str(DEFAULT_OUTPUT_ROOT))
        self.open_after = tk.BooleanVar(value=True)
        self.include_decorative = tk.BooleanVar(value=False)
        self.last_report = None
        self.worker = None

        self._build_ui()

    def _build_ui(self):
        self.columnconfigure(0, weight=1)
        self.rowconfigure(2, weight=1)

        header = ttk.Frame(self, padding=(18, 16, 18, 10))
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)

        ttk.Label(header, text="PDF to JSON Verify", font=("", 16, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Label(header, text="Pick a PDF and inspect extracted JSON blocks, tables, and figures in one HTML report.").grid(
            row=1, column=0, sticky="w", pady=(4, 0)
        )

        form = ttk.Frame(self, padding=(18, 4, 18, 12))
        form.grid(row=1, column=0, sticky="ew")
        form.columnconfigure(1, weight=1)

        ttk.Label(form, text="PDF").grid(row=0, column=0, sticky="w", padx=(0, 10), pady=6)
        ttk.Entry(form, textvariable=self.pdf_path).grid(row=0, column=1, sticky="ew", pady=6)
        ttk.Button(form, text="Browse", command=self.choose_pdf).grid(row=0, column=2, padx=(8, 0), pady=6)

        ttk.Label(form, text="Output").grid(row=1, column=0, sticky="w", padx=(0, 10), pady=6)
        ttk.Entry(form, textvariable=self.output_root).grid(row=1, column=1, sticky="ew", pady=6)
        ttk.Button(form, text="Change", command=self.choose_output).grid(row=1, column=2, padx=(8, 0), pady=6)

        options = ttk.Frame(form)
        options.grid(row=2, column=1, columnspan=2, sticky="ew", pady=(8, 2))
        options.columnconfigure(5, weight=1)
        ttk.Label(options, text="Quick pages").grid(row=0, column=0, sticky="w")
        ttk.Entry(options, textvariable=self.max_pages, width=8).grid(row=0, column=1, sticky="w", padx=(8, 18))
        ttk.Label(options, text="blank = all pages").grid(row=0, column=2, sticky="w", padx=(0, 18))
        ttk.Checkbutton(options, text="Open report", variable=self.open_after).grid(row=0, column=3, sticky="w", padx=(0, 18))
        ttk.Checkbutton(options, text="Include decorative images", variable=self.include_decorative).grid(row=0, column=4, sticky="w")

        actions = ttk.Frame(form)
        actions.grid(row=3, column=1, columnspan=2, sticky="ew", pady=(12, 0))
        self.run_button = ttk.Button(actions, text="Build Report", command=self.start_verify)
        self.run_button.pack(side="left")
        self.open_button = ttk.Button(actions, text="Open Last Report", command=self.open_last_report, state="disabled")
        self.open_button.pack(side="left", padx=(8, 0))
        ttk.Button(actions, text="Clear Log", command=self.clear_log).pack(side="left", padx=(8, 0))

        log_frame = ttk.Frame(self, padding=(18, 0, 18, 18))
        log_frame.grid(row=2, column=0, sticky="nsew")
        log_frame.rowconfigure(1, weight=1)
        log_frame.columnconfigure(0, weight=1)

        self.status = ttk.Label(log_frame, text="Ready")
        self.status.grid(row=0, column=0, sticky="w", pady=(0, 8))

        self.log = tk.Text(log_frame, height=16, wrap="word", font=("Consolas", 10))
        self.log.grid(row=1, column=0, sticky="nsew")
        scrollbar = ttk.Scrollbar(log_frame, orient="vertical", command=self.log.yview)
        scrollbar.grid(row=1, column=1, sticky="ns")
        self.log.configure(yscrollcommand=scrollbar.set)

        ttk.Label(log_frame, text="Tip: drag a PDF onto verify-pdf.cmd to build a report immediately.").grid(
            row=2, column=0, sticky="w", pady=(8, 0)
        )

    def choose_pdf(self):
        path = filedialog.askopenfilename(
            title="Choose PDF",
            filetypes=[("PDF files", "*.pdf"), ("All files", "*.*")],
            initialdir=str(Path.home()),
        )
        if path:
            self.pdf_path.set(path)

    def choose_output(self):
        path = filedialog.askdirectory(title="Choose report output folder", initialdir=str(TOOL_DIR))
        if path:
            self.output_root.set(path)

    def start_verify(self):
        if self.worker and self.worker.is_alive():
            messagebox.showinfo("Running", "A report is already being generated.")
            return

        pdf = Path(self.pdf_path.get().strip('" '))
        if not pdf.exists() or pdf.suffix.lower() != ".pdf":
            messagebox.showwarning("PDF required", "Please choose a PDF file first.")
            return

        max_pages = self.max_pages.get().strip()
        if max_pages and (not max_pages.isdigit() or int(max_pages) < 1):
            messagebox.showwarning("Check page count", "Quick pages must be a positive integer.")
            return

        output_root = Path(self.output_root.get().strip('" '))
        output_root.mkdir(parents=True, exist_ok=True)

        cmd = [
            sys.executable,
            str(VERIFY_SCRIPT),
            "--input",
            str(pdf),
            "--out",
            str(output_root),
        ]
        if max_pages:
            cmd.extend(["--max-pages", max_pages])
        if self.include_decorative.get():
            cmd.append("--include-decorative")

        self.run_button.configure(state="disabled")
        self.status.configure(text="Building report...")
        self.append_log("> " + " ".join(quote_arg(part) for part in cmd))
        self.worker = threading.Thread(target=self._run_verify, args=(cmd,), daemon=True)
        self.worker.start()

    def _run_verify(self, cmd):
        report_path = None
        try:
            process = subprocess.Popen(
                cmd,
                cwd=str(TOOL_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
            assert process.stdout is not None
            for line in process.stdout:
                stripped = line.rstrip()
                self.after(0, self.append_log, stripped)
                match = re.search(r"Open:\s+(.+index\.html)\s*$", stripped)
                if match:
                    raw_path = Path(match.group(1).strip())
                    report_path = raw_path if raw_path.is_absolute() else TOOL_DIR / raw_path
            code = process.wait()
            if code == 0:
                self.after(0, self._finish_success, report_path)
            else:
                self.after(0, self._finish_failure, code)
        except Exception as exc:
            self.after(0, self._finish_exception, exc)

    def _finish_success(self, report_path):
        self.run_button.configure(state="normal")
        self.status.configure(text="Done")
        if report_path and report_path.exists():
            self.last_report = report_path
            self.open_button.configure(state="normal")
            if self.open_after.get():
                open_file(report_path)
        messagebox.showinfo("Done", "The PDF verification report is ready.")

    def _finish_failure(self, code):
        self.run_button.configure(state="normal")
        self.status.configure(text=f"Failed: exit {code}")
        messagebox.showerror("Failed", f"Report generation failed. Check the log. exit={code}")

    def _finish_exception(self, exc):
        self.run_button.configure(state="normal")
        self.status.configure(text="Failed")
        self.append_log(f"ERROR: {exc}")
        messagebox.showerror("Error", str(exc))

    def open_last_report(self):
        if self.last_report and self.last_report.exists():
            open_file(self.last_report)
        else:
            messagebox.showinfo("No report", "No report has been generated yet.")

    def append_log(self, text):
        self.log.insert("end", text + "\n")
        self.log.see("end")

    def clear_log(self):
        self.log.delete("1.0", "end")


def quote_arg(value):
    value = str(value)
    return f'"{value}"' if " " in value else value


def open_file(path):
    path = Path(path)
    if sys.platform.startswith("win"):
        os.startfile(path)
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


def main():
    app = PdfVerifyApp()
    app.mainloop()


if __name__ == "__main__":
    main()
