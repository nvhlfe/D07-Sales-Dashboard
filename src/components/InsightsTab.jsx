import React, { useMemo, useState } from 'react'
import { formatNum, formatNum2, mocActInfo } from '../utils/parseExcel'
import { useReportsDoc, useManMark, useDailyTopDoc } from '../lib/db'
import { collectOpenCases } from '../lib/salesReportLogic'
import {
  monthPace, funnelStats, unitStats, nearPEList, zeroFycAgents, topBy,
} from '../lib/insightsLogic'

const DATA_YEAR = 2026
const VN_MONTHS = { 1:'T1',2:'T2',3:'T3',4:'T4',5:'T5',6:'T6',7:'T7',8:'T8',9:'T9',10:'T10',11:'T11',12:'T12' }
const tr = (vnd) => formatNum((Number(vnd) || 0) / 1e6) // VND → triệu

const VERDICT_UI = {
  ahead:      { label: '🚀 Nhanh hơn nhịp tháng', bg: '#e6faf2', color: '#065f46' },
  ontrack:    { label: '✅ Đúng nhịp',            bg: '#e6faf2', color: '#065f46' },
  behind:     { label: '⚠️ Chậm hơn nhịp tháng',  bg: '#fff0f0', color: '#b91c1c' },
  done:       { label: '🏁 Đã đạt mục tiêu',      bg: '#e6faf2', color: '#065f46' },
  missed:     { label: '🏁 Kết thúc — chưa đạt',  bg: '#fff0f0', color: '#b91c1c' },
  'no-target':{ label: 'Chưa có mục tiêu tháng',  bg: '#f1f3f9', color: '#5b6478' },
}

export default function InsightsTab({ data, onNavigate }) {
  const now = new Date()
  const curMonth = now.getFullYear() === DATA_YEAR ? now.getMonth() + 1 : null
  const excelMonths = data?.availableMonths || []
  const monthOptions = useMemo(() => {
    const s = new Set(excelMonths)
    if (curMonth) s.add(curMonth)
    return [...s].sort((a, b) => a - b)
  }, [excelMonths, curMonth])
  const [month, setMonth] = useState(() => (curMonth && monthOptions.includes(curMonth))
    ? curMonth
    : (monthOptions[monthOptions.length - 1] || curMonth || 1))

  const monthlyKpis = data?.monthlyKpis || {}
  const agList = data?.agList || []
  const umList = data?.umList || []

  const { data: dailyTop } = useDailyTopDoc()
  const { data: reportsDoc, loading: reportsLoading } = useReportsDoc(DATA_YEAR, month)
  const { data: mmDoc } = useManMark(DATA_YEAR, month)

  const persons = useMemo(() => {
    const raw = reportsDoc?.data
    const arr = Array.isArray(raw) ? raw : raw ? Object.values(raw) : []
    return arr.filter((p) => p && typeof p === 'object' && p.daily)
  }, [reportsDoc])

  // ── Pace tháng ──────────────────────────────────────────────
  const daily = dailyTop?.[`${DATA_YEAR}-${month}`] || null
  const actual = monthlyKpis[month]?.fypThang ?? daily?.totals?.fypThang ?? null
  const mmTargetTrieu = useMemo(() => {
    const commits = mmDoc?.commits || {}
    const sum = Object.values(commits).reduce((s, c) => s + (Number(c?.monthTarget) || 0), 0)
    return sum > 0 ? sum / 1000 : 0 // ManMark lưu nghìn đồng → triệu
  }, [mmDoc])
  const gaPlan = Number(data?.gaData?.fyp2026?.[month - 1]?.plan) || 0
  const target = mmTargetTrieu > 0 ? mmTargetTrieu : gaPlan
  const targetSrc = mmTargetTrieu > 0 ? 'cam kết ManMark' : gaPlan > 0 ? 'kế hoạch GA' : null
  const pace = monthPace({ actual: actual ?? 0, target, year: DATA_YEAR, month, today: now })
  const vUi = VERDICT_UI[pace.verdict]

  // ── Cảnh báo ────────────────────────────────────────────────
  const isCur = pace.phase === 'current'
  const openCases = useMemo(
    () => collectOpenCases(persons, DATA_YEAR, month, null, Date.now()),
    [persons, month]
  )
  const staleCases = isCur ? openCases.filter((c) => c.ageDays >= 5) : openCases
  const mocThieu = useMemo(
    () => umList.map((u) => ({ um: u, info: mocActInfo(u) }))
      .filter((x) => x.info.need !== null && x.info.need > 0)
      .sort((a, b) => b.info.need - a.info.need),
    [umList]
  )
  const nearPE = useMemo(() => nearPEList(agList, 2, 8), [agList])
  const zeroFyc = useMemo(() => zeroFycAgents(agList, 6), [agList])

  // ── Phễu + Unit + Top ───────────────────────────────────────
  const funnel = useMemo(() => funnelStats(persons), [persons])
  const units = useMemo(() => unitStats(agList), [agList])
  const topFycQuy = useMemo(() => topBy(agList, 'fyc', 5), [agList])
  const topFycL12m = useMemo(() => topBy(agList, 'fyc12m', 5), [agList])

  const funnelRows = [
    { label: 'CF — Có phí / chưa phí', n: funnel.cf.n, fee: funnel.cf.fee, color: '#f72585' },
    { label: 'CP — Pending (đã đóng phí)', n: funnel.cp.n, fee: funnel.cp.fee, color: '#fb8500' },
    { label: 'PH — Phát hành', n: funnel.ph.n, fee: funnel.ph.fee, color: '#06d6a0' },
  ]
  const funnelMax = Math.max(1, ...funnelRows.map((r) => r.n))

  const alertTile = (emoji, count, label, sub, color, tab) => (
    <div
      onClick={() => onNavigate && onNavigate(tab)}
      style={{
        background: 'white', border: '1px solid #e8ecf4', borderLeft: `4px solid ${color}`,
        borderRadius: 12, padding: '12px 14px', cursor: onNavigate ? 'pointer' : 'default',
        boxShadow: '0 1px 6px rgba(67,97,238,0.05)',
      }}
      title={onNavigate ? 'Bấm để mở tab liên quan' : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 20 }}>{emoji}</span>
        <span style={{ fontSize: 26, fontWeight: 800, color }}>{count}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#1a1f36' }}>{label}</span>
      </div>
      <div style={{ fontSize: 11, color: '#8896aa', marginTop: 4, lineHeight: 1.5 }}>{sub}</div>
    </div>
  )

  return (
    <div className="page-content">
      <div className="page-head">
        <div className="page-title">🎯 Trung Tâm Điều Hành — GA D07</div>
        <div className="page-sub">
          Nhịp độ tháng, cảnh báo cần xử lý, phễu hồ sơ, sức khỏe từng Unit và danh sách cần hỗ trợ —
          gom từ Compensation, Sales Report, ManMark &amp; AG-PE. Bấm vào thẻ cảnh báo để mở tab liên quan.
        </div>
      </div>

      {/* Chọn tháng */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#4a5568' }}>📅 Tháng:</span>
        {monthOptions.map((m) => (
          <button key={m} onClick={() => setMonth(m)}
            style={{
              padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 700,
              background: month === m ? 'linear-gradient(135deg,#4361ee,#7209b7)' : '#f0f4ff',
              color: month === m ? 'white' : '#4361ee',
            }}>
            {VN_MONTHS[m]}/{DATA_YEAR}{m === curMonth ? ' ●' : ''}
          </button>
        ))}
      </div>

      {/* ── 1. Nhịp độ tháng ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-header">
          <div className="section-icon">⏱️</div>
          NHỊP ĐỘ THÁNG {month}/{DATA_YEAR}
          <span style={{ marginLeft: 'auto', background: vUi.bg, color: vUi.color, padding: '4px 12px', borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
            {vUi.label}
          </span>
        </div>
        {actual === null && target <= 0 ? (
          <div className="empty-state">Chưa có số liệu FYP và mục tiêu cho tháng này.</div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 12.5, color: '#4a5568' }}>
                FYP đã đạt: <strong style={{ color: '#1a1f36', fontSize: 14 }}>{formatNum(pace.actual)}</strong>
                {target > 0 && <> / {formatNum(target)} triệu ({targetSrc})</>}
              </span>
              <span style={{ fontSize: 12, color: '#8896aa' }}>
                {pace.phase === 'current' && <>Hôm nay ngày {pace.dayIdx}/{pace.daysInMonth} — đã qua <strong>{pace.elapsedPct.toFixed(0)}%</strong> tháng</>}
                {pace.phase === 'past' && <>Tháng đã kết thúc</>}
                {pace.phase === 'future' && <>Tháng chưa bắt đầu</>}
                {pace.donePct !== null && <> · Đạt <strong style={{ color: '#1a1f36' }}>{pace.donePct.toFixed(1)}%</strong> mục tiêu</>}
              </span>
            </div>
            <div style={{ position: 'relative', height: 22, background: '#f0f4ff', borderRadius: 11, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${Math.min(pace.donePct ?? 0, 100)}%`,
                background: 'linear-gradient(90deg,#4361ee,#7209b7)', borderRadius: 11, transition: 'width .5s ease',
              }} />
              <div title={`Nhịp thời gian: ${pace.elapsedPct.toFixed(0)}%`}
                style={{ position: 'absolute', left: `${Math.min(pace.elapsedPct, 100)}%`, top: 0, bottom: 0, width: 2, background: '#1a1f36', opacity: 0.55 }} />
            </div>
            <div style={{ fontSize: 10.5, color: '#8896aa', marginTop: 4 }}>Vạch đen = nhịp thời gian đã trôi qua. Thanh màu dài hơn vạch = đang nhanh hơn nhịp.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 12 }}>
              <div className="info-block"><div className="info-block-label">Còn thiếu</div><div className="info-block-value" style={{ color: '#ef476f' }}>{target > 0 ? `${formatNum(pace.remaining)} tr` : '—'}</div></div>
              <div className="info-block"><div className="info-block-label">Ngày còn lại</div><div className="info-block-value">{pace.phase === 'current' ? pace.daysLeft : '—'}</div></div>
              <div className="info-block"><div className="info-block-label">Cần đạt / ngày còn lại</div><div className="info-block-value" style={{ color: '#fb8500' }}>{pace.perDayNeeded ? `${formatNum2(pace.perDayNeeded)} tr` : '—'}</div></div>
              <div className="info-block"><div className="info-block-label">Ước cuối tháng (theo nhịp)</div><div className="info-block-value" style={{ color: '#4361ee' }}>{pace.projected ? `${formatNum(pace.projected)} tr` : '—'}</div><div className="info-block-sub">{pace.projected && target > 0 ? `≈ ${((pace.projected / target) * 100).toFixed(0)}% mục tiêu` : ''}</div></div>
            </div>
          </>
        )}
      </div>

      {/* ── 2. Cảnh báo cần xử lý ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12, marginBottom: 16 }}>
        {alertTile('🧾', staleCases.length,
          isCur ? 'hồ sơ tồn ≥ 5 ngày' : 'hồ sơ chưa phát hành cuối tháng',
          staleCases.length
            ? staleCases.slice(0, 3).map((c) => `${c.person?.name || c.person?.msdl || ''} · HS ngày ${c.d} · ${isCur ? `${c.ageDays} ngày` : ''}`).join('  |  ') + (staleCases.length > 3 ? `  |  +${staleCases.length - 3} nữa` : '')
            : 'Không có hồ sơ tồn. Tốt!',
          '#ef476f', 'sales')}
        {alertTile('👤', mocThieu.length, 'UM còn thiếu lượt Act MOC',
          mocThieu.length
            ? mocThieu.slice(0, 3).map((x) => `${x.um.leaderName} (thiếu ${formatNum(x.info.need)})`).join('  |  ') + (mocThieu.length > 3 ? `  |  +${mocThieu.length - 3} nữa` : '')
            : 'Tất cả UM đã đủ lượt Act MOC.',
          '#fb8500', 'um')}
        {alertTile('⭐', nearPE.length, 'TVV sắp đạt PE (thiếu ≤ 2tr FYC)',
          nearPE.length
            ? nearPE.slice(0, 3).map((x) => `${x.name} (thiếu ${formatNum2(x.gap)}tr)`).join('  |  ') + (nearPE.length > 3 ? `  |  +${nearPE.length - 3} nữa` : '')
            : 'Không có TVV nào ở ngưỡng sắp đạt.',
          '#e6a800', 'tvv')}
        {alertTile('💤', zeroFyc.count, 'TVV chưa có FYC trong quý',
          zeroFyc.count
            ? zeroFyc.names.filter(Boolean).join(', ') + (zeroFyc.count > zeroFyc.names.length ? ` … +${zeroFyc.count - zeroFyc.names.length} nữa` : '')
            : 'Mọi TVV đều đã phát sinh FYC.',
          '#7209b7', 'tvv')}
      </div>

      {/* ── 3. Phễu hồ sơ + 4. Sức khỏe Unit ── */}
      <div className="grid-2-1" style={{ marginBottom: 16, alignItems: 'start' }}>
        <div className="card">
          <div className="section-header"><div className="section-icon">🏢</div>SỨC KHỎE THEO UNIT <span style={{ fontSize: 10.5, color: '#8896aa', fontWeight: 500 }}>(theo AG-PE mới nhất)</span></div>
          {units.length === 0 ? <div className="empty-state">Chưa có dữ liệu AG-PE.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead><tr><th>Unit</th><th>TVV</th><th>Có FYC quý</th><th>FYC Quý</th><th>FYC L12M</th><th>Đạt PE</th><th>FYC TB/TVV</th></tr></thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.unit}>
                      <td><span style={{ background: '#eef2ff', color: '#4361ee', padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700 }}>{u.unit}</span></td>
                      <td>{u.tvv}</td>
                      <td>{u.activeFyc}/{u.tvv}</td>
                      <td className="val-fyc">{formatNum(u.fycQuy)}</td>
                      <td className="val-fyc">{formatNum(u.fycL12m)}</td>
                      <td style={{ fontSize: 11.5 }}>{u.peDat} <span style={{ color: '#8896aa' }}>(💎{u.peKC} · 🥇{u.peBK} · 🥉{u.peV})</span></td>
                      <td>{formatNum2(u.avgFyc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="section-header"><div className="section-icon">🔻</div>PHỄU HỒ SƠ THÁNG {month}</div>
          {reportsLoading ? <div className="empty-state">Đang tải Sales Report…</div>
            : funnel.total === 0 ? <div className="empty-state">Chưa có hồ sơ nào trong Sales Report tháng này.</div> : (
            <>
              {funnelRows.map((r) => (
                <div key={r.label} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: '#1a1f36' }}>{r.label}</span>
                    <span style={{ color: '#4a5568' }}><strong>{r.n}</strong> HS · {tr(r.fee)} tr</span>
                  </div>
                  <div style={{ height: 14, background: '#f0f4ff', borderRadius: 7, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(r.n / funnelMax) * 100}%`, background: r.color, borderRadius: 7, transition: 'width .4s ease' }} />
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <span style={{ background: '#e6faf2', color: '#065f46', padding: '4px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                  Tỷ lệ phát hành: {funnel.convIssued.toFixed(0)}% số hồ sơ
                </span>
                <span style={{ background: '#eef2ff', color: '#4361ee', padding: '4px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                  {funnel.feeIssuedShare.toFixed(0)}% phí đã phát hành
                </span>
                <span style={{ background: '#f1f3f9', color: '#5b6478', padding: '4px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                  Tổng: {funnel.total} HS · {tr(funnel.totalFee)} tr
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── 5. Vinh danh & Cần hỗ trợ ── */}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="section-header"><div className="section-icon">🏆</div>VINH DANH <span style={{ fontSize: 10.5, color: '#8896aa', fontWeight: 500 }}>(theo AG-PE)</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8896aa', marginBottom: 8 }}>TOP FYC QUÝ</div>
              {topFycQuy.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #f0f4ff' }}>
                  <div className={`rank-num ${i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other'}`}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1f36', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.agentName}</div>
                    <div style={{ fontSize: 10.5, color: '#8896aa' }}>{a.unit || '—'}</div>
                  </div>
                  <div className="val-fyc">{formatNum(a.fyc)}</div>
                </div>
              ))}
              {topFycQuy.length === 0 && <div className="empty-state">Chưa có dữ liệu.</div>}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8896aa', marginBottom: 8 }}>TOP FYC L12M</div>
              {topFycL12m.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #f0f4ff' }}>
                  <div className={`rank-num ${i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other'}`}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1f36', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.agentName}</div>
                    <div style={{ fontSize: 10.5, color: '#8896aa' }}>{a.unit || '—'}</div>
                  </div>
                  <div className="val-fyc">{formatNum(a.fyc12m)}</div>
                </div>
              ))}
              {topFycL12m.length === 0 && <div className="empty-state">Chưa có dữ liệu.</div>}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-header"><div className="section-icon">🎯</div>CẦN HỖ TRỢ NGAY</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8896aa', marginBottom: 6 }}>UM THIẾU LƯỢT ACT MOC NHIỀU NHẤT</div>
          {mocThieu.length === 0 ? <div className="empty-state">Không có UM nào thiếu lượt. 🎉</div> : (
            <table className="data-table" style={{ marginBottom: 14 }}>
              <tbody>
                {mocThieu.slice(0, 5).map((x, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{x.um.leaderName}</td>
                    <td style={{ color: '#8896aa', fontSize: 11 }}>{x.um.unit || ''}</td>
                    <td style={{ color: '#7209b7', fontWeight: 700 }}>đã có {x.info.have !== null ? formatNum(x.info.have) : '—'}</td>
                    <td style={{ color: '#ef476f', fontWeight: 800 }}>thiếu {formatNum(x.info.need)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8896aa', marginBottom: 6 }}>TVV CHỈ CÒN THIẾU ÍT FYC LÀ ĐẠT PE — ƯU TIÊN ĐẨY</div>
          {nearPE.length === 0 ? <div className="empty-state">Không có TVV ở ngưỡng sắp đạt.</div> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {nearPE.map((x, i) => (
                <span key={i} style={{ background: '#fff7e0', color: '#92400e', padding: '4px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 600 }}>
                  {x.name} · {x.unit} · thiếu {formatNum2(x.gap)}tr
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: '#8896aa' }}>
        Nguồn: FYP/mục tiêu từ file Compensation tháng + cam kết ManMark · Hồ sơ từ Sales Report tháng {month}/{DATA_YEAR} ·
        Unit/PE/vinh danh từ AG-PE mới nhất · “Ước cuối tháng” chỉ là phép chiếu theo nhịp hiện tại, không phải dự báo chính thức.
      </div>
    </div>
  )
}
