import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API = import.meta.env.VITE_API_URL || '';

const S = {
  bg0:  '#0a0a0a',
  bg1:  '#0f0f0f',
  bg2:  '#141414',
  bg3:  '#1b1b1b',
  bg4:  '#1b1b1b',

  border1: 'rgba(255,255,255,0.06)',
  border2: 'rgba(255,255,255,0.1)',

  textPrimary:   '#dbdbdb',
  textSecondary: '#a0a0c0',
  textMuted:     '#6b6b9a',

  purple50:  'rgba(79,70,229,0.25)',
  purple100: 'rgba(79,70,229,0.4)',
  purple500: '#4f46e5',
  purple600: '#a98eff',
  purple700: '#c4b5fd',

  blue:   '#4f46e5',
  green:  '#1D9E75',
  orange: '#BA7517',
  purple: '#9d6bf5',

  adobeRed: '#fa0f00',

  fontSans: 'system-ui, -apple-system, sans-serif',

  contentGradient: 'linear-gradient(135deg, #1a0a4e 0%, #3b1a8a 25%, #6b21a8 50%, #0e7490 100%)',
};

const METRICS = [
  { key: 'pageView',        label: 'Page Views',    color: S.blue,   bg: 'rgba(79,70,229,0.2)'  },
  { key: 'productPageView', label: 'Product Views', color: S.green,  bg: 'rgba(29,158,117,0.2)' },
  { key: 'addToCart',       label: 'Add to Cart',   color: S.orange, bg: 'rgba(186,117,23,0.2)' },
  { key: 'purchase',        label: 'Purchases',     color: S.purple, bg: 'rgba(157,107,245,0.2)'},
];

const DIMS = [
  { key: 'pageName',     label: 'Page name'    },
  { key: 'pageUrl',      label: 'Page URL'     },
  { key: 'deviceType',   label: 'Device'       },
  { key: 'country',      label: 'Country'      },
  { key: 'trackingCode', label: 'Tracking code'},
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

function Panel({ children, style = {} }) {
  return (
    <div style={{
      background: S.bg3,
      border: `0.5px solid ${S.border2}`,
      borderRadius: 8,
      padding: '14px 16px',
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 16,
      fontWeight: 600,
      color: S.textMuted,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

export default function App() {
  const [connected, setConnected]     = useState(false);
  const [selectedMetric, setMetric]   = useState('pageView');
  const [selectedDim, setDim]         = useState('pageName');
  const [trendWindow, setTrendWindow] = useState(60);
  const [filters, setFilters]         = useState({});
  const [filterOpen, setFilterOpen]   = useState(null);
  const [simulating, setSimulating]   = useState(false);
  const [, forceRender]               = useState(0);

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
    let retryDelay = 10000;

    function connect() {
      es = new EventSource(`${API}/events/stream`);
      es.onopen = () => {
        setConnected(true);
        retryDelay = 10000;
      };
      es.onerror = () => {
        setConnected(false);
        es.close();
        retryTimeout = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30000);
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
    return () => { clearTimeout(retryTimeout); es?.close(); };
  }, [ingestEvents]);

  useEffect(() => {
    const initial = setTimeout(() => {
      fetch(`${API}/simulate/status`)
        .then(r => r.json())
        .then(d => setSimulating(d.running))
        .catch(() => {});
    }, 5000);

    const id = setInterval(() => {
      fetch(`${API}/simulate/status`)
        .then(r => r.json())
        .then(d => setSimulating(d.running))
        .catch(() => {});
    }, 60_000);

    return () => { clearTimeout(initial); clearInterval(id); };
  }, []);

  async function startSim() {
    await fetch(`${API}/simulate/start`, { method: 'POST' });
    setSimulating(true);
  }
  async function stopSim() {
    await fetch(`${API}/simulate/stop`, { method: 'POST' });
    setSimulating(false);
  }

  const dimValues = useMemo(() => {
    const map = {};
    DIMS.forEach(d => { map[d.key] = new Set(); });
    eventsRef.current.forEach(evt => {
      DIMS.forEach(d => { if (evt[d.key]) map[d.key].add(evt[d.key]); });
    });
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsRef.current.length]);

  const filteredEvents = useMemo(() => {
    return eventsRef.current.filter(evt => eventMatchesFilters(evt, filters));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsRef.current.length, filters]);

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

  const dimMax      = dimEntries[0]?.[1] || 1;
  const metric      = METRICS.find(m => m.key === selectedMetric);
  const metricColor = metric?.color || S.blue;
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

  const selectStyle = {
    fontSize: 12,
    padding: '4px 22px 4px 9px',
    borderRadius: 6,
    border: `0.5px solid ${S.border2}`,
    background: 'rgba(15,10,30,0.6)',
    color: S.textSecondary,
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%236b6b9a'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 7px center',
    cursor: 'pointer',
    fontFamily: S.fontSans,
  };

  return (
    <div style={{ fontFamily: S.fontSans, background: S.bg2, minHeight: '100vh', color: S.textPrimary }}>

      {/* Top navigation bar */}
      <div style={{
        background: S.bg0,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 10,
        borderBottom: `0.5px solid rgba(255,255,255,0.06)`,
      }}>
        <svg width="20" height="16" viewBox="0 0 22 18" fill="none" aria-label="Adobe">
          <path d="M13.2 0H22v18L13.2 0Z" fill={S.adobeRed}/>
          <path d="M8.8 0H0v18L8.8 0Z" fill={S.adobeRed}/>
          <path d="M11 6.6L16.5 18h-3.6l-1.6-3.8H8.6L11 6.6Z" fill={S.adobeRed}/>
        </svg>
        <div style={{ width: 1, height: 18, background: '#333' }} />
        <span style={{ fontSize: 16, fontWeight: 700, color: S.textPrimary }}>CX Enterprise</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 13,
            padding: '4px 10px', borderRadius: 12,
            background: connected ? 'rgba(29,158,117,0.15)' : 'rgba(226,75,74,0.15)',
            color: connected ? '#33ab84' : '#e24b4a',
            border: `0.5px solid ${connected ? 'rgba(29,158,117,0.3)' : 'rgba(226,75,74,0.3)'}`,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: connected ? '#33ab84' : '#e24b4a',
              animation: connected ? 'pulse 1.5s infinite' : 'none',
            }} />
            {connected ? 'Live' : 'Disconnected'}
          </div>
        </div>
      </div>

      {/* Page header */}
      <div style={{
        background: S.bg1,
        borderBottom: `0.5px solid rgba(255,255,255,0.06)`,
        padding: '16px 24px',
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0, color: S.textPrimary }}>Event Analytics</h1>
        <p style={{ fontSize: 16, color: S.textMuted, margin: '3px 0 0' }}>Real-time Event Dashboard</p>
      </div>

      {/* Main content with gradient background */}
      <div style={{ background: S.contentGradient, minHeight: 'calc(100vh - 112px)' }}>
        <div style={{ padding: '20px 24px', maxWidth: 1280, margin: '0 auto' }}>

          {/* Simulate traffic */}
        <Panel style={{ marginBottom: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: S.textPrimary, marginBottom: 2 }}>Traffic simulation</div>
          </div>
          <button onClick={simulating ? stopSim : startSim} style={{
            fontSize: 13, fontWeight: 500,
            padding: '8px 16px', borderRadius: 12, cursor: 'pointer',
            border: `0.5px solid ${simulating ? 'rgba(169,142,255,0.4)' : S.purple500}`,
            background: simulating ? 'rgba(79,70,229,0.2)' : S.purple500,
            color: simulating ? S.purple600 : '#fff',
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: S.fontSans,
            whiteSpace: 'nowrap',
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: simulating ? S.purple600 : '#fff',
              animation: simulating ? 'pulse 1s infinite' : 'none',
            }} />
            {simulating ? 'Stop simulation' : 'Simulate traffic'}
          </button>
        </Panel>


          {/* Filter bar */}
          <Panel style={{ marginBottom: 14, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: S.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}>Filters</span>
              <div style={{ width: 0.5, height: 14, background: S.border2 }} />

              {DIMS.map(d => {
                const active = filters[d.key]?.size > 0;
                const isOpen = filterOpen === d.key;
                return (
                  <div key={d.key} style={{ position: 'relative' }}>
                    <button onClick={() => setFilterOpen(isOpen ? null : d.key)} style={{
                      fontSize: 14, padding: '3px 10px', borderRadius: 12, cursor: 'pointer',
                      background: active ? 'rgba(79,70,229,0.3)' : 'transparent',
                      color: active ? S.purple700 : S.textSecondary,
                      border: `0.5px solid ${active ? 'rgba(169,142,255,0.4)' : S.border2}`,
                      fontFamily: S.fontSans,
                      fontWeight: active ? 500 : 400,
                    }}>
                      {d.label}{active ? ` (${filters[d.key].size})` : ' +'}
                    </button>

                    {isOpen && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100,
                        background: 'rgba(20,10,40,0.95)',
                        border: `0.5px solid ${S.border2}`,
                        borderRadius: 8,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                        minWidth: 220, maxHeight: 260, overflowY: 'auto', padding: '6px 0',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                      }}>
                        {[...dimValues[d.key]].sort().map(val => {
                          const checked = filters[d.key]?.has(val);
                          return (
                            <label key={val} style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: '6px 14px', cursor: 'pointer', fontSize: 13,
                              background: checked ? 'rgba(79,70,229,0.25)' : 'transparent',
                              color: checked ? S.purple700 : S.textSecondary,
                            }}
                              onMouseEnter={e => { if (!checked) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = checked ? 'rgba(79,70,229,0.25)' : 'transparent'; }}>
                              <input type="checkbox" checked={!!checked}
                                onChange={() => toggleFilterValue(d.key, val)}
                                style={{ accentColor: S.purple500 }} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }} title={val}>{val}</span>
                            </label>
                          );
                        })}
                        {dimValues[d.key].size === 0 && (
                          <div style={{ padding: '10px 14px', fontSize: 12, color: S.textMuted }}>No values yet</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {activeFilterCount > 0 && (
                <button onClick={clearFilters} style={{
                  fontSize: 14, padding: '3px 10px', borderRadius: 12, cursor: 'pointer',
                  background: 'transparent', color: S.textMuted, border: `0.5px solid ${S.border2}`,
                  fontFamily: S.fontSans,
                }}>Clear all</button>
              )}
            </div>

            {activeFilterCount > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: `0.5px solid ${S.border1}` }}>
                {Object.entries(filters).flatMap(([dimKey, values]) => {
                  const dimLabel = DIMS.find(d => d.key === dimKey)?.label;
                  return [...values].map(val => (
                    <span key={`${dimKey}:${val}`} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 11, padding: '3px 10px', borderRadius: 12,
                      background: 'rgba(79,70,229,0.3)', color: S.purple700,
                      border: `0.5px solid rgba(169,142,255,0.35)`, fontWeight: 500,
                    }}>
                      {dimLabel}: {val}
                      <button onClick={() => toggleFilterValue(dimKey, val)} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'rgba(169,142,255,0.5)', padding: 0, lineHeight: 1, fontSize: 14, marginLeft: 2,
                        fontFamily: S.fontSans,
                      }}>×</button>
                    </span>
                  ));
                })}
              </div>
            )}
          </Panel>

          {/* Metric cards */}
          <div className="metric-grid">
            {METRICS.map(m => (
              <button key={m.key} onClick={() => setMetric(m.key)} style={{
                textAlign: 'left', padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                background: selectedMetric === m.key ? '#000000' : '#1b1b1b',
                border: selectedMetric === m.key ? `1px solid ${m.color}` : `0.5px solid rgba(255,255,255,0.1)`,
                backdropFilter: 'none',
                WebkitBackdropFilter: 'none',
                fontFamily: S.fontSans,
                transition: 'all 0.12s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: S.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.label}</span>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: selectedMetric === m.key ? m.color : 'rgba(255,255,255,0.15)' }} />
                </div>
                <div style={{ fontSize: 28, fontWeight: 500, color: selectedMetric === m.key ? m.color : S.textPrimary, lineHeight: 1 }}>
                  {(totals[m.key] || 0).toLocaleString()}
                </div>
                {activeFilterCount > 0 && <div style={{ fontSize: 14, color: S.textMuted, marginTop: 5 }}>filtered</div>}
              </button>
            ))}
          </div>

          {filterOpen && <div onClick={() => setFilterOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />}

          {/* Trend chart */}
          <Panel style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <SectionLabel>Trend</SectionLabel>
                <div style={{ fontSize: 16, fontWeight: 500, color: S.textPrimary, lineHeight: 1 }}>
                  {metric?.label}
                  {activeFilterCount > 0 && (
                    <span style={{ fontSize: 14, color: S.purple600, marginLeft: 8, fontWeight: 400 }}>
                      {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} applied
                    </span>
                  )}
                </div>
              </div>
              <select value={trendWindow} onChange={e => setTrendWindow(+e.target.value)} style={selectStyle}>
                <option value={5}>Last 5 min</option>
                <option value={15}>Last 15 min</option>
                <option value={30}>Last 30 min</option>
                <option value={60}>Last 60 min</option>
                <option value={120}>Last 2 hrs</option>
              </select>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fontSize: 14, fill: S.textMuted, fontFamily: S.fontSans, dy: 10 }}
                  interval={Math.floor(trendWindow / 6)} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} tickLine={false} 
                  />
                <YAxis tick={{ fontSize: 14, fill: S.textMuted, fontFamily: S.fontSans }}
                  width={38} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    fontSize: 12, borderRadius: 6,
                    border: `0.5px solid ${S.border2}`,
                    background: 'rgba(20,10,40,0.95)',
                    color: S.textPrimary,
                    fontFamily: S.fontSans,
                    backdropFilter: 'blur(8px)',
                  }}
                  labelStyle={{ color: S.textSecondary }}
                />
                <Line type="monotone" dataKey="value"
                  name={metric?.label}
                  stroke={metricColor} strokeWidth={2}
                  dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          {/* Bottom row */}
          <div className="bottom-grid">

            {/* Top 10 dimension table */}
            <Panel>
              <SectionLabel>Top 10 by dimension</SectionLabel>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                {DIMS.map(d => (
                  <button key={d.key} onClick={() => setDim(d.key)} style={{
                    fontSize: 14, padding: '3px 8px', borderRadius: 12, cursor: 'pointer',
                    background: selectedDim === d.key ? 'rgba(79,70,229,0.3)' : 'transparent',
                    color: selectedDim === d.key ? S.purple700 : S.textMuted,
                    border: `0.5px solid ${selectedDim === d.key ? 'rgba(169,142,255,0.4)' : S.border2}`,
                    fontWeight: selectedDim === d.key ? 500 : 400,
                    fontFamily: S.fontSans,
                  }}>
                    {d.label}
                  </button>
                ))}
              </div>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${S.border2}` }}>
                    <th style={{ textAlign: 'left', color: S.textMuted, fontWeight: 600, fontSize: 14, padding: '4px 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Value</th>
                    <th style={{ textAlign: 'right', color: S.textMuted, fontWeight: 600, fontSize: 14, padding: '4px 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {dimEntries.length === 0 && (
                    <tr><td colSpan={2} style={{ color: S.textMuted, fontSize: 14, padding: '1.5rem 6px', textAlign: 'center' }}>
                      {activeFilterCount > 0 ? 'No data for current filters' : 'Waiting for events…'}
                    </td></tr>
                  )}
                  {dimEntries.map(([k, v], i) => (
                    <tr key={k} style={{ borderBottom: `0.5px solid ${S.border1}`, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '6px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: S.textSecondary }} title={k}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: Math.max(3, Math.round(v / dimMax * 48)), height: 3, borderRadius: 2, background: metricColor, flexShrink: 0, opacity: 0.8 }} />
                          {k}
                        </div>
                      </td>
                      <td style={{ padding: '6px', textAlign: 'right', fontWeight: 500, color: S.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto', marginTop: 8 }}>
                {filteredEvents.length === 0 && (
                  <div style={{ color: S.textMuted, fontSize: 14, textAlign: 'center', padding: '2rem 0' }}>
                    {activeFilterCount > 0 ? 'No events match current filters' : 'Waiting for events…'}
                  </div>
                )}
                {filteredEvents.slice(0, 20).map(evt => {
                  const firedMetrics = METRICS.filter(m => evt[m.key]);
                  const accent = firedMetrics[0]?.color || 'rgba(255,255,255,0.2)';
                  return (
                    <div key={evt.id} style={{
                      padding: '7px 10px',
                      background: 'rgba(15,10,30,0.5)',
                      borderRadius: 6,
                      borderLeft: `2px solid ${accent}`,
                    }}>
                      <div style={{ fontWeight: 500, color: S.textPrimary, marginBottom: 3, fontSize: 13 }}>
                        {evt.pageName || evt.pageUrl || 'Unknown page'}
                      </div>
                      <div style={{ color: S.textMuted, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
                        {firedMetrics.map(m => (
                          <span key={m.key} style={{
                            color: m.color, fontWeight: 500,
                            background: m.bg, padding: '1px 6px', borderRadius: 8, fontSize: 13,
                          }}>
                            {m.label}
                          </span>
                        ))}
                        {evt.deviceType  && <span>{evt.deviceType}</span>}
                        {evt.country     && <span>{evt.country}</span>}
                        {evt.trackingCode && <span style={{ color: S.purple600 }}>{evt.trackingCode}</span>}
                        <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', color: S.textMuted }}>
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
      </div>

      <style>{`
      * { box-sizing: border-box; }
      body { margin: 0; background: ${S.bg2}; }
      @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      button { outline: none; }
      button:focus-visible { box-shadow: 0 0 0 3px rgba(79,70,229,0.4); }
      ::-webkit-scrollbar { width: 5px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
      .bottom-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      @media (max-width: 768px) { .bottom-grid { grid-template-columns: 1fr; } }
      .metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
      @media (max-width: 768px) { .metric-grid { grid-template-columns: repeat(2, 1fr); } }
    `}</style>
    </div>
  );
}