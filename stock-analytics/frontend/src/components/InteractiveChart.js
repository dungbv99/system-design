import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CrosshairMode, ColorType, LineStyle, } from 'lightweight-charts';
import { aggregateWeekly, aggregateMonthly } from '../utils';
import { INDICATOR_DEFS } from '../indicators/defs';
import { calcMA, calcEMA, calcBB, calcRSI, calcMACD, calcStoch, calcVWAP, calcSuperTrend, calc52WHL, calcAroon, calcADX, calcCCI, calcATR, calcWilliamsR, calcOBV, calcBBW, calcIchimoku, calcParabolicSAR, calcDonchian, calcPivotPoints, calcFibLevels, calcMFI, calcROC, calcCMF, calcWyckoffClimax, } from '../indicators/math';
export function InteractiveChart({ quotes, indicators }) {
    const [tf, setTf] = useState('D');
    const activeQuotes = useMemo(() => {
        if (tf === 'W')
            return aggregateWeekly(quotes);
        if (tf === 'M')
            return aggregateMonthly(quotes);
        return quotes;
    }, [quotes, tf]);
    const priceRef = useRef(null);
    const rsiRef = useRef(null);
    const macdRef = useRef(null);
    const stochRef = useRef(null);
    const aroonRef = useRef(null);
    const adxRef = useRef(null);
    const cciRef = useRef(null);
    const atrRef = useRef(null);
    const williamsrRef = useRef(null);
    const obvRef = useRef(null);
    const bbwRef = useRef(null);
    const mfiRef = useRef(null);
    const rocRef = useRef(null);
    const cmfRef = useRef(null);
    const chartsRef = useRef([]);
    useEffect(() => {
        const quotes = activeQuotes; // shadow prop so all chart code below is unchanged
        chartsRef.current = [];
        if (!priceRef.current || quotes.length < 5)
            return;
        const THEME = {
            layout: { background: { type: ColorType.Solid, color: '#0d1117' }, textColor: '#8b949e' },
            grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
            rightPriceScale: { borderColor: '#30363d' },
            timeScale: { borderColor: '#30363d', timeVisible: true },
        };
        const t = (q) => q.date;
        const closes = quotes.map(q => q.close);
        // ── Price pane ────────────────────────────────────────────────────────────
        const priceChart = createChart(priceRef.current, {
            ...THEME, crosshair: { mode: CrosshairMode.Normal }, height: 520,
        });
        const candleSeries = priceChart.addCandlestickSeries({
            upColor: '#34d399', downColor: '#f87171',
            borderUpColor: '#34d399', borderDownColor: '#f87171',
            wickUpColor: '#34d399', wickDownColor: '#f87171',
        });
        candleSeries.setData(quotes.map(q => ({ time: t(q), open: q.open, high: q.high, low: q.low, close: q.close })));
        const addLine = (vals, color, w = 1) => {
            const s = priceChart.addLineSeries({ color, lineWidth: w, priceLineVisible: false, lastValueVisible: false });
            s.setData(vals.flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: v }]));
        };
        // Volume
        if (indicators.has('volume')) {
            const volS = priceChart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
            priceChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
            volS.setData(quotes.map(q => ({
                time: t(q), value: q.volume,
                color: q.close >= q.open ? '#15803d60' : '#b91c1c60',
            })));
        }
        // Moving averages
        if (indicators.has('ma20'))
            addLine(calcMA(closes, 20), '#facc15');
        if (indicators.has('ma50'))
            addLine(calcMA(closes, 50), '#60a5fa');
        if (indicators.has('ma200'))
            addLine(calcMA(closes, 200), '#f472b6');
        if (indicators.has('ema20'))
            addLine(calcEMA(closes, 20), '#fb923c');
        if (indicators.has('ema50'))
            addLine(calcEMA(closes, 50), '#34d399');
        if (indicators.has('ema200'))
            addLine(calcEMA(closes, 200), '#c084fc');
        // Bollinger Bands
        if (indicators.has('bb')) {
            const bb = calcBB(closes);
            const addBBLine = (key, color) => addLine(bb.map(v => v == null ? null : v[key]), color);
            addBBLine('upper', '#8b5cf6');
            addBBLine('mid', '#8b5cf660');
            addBBLine('lower', '#8b5cf6');
        }
        // VWAP
        if (indicators.has('vwap'))
            addLine(calcVWAP(quotes), '#f97316', 2);
        // SuperTrend
        if (indicators.has('supertrend')) {
            const st = calcSuperTrend(quotes);
            const sBull = priceChart.addLineSeries({ color: '#10b981', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
            const sBear = priceChart.addLineSeries({ color: '#f43f5e', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
            sBull.setData(st.flatMap((v, i) => v.value == null || !v.bullish ? [] : [{ time: t(quotes[i]), value: v.value }]));
            sBear.setData(st.flatMap((v, i) => v.value == null || v.bullish ? [] : [{ time: t(quotes[i]), value: v.value }]));
        }
        // 52-Week High/Low
        if (indicators.has('52whl')) {
            const whl = calc52WHL(quotes);
            addLine(whl.map(v => v.high), '#06b6d4');
            addLine(whl.map(v => v.low), '#f59e0b');
        }
        // Donchian Channels (20)
        if (indicators.has('donchian')) {
            const dc = calcDonchian(quotes);
            addLine(dc.map(v => v.upper), '#00bcd4');
            addLine(dc.map(v => v.lower), '#00bcd4');
            addLine(dc.map(v => v.mid), '#00bcd4');
        }
        // Ichimoku Cloud
        if (indicators.has('ichimoku')) {
            const ic = calcIchimoku(quotes);
            const cloudPts = [];
            ic.forEach((v, i) => {
                const fwd = i + 26;
                if (v.spanA != null && v.spanB != null && fwd < quotes.length)
                    cloudPts.push({ time: t(quotes[fwd]), spanA: v.spanA, spanB: v.spanB });
            });
            const mkArea = (data, color) => {
                const s = priceChart.addAreaSeries({
                    lineVisible: false, crosshairMarkerVisible: false,
                    topColor: color, bottomColor: color,
                    priceLineVisible: false, lastValueVisible: false,
                });
                s.setData(data);
            };
            const CHART_BG = '#0d1117';
            const bullish = cloudPts.filter(d => d.spanA >= d.spanB);
            const bearish = cloudPts.filter(d => d.spanB > d.spanA);
            if (bullish.length) {
                mkArea(bullish.map(d => ({ time: d.time, value: d.spanA })), 'rgba(38,166,154,0.25)');
                mkArea(bullish.map(d => ({ time: d.time, value: d.spanB })), CHART_BG);
            }
            if (bearish.length) {
                mkArea(bearish.map(d => ({ time: d.time, value: d.spanB })), 'rgba(239,83,80,0.25)');
                mkArea(bearish.map(d => ({ time: d.time, value: d.spanA })), CHART_BG);
            }
            addLine(ic.map(v => v.tenkan), '#e05c5c');
            addLine(ic.map(v => v.kijun), '#2196f3', 2);
            const mkFwd = (vals, color) => {
                const s = priceChart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
                s.setData(vals.flatMap((v, i) => {
                    const fwd = i + 26;
                    return v == null || fwd >= quotes.length ? [] : [{ time: t(quotes[fwd]), value: v }];
                }));
            };
            mkFwd(ic.map(v => v.spanA), '#26a69a');
            mkFwd(ic.map(v => v.spanB), '#ef5350');
            const chikouS = priceChart.addLineSeries({ color: '#ab47bc', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed });
            chikouS.setData(quotes.flatMap((q, i) => i < 26 ? [] : [{ time: t(quotes[i - 26]), value: q.close }]));
        }
        // Accumulate candle markers (PSAR + Wyckoff combined)
        const allMarkers = [];
        if (indicators.has('psar')) {
            calcParabolicSAR(quotes).forEach((v, i) => {
                if (v.sar == null)
                    return;
                allMarkers.push({ time: t(quotes[i]), position: v.bull ? 'belowBar' : 'aboveBar', color: v.bull ? '#26a69a' : '#ef5350', shape: 'circle', size: 0.3 });
            });
        }
        if (indicators.has('wyckoff')) {
            calcWyckoffClimax(quotes).forEach((type, i) => {
                if (!type)
                    return;
                allMarkers.push({ time: t(quotes[i]), position: type === 'SC' ? 'belowBar' : 'aboveBar', color: type === 'SC' ? '#ef5350' : '#26a69a', shape: type === 'SC' ? 'arrowUp' : 'arrowDown', text: type, size: 1 });
            });
        }
        if (allMarkers.length > 0) {
            allMarkers.sort((a, b) => a.time < b.time ? -1 : 1);
            candleSeries.setMarkers(allMarkers);
        }
        // Fibonacci Retracement
        if (indicators.has('fib')) {
            const fibColors = ['#f44336', '#ff9800', '#ffeb3b', '#66bb6a', '#2196f3', '#9c27b0', '#f44336'];
            calcFibLevels(quotes).forEach(({ ratio, value }, i) => candleSeries.createPriceLine({ price: value, color: fibColors[i], lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Fib ${(ratio * 100).toFixed(1)}%` }));
        }
        // Pivot Points
        if (indicators.has('pivot')) {
            const last = calcPivotPoints(quotes)[quotes.length - 1];
            if (last.pp != null) {
                ;
                ([
                    { p: last.r2, c: '#ef5350', l: 'R2' },
                    { p: last.r1, c: '#ff7043', l: 'R1' },
                    { p: last.pp, c: '#90a4ae', l: 'PP' },
                    { p: last.s1, c: '#66bb6a', l: 'S1' },
                    { p: last.s2, c: '#26a69a', l: 'S2' },
                ]).forEach(({ p, c, l }) => candleSeries.createPriceLine({ price: p, color: c, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: l }));
            }
        }
        priceChart.timeScale().fitContent();
        const allCharts = [priceChart];
        const makePane = (ref, h) => {
            if (!ref)
                return null;
            const c = createChart(ref, { ...THEME, crosshair: { mode: CrosshairMode.Normal }, height: h });
            allCharts.push(c);
            return c;
        };
        // ── Oscillator panes ──────────────────────────────────────────────────────
        if (indicators.has('rsi') && rsiRef.current) {
            const c = makePane(rsiRef.current, 140);
            const s = c.addLineSeries({ color: '#a78bfa', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(calcRSI(closes).flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: +v.toFixed(2) }]));
            s.createPriceLine({ price: 70, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '70' });
            s.createPriceLine({ price: 30, color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '30' });
            s.createPriceLine({ price: 50, color: '#374151', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
            c.timeScale().fitContent();
        }
        if (indicators.has('macd') && macdRef.current) {
            const c = makePane(macdRef.current, 140);
            const macdData = calcMACD(closes);
            const addMacdLine = (key, color) => {
                const s = c.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
                s.setData(macdData.flatMap((v, i) => v[key] == null ? [] : [{ time: t(quotes[i]), value: +v[key].toFixed(4) }]));
            };
            addMacdLine('macd', '#22d3ee');
            addMacdLine('signal', '#f87171');
            const hist = c.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
            hist.setData(macdData.flatMap((v, i) => v.hist == null ? [] : [{
                    time: t(quotes[i]), value: v.hist,
                    color: v.hist >= 0 ? '#15803d80' : '#b91c1c80',
                }]));
            c.timeScale().fitContent();
        }
        if (indicators.has('stoch') && stochRef.current) {
            const c = makePane(stochRef.current, 140);
            const stData = calcStoch(quotes);
            const addStLine = (key, color) => {
                const s = c.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
                s.setData(stData.flatMap((v, i) => v[key] == null ? [] : [{ time: t(quotes[i]), value: +v[key].toFixed(2) }]));
                return s;
            };
            const kS = addStLine('k', '#f59e0b');
            addStLine('d', '#60a5fa');
            kS.createPriceLine({ price: 80, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '80' });
            kS.createPriceLine({ price: 20, color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '20' });
            c.timeScale().fitContent();
        }
        if (indicators.has('aroon') && aroonRef.current) {
            const c = makePane(aroonRef.current, 130);
            const arData = calcAroon(quotes);
            const mkLine = (key, color) => {
                const s = c.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
                s.setData(arData.flatMap((v, i) => v[key] == null ? [] : [{ time: t(quotes[i]), value: +v[key].toFixed(2) }]));
                return s;
            };
            const upS = mkLine('up', '#4ade80');
            mkLine('down', '#f87171');
            upS.createPriceLine({ price: 70, color: '#374151', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
            c.timeScale().fitContent();
        }
        if (indicators.has('adx') && adxRef.current) {
            const c = makePane(adxRef.current, 140);
            const adxData = calcADX(quotes);
            const mkLine = (key, color) => {
                const s = c.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
                s.setData(adxData.flatMap((v, i) => v[key] == null ? [] : [{ time: t(quotes[i]), value: v[key] }]));
                return s;
            };
            mkLine('adx', '#f43f5e');
            mkLine('pdi', '#4ade80');
            mkLine('ndi', '#f87171');
            c.timeScale().fitContent();
        }
        if (indicators.has('cci') && cciRef.current) {
            const c = makePane(cciRef.current, 130);
            const s = c.addLineSeries({ color: '#eab308', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(calcCCI(quotes).flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: +v.toFixed(2) }]));
            s.createPriceLine({ price: 100, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '100' });
            s.createPriceLine({ price: -100, color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '-100' });
            s.createPriceLine({ price: 0, color: '#374151', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
            c.timeScale().fitContent();
        }
        if (indicators.has('atr') && atrRef.current) {
            const c = makePane(atrRef.current, 120);
            const s = c.addLineSeries({ color: '#94a3b8', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(calcATR(quotes).flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: v }]));
            c.timeScale().fitContent();
        }
        if (indicators.has('williamsr') && williamsrRef.current) {
            const c = makePane(williamsrRef.current, 130);
            const s = c.addLineSeries({ color: '#06b6d4', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(calcWilliamsR(quotes).flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: +v.toFixed(2) }]));
            s.createPriceLine({ price: -20, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '-20' });
            s.createPriceLine({ price: -80, color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '-80' });
            c.timeScale().fitContent();
        }
        if (indicators.has('obv') && obvRef.current) {
            const c = makePane(obvRef.current, 120);
            const obv = calcOBV(quotes);
            const s = c.addLineSeries({ color: '#a3e635', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(obv.map((v, i) => ({ time: t(quotes[i]), value: v })));
            c.timeScale().fitContent();
        }
        if (indicators.has('bbw') && bbwRef.current) {
            const c = makePane(bbwRef.current, 120);
            const s = c.addLineSeries({ color: '#e879f9', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(calcBBW(closes).flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: +v.toFixed(4) }]));
            c.timeScale().fitContent();
        }
        if (indicators.has('mfi') && mfiRef.current) {
            const c = makePane(mfiRef.current, 140);
            const s = c.addLineSeries({ color: '#26c6da', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(calcMFI(quotes).flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: +v.toFixed(2) }]));
            s.createPriceLine({ price: 80, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '80' });
            s.createPriceLine({ price: 20, color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '20' });
            s.createPriceLine({ price: 50, color: '#374151', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
            c.timeScale().fitContent();
        }
        if (indicators.has('roc') && rocRef.current) {
            const c = makePane(rocRef.current, 120);
            const s = c.addLineSeries({ color: '#ffca28', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            s.setData(calcROC(closes).flatMap((v, i) => v == null ? [] : [{ time: t(quotes[i]), value: +v.toFixed(2) }]));
            s.createPriceLine({ price: 0, color: '#4b5563', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: '' });
            c.timeScale().fitContent();
        }
        if (indicators.has('cmf') && cmfRef.current) {
            const c = makePane(cmfRef.current, 120);
            const hist = c.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
            hist.setData(calcCMF(quotes).flatMap((v, i) => v == null ? [] : [{
                    time: t(quotes[i]), value: +v.toFixed(4),
                    color: v >= 0 ? '#26a69a80' : '#ef535080',
                }]));
            hist.createPriceLine({ price: 0, color: '#4b5563', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: '' });
            c.timeScale().fitContent();
        }
        // ── Sync all panes ────────────────────────────────────────────────────────
        allCharts.forEach((chart, idx) => {
            chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
                if (!range)
                    return;
                allCharts.forEach((c, j) => { if (j !== idx)
                    c.timeScale().setVisibleLogicalRange(range); });
            });
        });
        const observer = new ResizeObserver(() => {
            const w = priceRef.current?.clientWidth;
            if (w)
                allCharts.forEach(c => c.applyOptions({ width: w }));
        });
        observer.observe(priceRef.current);
        chartsRef.current = allCharts;
        return () => { observer.disconnect(); allCharts.forEach(c => { try {
            c.remove();
        }
        catch { } }); };
    }, [activeQuotes, indicators]);
    if (activeQuotes.length < 5)
        return (_jsx("div", { className: "text-[#8b949e] text-xs py-8 text-center", children: "No history yet \u2014 go to the Crawl tab and run \"Full History (all time)\"" }));
    const activeLegend = INDICATOR_DEFS.filter(d => d.category === 'Overlay' && d.id !== 'volume' && indicators.has(d.id));
    const paneLabel = (id, label, ref) => indicators.has(id) && (_jsxs(_Fragment, { children: [_jsx("div", { className: "text-xs text-[#8b949e]/60 px-1 pt-1", children: label }), _jsx("div", { ref: ref, className: "w-full" })] }));
    const TF_OPTIONS = [
        { id: 'D', label: 'Day', count: `${quotes.length}D` },
        { id: 'W', label: 'Week', count: `${aggregateWeekly(quotes).length}W` },
        { id: 'M', label: 'Month', count: `${aggregateMonthly(quotes).length}M` },
    ];
    return (_jsxs("div", { className: "space-y-0", children: [_jsxs("div", { className: "flex items-center justify-between mb-1.5 flex-wrap gap-2", children: [_jsx("div", { className: "flex gap-1", children: TF_OPTIONS.map(opt => (_jsxs("button", { onClick: () => setTf(opt.id), className: `px-2.5 py-1 rounded text-[11px] font-bold border transition-all
                ${tf === opt.id
                                ? 'bg-[#58a6ff] text-[#0d1117] border-[#58a6ff]'
                                : 'bg-[#21262d] text-[#8b949e] border-[#30363d] hover:text-[#e6edf3] hover:border-[#8b949e]/50'}`, children: [opt.label, _jsx("span", { className: `ml-1 text-[9px] ${tf === opt.id ? 'text-[#0d1117]/70' : 'text-[#8b949e]/60'}`, children: opt.count })] }, opt.id))) }), activeLegend.length > 0 && (_jsx("div", { className: "flex flex-wrap gap-3 text-xs text-[#8b949e]", children: activeLegend.map(d => (_jsxs("span", { children: [_jsx("span", { style: { color: d.color }, children: "\u2501" }), " ", d.label] }, d.id))) }))] }), _jsx("div", { ref: priceRef, className: "w-full" }), paneLabel('rsi', 'RSI (14)', rsiRef), paneLabel('macd', 'MACD (12,26,9)', macdRef), paneLabel('stoch', 'Stochastic (14,3)', stochRef), paneLabel('aroon', 'Aroon (14)', aroonRef), paneLabel('adx', 'ADX / DI (14)', adxRef), paneLabel('cci', 'CCI (20)', cciRef), paneLabel('atr', 'ATR (14)', atrRef), paneLabel('williamsr', 'Williams %R (14)', williamsrRef), paneLabel('obv', 'OBV', obvRef), paneLabel('bbw', 'BB Width', bbwRef), paneLabel('mfi', 'MFI (14)', mfiRef), paneLabel('roc', 'ROC (14)', rocRef), paneLabel('cmf', 'CMF (20)', cmfRef), _jsx("div", { className: "text-xs text-[#8b949e]/40 text-right pt-0.5", children: "scroll to zoom \u00B7 drag to pan" })] }));
}
