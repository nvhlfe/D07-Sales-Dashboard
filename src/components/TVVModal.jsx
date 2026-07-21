import React, { useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { formatNum } from '../utils/parseExcel'

function fmtDate(val) {
  if (!val) return '—'
  return String(val).split('T')[0]
}

// TLDTPTT already converted to % in parseExcel (e.g. 87.1)
function fmtPct(val) {
  if (val === null || val === undefined) return '—'
  const n = Number(val)
  if (isNaN(n)) return '—'
  return n.toFixed(1) + '%'
}

// Large IP values (VND)
function fmtIp(val) {
  if (!val) return '—'
  const n = parseFloat(val)
  if (isNaN(n)) return '—'
  return n.toLocaleString('vi-VN') + ' đ'
}

const IB = ({ label, value, color, sub }) => (
  <div className="info-block">
    <div className="info-block-label">{label}</div>
    <div className="info-block-value" style={color ? { color, fontSize: 14 } : { fontSize: 14 }}>{value ?? '—'}</div>
    {sub && <div className="info-block-sub">{sub}</div>}
  </div>
)

function PEBadge({ val }) {
  if (!val || String(val) === '0') return <span style={{ color: '#aaa' }}>—</span>
  const v = String(val).toUpperCase()
  let bg = '#f0f4ff', color = '#4361ee'
  if (v.includes('KIM CƯƠNG')) { bg = '#e3f2fd'; color = '#1e88e5' }
  else if (v.includes('BẠCH KIM')) { bg = '#e8f5e9'; color = '#43a047' }
  else if (v.includes('VÀNG') || v.includes('VANG')) { bg = '#fff3cd'; color = '#7a5c00' }
  return <span style={{ background: bg, color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{val}</span>
}

function MdrtBadge({ val }) {
  if (!val || val === 'Not MDRT' || val === '-') return <span style={{ color: '#aaa' }}>—</span>
  const colors = { 'MDRT': '#ffd166', 'COT': '#a29bfe', 'TOT': '#fd79a8' }
  const bg = colors[String(val).toUpperCase()] || '#e8edff'
  return <span style={{ background: bg, color: '#1a1f36', padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{val}</span>
}

function OTBadge({ val }) {
  if (!val || val === '-') return <span style={{ color: '#aaa' }}>—</span>
  const v = String(val)
  if (v.includes('MDRT OT')) return <span style={{ background: '#fff3cd', color: '#7a5c00', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>✓ {v}</span>
  return <span style={{ color: '#aaa' }}>{v}</span>
}

function ActCheck({ val }) {
  if (!val) return <span style={{ color: '#e0e0e0', fontSize: 18 }}>○</span>
  if (String(val).includes('ü')) return <span style={{ color: '#06d6a0', fontWeight: 700, fontSize: 18 }}>✓</span>
  return <span style={{ color: '#e0e0e0', fontSize: 18 }}>○</span>
}


// Helper: sort month labels T1..T12
function sortMonths(monthly) {
  return [...monthly].sort((a, b) => {
    const na = parseInt(a.month.replace('T',''))
    const nb = parseInt(b.month.replace('T',''))
    return na - nb
  })
}

function MonthlyTable({ monthly }) {
  const sorted = sortMonths(monthly)

  return (
    <div style={{ marginBottom:12 }}>
      {sorted.map((m, i) => (
        <div key={i} style={{
          marginBottom: 8,
          border: '1px solid #e8ecf4',
          borderRadius: 10,
          overflow: 'hidden',
        }}>
          {/* Month header */}
          <div style={{
            background: m.act
              ? 'linear-gradient(90deg,#e6faf2,#f0fff8)'
              : 'linear-gradient(90deg,#f8f9ff,#f0f4ff)',
            padding: '6px 12px',
            display: 'flex', alignItems: 'center', gap: 10,
            borderBottom: '1px solid #e8ecf4',
          }}>
            <div style={{
              background: m.act ? '#06d6a0' : '#8896aa',
              color: 'white', borderRadius: 20,
              padding: '2px 10px', fontSize: 11, fontWeight: 800,
            }}>
              {m.month}
            </div>
            {m.act
              ? <span style={{ fontSize:11, color:'#065f46', fontWeight:600 }}>✓ Hoạt động</span>
              : <span style={{ fontSize:11, color:'#8896aa' }}>— Không hoạt động</span>
            }
            {m.fycYtd != null && (
              <span style={{ marginLeft:'auto', fontSize:11, color:'#8896aa' }}>
                FYC LK: <strong style={{ color:'#4361ee' }}>{formatNum(m.fycYtd)}</strong>
                &nbsp;·&nbsp;FYP LK: <strong style={{ color:'#06d6a0' }}>{formatNum(m.fypYtd)}</strong>
              </span>
            )}
          </div>

          {/* Data row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 0,
            background: 'white',
          }}>
            {[
              { label:'HĐ tháng',  value:formatNum(m.hd),  color:'#1a1f36' },
              { label:'FYP tháng', value:formatNum(m.fyp), color:'#06d6a0' },
              { label:'FYC tháng', value:formatNum(m.fyc), color:'#4361ee' },
              { label:'FYC L12M',  value:formatNum(m.fycL12m), color:'#7209b7' },
              { label:'IP lũy kế', value:formatNum(m.ipYtd),   color:'#fb8500' },
            ].map((item, j) => (
              <div key={j} style={{
                padding: '8px 10px',
                borderRight: j < 4 ? '1px solid #f0f4ff' : 'none',
                textAlign: 'center',
              }}>
                <div style={{ fontSize:9.5, color:'#8896aa', fontWeight:600, marginBottom:3 }}>
                  {item.label}
                </div>
                <div style={{ fontSize:14, fontWeight:800, color:item.color }}>
                  {item.value || '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function TVVModal({ tvv, onClose }) {
  if (!tvv) return null
  const monthly = tvv.monthly || []
  const modalRef = useRef()
  const [saving, setSaving] = useState(false)

  const saveImage = async () => {
    if (!modalRef.current) return
    setSaving(true)
    try {
      const el = modalRef.current
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        scrollX: 0,
        scrollY: 0,
        width: el.scrollWidth,
        height: el.scrollHeight,
        windowWidth: el.scrollWidth,
        windowHeight: el.scrollHeight,
      })
      const link = document.createElement('a')
      const name = (tvv.agentName || 'TVV').replace(/\s+/g, '_')
      link.download = `121AG_${name}_${tvv.msddl}.png`
      link.href = canvas.toDataURL('image/png', 1.0)
      link.click()
    } catch (e) {
      console.error('Save image error:', e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 1040 }} ref={modalRef}>
        <div className="modal-header">
          <div>
            <div className="modal-title">👤 {tvv.agentName}</div>
            <div style={{ fontSize: 12, color: '#8896aa', marginTop: 3 }}>
              Mã: {tvv.msddl} · {tvv.office}/{tvv.ban}/{tvv.unit} · Ngày vào: {tvv.appDate} · ĐT: {tvv.phone}
            </div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button
              onClick={saveImage}
              disabled={saving}
              style={{
                display:'flex', alignItems:'center', gap:6,
                padding:'7px 14px', borderRadius:9, border:'none',
                background: saving
                  ? '#e8ecf4'
                  : 'linear-gradient(135deg,#4361ee,#7209b7)',
                color: saving ? '#8896aa' : 'white',
                fontSize:12, fontWeight:700, cursor: saving ? 'default' : 'pointer',
                boxShadow: saving ? 'none' : '0 3px 10px rgba(67,97,238,.3)',
                transition:'all .2s',
              }}
            >
              {saving ? (
                <>
                  <span style={{ fontSize:14 }}>⏳</span> Đang lưu...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Lưu ảnh 121AG
                </>
              )}
            </button>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="modal-body">

          {/* === A. KẾT QUẢ KINH DOANH === */}
          <div className="section-divider">📊 A. KẾT QUẢ KINH DOANH 2026</div>
          {monthly.length > 0 ? (
            <MonthlyTable monthly={monthly} />
          ) : (
            <div style={{ padding:'12px', color:'#8896aa', fontSize:12, background:'#f8f9ff', borderRadius:8, marginBottom:12 }}>
              Chưa có dữ liệu tháng. Upload file Excel để xem chi tiết.
            </div>
          )}

          {/* === B. MDRT 2027 === */}
          <div className="section-divider">🏆 B. MDRT 2027</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
            <IB label="FYP Lũy kế 2026" value={formatNum(tvv.fypYtd)} color="#4361ee" sub="triệu VND" />
            <IB label="FYC 12T vừa qua" value={formatNum(tvv.fyc12m)} color="#f72585" sub="triệu VND" />
            <IB label="TLDTPTT" value={fmtPct(tvv.tldtptt)} color="#7209b7" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
            <IB label="FYP Cần — ON TRACK Q1" value={formatNum(tvv.mdrt_fypCanMdrt)} color="#ef476f" sub="triệu VND" />
            <IB label="FYP Cần — ON TRACK Q2" value={
              (() => {
                // Q2 = fypCanMdrt + 250 (as per COT formula from file)
                // Actually use direct value from col 33/34/35
                const v = tvv.mdrt_fypCanCot
                return formatNum(v)
              })()
            } color="#ef476f" sub="triệu VND (COT)" />
            <IB label="FYP Cần — ON TRACK Q3" value={formatNum(tvv.mdrt_fypCanTot)} color="#ef476f" sub="triệu VND (TOT)" />
            <IB label="MDRT Đã Đạt" value={tvv.mdrt_daDat || '—'} color="#06d6a0" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
            <div className="info-block">
              <div className="info-block-label">MDRT OT Quý 3</div>
              <OTBadge val={tvv.mdrt_otQ3} />
            </div>
            <div className="info-block">
              <div className="info-block-label">MDRT OT Quý 2</div>
              <OTBadge val={tvv.mdrt_otQ2} />
            </div>
            <div className="info-block">
              <div className="info-block-label">MDRT OT Quý 1</div>
              <OTBadge val={tvv.mdrt_otQ1} />
            </div>
          </div>
          {/* MDRT 2027 Chỉ tiêu cả năm */}
          {tvv.mdrt2027_level && tvv.mdrt2027_level !== '-' && (
            <div style={{ background: '#f8f9ff', borderRadius: 10, padding: '12px 16px', border: '1px solid #e8ecf4', marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#4361ee', marginBottom: 8 }}>
                Chỉ tiêu đạt <MdrtBadge val={tvv.mdrt2027_level} /> năm 2027
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <IB label="CHỈ TIÊU FYP" value={fmtIp(tvv.mdrt2027_fypChiTieu)} color="#4361ee" />
                <IB label="CHỈ TIÊU FYC" value={fmtIp(tvv.mdrt2027_fycChiTieu)} color="#f72585" />
                <IB label="CHỈ TIÊU INCOME" value={fmtIp(tvv.mdrt2027_incomeChiTieu)} color="#06d6a0" />
              </div>
            </div>
          )}

          {/* === C. PRU ELITE === */}
          <div className="section-divider">💎 C. PRU ELITE</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
            <IB label="PE Hiện tại" value={<PEBadge val={tvv.peHienTai} />} />
            <IB label="PE Dự kiến" value={<PEBadge val={tvv.peDuKien} />} />
            <IB label="Kết quả tạm tính" value={tvv.ketQuaTamTinh || '—'} color="#fb8500" />
            <IB label="FYC 12T vừa qua" value={formatNum(tvv.fyc12m)} color="#4361ee" sub="triệu VND" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 8 }}>
            <div className="info-block">
              <div className="info-block-label">HĐ Tháng 1</div>
              <ActCheck val={tvv.act1} />
            </div>
            <div className="info-block">
              <div className="info-block-label">HĐ Tháng 2</div>
              <ActCheck val={tvv.act2} />
            </div>
            <div className="info-block">
              <div className="info-block-label">HĐ Tháng 3</div>
              <ActCheck val={tvv.act3} />
            </div>
            <IB label="Tổng HĐ 3 tháng" value={formatNum(tvv.tongHd3m)} color="#06d6a0" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
            <IB label="TLDTPTT" value={fmtPct(tvv.tldtptt)} color="#7209b7" />
            <IB label="FYC Cần thêm (PE)" value={formatNum(tvv.pe_fycCanThem)} color="#ef476f" sub="triệu VND" />
            <IB label="Tháng HĐ cần thêm" value={formatNum(tvv.pe_thangCanThem)} color="#ef476f" />
            <IB label="TLDTPTT cần khôi phục" value={tvv.pe_nangTldtptt || '—'} color="#ef476f" />
          </div>

          {/* === D. THƯỞNG QUÝ CÁ NHÂN === */}
          <div className="section-divider">💰 D. THƯỞNG QUÝ CÁ NHÂN</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 8 }}>
            <IB label="FYC trong quý" value={formatNum(tvv.fyc)} color="#4361ee" sub="triệu VND" />
            <IB label="SYC trong quý" value={formatNum(tvv.syc)} color="#7209b7" sub="triệu VND" />
            <IB label="TLDTPTT" value={fmtPct(tvv.quy_tldtptt)} color="#7209b7" />
            <IB label="Mức Hỗ trợ" value={tvv.mucHoTro != null ? String(tvv.mucHoTro) : '—'} color="#fb8500" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
            <IB label="Mức Chi trả" value={tvv.mucChiTra != null ? String(tvv.mucChiTra) : '—'} color="#06d6a0" />
            <IB label="Tiền thưởng tạm tính" value={formatNum(tvv.thuongTamTinh)} color="#f72585" sub="triệu VND" />
            <IB label="FYC cần tăng mức" value={formatNum(tvv.fycCanThem)} color="#ef476f" sub="triệu VND" />
            <IB label="Thưởng dự kiến tăng thêm" value={formatNum(tvv.quy_thuongTangThem)} color="#4361ee" sub="triệu VND" />
          </div>

          {/* === E. STAR CLUB 2026 === */}
          <div className="section-divider">⭐ E. STAR CLUB 2026</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 8 }}>
            <IB label="HS nộp & phát hành" value={formatNum(tvv.sc_hs)} color="#4361ee" sub="hợp đồng" />
            <IB label="Tổng IP" value={fmtIp(tvv.sc_tongIp)} color="#fb8500" />
            <IB label="TLDTPTT" value={fmtPct(tvv.sc_tldtptt)} color="#7209b7" />
            <IB label="TLDTHĐ" value={fmtPct(tvv.sc_tldthd)} color="#7209b7" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
            <IB label="SLHĐ còn hiệu lực" value={formatNum(tvv.sc_slhd)} color="#4361ee" />
            <IB label="Tạm thỏa ĐK đạt vé" value={tvv.sc_tamThoa || '—'} color="#06d6a0" />
            <IB label="Số vé tạm đạt" value={formatNum(tvv.sc_soVe)} color="#06d6a0" />
            <div className="info-block">
              <div className="info-block-label">Vé Star Club</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: tvv.sc_ve ? '#ffd166' : '#aaa' }}>
                {tvv.sc_ve ? `⭐ ${tvv.sc_ve}` : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
