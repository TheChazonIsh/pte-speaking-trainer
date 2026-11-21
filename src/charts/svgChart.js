import { DI_COLOR_PALETTE } from '../config/constants.js';
import { escapeHtml, sanitizeSvgColor } from '../utils/security.js';

export function renderSvgChart(q) {
  const W = 640;
  const H = 350;
  const toFiniteNum = (val, fallback = 0) => {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
  };
  const renderEmptyChart = (msg = '표시할 차트 데이터가 없습니다.') => {
    const safeTitle = escapeHtml(q?.title || 'Describe Image Chart');
    const safeSubtitle = escapeHtml(q?.subtitle || '');
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full max-w-[640px] h-auto rounded-lg border border-slate-200 bg-white shadow-xs" role="img" aria-label="${safeTitle}">
      <rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="#ffffff" />
      <text x="${W / 2}" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="#0f172a">${safeTitle}</text>
      ${safeSubtitle ? `<text x="${W / 2}" y="43" text-anchor="middle" font-size="11.5" fill="#64748b">${safeSubtitle}</text>` : ''}
      <rect x="60" y="76" width="${W - 120}" height="${H - 116}" rx="12" fill="#f8fafc" stroke="#cbd5e1" stroke-dasharray="6 4" />
      <text x="${W / 2}" y="${H / 2 + 16}" text-anchor="middle" font-size="13.5" font-weight="600" fill="#64748b">${escapeHtml(msg)}</text>
    </svg>`;
  };

  if (!q || typeof q !== 'object') {
    return renderEmptyChart();
  }

  let inner = `
    <rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="#ffffff" />
    <text x="${W / 2}" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="#0f172a">${escapeHtml(q.title || '')}</text>
    <text x="${W / 2}" y="43" text-anchor="middle" font-size="11.5" fill="#64748b">${escapeHtml(q.subtitle || '')}</text>
  `;

  if (q.chartType === 'pie') {
    const slices = Array.isArray(q.slices) ? q.slices.filter(s => s && typeof s === 'object') : [];
    if (slices.length === 0) return renderEmptyChart();

    const cx = 195;
    const cy = 198;
    const r = 112;
    const total = slices.reduce((sum, s) => sum + Math.max(0, toFiniteNum(s.value, 0)), 0);
    if (!(total > 0)) return renderEmptyChart();
    let startAngle = -Math.PI / 2;

    slices.forEach((s, idx) => {
      const val = Math.max(0, toFiniteNum(s.value, 0));
      const color = sanitizeSvgColor(s.color, DI_COLOR_PALETTE[idx % DI_COLOR_PALETTE.length]);
      const sliceAngle = (val / total) * Math.PI * 2;
      const endAngle = startAngle + sliceAngle;
      const midAngle = startAngle + sliceAngle / 2;

      if (sliceAngle >= Math.PI * 1.9999) {
        inner += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#ffffff" stroke-width="2" />`;
      } else if (sliceAngle > 0) {
        const x1 = cx + r * Math.cos(startAngle);
        const y1 = cy + r * Math.sin(startAngle);
        const x2 = cx + r * Math.cos(endAngle);
        const y2 = cy + r * Math.sin(endAngle);
        const largeArc = sliceAngle > Math.PI ? 1 : 0;
        inner += `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${color}" stroke="#ffffff" stroke-width="2" />`;
      }

      // Percentage text inside slice
      const labelR = val >= 12 ? r * 0.65 : r * 0.78;
      const lx = cx + labelR * Math.cos(midAngle);
      const ly = cy + labelR * Math.sin(midAngle);
      inner += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" font-size="11.5" font-weight="800" fill="#ffffff">${val}%</text>`;

      // Right-side legend
      const legX = 365;
      const legY = 108 + idx * 42;
      inner += `
        <rect x="${legX}" y="${legY}" width="16" height="16" rx="4" fill="${color}" />
        <text x="${legX + 26}" y="${legY + 13}" font-size="13" font-weight="600" fill="#1e293b">${escapeHtml(s.label || '')}</text>
        <text x="${W - 36}" y="${legY + 13}" text-anchor="end" font-size="13" font-weight="700" fill="${color}">${val}%</text>
      `;

      startAngle = endAngle;
    });

    // Inner donut hole for crisp modern look
    inner += `<circle cx="${cx}" cy="${cy}" r="34" fill="#ffffff" />`;
    inner += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#64748b">100%</text>`;

    return `<svg viewBox="0 0 ${W} ${H}" class="w-full max-w-[640px] h-auto rounded-lg border border-slate-200 bg-white shadow-xs" role="img" aria-label="${escapeHtml(q.title || '')}">${inner}</svg>`;
  }

  if (q.chartType === 'process') {
    const steps = Array.isArray(q.steps) ? q.steps.filter(st => st && typeof st === 'object') : [];
    if (steps.length === 0) return renderEmptyChart();

    // 3 cards on top row, 2 centered cards on bottom row with crisp connecting arrows
    const boxW = 166;
    const boxH = 88;
    const positions = [
      { x: 34, y: 78 },
      { x: 237, y: 78 },
      { x: 440, y: 78 },
      { x: 135, y: 218 },
      { x: 345, y: 218 }
    ];

    // Arrow markers
    inner += `
      <defs>
        <marker id="proc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" />
        </marker>
      </defs>
    `;

    // Connectors: 1->2, 2->3, 3->4 (stepped path), 4->5
    inner += `<line x1="${34 + boxW + 4}" y1="${78 + boxH / 2}" x2="${237 - 6}" y2="${78 + boxH / 2}" stroke="#64748b" stroke-width="2.2" marker-end="url(#proc-arrow)" />`;
    inner += `<line x1="${237 + boxW + 4}" y1="${78 + boxH / 2}" x2="${440 - 6}" y2="${78 + boxH / 2}" stroke="#64748b" stroke-width="2.2" marker-end="url(#proc-arrow)" />`;
    inner += `<path d="M ${440 + boxW / 2} ${78 + boxH + 4} L ${440 + boxW / 2} 192 L ${135 + boxW / 2} 192 L ${135 + boxW / 2} ${218 - 6}" fill="none" stroke="#64748b" stroke-width="2.2" marker-end="url(#proc-arrow)" />`;
    inner += `<line x1="${135 + boxW + 4}" y1="${218 + boxH / 2}" x2="${345 - 6}" y2="${218 + boxH / 2}" stroke="#64748b" stroke-width="2.2" marker-end="url(#proc-arrow)" />`;

    steps.forEach((st, idx) => {
      const pos = positions[idx];
      if (!pos) return;
      const color = sanitizeSvgColor(st.color, DI_COLOR_PALETTE[idx % DI_COLOR_PALETTE.length]);
      inner += `
        <rect x="${pos.x}" y="${pos.y}" width="${boxW}" height="${boxH}" rx="12" fill="#f8fafc" stroke="${color}" stroke-width="2.2" />
        <rect x="${pos.x + 10}" y="${pos.y + 10}" width="52" height="20" rx="10" fill="${color}" />
        <text x="${pos.x + 36}" y="${pos.y + 24}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#ffffff">Step ${escapeHtml(st.step ?? idx + 1)}</text>
        <text x="${pos.x + boxW / 2}" y="${pos.y + 52}" text-anchor="middle" font-size="13.5" font-weight="800" fill="#0f172a">${escapeHtml(st.title || '')}</text>
        <text x="${pos.x + boxW / 2}" y="${pos.y + 72}" text-anchor="middle" font-size="11" fill="#475569">${escapeHtml(st.detail || '')}</text>
      `;
    });

    return `<svg viewBox="0 0 ${W} ${H}" class="w-full max-w-[640px] h-auto rounded-lg border border-slate-200 bg-white shadow-xs" role="img" aria-label="${escapeHtml(q.title || '')}">${inner}</svg>`;
  }

  if (q.chartType === 'horizontal-bar') {
    const data = Array.isArray(q.data) ? q.data.filter(d => d && typeof d === 'object') : [];
    if (data.length === 0) return renderEmptyChart();

    const pad = { top: 66, right: 64, bottom: 36, left: 132 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    const maxVal = Math.max(0, ...data.map(d => Math.max(0, toFiniteNum(d.value, 0))));
    const niceStep = maxVal > 2000 ? 1500 : maxVal > 50 ? 20 : 5;
    const xMax = Math.max(1, Math.ceil((maxVal * 1.1) / niceStep) * niceStep);
    const safeUnit = escapeHtml(String(q.unit ?? ''));

    // Vertical gridlines
    for (let i = 0; i <= 4; i++) {
      const val = Math.round(((xMax / 4) * i) * 10) / 10;
      const x = pad.left + (val / xMax) * plotW;
      const lbl = q.unit === 'B' ? `$${val}B` : `${val}${safeUnit}`;
      inner += `
        <line x1="${x}" y1="${pad.top}" x2="${x}" y2="${pad.top + plotH}" stroke="${i === 0 ? '#94a3b8' : '#e2e8f0'}" stroke-width="${i === 0 ? 1.5 : 1}" />
        <text x="${x}" y="${pad.top + plotH + 18}" text-anchor="middle" font-size="11" fill="#64748b">${lbl}</text>
      `;
    }

    const rowH = plotH / data.length;
    const barH = Math.min(32, rowH * 0.58);

    data.forEach((d, idx) => {
      const val = Math.max(0, toFiniteNum(d.value, 0));
      const color = sanitizeSvgColor(d.color, DI_COLOR_PALETTE[idx % DI_COLOR_PALETTE.length]);
      const y = pad.top + idx * rowH + (rowH - barH) / 2;
      const w = (val / xMax) * plotW;
      const valLabel = q.unit === 'B' ? `$${val}B` : `${val.toLocaleString()}${safeUnit}`;
      inner += `
        <text x="${pad.left - 10}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="12" font-weight="600" fill="#334155">${escapeHtml(d.label || '')}</text>
        <rect x="${pad.left}" y="${y}" width="${w}" height="${barH}" rx="4" fill="${color}" />
        <text x="${pad.left + w + 7}" y="${y + barH / 2 + 4}" font-size="11.5" font-weight="700" fill="#0f172a">${valLabel}</text>
      `;
    });

    return `<svg viewBox="0 0 ${W} ${H}" class="w-full max-w-[640px] h-auto rounded-lg border border-slate-200 bg-white shadow-xs" role="img" aria-label="${escapeHtml(q.title || '')}">${inner}</svg>`;
  }

  // Standard Cartesian charts (bar, grouped-bar, line, single-line)
  const supportedCartesian = ['bar', 'grouped-bar', 'line', 'single-line'];
  if (!supportedCartesian.includes(q.chartType)) {
    return renderEmptyChart();
  }

  const pad = { top: 52, right: 28, bottom: 52, left: 58 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  let maxVal = 0;
  if (q.chartType === 'bar') {
    const data = Array.isArray(q.data) ? q.data.filter(d => d && typeof d === 'object') : [];
    if (data.length === 0) return renderEmptyChart();
    maxVal = Math.max(0, ...data.map(d => Math.max(0, toFiniteNum(d.value, 0))));
  } else if (q.chartType === 'line') {
    const series = Array.isArray(q.series) ? q.series.filter(s => s && typeof s === 'object') : [];
    const allPts = series.flatMap(s => Array.isArray(s.points) ? s.points : []);
    if (series.length === 0 || allPts.length === 0) return renderEmptyChart();
    maxVal = Math.max(0, ...allPts.map(p => Math.max(0, toFiniteNum(p?.value, 0))));
  } else if (q.chartType === 'grouped-bar') {
    const cats = Array.isArray(q.categories) ? q.categories : [];
    const series = Array.isArray(q.series) ? q.series.filter(s => s && typeof s === 'object') : [];
    if (cats.length === 0 || series.length === 0) return renderEmptyChart();
    const allVals = series.flatMap(s => Array.isArray(s.values) ? s.values : [0]);
    maxVal = Math.max(0, ...allVals.map(v => Math.max(0, toFiniteNum(v, 0))));
  } else if (q.chartType === 'single-line') {
    const pts = Array.isArray(q.points) ? q.points.filter(p => p && typeof p === 'object') : [];
    if (pts.length === 0) return renderEmptyChart();
    maxVal = Math.max(0, ...pts.map(p => Math.max(0, toFiniteNum(p.value, 0))));
  }

  const niceStep = maxVal > 800 ? 300 : maxVal > 300 ? 100 : maxVal > 60 ? 20 : maxVal > 15 ? 10 : 3;
  const yMax = Math.max(1, Math.ceil((maxVal * 1.12) / niceStep) * niceStep);
  const ticks = 5;

  const formatChartVal = (val, unit) => {
    const safeNum = toFiniteNum(val, 0);
    const safeUnit = escapeHtml(String(unit ?? ''));
    if (unit === '$') return `$${safeNum}`;
    if (unit === 'B') return `$${safeNum}B`;
    return safeUnit ? `${safeNum}${safeUnit}` : `${safeNum}`;
  };

  for (let i = 0; i <= ticks; i++) {
    const val = Math.round(((yMax / ticks) * i) * 10) / 10;
    const y = pad.top + plotH - (val / yMax) * plotH;
    const label = formatChartVal(val, q.unit);
    inner += `
      <line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="${i === 0 ? '#94a3b8' : '#e2e8f0'}" stroke-width="${i === 0 ? 1.5 : 1}" />
      <text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#64748b">${label}</text>
    `;
  }

  inner += `<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" stroke="#94a3b8" stroke-width="1.5" />`;

  if (q.chartType === 'bar') {
    const data = q.data.filter(d => d && typeof d === 'object');
    const count = data.length;
    const slotW = plotW / count;
    const barW = Math.min(58, slotW * 0.56);

    data.forEach((d, idx) => {
      const val = Math.max(0, toFiniteNum(d.value, 0));
      const color = sanitizeSvgColor(d.color, DI_COLOR_PALETTE[idx % DI_COLOR_PALETTE.length]);
      const barH = (val / yMax) * plotH;
      const x = pad.left + idx * slotW + (slotW - barW) / 2;
      const y = pad.top + plotH - barH;
      const valLabel = formatChartVal(val, q.unit);
      inner += `
        <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${color}" />
        <text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#1e293b">${valLabel}</text>
        <text x="${x + barW / 2}" y="${pad.top + plotH + 20}" text-anchor="middle" font-size="11.5" font-weight="600" fill="#334155">${escapeHtml(d.label || '')}</text>
      `;
    });
  } else if (q.chartType === 'grouped-bar') {
    const cats = q.categories;
    const series = q.series.filter(s => s && typeof s === 'object');
    const count = cats.length;
    const slotW = plotW / Math.max(1, count);
    const seriesCount = Math.max(1, series.length);
    const barW = Math.min(34, (slotW * 0.7) / seriesCount);
    const gap = 6;

    series.forEach((s, si) => {
      const lx = pad.left + 12 + si * 165;
      const color = sanitizeSvgColor(s.color, DI_COLOR_PALETTE[si % DI_COLOR_PALETTE.length]);
      inner += `
        <rect x="${lx}" y="${pad.top - 2}" width="11" height="11" rx="2" fill="${color}" />
        <text x="${lx + 16}" y="${pad.top + 8}" font-size="11" font-weight="600" fill="#334155">${escapeHtml(s.name || '')}</text>
      `;
    });

    cats.forEach((cat, idx) => {
      const centerX = pad.left + idx * slotW + slotW / 2;
      const totalGroupW = barW * seriesCount + gap * Math.max(0, seriesCount - 1);
      series.forEach((s, si) => {
        const rawV = Array.isArray(s.values) ? s.values[idx] : 0;
        const val = Math.max(0, toFiniteNum(rawV, 0));
        const color = sanitizeSvgColor(s.color, DI_COLOR_PALETTE[si % DI_COLOR_PALETTE.length]);
        const barH = (val / yMax) * plotH;
        const x = centerX - totalGroupW / 2 + si * (barW + gap);
        const y = pad.top + plotH - barH;
        const valLabel = formatChartVal(val, q.unit);
        inner += `
          <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${color}" />
          <text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#1e293b">${valLabel}</text>
        `;
      });
      inner += `<text x="${centerX}" y="${pad.top + plotH + 20}" text-anchor="middle" font-size="11.5" font-weight="600" fill="#334155">${escapeHtml(cat)}</text>`;
    });
  } else if (q.chartType === 'line') {
    const series = q.series.filter(s => s && typeof s === 'object' && Array.isArray(s.points) && s.points.length > 0);
    if (series.length === 0) return renderEmptyChart();
    const labels = series[0].points.map(p => String(p?.label ?? ''));
    const stepX = labels.length > 1 ? plotW / (labels.length - 1) : 0;

    series.forEach((s, si) => {
      const lx = pad.left + 12 + si * 145;
      const color = sanitizeSvgColor(s.color, DI_COLOR_PALETTE[si % DI_COLOR_PALETTE.length]);
      inner += `
        <line x1="${lx}" y1="${pad.top + 4}" x2="${lx + 18}" y2="${pad.top + 4}" stroke="${color}" stroke-width="3" />
        <circle cx="${lx + 9}" cy="${pad.top + 4}" r="3.5" fill="${color}" />
        <text x="${lx + 24}" y="${pad.top + 8}" font-size="11" font-weight="600" fill="#334155">${escapeHtml(s.name || '')}</text>
      `;
    });

    labels.forEach((lbl, idx) => {
      const x = labels.length > 1 ? pad.left + idx * stepX : pad.left + plotW / 2;
      inner += `<text x="${x}" y="${pad.top + plotH + 20}" text-anchor="middle" font-size="11.5" font-weight="600" fill="#334155">${escapeHtml(lbl)}</text>`;
    });

    series.forEach((s, si) => {
      const color = sanitizeSvgColor(s.color, DI_COLOR_PALETTE[si % DI_COLOR_PALETTE.length]);
      const pts = s.points.map((p, idx) => {
        const x = s.points.length > 1 ? pad.left + idx * stepX : pad.left + plotW / 2;
        const val = Math.max(0, toFiniteNum(p?.value, 0));
        const y = pad.top + plotH - (val / yMax) * plotH;
        return { x, y, value: val };
      });
      const dAttr = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      inner += `<path d="${dAttr}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`;
      pts.forEach(p => {
        const dy = si === 0 ? -10 : 16;
        inner += `
          <circle cx="${p.x}" cy="${p.y}" r="4.5" fill="#ffffff" stroke="${color}" stroke-width="2.5" />
          <text x="${p.x}" y="${p.y + dy}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${color}">${formatChartVal(p.value, q.unit)}</text>
        `;
      });
    });
  } else if (q.chartType === 'single-line') {
    const rawPts = q.points.filter(p => p && typeof p === 'object');
    if (rawPts.length === 0) return renderEmptyChart();
    const seriesColor = sanitizeSvgColor(q.color, DI_COLOR_PALETTE[0]);
    const stepX = rawPts.length > 1 ? plotW / (rawPts.length - 1) : 0;
    const pts = rawPts.map((p, idx) => {
      const x = rawPts.length > 1 ? pad.left + idx * stepX : pad.left + plotW / 2;
      const val = Math.max(0, toFiniteNum(p.value, 0));
      const y = pad.top + plotH - (val / yMax) * plotH;
      return { x, y, label: String(p.label ?? ''), value: val };
    });

    const areaPath = `M ${pts[0].x} ${pad.top + plotH} ` +
      pts.map(p => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') +
      ` L ${pts[pts.length - 1].x} ${pad.top + plotH} Z`;
    inner += `<path d="${areaPath}" fill="${seriesColor}" fill-opacity="0.12" />`;

    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    inner += `<path d="${linePath}" fill="none" stroke="${seriesColor}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />`;

    pts.forEach(p => {
      const valLabel = formatChartVal(p.value, q.unit);
      inner += `
        <circle cx="${p.x}" cy="${p.y}" r="5" fill="#ffffff" stroke="${seriesColor}" stroke-width="2.5" />
        <text x="${p.x}" y="${p.y - 11}" text-anchor="middle" font-size="11" font-weight="700" fill="#0f172a">${valLabel}</text>
        <text x="${p.x}" y="${pad.top + plotH + 20}" text-anchor="middle" font-size="11.5" font-weight="600" fill="#334155">${escapeHtml(p.label)}</text>
      `;
    });
  }

  return `<svg viewBox="0 0 ${W} ${H}" class="w-full max-w-[640px] h-auto rounded-lg border border-slate-200 bg-white shadow-xs" role="img" aria-label="${escapeHtml(q.title || '')}">${inner}</svg>`;
}
