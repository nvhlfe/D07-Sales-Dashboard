import React from 'react'
import { formatNum } from '../utils/parseExcel'

const InfoBlock = ({ label, value, color, sub }) => (
  <div className="info-block">
    <div className="info-block-label">{label}</div>
    <div className="info-block-value" style={color ? { color } : {}}>{value || '—'}</div>
    {sub && <div className="info-block-sub">{sub}</div>}
  </div>
)

function PCBadge({ val }) {
  if (!val) return <span style={{ color: '#ccc' }}>—</span>
  const v = String(val).toUpperCase()
  let cls = ''
  if (v.includes('VÀNG') || v.includes('VANG')) cls = 'pc-VANG'
  else if (v.includes('KIM CƯƠNG')) cls = 'pc-KIM_CUONG'
  else if (v.includes('BẠCH KIM')) cls = 'pc-BACH_KIM'
  return <span className={`pc-badge ${cls}`}>{val}</span>
}

function fmtDate(val) {
  if (!val) return '—'
  if (val instanceof Date) return val.toLocaleDateString('vi-VN')
  const s = String(val)
  if (s.includes('T')) return s.split('T')[0]
  return s
}

function fmtPct(val) {
  if (val === null || val === undefined) return '—'
  const n = Number(val)
  if (isNaN(n)) return '—'
  return n.toFixed(1) + '%'
}

function CheckMark({ val }) {
  if (!val) return <span style={{ color: '#ddd' }}>—</span>
  const s = String(val)
  if (s.includes('ü') || s.toLowerCase() === 'true') return <span style={{ color: '#06d6a0', fontWeight: 700, fontSize: 16 }}>✓ Đạt</span>
  if (s === '-') return <span style={{ color: '#8896aa' }}>—</span>
  return <span style={{ color: '#ef476f' }}>✗</span>
}

export default function UMModal({ um, onClose }) {
  if (!um) return null

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 860 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">📋 {um.leaderName}</div>
            <div style={{ fontSize: 12, color: '#8896aa', marginTop: 2 }}>
              Mã: {um.leaderCode} · {um.off}/{um.bm}/{um.unit} · {um.agType} · {fmtDate(um.appDate)}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Basic info */}
          <div className="info-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 12 }}>
            <InfoBlock label="Văn phòng / Ban" value={`${um.off} / ${um.bm}`} />
            <InfoBlock label="Unit" value={um.unit} />
            <InfoBlock label="Ngày bổ nhiệm" value={fmtDate(um.appDate)} />
            <InfoBlock label="Điện thoại" value={um.phone} />
          </div>

          {/* === PRU CHAMPION === */}
          <div className="section-divider">🏆 PRU CHAMPION</div>
          <div className="info-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <InfoBlock label="PC Hiện tại" value={<PCBadge val={um.pcHienTai} />} />
            <InfoBlock label="PC Tạm đạt" value={<PCBadge val={um.pcTamDat} />} />
            <InfoBlock label="PC Dự kiến" value={<PCBadge val={um.pcDuKien} />} />
            <InfoBlock label="FYC Phòng TT" value={formatNum(um.fycPhongTT)} color="#4361ee" sub="triệu VND" />
            <InfoBlock label="FYC Cần thêm" value={formatNum(um.fycCanThem)} color="#ef476f" sub="triệu VND" />
            <InfoBlock label="TVV Mới CL cần thêm" value={formatNum(um.tvvMoiCl)} color="#f72585" />
          </div>

          {/* === THƯỞNG QUÝ NHÓM === */}
          <div className="section-divider">💰 THƯỞNG QUÝ NHÓM</div>
          <div className="info-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <InfoBlock label="Tổng FYC" value={formatNum(um.tongFyc)} color="#4361ee" sub="triệu VND" />
            <InfoBlock label="Tổng TVV Hoạt động" value={formatNum(um.tongTvvAct)} color="#06d6a0" />
            <InfoBlock label="TLDTPTT" value={fmtPct(um.tldtptt)} color="#7209b7" />
            <InfoBlock label="Mức Hỗ trợ" value={um.mucHoTro || '—'} color="#fb8500" />
            <InfoBlock label="Mức Chi trả" value={um.mucChiTra || '—'} color="#06d6a0" />
            <InfoBlock label="Tiền thưởng tạm đạt" value={formatNum(um.tienThuong)} color="#f72585" sub="triệu VND" />
            <InfoBlock label="Lượt ACT cần thêm" value={formatNum(um.luotActCanThem)} color="#ef476f" />
            <InfoBlock label="Thưởng tăng thêm" value={formatNum(um.thuongTangThem)} color="#4361ee" sub="triệu VND" />
          </div>

          {/* === UM MOC — DUY TRÌ UM === */}
          <div className="section-divider">🔐 UM MOC — DUY TRÌ CHỨC DANH UM</div>
          <div className="info-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <InfoBlock label="FYC Phòng TT 6 tháng" value={formatNum(um.moc_fyc6thang)} color="#4361ee" sub="triệu VND (≥20tr)" />
            <InfoBlock label="Lượt TVV Có HĐ" value={formatNum(um.moc_luotTvvAct)} color="#06d6a0" sub="(≥6 lượt)" />
            <InfoBlock label="Lượt TVV Mới CL" value={formatNum(um.moc_tvvMoiCl)} color="#f72585" sub="(*2 lượt)" />
            <InfoBlock label="Tổng Lượt TVV HĐ" value={formatNum(um.moc_tongLuot)} color="#7209b7" />
            <InfoBlock label="TLDTPTT" value={fmtPct(um.moc_tldtptt)} color="#7209b7" sub="(≥80%)" />
            <InfoBlock label="Tạm Đạt Duy Trì" value={<CheckMark val={um.moc_tamDat} />} />
          </div>
          <div className="info-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <InfoBlock label="FYC Cần Thêm (duy trì)" value={formatNum(um.moc_fycCanThem)} color="#ef476f" />
            <InfoBlock label="Lượt ACT Cần Thêm" value={formatNum(um.moc_luotCanThem)} color="#ef476f" />
            <InfoBlock label="TLDTPTT Cần Thêm" value={um.moc_tldtCanThem || '—'} color="#ef476f" />
          </div>

          {/* === TVVMCL === */}
          <div className="section-divider">👥 TVVMCL</div>
          <div className="info-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <InfoBlock label="TVVMCL Trực tiếp" value={formatNum(um.tvvmcl)} color="#4361ee" />
            <InfoBlock label="50% TVVMCL GEN1" value={formatNum(um.tvvmclGen1)} color="#7209b7" />
            <InfoBlock label="Tổng TVVMCL GEN1" value={formatNum(um.tongTvvmclGen1)} color="#06d6a0" />
          </div>

          {/* === STAR CLUB NHÓM === */}
          <div className="section-divider">⭐ STAR CLUB NHÓM</div>
          <div className="info-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <InfoBlock label="Lượt TVV HĐ TB" value={formatNum(um.luotTvvHdTb)} color="#4361ee" />
            <InfoBlock label="Tổng IP" value={um.tongIp ? Number(um.tongIp).toLocaleString('vi-VN') : '—'} color="#fb8500" />
            <InfoBlock label="Tạm Thỏa Điều Kiện" value={um.tamThoaDK ? '✓ Có' : '—'} color="#06d6a0" />
            <InfoBlock label="Vé Tham Dự" value={um.veThamDu || '—'} color="#ffd166" />
          </div>
        </div>
      </div>
    </div>
  )
}
