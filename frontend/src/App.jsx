import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API = import.meta.env.VITE_API_URL || '';

// ── Spectrum 2 design tokens ───────────────────────────────────────────────────
const S = {
  // Gray scale (Spectrum global)
  gray50:  '#ffffff',
  gray75:  '#fafafa',
  gray100: '#f5f5f5',
  gray200: '#eaeaea',
  gray300: '#e0e0e0',
  gray400: '#c8c8c8',
  gray500: '#adadad',
  gray600: '#868686',
  gray700: '#6f6f6f',
  gray800: '#444444',
  gray900: '#1a1a1a',

  // Accent / Blue (Spectrum blue ramp)
  blue400: '#5aa8ff',
  blue500: '#378ef0',
  blue600: '#147af3',
  blue700: '#0d66d0',

  // Semantic
  red500:   '#ec5b62',
  green500: '#33ab84',
  orange500:'#f29423',
  purple500:'#9d6bf5',

  // Adobe red (brand)
  adobeRed: '#fa0f00',

  // Spacing
  sp50:  '4px',
  sp75:  '6px',
  sp100: '8px',
  sp150: '12px',
  sp200: '16px',
  sp300: '24px',
  sp400: '32px',

  // Corner radius
  radius75:  '4px',
  radius100: '8px',
  radius200: '16px',

  // Typography
  fontSans: '"Adobe Clean", "Source Sans Pro", ui-sans-serif, system-ui, sans-serif',
  fontSize75:  '11px',
  fontSize100: '14px',
  fontSize200: '16px',
  fontSize300: '18px',
  fontSize400: '20px',
  fontSize500: '22px',
  fontSize600: '25px',
  fontSize700: '28px',
  fontWeightRegular: 400,
  fontWeightMedium:  500,
  fontWeightBold:    700,
};

const METRICS = [
  { key: 'pageView',        label: 'Page Views',    color: S.blue600,   bg: '#e8f3ff' },
  { key: 'productPageView', label: 'Product Views', color: S.green500,  bg: '#e6f6f1' },
  { key: 'addToCart',       label: 'Add to Cart',   color: S.orange500, bg: '#fef3e3' },
  { key: 'purchase',        label: 'Purchases',     color: S.purple500, bg: '#f2edff' },
];

const DIMS = [
  { key: 'pageName',     label: 'Page name'     },
  { key: 'pageUrl',      label: 'Page URL'       },
  { key: 'deviceType',   label: 'Device'         },
  { key: 'country',      label: 'Country'        },
  { key: 'trackingCode', label: 'Tracking code'  },
];

const BUCKET_MS = 60_000;

function bucketKey(ts) {
  return Math.floor(new Date(ts).getTime() / BUCKET_MS);
}
function formatTime(bucketNum) {
  const d = new Date(bucketNum * BUCKET_MS);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function eventMatchesFilters(evt, filters) {
  return Object.entries(filters).every(([dimKey, values]) => {
    if (values.size === 0) return true;
    return values.has(evt[dimKey]);
  });
}

// ── Spectrum UI primitives ────────────────────────────────────────────────────

function Panel({ children, style = {} }) {
  return (
    <div style={{
      background: S.gray50,
      border: `1px solid ${S.gray200}`,
      borderRadius: S.radius100,
      padding: S.sp300,
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: S.fontSize75,
      fontWeight: S.fontWeightBold,
      color: S.gray600,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      marginBottom: S.sp150,
    }}>
      {children}
    </div>
  );
}

function ActionButton({ active, onClick, children, style = {} }) {
  return (
    <button onClick={onClick} style={{
      fontSize: S.fontSize75,
      fontWeight: active ? S.fontWeightMedium : S.fontWeightRegular,
      padding: '4px 10px',
      borderRadius: '16px',
      cursor: 'pointer',
      background: active ? S.blue700 : 'transparent',
      color: active ? S.gray50 : S.gray700,
      border: `1px solid ${active ? S.blue700 : S.gray300}`,
      transition: 'all 0.12s',
      whiteSpace: 'nowrap',
      ...style,
    }}>
      {children}
    </button>
  );
}

function SpectrumSelect({ value, onChange, children }) {
  return (
    <select value={value} onChange={onChange} style={{
      fontSize: S.fontSize75,
      padding: '5px 28px 5px 10px',
      borderRadius: S.radius75,
      border: `1px solid ${S.gray300}`,
      background: S.gray50,
      color: S.gray800,
      cursor: 'pointer',
      appearance: 'none',
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 9px center',
      minWidth: 110,
    }}>
      {children}
    </select>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [connected, setConnected]     = useState(false);
  const [selectedMetric, setMetric]   = useState('pageView');
  const [selectedDim, setDim]         = useState('pageName');
  const [trendWindow, setTrendWindow] = useState(60);
  const [filters, setFilters]         = useState({});
  const [filterOpen, setFilterOpen]   = useState(null);
  const [, forceRender]               = useState(0);
  const [simulating, setSimulating] = useState(false);

  const eventsRef = useRef([]);

  const ingestEvents = useCallback((incoming) => {
    eventsRef.current = [...incoming, ...eventsRef.current].slice(0, 2000);
    forceRender(n => n + 1);
  }, []);

  useEffect(() => {
    const id = setInterval(() => forceRender(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
  let es;
  let retryTimeout;
  let retryDelay = 3000;

  function connect() {
    es = new EventSource(`${API}/events/stream`);
    es.onopen = () => {
      setConnected(true);
      retryDelay = 3000; // reset delay on successful connection
    };
    es.onerror = () => {
      setConnected(false);
      es.close();
      retryTimeout = setTimeout(() => {
        retryDelay = Math.min(retryDelay * 2, 30000); // backoff up to 30s
        connect();
      }, retryDelay);
    };
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'history') ingestEvents(msg.events);
      else ingestEvents([msg]);
    };
  }

  connect();

  return () => {
    clearTimeout(retryTimeout);
    es?.close();
  };
}, [ingestEvents]);

  // Check simulation status on load  ← add here
    useEffect(() => {
      fetch(`${API}/simulate/status`)
        .then(r => r.json())
        .then(d => setSimulating(d.running))
        .catch(() => {});
    }, []);

  const dimValues = useMemo(() => {
    const map = {};
    DIMS.forEach(d => { map[d.key] = new Set(); });
    eventsRef.current.forEach(evt => {
      DIMS.forEach(d => { if (evt[d.key]) map[d.key].add(evt[d.key]); });
    });
    return map;
  }, [eventsRef.current.length]); // eslint-disable-line

  const filteredEvents = useMemo(() => {
    return eventsRef.current.filter(evt => eventMatchesFilters(evt, filters));
  }, [eventsRef.current.length, filters]); // eslint-disable-line

  const nowBucket = bucketKey(new Date());
  const trendData = useMemo(() => {
    const buckets = {};
    filteredEvents.forEach(evt => {
      const bk = bucketKey(evt.timestamp);
      buckets[bk] = (buckets[bk] || 0) + (evt[selectedMetric] || 0);
    });
    return Array.from({ length: trendWindow }, (_, i) => {
      const bk = nowBucket - (trendWindow - 1 - i);
      return { time: formatTime(bk), value: buckets[bk] || 0 };
    });
  }, [filteredEvents, selectedMetric, trendWindow, nowBucket]);

  const totals = useMemo(() => {
    const t = {};
    METRICS.forEach(m => { t[m.key] = 0; });
    filteredEvents.forEach(evt => {
      METRICS.forEach(m => { t[m.key] += evt[m.key] || 0; });
    });
    return t;
  }, [filteredEvents]);

  const dimEntries = useMemo(() => {
    const counts = {};
    filteredEvents.forEach(evt => {
      const v = evt[selectedDim];
      if (v) counts[v] = (counts[v] || 0) + (evt[selectedMetric] || 1);
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [filteredEvents, selectedDim, selectedMetric]);

  const dimMax       = dimEntries[0]?.[1] || 1;
  const metric       = METRICS.find(m => m.key === selectedMetric);
  const metricColor  = metric?.color || S.blue600;
  const activeFilterCount = Object.values(filters).reduce((n, s) => n + s.size, 0);

  function toggleFilterValue(dimKey, value) {
    setFilters(prev => {
      const next = { ...prev };
      const s = new Set(next[dimKey] || []);
      s.has(value) ? s.delete(value) : s.add(value);
      if (s.size === 0) delete next[dimKey]; else next[dimKey] = s;
      return next;
    });
  }

  function clearFilters() { setFilters({}); }

    async function startSim() {
    await fetch(`${API}/simulate/start`, { method: 'POST' });
    setSimulating(true);
  }

  async function stopSim() {
    await fetch(`${API}/simulate/stop`, { method: 'POST' });
    setSimulating(false);
  }

  return (
    <div style={{ fontFamily: S.fontSans, background: S.gray100, minHeight: '100vh', color: S.gray900 }}>

      {/* ── Top navigation bar ── */}
      <div style={{
        background: `#f5f5f5`,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        padding: `0 ${S.sp300}`,
        gap: S.sp200,
        borderBottom: `1px solid #000`
      }}>
        {/* Adobe logo mark */}
        <img
          src="https://cdn.experience.adobe.net/assets/HeroIcons.6620f5dc.svg#AdobeExperienceCloud"
          alt="Adobe Experience Cloud"
          style={{ height: 28, width: 'auto' }}
        />
        <div style={{ width: 1, height: 20, background: '#444' }} />
        <span style={{ color: 'black', fontSize: S.fontSize100, fontWeight: S.fontWeightMedium, letterSpacing: '0.01em' }}>
          Adobe CX Enterprise
        </span>
        <div style={{ flex: 1 }} />
        {/* Live indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={simulating ? stopSim : startSim}
          style={{
            fontSize: 13,
            fontWeight: 500,
            padding: '6px 14px',
            borderRadius: 16,
            cursor: 'pointer',
            border: 'none',
            background: simulating ? S.red500 : S.blue600,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            transition: 'background 0.15s',
          }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#fff',
            animation: simulating ? 'pulse 1s infinite' : 'none',
          }} />
          {simulating ? 'Stop simulation' : 'Simulate traffic'}
        </button>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
          padding: '4px 10px', borderRadius: 20,
          background: connected ? '#E1F5EE' : '#FEE2E2',
          color: connected ? '#0F6E56' : '#991B1B',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: connected ? S.green500 : S.red500,
            animation: connected ? 'pulse 1.5s infinite' : 'none',
          }} />
          {connected ? 'Live' : 'Disconnected'}
        </div>
      </div>
        
      </div>

      {/* ── Page header ── */}
      <div style={{
        background: S.gray50,
        borderBottom: `1px solid ${S.gray200}`,
        padding: `${S.sp300} ${S.sp400}`,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: S.fontSize75, color: S.gray600, marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: S.fontWeightBold }}>
            Analytics
          </div>
          <h1 style={{ fontSize: S.fontSize700, fontWeight: S.fontWeightBold, margin: 0, color: S.gray900, lineHeight: 1.2 }}>
            Event Analytics
          </h1>
          <p style={{ fontSize: S.fontSize100, color: S.gray600, margin: '4px 0 0' }}>
            Real-time event forwarding dashboard
          </p>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ padding: `${S.sp300} ${S.sp400}`, maxWidth: 1280, margin: '0 auto' }}>

        {/* Metric cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: S.sp200, marginBottom: S.sp300 }}>
          {METRICS.map(m => (
            <button key={m.key} onClick={() => setMetric(m.key)} style={{
              textAlign: 'left',
              padding: S.sp300,
              borderRadius: S.radius100,
              cursor: 'pointer',
              background: S.gray50,
              border: selectedMetric === m.key
                ? `2px solid ${m.color}`
                : `1px solid ${S.gray200}`,
              transition: 'border-color 0.12s, box-shadow 0.12s',
              boxShadow: selectedMetric === m.key ? `0 0 0 1px ${m.color}22` : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: S.sp150 }}>
                <span style={{ fontSize: S.fontSize75, fontWeight: S.fontWeightBold, color: S.gray600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {m.label}
                </span>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: selectedMetric === m.key ? m.color : S.gray300,
                }} />
              </div>
              <div style={{ fontSize: 32, fontWeight: S.fontWeightBold, color: selectedMetric === m.key ? m.color : S.gray900, lineHeight: 1 }}>
                {(totals[m.key] || 0).toLocaleString()}
              </div>
              {activeFilterCount > 0 && (
                <div style={{ fontSize: S.fontSize75, color: S.gray500, marginTop: 6 }}>filtered</div>
              )}
            </button>
          ))}
        </div>

        {/* Filter bar */}
        <Panel style={{ marginBottom: S.sp300, padding: `${S.sp150} ${S.sp200}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: S.sp100, flexWrap: 'wrap' }}>
            <span style={{ fontSize: S.fontSize75, fontWeight: S.fontWeightBold, color: S.gray600, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}>
              Filters
            </span>
            <div style={{ width: 1, height: 16, background: S.gray300 }} />

            {DIMS.map(d => {
              const active = filters[d.key]?.size > 0;
              const isOpen = filterOpen === d.key;
              return (
                <div key={d.key} style={{ position: 'relative' }}>
                  <ActionButton active={active} onClick={() => setFilterOpen(isOpen ? null : d.key)}>
                    {d.label}{active ? ` (${filters[d.key].size})` : ' +'}
                  </ActionButton>

                  {isOpen && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100,
                      background: S.gray50,
                      border: `1px solid ${S.gray200}`,
                      borderRadius: S.radius100,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                      minWidth: 220, maxHeight: 280,
                      overflowY: 'auto', padding: '6px 0',
                    }}>
                      {[...dimValues[d.key]].sort().map(val => {
                        const checked = filters[d.key]?.has(val);
                        return (
                          <label key={val} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '6px 14px', cursor: 'pointer',
                            fontSize: S.fontSize100,
                            background: checked ? '#e8f3ff' : 'transparent',
                          }}
                            onMouseEnter={e => { if (!checked) e.currentTarget.style.background = S.gray100; }}
                            onMouseLeave={e => { e.currentTarget.style.background = checked ? '#e8f3ff' : 'transparent'; }}>
                            <input type="checkbox" checked={!!checked}
                              onChange={() => toggleFilterValue(d.key, val)}
                              style={{ accentColor: S.blue600, width: 14, height: 14 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170, color: S.gray800 }} title={val}>
                              {val}
                            </span>
                          </label>
                        );
                      })}
                      {dimValues[d.key].size === 0 && (
                        <div style={{ padding: '10px 14px', fontSize: S.fontSize75, color: S.gray500 }}>No values yet</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {activeFilterCount > 0 && (
              <button onClick={clearFilters} style={{
                fontSize: S.fontSize75, padding: '4px 10px', borderRadius: 16, cursor: 'pointer',
                background: 'transparent', color: S.gray600, border: `1px solid ${S.gray300}`,
              }}>
                Clear all
              </button>
            )}
          </div>

          {/* Active filter pills */}
          {activeFilterCount > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: S.sp100, paddingTop: S.sp100, borderTop: `1px solid ${S.gray200}` }}>
              {Object.entries(filters).flatMap(([dimKey, values]) => {
                const dimLabel = DIMS.find(d => d.key === dimKey)?.label;
                return [...values].map(val => (
                  <span key={`${dimKey}:${val}`} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: S.fontSize75, padding: '3px 10px',
                    borderRadius: 16,
                    background: '#e8f3ff', color: S.blue700,
                    border: `1px solid ${S.blue400}`,
                    fontWeight: S.fontWeightMedium,
                  }}>
                    {dimLabel}: {val}
                    <button onClick={() => toggleFilterValue(dimKey, val)} style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: S.blue700, padding: 0, lineHeight: 1, fontSize: 15, marginLeft: 2,
                    }}>×</button>
                  </span>
                ));
              })}
            </div>
          )}
        </Panel>

        {/* Click outside closes dropdown */}
        {filterOpen && (
          <div onClick={() => setFilterOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
        )}

        {/* Trend chart */}
        <Panel style={{ marginBottom: S.sp300 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: S.sp200 }}>
            <div>
              <SectionLabel>Trend</SectionLabel>
              <div style={{ fontSize: S.fontSize300, fontWeight: S.fontWeightBold, color: S.gray900, lineHeight: 1 }}>
                {metric?.label}
                {activeFilterCount > 0 && (
                  <span style={{ fontSize: S.fontSize75, color: S.blue600, marginLeft: 8, fontWeight: S.fontWeightRegular }}>
                    {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} applied
                  </span>
                )}
              </div>
            </div>
            <SpectrumSelect value={trendWindow} onChange={e => setTrendWindow(+e.target.value)}>
              <option value={5}>Last 5 min</option>
              <option value={15}>Last 15 min</option>
              <option value={30}>Last 30 min</option>
              <option value={60}>Last 60 min</option>
              <option value={120}>Last 2 hrs</option>
            </SpectrumSelect>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={S.gray200} />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: S.gray500, fontFamily: S.fontSans }}
                interval={Math.floor(trendWindow / 6)} axisLine={{ stroke: S.gray300 }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: S.gray500, fontFamily: S.fontSans }}
                width={38} allowDecimals={false} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  fontSize: 13, borderRadius: 6,
                  border: `1px solid ${S.gray200}`,
                  background: S.gray50,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  fontFamily: S.fontSans,
                }}
                labelStyle={{ color: S.gray600, fontWeight: 600 }}
              />
              <Line type="monotone" dataKey="value"
                name={metric?.label}
                stroke={metricColor} strokeWidth={2.5}
                dot={false} isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        {/* Bottom row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: S.sp300 }}>

          {/* Top 10 dimension table */}
          <Panel>
            <SectionLabel>Top 10 by dimension</SectionLabel>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: S.sp200 }}>
              {DIMS.map(d => (
                <ActionButton key={d.key} active={selectedDim === d.key} onClick={() => setDim(d.key)}>
                  {d.label}
                </ActionButton>
              ))}
            </div>
            <table style={{ width: '100%', fontSize: S.fontSize100, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${S.gray200}` }}>
                  <th style={{ textAlign: 'left', color: S.gray600, fontWeight: S.fontWeightBold, fontSize: S.fontSize75, padding: '6px 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Value</th>
                  <th style={{ textAlign: 'right', color: S.gray600, fontWeight: S.fontWeightBold, fontSize: S.fontSize75, padding: '6px 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {dimEntries.length === 0 && (
                  <tr><td colSpan={2} style={{ color: S.gray400, fontSize: S.fontSize75, padding: '1.5rem 8px', textAlign: 'center' }}>
                    {activeFilterCount > 0 ? 'No data for current filters' : 'Waiting for events…'}
                  </td></tr>
                )}
                {dimEntries.map(([k, v], i) => (
                  <tr key={k} style={{ borderBottom: `1px solid ${S.gray100}`, background: i % 2 === 0 ? 'transparent' : S.gray75 }}>
                    <td style={{ padding: '7px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: S.gray800 }} title={k}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: Math.max(3, Math.round(v / dimMax * 56)),
                          height: 3, borderRadius: 2,
                          background: metricColor, flexShrink: 0,
                        }} />
                        {k}
                      </div>
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: S.fontWeightBold, color: S.gray900, fontVariantNumeric: 'tabular-nums' }}>
                      {v.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {/* Live event feed */}
          <Panel>
            <SectionLabel>Live event feed</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
              {filteredEvents.length === 0 && (
                <div style={{ color: S.gray400, fontSize: S.fontSize75, textAlign: 'center', padding: '2rem 0' }}>
                  {activeFilterCount > 0 ? 'No events match current filters' : 'Waiting for events…'}
                </div>
              )}
              {filteredEvents.slice(0, 20).map(evt => {
                const firedMetrics = METRICS.filter(m => evt[m.key]);
                const accent = firedMetrics[0]?.color || S.gray400;
                return (
                  <div key={evt.id} style={{
                    padding: '8px 12px',
                    background: S.gray75,
                    borderRadius: S.radius75,
                    borderLeft: `3px solid ${accent}`,
                    fontSize: S.fontSize75,
                  }}>
                    <div style={{ fontWeight: S.fontWeightBold, color: S.gray900, marginBottom: 3, fontSize: S.fontSize100 }}>
                      {evt.pageName || evt.pageUrl || 'Unknown page'}
                    </div>
                    <div style={{ color: S.gray600, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      {firedMetrics.map(m => (
                        <span key={m.key} style={{
                          color: m.color, fontWeight: S.fontWeightMedium,
                          background: m.bg, padding: '1px 6px', borderRadius: 10, fontSize: 10,
                        }}>
                          {m.label}
                        </span>
                      ))}
                      {evt.deviceType && <span>{evt.deviceType}</span>}
                      {evt.country    && <span>{evt.country}</span>}
                      {evt.trackingCode && <span style={{ color: S.purple500 }}>{evt.trackingCode}</span>}
                      <span style={{ marginLeft: 'auto', color: S.gray500, fontVariantNumeric: 'tabular-nums' }}>
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Sans+Pro:wght@400;600;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: ${S.gray100}; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        button { font-family: inherit; outline: none; }
        button:focus-visible { box-shadow: 0 0 0 3px ${S.blue400}66; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${S.gray100}; }
        ::-webkit-scrollbar-thumb { background: ${S.gray300}; border-radius: 3px; }
      `}</style>
    </div>
  );
}
