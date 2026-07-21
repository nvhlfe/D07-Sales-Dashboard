import React from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LabelList } from 'recharts'
import { formatNum } from '../utils/parseExcel'

function GrowthBadge({ pct }) {
  if (pct === null || pct === undefined) return <span style={{ color:'#aaa', fontSize:11 }}>—</span>
  const isFlat = Math.abs(pct) < 0.5
  const isUp = pct > 0
  const color = isFlat ? '#8896aa' : isUp ? '#06d6a0' : '#ef4444'
  const bg = isFlat ? '#f0f4ff' : isUp ? '#e6faf2' : '#fff1f2'
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:3,
      background:bg, color, padding:'2px 8px', borderRadius:12,
      fontSize:11.5, fontWeight:700,
    }}>
      {isFlat ? '—' : isUp ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

function CompareRow({ label, v2025, v2026, growthPct, unit, isEstimate }) {
  return (
    <tr>
      <td style={{ fontWeight:600, color:'#1a1f36', padding:'7px 8px' }}>
        {label}
        {isEstimate && (
          <span title="2025 chỉ có tổng năm trong file, được chia đều theo số tháng đã qua để ước tính"
            style={{ marginLeft:5, fontSize:9.5, color:'#fb8500', cursor:'help', fontWeight:600 }}>
            ~ước tính
          </span>
        )}
      </td>
      <td style={{ textAlign:'center', color:'#8896aa', padding:'7px 8px' }}>{v2025 != null ? formatNum(v2025) : '—'}</td>
      <td style={{ textAlign:'center', color:'#4361ee', fontWeight:700, padding:'7px 8px' }}>{v2026 != null ? formatNum(v2026) : '—'}</td>
      <td style={{ textAlign:'center', padding:'7px 8px' }}><GrowthBadge pct={growthPct} /></td>
      <td style={{ textAlign:'left', color:'#8896aa', fontSize:10.5, padding:'7px 8px' }}>{unit || ''}</td>
    </tr>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div style={{ background:'white', padding:'10px 14px', borderRadius:10,
        boxShadow:'0 4px 16px rgba(0,0,0,.12)', fontSize:12 }}>
        <div style={{ fontWeight:700, marginBottom:6 }}>{label}</div>
        {payload.map((p,i) => (
          <div key={i} style={{ display:'flex', justifyContent:'space-between', gap:12, color:p.color, fontWeight:600 }}>
            <span>{p.name}</span><span>{formatNum(p.value)}</span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

export default function YoYComparison({ yoy }) {
  // `yoy` is gaData itself — destructure the 3 sub-objects we built in parseExcel
  const fypYoY = yoy?.fypYoY
  const opsYoY = yoy?.opsYoY
  const apeYoY = yoy?.apeYoY

  if (!fypYoY && !opsYoY) {
    return (
      <div className="card" style={{ textAlign:'center', padding:'24px 16px', color:'#8896aa' }}>
        <div style={{ fontSize:24, marginBottom:6 }}>📊</div>
        <div style={{ fontSize:12.5 }}>Không tìm thấy dữ liệu so sánh 2025 trong sheet GA data</div>
      </div>
    )
  }

  const monthsLabel = fypYoY?.ytd?.monthsCovered?.length
    ? fypYoY.ytd.monthsCovered[fypYoY.ytd.monthsCovered.length - 1]
    : ''

  const quarterChartData = (fypYoY?.byQuarter || []).map(q => ({
    quarter: q.quarter, '2025': q.y2025, '2026': q.y2026,
  }))

  return (
    <div style={{ marginBottom:16 }}>
      {/* ── Headline cards: FYP & APE YTD growth ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
        <div className="card" style={{ background:'linear-gradient(135deg,#eef2ff,#f8f9ff)' }}>
          <div style={{ fontSize:10.5, color:'#8896aa', fontWeight:600, textTransform:'uppercase', marginBottom:6 }}>
            FYP từ đầu năm đến {monthsLabel} — 2026 vs 2025
          </div>
          <div style={{ display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap' }}>
            <span style={{ fontSize:28, fontWeight:800, color:'#4361ee' }}>{formatNum(fypYoY?.ytd?.[2026])}</span>
            <span style={{ fontSize:13, color:'#8896aa' }}>vs {formatNum(fypYoY?.ytd?.[2025])} (2025)</span>
          </div>
          <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:8 }}>
            <GrowthBadge pct={fypYoY?.ytd?.growthYoY} />
            <span style={{ fontSize:11, color:'#8896aa' }}>triệu VND</span>
          </div>
          {fypYoY?.ytd?.[2024] != null && (
            <div style={{ marginTop:6, fontSize:10.5, color:'#8896aa' }}>
              So với 2024: <GrowthBadge pct={fypYoY?.ytd?.growthVs2024} />
            </div>
          )}
        </div>

        <div className="card" style={{ background:'linear-gradient(135deg,#fdf4ff,#f8f9ff)' }}>
          <div style={{ fontSize:10.5, color:'#8896aa', fontWeight:600, textTransform:'uppercase', marginBottom:6 }}>
            APE từ đầu năm đến {monthsLabel} — 2026 vs 2025
            <span title="2025 chỉ có tổng năm trong file, được chia đều theo tháng để ước tính"
              style={{ marginLeft:4, color:'#fb8500', cursor:'help' }}>ⓘ</span>
          </div>
          <div style={{ display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap' }}>
            <span style={{ fontSize:28, fontWeight:800, color:'#7209b7' }}>{formatNum(apeYoY?.ytd2026)}</span>
            <span style={{ fontSize:13, color:'#8896aa' }}>vs ~{formatNum(apeYoY?.ytd2025Estimate)} (2025 ước tính)</span>
          </div>
          <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:8 }}>
            <GrowthBadge pct={apeYoY?.growthYoY} />
            <span style={{ fontSize:11, color:'#8896aa' }}>triệu VND</span>
          </div>
        </div>
      </div>

      {/* ── Quarterly FYP chart ── */}
      {quarterChartData.length > 0 && (
        <div className="card" style={{ marginBottom:14 }}>
          <div className="section-header">
            <div className="section-icon">📊</div>
            FYP THEO QUÝ — 2025 vs 2026
          </div>
          <div style={{ height:220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={quarterChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f4ff" />
                <XAxis dataKey="quarter" tick={{ fontSize:12, fontWeight:600 }} />
                <YAxis tick={{ fontSize:11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend iconSize={9} formatter={v => <span style={{ fontSize:11.5 }}>{v}</span>} />
                <Bar dataKey="2025" fill="#c7d2fe" radius={[4,4,0,0]}>
                  <LabelList dataKey="2025" position="top" fontSize={10} fontWeight={700} fill="#1a1f36"
                    formatter={(v) => v != null ? formatNum(v) : ''} />
                </Bar>
                <Bar dataKey="2026" fill="#4361ee" radius={[4,4,0,0]}>
                  <LabelList dataKey="2026" position="top" fontSize={10} fontWeight={700} fill="#1a1f36"
                    formatter={(v) => v != null ? formatNum(v) : ''} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginTop:12 }}>
            {(fypYoY?.byQuarter || []).map((q, i) => (
              <div key={i} style={{ textAlign:'center', padding:'8px 6px', background:'#f8f9ff', borderRadius:8 }}>
                <div style={{ fontSize:10.5, color:'#8896aa', fontWeight:600 }}>{q.quarter}</div>
                <div style={{ marginTop:4 }}><GrowthBadge pct={q.growthYoY} /></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Operational metrics table ── */}
      {opsYoY && (
        <div className="card">
          <div className="section-header">
            <div className="section-icon">📋</div>
            CHỈ SỐ VẬN HÀNH — 2025 vs 2026 (cả năm)
          </div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:'2px solid #e8ecf4' }}>
                <th style={{ textAlign:'left', padding:'6px 8px', color:'#8896aa', fontSize:10.5, fontWeight:700 }}>Chỉ số</th>
                <th style={{ padding:'6px 8px', color:'#8896aa', fontSize:10.5, fontWeight:700 }}>2025</th>
                <th style={{ padding:'6px 8px', color:'#8896aa', fontSize:10.5, fontWeight:700 }}>2026</th>
                <th style={{ padding:'6px 8px', color:'#8896aa', fontSize:10.5, fontWeight:700 }}>Tăng trưởng</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <CompareRow label="Net Manpower" v2025={opsYoY.manpower?.v2025} v2026={opsYoY.manpower?.v2026} growthPct={opsYoY.manpower?.growthPct} unit="đại lý" />
              <CompareRow label="Số ACT" v2025={opsYoY.actCount?.v2025} v2026={opsYoY.actCount?.v2026} growthPct={opsYoY.actCount?.growthPct} unit="lượt/tháng" />
              <CompareRow label="ACT Ratio" v2025={opsYoY.actRatio?.v2025 != null ? opsYoY.actRatio.v2025*100 : null} v2026={opsYoY.actRatio?.v2026 != null ? opsYoY.actRatio.v2026*100 : null} growthPct={opsYoY.actRatio?.growthPct} unit="%" />
              <CompareRow label="Case/ACT" v2025={opsYoY.caseAct?.v2025} v2026={opsYoY.caseAct?.v2026} growthPct={opsYoY.caseAct?.growthPct} unit="case" />
              <CompareRow label="Case Size" v2025={opsYoY.caseSize?.v2025} v2026={opsYoY.caseSize?.v2026} growthPct={opsYoY.caseSize?.growthPct} unit="triệu VND" />
              <CompareRow label="APE/Tháng" v2025={opsYoY.apeMonth?.v2025} v2026={opsYoY.apeMonth?.v2026} growthPct={opsYoY.apeMonth?.growthPct} unit="triệu VND" />
              <CompareRow label="APE/Năm" v2025={opsYoY.apeYear?.v2025} v2026={opsYoY.apeYear?.v2026} growthPct={opsYoY.apeYear?.growthPct} unit="triệu VND" />
            </tbody>
          </table>
          <div style={{ marginTop:10, fontSize:10.5, color:'#8896aa' }}>
            📌 Số liệu lấy từ bảng so sánh có sẵn trong sheet "GA data" (vùng MANPOWER/ACT/APE theo năm)
          </div>
        </div>
      )}
    </div>
  )
}
