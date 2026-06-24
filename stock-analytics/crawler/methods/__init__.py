"""Pluggable backtest / optimization methods.

Each method is an independent module here so they can evolve separately:
  - wyckoff_robust_pipeline : 8→4→7 (plateau search → continuous → Monte Carlo)

They reuse the shared engine in ``opt_backtest`` (snapshot context + the
continuous portfolio simulation) rather than re-implementing it.
"""
