"""
Lightweight backtest progress reporter.

A process-wide singleton that the long-running backtest writes to a small JSON
file (``output/backtest_progress.json`` when the mounted output dir exists, else
``/tmp``).  ``GET /api/backtest/progress`` and ``make backtest-progress`` read it,
so a run that takes 30 min–6 h can be polled as a simple ``X/100%``.

Overall percent is a weighted blend of the pipeline phases (precompute dominates
wall-clock, so it carries the most weight):

    precompute (snapshots) ── 50%
    walk_forward (9 splits) ── 35%
    optimize (per regime)  ── 15%
"""

from __future__ import annotations

import json
import os
import time

# (phase key, label, weight, cumulative-offset-before-this-phase)
_PHASES = [
    ("precompute",   "Pre-computing signal snapshots", 50.0,  0.0),
    ("walk_forward", "Walk-forward optimization",      35.0, 50.0),
    ("optimize",     "Per-regime optimization",        15.0, 85.0),
]
_WEIGHT = {k: w for k, _, w, _ in _PHASES}
_OFFSET = {k: o for k, _, _, o in _PHASES}
_LABEL  = {k: l for k, l, _, _ in _PHASES}


def _path() -> str:
    return "output/backtest_progress.json" if os.path.isdir("output") \
        else "/tmp/backtest_progress.json"


class Progress:
    def __init__(self):
        self.active = False
        self.phase = ""
        self.current = 0
        self.total = 0
        self.message = ""
        self.started_at = 0.0
        self._last_write = 0.0
        self._ticks = 0
        # Phase plan (weights/offsets/labels). Defaults to the 3a pipeline; a
        # different pipeline can replace it for its run via ``set_plan``.
        self._weight = dict(_WEIGHT)
        self._offset = dict(_OFFSET)
        self._label = dict(_LABEL)

    # ── lifecycle ────────────────────────────────────────────────────────────
    def start(self, message: str = "starting") -> None:
        self.active = True
        self.phase = ""
        self.current = self.total = 0
        self.message = message
        self.started_at = time.time()
        # Reset to the default plan; callers override with set_plan() after.
        self._weight, self._offset, self._label = dict(_WEIGHT), dict(_OFFSET), dict(_LABEL)
        self._write(force=True)

    def set_plan(self, phases: list[tuple[str, str, float]]) -> None:
        """Define this run's phases as (key, label, weight). Offsets are derived
        from cumulative weights, normalised to 100%. Lets a non-3a pipeline
        report a correct overall percent through the same reporter/endpoint."""
        total_w = sum(w for _, _, w in phases) or 1.0
        self._weight, self._offset, self._label = {}, {}, {}
        off = 0.0
        for key, label, w in phases:
            nw = w / total_w * 100.0
            self._weight[key] = nw
            self._offset[key] = off
            self._label[key] = label
            off += nw
        self._write(force=True)

    def set_phase(self, phase: str, total: int, message: str = "") -> None:
        self.phase = phase
        self.total = max(1, total)
        self.current = 0
        self.message = message or self._label.get(phase, phase)
        self._write(force=True)

    def tick(self, n: int = 1) -> None:
        self.current = min(self.total, self.current + n)
        self._ticks += 1
        # Force a write every 25 ticks so the cross-process `make` poller sees
        # intra-phase movement even when ticks are faster than the time throttle.
        self._write(force=self._ticks % 25 == 0)

    def finish(self, message: str = "done") -> None:
        self.phase = "done"
        self.current = self.total = 1
        self.message = message
        self.active = False
        self._write(force=True)

    def fail(self, message: str) -> None:
        self.phase = "error"
        self.message = message
        self.active = False
        self._write(force=True)

    # ── computed ─────────────────────────────────────────────────────────────
    def overall_pct(self) -> float:
        if self.phase == "done":
            return 100.0
        if self.phase not in self._weight:
            return 0.0
        frac = self.current / self.total if self.total else 0.0
        return round(self._offset[self.phase] + self._weight[self.phase] * frac, 1)

    def snapshot(self) -> dict:
        elapsed = time.time() - self.started_at if self.started_at else 0.0
        pct = self.overall_pct()
        eta = (elapsed * (100 - pct) / pct) if 0 < pct < 100 else None
        return {
            "active": self.active,
            "phase": self.phase or None,
            "message": self.message,
            "phase_current": self.current,
            "phase_total": self.total,
            "overall_pct": pct,
            "elapsed_sec": round(elapsed),
            "eta_sec": round(eta) if eta is not None else None,
        }

    # ── io (throttled) ───────────────────────────────────────────────────────
    def _write(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and (now - self._last_write) < 0.5:
            return
        self._last_write = now
        try:
            with open(_path(), "w", encoding="utf-8") as fh:
                json.dump(self.snapshot(), fh)
        except OSError:
            pass


_INSTANCE = Progress()


def get() -> Progress:
    return _INSTANCE


def read() -> dict:
    """Read the latest progress snapshot from disk (for the API / CLI)."""
    try:
        with open(_path(), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {"active": False, "phase": None, "overall_pct": 0.0,
                "message": "no backtest has run yet"}
