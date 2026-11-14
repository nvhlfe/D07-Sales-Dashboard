import React, { useState, useEffect, useRef } from 'react'
import { listDailySalesInMonth } from '../lib/db'
import { analyzeSoSanLuong } from '../lib/soSanLuongLogic'
import { diagnoseActivation, ACTIVE_IP_THRESHOLD } from '../lib/activationLogic'

const DIAG_GROUPS = [
  { id: 'chuaNop', label: 'Chưa nộp hồ sơ nào', color: '#c0243c', hint: 'Chưa có hồ sơ IF/PS/Pipeline nào trong tháng — vấn đề ở khâu tiếp cận khách, mở hàng.' },
  { id: 'ketPending', label: 'Có hồ sơ kẹt pending', color: '#b45309', hint: 'Đã nộp nhưng hồ sơ đang chờ xử lý — đẩy các hồ sơ chờ này là đường nhanh nhất tới mốc.' },
  { id: 'nopThua', label: 'Nộp thưa, chưa đủ nhịp', color: '#4361ee', hint: 'Đã nộp/phát hành nhưng còn thiếu nhiều so với mốc — cần tăng nhịp nộp hồ sơ.' },
]
import { formatNum } from '../utils/parseExcel'
import TVVModal from './TVVModal'
import ColumnToggle, { useVisibleColumns } from './ColumnToggle'

function PEBadge({ val }) {
  if (!val) return <span style={{ color: '#ccc' }}>—</span>
  const v = String(val).toUpperCase()
  let bg, color
  if (v.includes('KIM CƯƠNG')) { bg = '#e3f2fd'; color = '#1e88e5' }
  else if (v.includes('BẠCH KIM')) { bg = '#e8f5e9'; color = '#43a047' }
  else if (v.includes('VÀNG') || v.includes('VANG')) { bg = '#fff3cd'; color = '#7a5c00' }
  else { bg = '#f0f4ff'; color = '#4361ee' }
  return <span style={{ background: bg, color, padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700 }}>{val}</span>
}

function ActMark({ val }) {
  if (!val || val === 'NaN' || val === null) return <span style={{ color: '#ddd' }}>—</span>
  if (String(val).includes('ü') || String(val) === 'true') return <span style={{ color: '#06d6a0', fontWeight: 700 }}>✓</span>
  return <span style={{ color: '#ddd' }}>—</span>
}

function fmtPct(val) {
  if (val === null || val === undefined) return '—'
  const n = parseFloat(val)
  if (isNaN(n)) return '—'
  return (n * 100).toFixed(2) + '%'
}

// Xếp hạng bậc PE (dùng để sort các cột kiểu badge)
function peRank(val) {
  const v = String(val || '').toUpperCase()
  if (v.includes('KIM CƯƠNG')) return 3
  if (v.includes('BẠCH KIM')) return 2
  if (v.includes('VÀNG') || v.includes('VANG')) return 1
  return 0
}

// TVV "khác" = PE hiện tại không thuộc 3 bậc Kim Cương / Bạch Kim / Vàng
// (gồm cả TVV chưa có PE hoặc mang nhãn khác)
const isOtherPE = (ag) => peRank(ag.peHienTai) === 0
const PE_OTHER = '__other'

// Các cột TVV hỗ trợ sắp xếp cao→thấp / thấp→cao
const TVV_SORTERS = {
  peHienTai:     ag => peRank(ag.peHienTai),
  ketQuaTamTinh: ag => peRank(ag.ketQuaTamTinh),
  fyc12m:        ag => parseFloat(ag.fyc12m) || 0,
  fyc:           ag => parseFloat(ag.fyc) || 0,
  mucHoTro:      ag => parseFloat(ag.mucHoTro) || 0,
}

// Các cột cho phép bật/tắt (No. + Tên TVV luôn hiện)
const TVV_TOGGLE_COLS = [
  { key: 'ma',        label: 'Mã ĐL' },
  { key: 'bmUnit',    label: 'BM/Unit' },
  { key: 'peHienTai', label: 'PE Hiện tại' },
  { key: 'ketQua',    label: 'PE Tạm đạt' },
  { key: 'fyc12m',    label: 'FYC L12M' },
  { key: 'act1',      label: 'Act T1' },
  { key: 'act2',      label: 'Act T2' },
  { key: 'act3',      label: 'Act T3' },
  { key: 'tldtptt',   label: 'TLDTPTT' },
  { key: 'fycQuy',    label: 'FYC Quý' },
  { key: 'mucHoTro',  label: 'Mức HT (%)' },
  { key: 'fycCanThem',label: 'FYC Cần thêm' },
  { key: 'veStar',    label: 'Vé Star Club' },
]

function SortableTh({ field, label, sortField, sortDir, onSort }) {
  const active = sortField === field
  return (
    <th
      onClick={() => onSort(field)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      title="Click để sắp xếp"
    >
      {label} <span style={{ fontSize: 9, color: active ? '#4361ee' : '#c5cde8' }}>
        {active ? (sortDir === 'desc' ? '▼' : '▲') : '↕'}
      </span>
    </th>
  )
}

export default function TVVTab({ data }) {
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')
  const [filterPE, setFilterPE] = useState('all')
  const [filterUnit, setFilterUnit] = useState('all')
  const [sortField, setSortField] = useState(null)
  const [sortDir, setSortDir] = useState('desc')
  const [visibleCols, setVisibleCols, show] = useVisibleColumns('d07-tvv-cols', TVV_TOGGLE_COLS)

  const agList = data?.agList || []
  const peOptions = ['all', ...new Set(agList.map(a => a.peHienTai).filter(Boolean))]
  const unitOptions = ['all', ...new Set(agList.map(a => a.unit).filter(Boolean))]
    .sort((a, b) => a === 'all' ? -1 : b === 'all' ? 1 : a.localeCompare(b))
  const otherCount = agList.filter(isOtherPE).length

  const filtered = agList.filter(ag => {
    const matchSearch = !search || ag.agentName?.toLowerCase().includes(search.toLowerCase()) || String(ag.msddl).includes(search)
    const matchPE = filterPE === 'all' ? true
      : filterPE === PE_OTHER ? isOtherPE(ag)
      : ag.peHienTai === filterPE
    const matchUnit = filterUnit === 'all' || ag.unit === filterUnit
    return matchSearch && matchPE && matchUnit
  })

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const sorted = React.useMemo(() => {
    if (!sortField) return filtered
    const getter = TVV_SORTERS[sortField]
    const arr = [...filtered].sort((a, b) => getter(a) - getter(b))
    return sortDir === 'desc' ? arr.reverse() : arr
  }, [filtered, sortField, sortDir])

  const bachKim = agList.filter(a => String(a.peHienTai || '').includes('BẠCH KIM')).length
  const vang = agList.filter(a => String(a.peHienTai || '').toUpperCase().includes('VÀNG')).length
  const totalFyc = agList.reduce((s, a) => s + (parseFloat(a.fyc) || 0), 0)
  const colSpan = 2 + visibleCols.length

  // ── ⑲ Chẩn đoán TVV chưa Active (theo Daily mới nhất) ──
  const [diag, setDiag] = useState(null)
  const [diagGroup, setDiagGroup] = useState('ketPending')
  const [diagOpen, setDiagOpen] = useState(true)
  const diagKeyRef = useRef('')
  useEffect(() => {
    const nowD = new Date()
    const key = `${nowD.getFullYear()}-${nowD.getMonth() + 1}|${(data?.agList || []).length}`
    if (diagKeyRef.current === key) return
    diagKeyRef.current = key
    let alive = true
    ;(async () => {
      const fetchMonth = async (y, m) => ({ docs: await listDailySalesInMonth(y, m).catch(() => []), y, m })
      let { docs, y, m } = await fetchMonth(nowD.getFullYear(), nowD.getMonth() + 1)
      if (!docs.length) {
        const prev = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1)
        ;({ docs, y, m } = await fetchMonth(prev.getFullYear(), prev.getMonth() + 1))
      }
      if (!alive) return
      const analysis = analyzeSoSanLuong(docs, [], { year: y, month: m })
      const roster = (data?.agList || []).map((a) => ({ msdl: String(a.msddl || ''), name: a.agentName || '', unit: a.unit || '' }))
      setDiag({ asOf: analysis.asOf, hasData: analysis.hasData, result: diagnoseActivation(roster, analysis.agents) })
    })()
    return () => { alive = false }
  }, [data])

  return (
    <div className="page-content">
      <div className="page-head">
        <div className="page-title">Danh Sách TVV (AG-PE)</div>
        <div className="page-sub">Click vào dòng để xem chi tiết · {agList.length} TVV</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 4 }}>TỔNG TVV</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#4361ee' }}>{agList.length}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 4 }}>BẠCH KIM</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#43a047' }}>{bachKim}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 4 }}>VÀNG</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#e6a800' }}>{vang}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 4 }}>FYC THÁNG</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#f72585' }}>{formatNum(totalFyc)}</div>
          <div style={{ fontSize: 10, color: '#8896aa' }}>triệu VND</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 4 }}>FYC L12M</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#7209b7' }}>
            {formatNum(agList.reduce((s, a) => s + (parseFloat(a.fyc12m) || 0), 0))}
          </div>
          <div style={{ fontSize: 10, color: '#8896aa' }}>triệu VND</div>
        </div>
      </div>

      {/* ── ⑲ Chẩn đoán TVV chưa Active ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div onClick={() => setDiagOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#1a1f5e' }}>🔎 Chẩn đoán TVV chưa Active</span>
          {diag?.asOf && <span style={{ fontSize: 11.5, color: '#8896aa' }}>theo Daily {diag.asOf.slice(8, 10)}/{diag.asOf.slice(5, 7)}/{diag.asOf.slice(0, 4)}</span>}
          {diag?.result && <span style={{ fontSize: 11.5, fontWeight: 700, color: '#c0243c' }}>{diag.result.total - diag.result.activeCount} / {diag.result.total} TVV chưa Active</span>}
          <span style={{ marginLeft: 'auto', color: '#8896aa' }}>{diagOpen ? '▾' : '▸'}</span>
        </div>
        {diagOpen && (
          diag === null ? <div style={{ fontSize: 12, color: '#8896aa', marginTop: 8 }}>Đang phân tích dữ liệu Daily…</div>
          : !diag.hasData ? <div style={{ fontSize: 12, color: '#8896aa', marginTop: 8 }}>Chưa có dữ liệu Daily để chẩn đoán.</div>
          : (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11.5, color: '#8896aa', marginBottom: 10 }}>
                Chuẩn tính: Active = IP phát hành ròng trong tháng ≥ {ACTIVE_IP_THRESHOLD}tr (theo Sổ Sản Lượng, đã trừ CF liên tháng).
                Mỗi TVV chưa Active nằm ở đúng 1 nhóm nguyên nhân — bấm vào nhóm để xem danh sách, xếp theo người sắp qua mốc nhất lên đầu.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
                {DIAG_GROUPS.map((g) => {
                  const list = diag.result.groups[g.id]
                  const quaMoc = g.id === 'ketPending' ? list.filter((x) => x.quaMocNeuThong).length : 0
                  return (
                    <div key={g.id} onClick={() => setDiagGroup(g.id)}
                      style={{ border: `2px solid ${diagGroup === g.id ? g.color : '#e3e8f2'}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer', background: diagGroup === g.id ? '#f8f9ff' : '#fff' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: g.color }}>{g.label.toUpperCase()}</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: g.color }}>{list.length}</div>
                      <div style={{ fontSize: 11, color: '#5a6b87' }}>{g.hint}</div>
                      {quaMoc > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: '#0f9d58', marginTop: 4 }}>✓ {quaMoc} người đẩy pending là qua mốc</div>}
                    </div>
                  )
                })}
              </div>
              {(() => {
                const g = DIAG_GROUPS.find((x) => x.id === diagGroup)
                const list = diag.result.groups[diagGroup]
                return (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: g.color, marginBottom: 6 }}>{g.label} — {list.length} TVV</div>
                    {list.length === 0 ? <div style={{ fontSize: 12, color: '#8896aa' }}>Không có TVV nào ở nhóm này. 🎉</div> : (
                      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                        {list.slice(0, 40).map((pp) => (
                          <div key={pp.msdl} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0', borderBottom: '1px dashed #e3e8f2', fontSize: 12.5, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700 }}>{pp.name || pp.msdl}</span>
                            <span style={{ color: '#8896aa' }}>{pp.unit || '—'} · {pp.msdl}</span>
                            {diagGroup !== 'chuaNop' && <span>IP ròng <b>{formatNum(pp.netIp)}tr</b> · thiếu <b style={{ color: '#c0243c' }}>{formatNum(pp.thieu)}tr</b></span>}
                            {diagGroup === 'ketPending' && <span>đang chờ {pp.pendN} HS ({formatNum(pp.pendIp)}tr)</span>}
                            {diagGroup === 'nopThua' && <span>đã nộp {pp.subN} HS</span>}
                            {pp.quaMocNeuThong && <span style={{ fontWeight: 700, color: '#0f9d58' }}>✓ Đẩy pending là qua mốc</span>}
                          </div>
                        ))}
                        {list.length > 40 && <div style={{ fontSize: 11.5, color: '#8896aa', paddingTop: 6 }}>… và {list.length - 40} TVV nữa</div>}
                      </div>
                    )}
                  </div>
                )
              })()}
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Unit</th>
                      <th style={{ textAlign: 'center' }}>Tổng TVV</th>
                      <th style={{ textAlign: 'center' }}>Đã Active</th>
                      <th style={{ textAlign: 'center' }}>% Active</th>
                      <th style={{ textAlign: 'center' }}>Chưa nộp</th>
                      <th style={{ textAlign: 'center' }}>Kẹt pending</th>
                      <th style={{ textAlign: 'center' }}>Nộp thưa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diag.result.byUnit.map((u) => (
                      <tr key={u.unit}>
                        <td style={{ fontWeight: 700 }}>{u.unit}</td>
                        <td style={{ textAlign: 'center' }}>{u.total}</td>
                        <td style={{ textAlign: 'center', color: '#0f9d58', fontWeight: 700 }}>{u.active}</td>
                        <td style={{ textAlign: 'center' }}>{u.activePct}%</td>
                        <td style={{ textAlign: 'center', color: '#c0243c', fontWeight: 600 }}>{u.chuaNop}</td>
                        <td style={{ textAlign: 'center', color: '#b45309', fontWeight: 600 }}>{u.ketPending}</td>
                        <td style={{ textAlign: 'center', color: '#4361ee', fontWeight: 600 }}>{u.nopThua}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Tìm tên hoặc mã..."
            style={{ flex: 1, minWidth: 200, padding: '8px 14px', border: '1.5px solid #e8ecf4', borderRadius: 9, fontSize: 13, outline: 'none', fontFamily: 'Inter, sans-serif' }}
            onFocus={e => e.target.style.borderColor = '#4361ee'}
            onBlur={e => e.target.style.borderColor = '#e8ecf4'}
          />
          <select value={filterUnit} onChange={e => setFilterUnit(e.target.value)}
            style={{ padding: '8px 12px', border: '1.5px solid #e8ecf4', borderRadius: 9, fontSize: 12, outline: 'none', fontFamily: 'Inter, sans-serif', background: 'white', cursor: 'pointer' }}>
            <option value="all">Tất cả Unit</option>
            {unitOptions.filter(u => u !== 'all').map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select value={filterPE} onChange={e => setFilterPE(e.target.value)}
            style={{ padding: '8px 12px', border: '1.5px solid #e8ecf4', borderRadius: 9, fontSize: 12, outline: 'none', fontFamily: 'Inter, sans-serif', background: 'white', cursor: 'pointer' }}>
            <option value="all">Tất cả PE</option>
            {peOptions.filter(p => p !== 'all').map(p => <option key={p} value={p}>{p}</option>)}
            <option value={PE_OTHER}>TVV khác — ngoài Kim Cương/Bạch Kim/Vàng ({otherCount})</option>
          </select>
          <ColumnToggle columns={TVV_TOGGLE_COLS} visible={visibleCols} onChange={setVisibleCols} />
          <div style={{ fontSize: 12, color: '#8896aa' }}>{filtered.length}/{agList.length} TVV</div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Tên TVV</th>
                {show('ma') && <th>Mã ĐL</th>}
                {show('bmUnit') && <th>BM/Unit</th>}
                {show('peHienTai') && <SortableTh field="peHienTai" label="PE Hiện tại" sortField={sortField} sortDir={sortDir} onSort={handleSort} />}
                {show('ketQua') && <SortableTh field="ketQuaTamTinh" label="PE Tạm đạt" sortField={sortField} sortDir={sortDir} onSort={handleSort} />}
                {show('fyc12m') && <SortableTh field="fyc12m" label="FYC L12M" sortField={sortField} sortDir={sortDir} onSort={handleSort} />}
                {show('act1') && <th>Act T1</th>}
                {show('act2') && <th>Act T2</th>}
                {show('act3') && <th>Act T3</th>}
                {show('tldtptt') && <th>TLDTPTT</th>}
                {show('fycQuy') && <SortableTh field="fyc" label="FYC Quý" sortField={sortField} sortDir={sortDir} onSort={handleSort} />}
                {show('mucHoTro') && <SortableTh field="mucHoTro" label="Mức HT (%)" sortField={sortField} sortDir={sortDir} onSort={handleSort} />}
                {show('fycCanThem') && <th>FYC Cần thêm</th>}
                {show('veStar') && <th>Vé Star Club</th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map((ag, i) => (
                <tr key={i} onClick={() => setSelected(ag)} style={{ cursor: 'pointer' }}>
                  <td style={{ color: '#8896aa' }}>{ag.no}</td>
                  <td><span className="agent-name-link">{ag.agentName}</span></td>
                  {show('ma') && <td style={{ fontSize: 11, color: '#8896aa' }}>{ag.msddl}</td>}
                  {show('bmUnit') && <td style={{ fontSize: 11 }}>{ag.ban}/{ag.unit}</td>}
                  {show('peHienTai') && <td><PEBadge val={ag.peHienTai} /></td>}
                  {show('ketQua') && <td><PEBadge val={ag.ketQuaTamTinh} /></td>}
                  {show('fyc12m') && <td className="val-fyc">{formatNum(ag.fyc12m)}</td>}
                  {show('act1') && <td><ActMark val={ag.act1} /></td>}
                  {show('act2') && <td><ActMark val={ag.act2} /></td>}
                  {show('act3') && <td><ActMark val={ag.act3} /></td>}
                  {show('tldtptt') && <td style={{ fontSize: 11, color: '#7209b7', fontWeight: 600 }}>{ag.tldtptt != null && !isNaN(ag.tldtptt) ? Number(ag.tldtptt).toFixed(1)+'%' : '—'}</td>}
                  {show('fycQuy') && <td className="val-fyc">{formatNum(ag.fyc)}</td>}
                  {show('mucHoTro') && <td style={{color:"#fb8500",fontWeight:600}}>{ag.mucHoTro != null && !isNaN(Number(ag.mucHoTro)) ? Number(ag.mucHoTro).toFixed(1)+'%' : '—'}</td>}
                  {show('fycCanThem') && <td className="val-red">{formatNum(ag.fycCanThem)}</td>}
                  {show('veStar') && <td style={{ fontSize: 11, color: '#fb8500', fontWeight: 600 }}>{ag.sc_ve || '—'}</td>}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={colSpan} style={{ textAlign: 'center', padding: 24, color: '#8896aa' }}>Không tìm thấy</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, fontSize: 11.5, color: '#8896aa' }}>
          <em>Click vào dòng để xem chi tiết: KQ Kinh Doanh, MDRT, PRU ELITE, Thưởng Quý, Star Club</em>
        </div>
      </div>

      {selected && <TVVModal tvv={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
