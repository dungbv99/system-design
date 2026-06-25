-- Wyckoff robust pipeline (8→4→7) — global params for ALL regimes
-- Load on the target DB:  psql "$DB_DSN" -f <this file>
BEGIN;
INSERT INTO optimized_params (regime, params, run_id, sharpe) VALUES
  ('UPTREND', '{"climax_vol_mult": 2.0, "hi_vol_mult": 1.4, "lo_vol_mult": 0.5, "rsi_entry_max": 55, "rsi_exit_min": 75, "bb_squeeze_thresh": 0.03, "min_signal_score": 3, "max_entry_gap_pct": 999, "atr_stop_mult": 2.0, "atr_trail_pct": 0.8, "profit_giveback_pct": 0.5, "top_n_sectors": 4, "downtrend_drawdown_pct": 0.1, "rs_min_ratio": 0.9}'::jsonb, NULL, 1.771),
  ('SIDEWAYS', '{"climax_vol_mult": 2.0, "hi_vol_mult": 1.4, "lo_vol_mult": 0.5, "rsi_entry_max": 55, "rsi_exit_min": 75, "bb_squeeze_thresh": 0.03, "min_signal_score": 3, "max_entry_gap_pct": 999, "atr_stop_mult": 2.0, "atr_trail_pct": 0.8, "profit_giveback_pct": 0.5, "top_n_sectors": 4, "downtrend_drawdown_pct": 0.1, "rs_min_ratio": 0.9}'::jsonb, NULL, 1.771),
  ('DOWNTREND', '{"climax_vol_mult": 2.0, "hi_vol_mult": 1.4, "lo_vol_mult": 0.5, "rsi_entry_max": 55, "rsi_exit_min": 75, "bb_squeeze_thresh": 0.03, "min_signal_score": 3, "max_entry_gap_pct": 999, "atr_stop_mult": 2.0, "atr_trail_pct": 0.8, "profit_giveback_pct": 0.5, "top_n_sectors": 4, "downtrend_drawdown_pct": 0.1, "rs_min_ratio": 0.9}'::jsonb, NULL, 1.771)
ON CONFLICT (regime) DO UPDATE SET params=EXCLUDED.params, run_id=EXCLUDED.run_id, sharpe=EXCLUDED.sharpe, updated_at=NOW();
COMMIT;
