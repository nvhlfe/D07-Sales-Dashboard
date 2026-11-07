import React, { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { formatNum, formatNum2 } from '../utils/parseExcel'
import { getFirebase, listDailySalesInMonth, useAuth } from '../lib/db'
import { analyzeSoSanLuong, latestDailyDoc, maskSensitive, prevYearMonth } from '../lib/soSanLuongLogic'

// ─────────────────────────────────────────────────────────────────
// 📋 SỔ SẢN LƯỢNG — theo ý tưởng dashboard D03, chạy trên dữ liệu
// Proposal + Daily Sales GA D07 đã nạp sẵn (không thêm nguồn file mới).
// 3 cấp drill-down: GA → Unit → TVV. Phát hành tính RÒNG (trừ CF liên tháng).
// Số HSYC/số HĐ: che ở mức HIỂN THỊ cho tài khoản thường (chỉ admin cao nhất
// xem đầy đủ) — đây là che phía client, không phải che ở máy chủ như D03.
// ─────────────────────────────────────────────────────────────────

const fmtDMY = (iso) => {
  const p = String(iso || '').split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : '—'
}
const ymLabel = (ym) => {
  const [y, m] = String(ym || '').split('-')
  return y && m ? `Tháng ${Number(m)}/${y}` : ''
}
const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣']

export default function SoSanLuongTab() {
  const { isSuperAdmin } = useAuth()
  const [months, setMonths] = useState([])
  const [ym, setYm] = useState('')
  const [docs, setDocs] = useState({ cur: [], prev: [] })
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState({ level: 'ga' })

  // Danh sách tháng có Daily đã nạp
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { fs } = getFirebase()
        const snap = await getDocs(collection(fs, 'daily_sales_tvv'))
        const set = new Set()
        snap.forEach((d) => { if (/^\d{4}-\d{2}-\d{2}$/.test(d.id)) set.add(d.id.slice(0, 7)) })
        const list = [...set].sort().reverse()
        if (!alive) return
        setMonths(list)
        setYm((cur) => cur || list[0] || '')
      } catch {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // Nạp doc tháng đang xem + tháng trước (cho phần CF liên tháng)
  useEffect(() => {
    if (!ym) return
    let alive = true
    setLoading(true)
    const [y, m] = ym.split('-').map(Number)
    const pm = prevYearMonth(y, m)
    Promise.all([
      listDailySalesInMonth(y, m).catch(() => []),
      listDailySalesInMonth(pm.year, pm.month).catch(() => []),
    ]).then(([cur, prev]) => {
      if (!alive) return
      setDocs({ cur, prev })
      setLoading(false)
    })
    return () => { alive = false }
  }, [ym])

  const [year, month] = useMemo(() => {
    const [y, m] = String(ym || '').split('-').map(Number)
    return [y || 2026, m || 1]
  }, [ym])

  const so = useMemo(
    () => analyzeSoSanLuong(docs.cur, docs.prev, { year, month }),
    [docs, year, month]
  )
  const leaderByUnit = useMemo(() => {
    const latest = latestDailyDoc(docs.cur)
    const map = {}
    Object.values(latest?.data?.units || {}).forEach((u) => { if (u?.unit) map[u.unit] = u.leaderName || '' })
    return map
  }, [docs])

  const selUnit = view.level !== 'ga' ? so.units.find((u) => u.unit === view.unit) : null
  const selAgent = view.level === 'agent' ? so.agents.find((a) => a.msdl === view.msdl) : null
  const agentFlips = view.level === 'agent' ? so.cfFlips.filter((f) => f.msdl === view.msdl) : []

  const changeMonth = (v) => { setYm(v); setView({ level: 'ga' }) }
  const mask = (v) => maskSensitive(v, isSuperAdmin)

  const metricCards = (t) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 16 }}>
      <div className="summary-card">
        <div className="summary-label">📥 Nộp trong tháng</div>
        <div className="summary-value" style={{ color: '#4361ee' }}>{t.nopN} HS</div>
        <div className="summary-sub">Đã lên phí {t.subN} HS · {formatNum(t.subIp)} tr IP · Chưa lên phí {t.pipeN} HS · {formatNum(t.pipeApe)} tr APE</div>
      </div>
      <div className="summary-card">
        <div className="summary-label">📤 Phát hành ròng</div>
        <div className="summary-value" style={{ color: '#065f46' }}>{formatNum(t.netIp)} tr</div>
        <div className="summary-sub">{t.netN} HĐ · Gộp {formatNum(t.issIp)} tr{t.cfN > 0 ? ` · trừ huỷ CF ${formatNum(t.cfIp)} tr` : ''}</div>
      </div>
      <div className="summary-card">
        <div className="summary-label">⏳ Đang chờ (Pending)</div>
        <div className="summary-value" style={{ color: '#d97706' }}>{t.pendN} HS</div>
        <div className="summary-sub">{formatNum(t.pendIp)} tr đang chờ xử lý</div>
      </div>
      <div className="summary-card">
        <div className="summary-label">🎯 Tỷ lệ phát hành (theo IP)</div>
        <div className="summary-value" style={{ color: '#7209b7' }}>{t.rate !== null ? `${(t.rate * 100).toFixed(0)}%` : '—'}</div>
        <div className="summary-sub">Phát hành ròng ÷ IP đã lên phí</div>
      </div>
    </div>
  )

  const pendingTable = (rows, showAgent) => (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead><tr>
          {showAgent && <th>TVV</th>}
          <th>Số HSYC</th><th>Sản phẩm</th><th>APE / IP</th><th>Ngày nộp</th><th>Tuổi</th><th>Lý do chờ</th>
        </tr></thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={`${p.proposalNum}-${i}`}>
              {showAgent && (
                <td>
                  <button type="button" onClick={() => setView({ level: 'agent', unit: p.unit, msdl: p.msdl })}
                    style={{ background: 'none', border: 'none', color: '#4361ee', fontWeight: 700, cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                    {p.name || p.msdl}
                  </button>
                  <div style={{ fontSize: 10, color: '#8896aa' }}>{p.unit || '—'}</div>
                </td>
              )}
              <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{mask(p.proposalNum)}</td>
              <td style={{ whiteSpace: 'normal' }}>{p.product || '—'}</td>
              <td>{formatNum(p.ape ?? p.ipSub)} tr</td>
              <td>{fmtDMY(p.proposalDate)}</td>
              <td>{p.ageDays !== null && p.ageDays !== undefined
                ? <span style={{ fontWeight: 700, color: p.ageDays > 14 ? '#b91c1c' : p.ageDays >= 8 ? '#92400e' : '#5b6478' }}>{p.ageDays} ngày</span>
                : '—'}</td>
              <td style={{ whiteSpace: 'normal' }}>
                {p.reasons && p.reasons.length > 0
                  ? p.reasons.map((r) => (
                    <span key={r} style={{ display: 'inline-block', background: '#fff7e0', color: '#92400e', padding: '2px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 700, margin: '0 4px 4px 0' }}>{r}</span>
                  ))
                  : <span style={{ color: '#8896aa', fontSize: 11 }}>{p.hasDetail ? 'Chưa ghi lý do cụ thể' : 'Chưa có chi tiết ở sheet Pending'}</span>}
                {p.description && <div style={{ fontSize: 11, color: '#5b6478' }}>{p.description}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">📋 Sổ Sản Lượng — GA D07</div>
          <div className="page-sub">
            Theo dõi hồ sơ nộp / phát hành ròng / pending theo 3 cấp GA → Unit → TVV, từ dữ liệu Proposal + Daily Sales đã nạp.
            {so.asOf && <> Dữ liệu tới <strong>{fmtDMY(so.asOf)}</strong>.</>}
          </div>
        </div>
        <select className="search-input" style={{ width: 'auto', minWidth: 150 }} value={ym} onChange={(e) => changeMonth(e.target.value)}>
          {months.length === 0 && <option value="">Chưa có dữ liệu</option>}
          {months.map((x) => <option key={x} value={x}>{ymLabel(x)}</option>)}
        </select>
      </div>

      {/* Breadcrumb drill-down */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14, fontSize: 13 }}>
        <button type="button" onClick={() => setView({ level: 'ga' })}
          style={{ background: view.level === 'ga' ? '#4361ee' : '#eef2ff', color: view.level === 'ga' ? '#fff' : '#4361ee', border: 'none', padding: '5px 12px', borderRadius: 14, fontWeight: 700, cursor: 'pointer' }}>
          🏢 Toàn GA D07
        </button>
        {view.level !== 'ga' && (
          <>
            <span style={{ color: '#8896aa' }}>›</span>
            <button type="button" onClick={() => setView({ level: 'unit', unit: view.unit })}
              style={{ background: view.level === 'unit' ? '#4361ee' : '#eef2ff', color: view.level === 'unit' ? '#fff' : '#4361ee', border: 'none', padding: '5px 12px', borderRadius: 14, fontWeight: 700, cursor: 'pointer' }}>
              Unit {view.unit}
            </button>
          </>
        )}
        {view.level === 'agent' && selAgent && (
          <>
            <span style={{ color: '#8896aa' }}>›</span>
            <span style={{ background: '#4361ee', color: '#fff', padding: '5px 12px', borderRadius: 14, fontWeight: 700 }}>
              🧑‍💼 {selAgent.name || selAgent.msdl}
            </span>
          </>
        )}
      </div>

      {loading ? <div className="empty-state">Đang tải dữ liệu Daily Sales…</div>
        : !so.hasData ? <div className="empty-state">Chưa có Daily Sales cho {ymLabel(ym)}. Lan nạp Daily ở tab TVV Hàng Ngày rồi quay lại đây nhé.</div>
        : view.level === 'ga' ? (
          <>
            {metricCards(so.totals)}

            {so.cfFlips.length > 0 && (
              <div style={{ background: '#fff0f0', border: '1px solid #ffd6d6', borderRadius: 12, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#7f1d1d' }}>
                ↩️ Tháng này có <strong>{so.cfFlips.length} hợp đồng</strong> phát hành tháng trước bị huỷ (CF) — đã trừ <strong>{formatNum(so.totals.cfIp)} tr</strong> khỏi phát hành ròng: { }
                {so.cfFlips.map((f) => `${f.name || f.msdl} (${mask(f.proposalNum)} · ${formatNum(f.ipNetPrev)} tr)`).join('  |  ')}
              </div>
            )}

            {/* ── Bảng Vàng ── */}
            <div className="card" style={{ marginBottom: 16, background: 'linear-gradient(135deg,#fffbe6 0%,#fff3c4 55%,#ffe9a8 100%)', border: '1px solid #f5d76e' }}>
              <div className="section-header">
                <div className="section-icon">🏆</div>
                BẢNG VÀNG {ymLabel(ym).toUpperCase()}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#92400e', marginBottom: 8 }}>🌟 TOP PHÁT HÀNH RÒNG (IP NET)</div>
                  {so.topNet.length === 0 ? <div style={{ fontSize: 12, color: '#8896aa' }}>Chưa có TVV nào phát hành ròng dương.</div>
                    : so.topNet.map((a, i) => (
                      <div key={a.msdl} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'rgba(255,255,255,0.75)', borderRadius: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 20 }}>{MEDALS[i]}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 13, color: '#1a1f36', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || a.msdl}</div>
                          <div style={{ fontSize: 10.5, color: '#8896aa' }}>{a.unit || '—'} · {a.msdl}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 800, color: '#065f46' }}>{formatNum(a.netIp)} tr</div>
                          <div style={{ fontSize: 10.5, color: '#8896aa' }}>{a.netN} HĐ</div>
                        </div>
                      </div>
                    ))}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#92400e', marginBottom: 8 }}>🚀 TOP NỘP HỒ SƠ TRONG THÁNG</div>
                  {so.topSub.length === 0 ? <div style={{ fontSize: 12, color: '#8896aa' }}>Chưa có hồ sơ nộp trong tháng.</div>
                    : so.topSub.map((a, i) => (
                      <div key={a.msdl} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'rgba(255,255,255,0.75)', borderRadius: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 20 }}>{MEDALS[i]}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 13, color: '#1a1f36', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || a.msdl}</div>
                          <div style={{ fontSize: 10.5, color: '#8896aa' }}>{a.unit || '—'} · {a.msdl}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 800, color: '#4361ee' }}>{a.nopN} HS</div>
                          <div style={{ fontSize: 10.5, color: '#8896aa' }}>{formatNum(a.subIp)} tr IP nộp</div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* ── Bảng theo Unit ── */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-header">
                <div className="section-icon">🏢</div>
                SẢN LƯỢNG THEO UNIT — BẤM VÀO 1 UNIT ĐỂ XEM TVV
              </div>
              {so.units.length === 0 ? <div className="empty-state">Chưa có Unit nào có hoạt động trong tháng.</div> : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead><tr>
                      <th>Unit</th><th>Leader</th><th>TVV có hoạt động</th><th>Nộp (HS)</th><th>IP nộp</th>
                      <th>Pipeline</th><th>PH gộp</th><th>Trừ CF</th><th>PHÁT HÀNH RÒNG</th><th>Đang chờ</th><th>Tỷ lệ PH</th>
                    </tr></thead>
                    <tbody>
                      {so.units.map((u) => (
                        <tr key={u.unit} onClick={() => setView({ level: 'unit', unit: u.unit })} style={{ cursor: 'pointer' }}>
                          <td><span style={{ background: '#eef2ff', color: '#4361ee', padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700 }}>{u.unit}</span></td>
                          <td>{leaderByUnit[u.unit] || '—'}</td>
                          <td>{u.agentCount}</td>
                          <td style={{ fontWeight: 700 }}>{u.metrics.nopN}</td>
                          <td>{formatNum(u.metrics.subIp)} tr</td>
                          <td>{u.metrics.pipeN} HS · {formatNum(u.metrics.pipeApe)} tr</td>
                          <td>{formatNum(u.metrics.issIp)} tr</td>
                          <td style={{ color: u.metrics.cfN > 0 ? '#b91c1c' : '#8896aa' }}>{u.metrics.cfN > 0 ? `−${formatNum(u.metrics.cfIp)} tr` : '—'}</td>
                          <td style={{ fontWeight: 800, color: '#065f46' }}>{formatNum(u.metrics.netIp)} tr · {u.metrics.netN} HĐ</td>
                          <td>{u.metrics.pendN} HS</td>
                          <td>{u.metrics.rate !== null ? `${(u.metrics.rate * 100).toFixed(0)}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Pending toàn GA ── */}
            <div className="card">
              <div className="section-header">
                <div className="section-icon">⏳</div>
                HỒ SƠ ĐANG CHỜ LÂU NHẤT TOÀN GA
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#8896aa', fontWeight: 500 }}>
                  Tuổi tính tới ngày dữ liệu {fmtDMY(so.asOf)}
                </span>
              </div>
              {so.pendingAll.length === 0 ? <div className="empty-state">Không có hồ sơ nào đang chờ. 🎉</div>
                : pendingTable(so.pendingAll.slice(0, 20), true)}
            </div>
          </>
        ) : view.level === 'unit' ? (
          <>
            {!selUnit ? <div className="empty-state">Không tìm thấy Unit này trong dữ liệu tháng.</div> : (
              <>
                {metricCards(selUnit.metrics)}
                <div className="card">
                  <div className="section-header">
                    <div className="section-icon">🧑‍💼</div>
                    TVV CỦA UNIT {selUnit.unit}{leaderByUnit[selUnit.unit] ? ` — LEADER ${leaderByUnit[selUnit.unit]}` : ''} · BẤM VÀO 1 TVV ĐỂ XEM HỒ SƠ
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead><tr>
                        <th>TVV</th><th>Nộp (HS)</th><th>IP nộp</th><th>Pipeline</th><th>PH gộp</th><th>Trừ CF</th><th>PHÁT HÀNH RÒNG</th><th>Đang chờ</th><th>Tỷ lệ PH</th>
                      </tr></thead>
                      <tbody>
                        {so.agents.filter((a) => (a.unit || '—') === selUnit.unit).map((a) => (
                          <tr key={a.msdl} onClick={() => setView({ level: 'agent', unit: selUnit.unit, msdl: a.msdl })} style={{ cursor: 'pointer' }}>
                            <td><strong>{a.name || a.msdl}</strong><div style={{ fontSize: 10, color: '#8896aa' }}>{a.msdl}</div></td>
                            <td style={{ fontWeight: 700 }}>{a.metrics.nopN}</td>
                            <td>{formatNum(a.metrics.subIp)} tr</td>
                            <td>{a.metrics.pipeN} HS · {formatNum(a.metrics.pipeApe)} tr</td>
                            <td>{formatNum(a.metrics.issIp)} tr</td>
                            <td style={{ color: a.metrics.cfN > 0 ? '#b91c1c' : '#8896aa' }}>{a.metrics.cfN > 0 ? `−${formatNum(a.metrics.cfIp)} tr` : '—'}</td>
                            <td style={{ fontWeight: 800, color: '#065f46' }}>{formatNum(a.metrics.netIp)} tr · {a.metrics.netN} HĐ</td>
                            <td>{a.metrics.pendN} HS</td>
                            <td>{a.metrics.rate !== null ? `${(a.metrics.rate * 100).toFixed(0)}%` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {!selAgent ? <div className="empty-state">Không tìm thấy TVV này trong dữ liệu tháng.</div> : (
              <>
                {metricCards(selAgent.metrics)}
                {!isSuperAdmin && (
                  <div style={{ fontSize: 11.5, color: '#8896aa', marginBottom: 12 }}>
                    🔒 Số HSYC / số hợp đồng đang được che ở mức hiển thị đối với tài khoản thường (chỉ hiện 2 số cuối); tài khoản quản trị cao nhất xem đầy đủ.
                  </div>
                )}

                {agentFlips.length > 0 && (
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="section-header"><div className="section-icon">↩️</div> HỢP ĐỒNG THÁNG TRƯỚC BỊ HUỶ (CF) — ĐÃ TRỪ KHỎI PHÁT HÀNH RÒNG</div>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table">
                        <thead><tr><th>Số HSYC</th><th>Sản phẩm</th><th>Ngày phát hành</th><th>IP Net tháng trước (đã trừ)</th></tr></thead>
                        <tbody>
                          {agentFlips.map((f, i) => (
                            <tr key={`${f.proposalNum}-${i}`}>
                              <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{mask(f.proposalNum)}</td>
                              <td style={{ whiteSpace: 'normal' }}>{f.product || '—'}</td>
                              <td>{fmtDMY(f.issuedDate)}</td>
                              <td style={{ color: '#b91c1c', fontWeight: 700 }}>−{formatNum(f.ipNetPrev)} tr</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="card" style={{ marginBottom: 16 }}>
                  <div className="section-header"><div className="section-icon">✅</div> ĐÃ PHÁT HÀNH TRONG THÁNG ({selAgent.detail.issued.length})</div>
                  {selAgent.detail.issued.length === 0 ? <div className="empty-state">Chưa có hồ sơ phát hành trong tháng.</div> : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table">
                        <thead><tr><th>Số HSYC</th><th>Số HĐ</th><th>Sản phẩm</th><th>Ngày nộp</th><th>Ngày phát hành</th><th>IP Net</th></tr></thead>
                        <tbody>
                          {selAgent.detail.issued.map((c, i) => (
                            <tr key={`${c.proposalNum}-${i}`}>
                              <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{mask(c.proposalNum)}</td>
                              <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{mask(c.policyNum)}</td>
                              <td style={{ whiteSpace: 'normal' }}>{c.product || '—'}</td>
                              <td>{fmtDMY(c.proposalDate)}</td>
                              <td>{fmtDMY(c.issuedDate)}</td>
                              <td style={{ fontWeight: 700, color: '#065f46' }}>{formatNum2(c.ipNet)} tr</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="card" style={{ marginBottom: 16 }}>
                  <div className="section-header"><div className="section-icon">⏳</div> ĐANG CHỜ XỬ LÝ ({selAgent.detail.pending.length})</div>
                  {selAgent.detail.pending.length === 0 ? <div className="empty-state">Không có hồ sơ đang chờ. 🎉</div>
                    : pendingTable(selAgent.detail.pending, false)}
                </div>

                <div className="card" style={{ marginBottom: 16 }}>
                  <div className="section-header"><div className="section-icon">📝</div> PIPELINE — CHƯA LÊN PHÍ ({selAgent.detail.pipeline.length})</div>
                  {selAgent.detail.pipeline.length === 0 ? <div className="empty-state">Không có hồ sơ pipeline.</div> : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table">
                        <thead><tr><th>Số HSYC</th><th>Sản phẩm</th><th>APE</th><th>Ngày nộp</th><th>Tuổi</th></tr></thead>
                        <tbody>
                          {selAgent.detail.pipeline.map((c, i) => (
                            <tr key={`${c.proposalNum}-${i}`}>
                              <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{mask(c.proposalNum)}</td>
                              <td style={{ whiteSpace: 'normal' }}>{c.product || '—'}</td>
                              <td>{formatNum(c.ape)} tr</td>
                              <td>{fmtDMY(c.proposalDate)}</td>
                              <td>{c.ageDays !== null && c.ageDays !== undefined ? `${c.ageDays} ngày` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="card">
                  <div className="section-header"><div className="section-icon">🗂</div> HỒ SƠ KHÁC TRONG THÁNG ({selAgent.detail.others.length})</div>
                  {selAgent.detail.others.length === 0 ? <div className="empty-state">Không có hồ sơ khác.</div> : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table">
                        <thead><tr><th>Số HSYC</th><th>Trạng thái</th><th>Sản phẩm</th><th>Ngày nộp</th><th>IP Sub</th></tr></thead>
                        <tbody>
                          {selAgent.detail.others.map((c, i) => (
                            <tr key={`${c.proposalNum}-${i}`}>
                              <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{mask(c.proposalNum)}</td>
                              <td style={{ whiteSpace: 'normal' }}>{c.statusFull || c.status || '—'}</td>
                              <td style={{ whiteSpace: 'normal' }}>{c.product || '—'}</td>
                              <td>{fmtDMY(c.proposalDate)}</td>
                              <td>{formatNum(c.ipSub)} tr</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

      <div style={{ marginTop: 14, fontSize: 11, color: '#8896aa' }}>
        Cách tính: Nộp = hồ sơ đã lên phí (IF + PS) + Pipeline chưa lên phí · Phát hành gộp = hồ sơ có ngày phát hành trong tháng và IP Net &gt; 0 ·
        Phát hành ròng = phát hành gộp − hợp đồng tháng trước bị huỷ CF tháng này (khớp theo số HSYC giữa 2 tháng) ·
        Hồ sơ PO / DC / WD / CF trong tháng nằm ở nhóm “Khác”, không tính vào nộp. Số HSYC/số HĐ được che ở mức hiển thị cho tài khoản thường.
      </div>
    </div>
  )
}
