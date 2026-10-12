import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { getFirebase, logAudit, saveReportsDoc, useAuth, useReportsDoc } from '../lib/db'

// ═════════════════════════════════════════════════════════════
// SalesReportTab — port từ public/sales-report.html sang React
// Logic nghiệp vụ giữ nguyên 100% file gốc. Năm hardcode 2026
// như file gốc (tiêu đề, key ngày, tên file export).
// ═════════════════════════════════════════════════════════════
const YEAR = 2026
const STATUS_LBL = { none: 'Chưa phí', paid: 'Có phí', issued: 'Phát hành' }
const AUDIT_ICON = {
  update_field: '✏️', add_person: '➕', delete_person: '🗑️',
  update_fee: '💰', update_status: '🔄', delete_case: '❌',
  add_case: '📝', update_note: '🗒️',
}

const createDefaultData = () => [{ group: 'G01', msdl: '100001', name: 'Nguyễn Văn A', daily: {} }]
const daysInMonth = (m) => new Date(YEAR, m, 0).getDate()
const dayOfWeek = (m, d) => new Date(YEAR, m - 1, d).getDay()

const sumCases = (p, pred) => {
  let t = 0
  Object.values(p.daily || {}).forEach((d) => {
    ;(d.cases || []).forEach((c) => { if (!pred || pred(c)) t += Number(c.fee || 0) })
  })
  return t
}
const calcTotal = (p) => sumCases(p)
const calcIssued = (p) => sumCases(p, (c) => c.status === 'issued')

const fmt = (v) => (v ? Number(v).toLocaleString('vi-VN') : '—')
const fmtM = (v) => {
  const n = Number(v || 0)
  return n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n.toLocaleString('vi-VN')
}

const validateFee = (val) => {
  if (val === '' || val == null) return { ok: true }
  const n = Number(val)
  if (Number.isNaN(n)) return { ok: false, msg: 'Phí phải là số' }
  if (Math.abs(n) > 500000000) return { ok: false, msg: 'Phí lớn bất thường (>500tr) — kiểm tra lại số 0' }
  return { ok: true }
}

const TABS = [
  { id: 'report', label: '📋 Report' },
  { id: 'overview', label: '👁 Overview' },
  { id: 'summary', label: '📊 Tổng hợp' },
]

export default function SalesReportTab() {
  const { user, isAdmin } = useAuth()
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [selectedDay, setSelectedDay] = useState('all')
  const [sortType, setSortType] = useState('default')
  const [activeTab, setActiveTab] = useState('report')
  const [reportData, setReportData] = useState([])
  const [hasRemoteData, setHasRemoteData] = useState(false)
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const [rev, setRev] = useState(0) // bump để remount input khi validate fail (revert hiển thị)
  const [caseModal, setCaseModal] = useState(null) // { pi, d }
  const [mFee, setMFee] = useState('')
  const [mStatus, setMStatus] = useState('none')
  const [mNote, setMNote] = useState('')
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditLogs, setAuditLogs] = useState([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [clock, setClock] = useState('')

  const dataRef = useRef([])
  const saveTimerRef = useRef(null)
  const pendingSaveRef = useRef(false)

  const { data: docData, source, loading } = useReportsDoc(YEAR, month)
  const days = daysInMonth(month)

  // ── Đồng bộ dữ liệu realtime từ Firestore ──
  useEffect(() => {
    if (loading) return
    if (pendingSaveRef.current) return // đang có thay đổi chưa lưu: giữ local, không để snapshot đè
    if (docData && Array.isArray(docData.data)) {
      dataRef.current = docData.data
      setReportData(docData.data)
      setHasRemoteData(true)
    } else {
      const d = createDefaultData()
      dataRef.current = d
      setReportData(d)
      setHasRemoteData(false)
    }
  }, [docData, loading, month])

  // ── Đồng hồ ──
  useEffect(() => {
    const tick = () => {
      const n = new Date()
      setClock(n.toLocaleDateString('vi-VN') + ' ' + n.toLocaleTimeString('vi-VN'))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const applyData = (next) => { dataRef.current = next; setReportData(next) }

  // ── Lưu debounce 500ms (gom các edit liên tiếp thành 1 write, như file gốc) ──
  const flushSave = async () => {
    clearTimeout(saveTimerRef.current)
    setSaveState('saving')
    try {
      await saveReportsDoc(YEAR, month, { data: dataRef.current }, user?.email)
      pendingSaveRef.current = false
      setHasRemoteData(true)
      setSaveState('saved')
      setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2500)
    } catch (e) {
      console.error('[SalesReport] save error:', e)
      setSaveState('error')
    }
  }
  const scheduleSave = () => {
    pendingSaveRef.current = true
    setSaveState('saving')
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(flushSave, 500)
  }

  const audit = (action, detail) => {
    logAudit({ month: String(month), action, detail, user: user?.email })
      .catch((e) => console.error('[SalesReport] audit error:', e))
  }

  // mutate: deep clone → sửa → apply → debounce save → ghi audit
  const mutate = (fn, auditAction, auditDetail) => {
    if (!isAdmin) return
    const next = JSON.parse(JSON.stringify(dataRef.current))
    fn(next)
    applyData(next)
    scheduleSave()
    if (auditAction) audit(auditAction, auditDetail)
  }

  const changeMonth = (m) => {
    clearTimeout(saveTimerRef.current)
    pendingSaveRef.current = false
    setSaveState('idle')
    setSelectedDay('all')
    setMonth(m)
  }

  // ── CRUD (logic y hệt file gốc) ──
  const updateField = (pi, field, val) => {
    if (!isAdmin) return
    const oldVal = dataRef.current[pi]?.[field]
    if (String(oldVal ?? '') === String(val ?? '')) return
    mutate((next) => { next[pi][field] = val },
      'update_field', `${field}: "${oldVal}" → "${val}" (dòng ${pi + 1})`)
  }

  const addPerson = () => {
    mutate((next) => { next.push({ group: 'GROUP', msdl: '000000', name: 'Nhân sự mới', daily: {} }) },
      'add_person', `Thêm dòng mới (dòng ${dataRef.current.length + 1})`)
  }

  const deletePerson = (pi) => {
    const person = dataRef.current[pi]
    if (!person) return
    const totalFee = calcTotal(person)
    const msg = totalFee > 0
      ? `⚠️ "${person.name}" có TỔNG PHÍ ${totalFee.toLocaleString('vi-VN')} VND.\n\nXóa dòng này sẽ mất toàn bộ dữ liệu hồ sơ. Bạn chắc chắn?`
      : `Xóa dòng "${person.name}"?`
    if (!window.confirm(msg)) return
    mutate((next) => { next.splice(pi, 1) }, 'delete_person',
      `Xóa "${person.name}" (MSDL ${person.msdl}, tổng phí ${totalFee.toLocaleString('vi-VN')})`)
  }

  const updateCaseFee = (pi, d, ci, val) => {
    if (!isAdmin) return
    const check = validateFee(val)
    if (!check.ok) { window.alert('⚠️ ' + check.msg); setRev((r) => r + 1); return }
    const oldFee = dataRef.current[pi]?.daily?.[d]?.cases?.[ci]?.fee
    if (String(oldFee ?? '') === String(val)) return
    const name = dataRef.current[pi]?.name
    mutate((next) => { next[pi].daily[d].cases[ci].fee = val }, 'update_fee',
      `${name} ngày ${d}: ${Number(oldFee || 0).toLocaleString('vi-VN')} → ${Number(val || 0).toLocaleString('vi-VN')} VND`)
  }

  const updateCaseStatus = (pi, d, ci, val) => {
    if (!isAdmin) return
    const oldStatus = dataRef.current[pi]?.daily?.[d]?.cases?.[ci]?.status
    if (oldStatus === val) return
    const name = dataRef.current[pi]?.name
    mutate((next) => { next[pi].daily[d].cases[ci].status = val }, 'update_status',
      `${name} ngày ${d}: ${STATUS_LBL[oldStatus] || oldStatus} → ${STATUS_LBL[val]}`)
  }

  const deleteCase = (pi, d, ci) => {
    if (!isAdmin) return
    const item = dataRef.current[pi]?.daily?.[d]?.cases?.[ci]
    if (!item) return
    const fee = Number(item.fee || 0)
    const name = dataRef.current[pi]?.name
    if (fee > 0 && !window.confirm(`Xóa hồ sơ phí ${fee.toLocaleString('vi-VN')} VND? Hành động này không thể hoàn tác.`)) return
    mutate((next) => {
      next[pi].daily[d].cases.splice(ci, 1)
      if (!next[pi].daily[d].cases.length) delete next[pi].daily[d]
    }, 'delete_case', `${name} ngày ${d}: xóa hồ sơ ${fee.toLocaleString('vi-VN')} VND (${STATUS_LBL[item.status]})`)
  }

  const editCaseNote = (pi, d, ci) => {
    if (!isAdmin) return
    const item = dataRef.current[pi]?.daily?.[d]?.cases?.[ci]
    if (!item) return
    const val = window.prompt('Ghi chú cho hồ sơ này (hiện khi rê chuột vào góc đỏ):', item.note || '')
    if (val === null) return
    const name = dataRef.current[pi]?.name
    mutate((next) => { next[pi].daily[d].cases[ci].note = val.trim() }, 'update_note',
      `${name} ngày ${d}: cập nhật ghi chú hồ sơ`)
  }

  const applySorting = (type) => {
    setSortType(type)
    const next = JSON.parse(JSON.stringify(dataRef.current))
    if (type === 'group') next.sort((a, b) => String(a.group).localeCompare(String(b.group)))
    else if (type === 'highest') next.sort((a, b) => calcTotal(b) - calcTotal(a))
    else if (type === 'issued') next.sort((a, b) => calcIssued(b) - calcIssued(a))
    applyData(next) // chỉ sắp xếp view, không save (y như file gốc)
  }

  // ── Modal thêm hồ sơ ──
  const openCaseModal = (pi, d) => {
    if (!isAdmin) return
    setMFee(''); setMStatus('none'); setMNote('')
    setCaseModal({ pi, d })
  }
  const saveModalCase = () => {
    if (!caseModal) return
    const check = validateFee(mFee)
    if (!check.ok) { window.alert('⚠️ ' + check.msg); return }
    const { pi, d } = caseModal
    const name = dataRef.current[pi]?.name
    mutate((next) => {
      if (!next[pi].daily[d]) next[pi].daily[d] = { cases: [] }
      next[pi].daily[d].cases.push({ fee: mFee, status: mStatus, note: mNote.trim() })
    }, 'add_case', `${name} ngày ${d}: thêm hồ sơ ${Number(mFee || 0).toLocaleString('vi-VN')} VND (${STATUS_LBL[mStatus]})`)
    setCaseModal(null)
  }

  // ── Xem lịch sử audit ──
  const openAuditLog = async () => {
    setAuditOpen(true)
    setAuditLoading(true)
    setAuditLogs([])
    try {
      const { fs } = getFirebase() // dùng singleton của data layer, không init riêng
      const q = query(
        collection(fs, 'audit_log'),
        where('month', '==', String(month)),
        orderBy('at', 'desc'),
        limit(20)
      )
      const snap = await getDocs(q)
      setAuditLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    } catch (e) {
      console.error('[SalesReport] audit load error:', e)
      setAuditLogs(null)
    } finally {
      setAuditLoading(false)
    }
  }

  // ── Export Excel ──
  const exportExcel = () => {
    const rows = [['STT', 'Mã nhóm', 'MSDL', 'Họ tên', 'Hồ sơ', 'Tổng phí', 'Phát hành', 'Pending', 'Có phí', 'Chưa phí']]
    reportData.forEach((p, i) => {
      let cases = 0, fee = 0, issued = 0, paid = 0, noFee = 0
      Object.values(p.daily || {}).forEach((dd) => {
        ;(dd.cases || []).forEach((c) => {
          const v = Number(c.fee || 0); cases++; fee += v
          if (c.status === 'issued') issued += v
          else if (c.status === 'paid') paid += v
          else if (c.status === 'none') noFee += v
        })
      })
      rows.push([i + 1, p.group, p.msdl, p.name, cases, fee, issued, fee - issued - noFee, paid, noFee])
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'TONG_HOP')
    XLSX.writeFile(wb, `D07_TONG_HOP_${YEAR}.xlsx`)
  }

  const dayList = useMemo(() => {
    const arr = []
    for (let d = 1; d <= days; d++) {
      if (selectedDay !== 'all' && parseInt(selectedDay, 10) !== d) continue
      arr.push(d)
    }
    return arr
  }, [days, selectedDay])

  const exportOverviewExcel = () => {
    const header = ['STT', 'Mã nhóm', 'MSDL', 'Họ tên', ...dayList.map((d) => `Ngày ${d}`), 'Tổng', 'Phát hành', 'Có phí chưa PH', 'Chưa phí']
    const rows = [header]
    reportData.forEach((p, i) => {
      let total = 0, issued = 0, paid = 0, noFee = 0
      const dayValues = dayList.map((d) => {
        const dd = (p.daily || {})[d] || { cases: [] }
        let dayTot = 0
        ;(dd.cases || []).forEach((c) => {
          const v = Number(c.fee || 0); dayTot += v; total += v
          if (c.status === 'issued') issued += v
          else if (c.status === 'paid') paid += v
          else if (c.status === 'none') noFee += v
        })
        return dayTot || ''
      })
      rows.push([i + 1, p.group, p.msdl, p.name, ...dayValues, total || '', issued || '', paid || '', noFee || ''])
    })
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [
      { wch: 5 }, { wch: 10 }, { wch: 10 }, { wch: 24 },
      ...dayList.map(() => ({ wch: 9 })),
      { wch: 11 }, { wch: 11 }, { wch: 13 }, { wch: 11 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'OVERVIEW')
    const dayTag = selectedDay !== 'all' ? `_Ngay${selectedDay}` : ''
    XLSX.writeFile(wb, `D07_OVERVIEW_T${String(month).padStart(2, '0')}_${YEAR}${dayTag}.xlsx`)
  }

  // ── Tính toán hiển thị ──
  const kpi = useMemo(() => {
    let total = 0, issued = 0, noFee = 0, cases = 0
    reportData.forEach((p) => {
      Object.values(p.daily || {}).forEach((dd) => {
        ;(dd.cases || []).forEach((c) => {
          const v = Number(c.fee || 0); cases++; total += v
          if (c.status === 'issued') issued += v
          else if (c.status === 'none') noFee += v
        })
      })
    })
    return { tvv: reportData.length, cases, total, issued, pending: total - issued - noFee, noFee }
  }, [reportData])

  const dailyTotals = useMemo(() => {
    const map = {}
    dayList.forEach((d) => {
      let tot = 0
      reportData.forEach((p) => {
        ;(((p.daily || {})[d] || {}).cases || []).forEach((c) => { tot += Number(c.fee || 0) })
      })
      map[d] = tot
    })
    return map
  }, [reportData, dayList])

  const rowSummary = (p) => {
    let totalFee = 0, noFee = 0, issued = 0, paidNI = 0
    Object.values(p.daily || {}).forEach((dd) => {
      ;(dd.cases || []).forEach((c) => {
        const v = Number(c.fee || 0); totalFee += v
        if (c.status === 'none') noFee += v
        else if (c.status === 'issued') issued += v
        else if (c.status === 'paid') paidNI += v
      })
    })
    return { totalFee, noFee, issued, paidNI }
  }

  const summary = useMemo(() => {
    let tC = 0, tF = 0, tI = 0, tP = 0, tN = 0
    const rows = reportData.map((p) => {
      let cases = 0, fee = 0, issued = 0, noFee = 0
      Object.values(p.daily || {}).forEach((dd) => {
        ;(dd.cases || []).forEach((c) => {
          const v = Number(c.fee || 0); cases++; fee += v
          if (c.status === 'issued') issued += v
          else if (c.status === 'none') noFee += v
        })
      })
      const pending = fee - issued - noFee
      tC += cases; tF += fee; tI += issued; tP += pending; tN += noFee
      return { p, cases, fee, issued, pending, noFee }
    })
    return { rows, totals: { tC, tF, tI, tP, tN } }
  }, [reportData])

  const saveInfo = {
    saving: { text: '⏳ Đang lưu...', color: '#92400e' },
    saved: { text: '✓ Đã lưu', color: '#065f46' },
    error: { text: '⚠ Lỗi lưu — thử lại', color: '#991b1b' },
    idle: { text: '', color: '#8896aa' },
  }[saveState]

  return (
    <div>
      <style>{`
        .sr-toolbar{position:sticky;top:0;z-index:40;background:#fff;border-bottom:1px solid #e8ecf4;padding:8px 14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(67,97,238,.07)}
        .sr-tool-group{display:flex;align-items:center;gap:6px}
        .sr-tool-sep{width:1px;height:24px;background:#e8ecf4;margin:0 2px}
        .sr-tool-label{font-size:10px;font-weight:600;color:#8896aa;white-space:nowrap}
        .sr-compact{border:1.5px solid #e8ecf4;border-radius:7px;padding:5px 9px;font-size:11.5px;font-family:inherit;background:#fff;outline:none;cursor:pointer;color:#1a1f36}
        .sr-compact:focus{border-color:#4361ee}
        .sr-btn{padding:5px 12px;border-radius:7px;border:none;font-size:11.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:all .15s;white-space:nowrap;font-family:inherit}
        .sr-btn:active{transform:scale(.97)}
        .sr-btn-tab{background:#f0f4ff;color:#4361ee}
        .sr-btn-tab:hover{background:#4361ee;color:#fff}
        .sr-btn-tab.active{background:#4361ee;color:#fff;box-shadow:0 2px 8px rgba(67,97,238,.3)}
        .sr-btn-green{background:#e6faf2;color:#065f46}
        .sr-btn-green:hover{background:#06d6a0;color:#fff}
        .sr-btn-purple{background:#f3e8ff;color:#6d28d9}
        .sr-btn-purple:hover{background:#7c3aed;color:#fff}
        .sr-btn-export{background:#fef3c7;color:#92400e}
        .sr-btn-export:hover{background:#f59e0b;color:#fff}
        .sr-clock{margin-left:auto;font-size:10.5px;font-weight:600;color:#4361ee;background:#f0f4ff;padding:4px 10px;border-radius:6px;white-space:nowrap}
        .sr-hint{margin:0 14px 8px;background:linear-gradient(90deg,#eef2ff,#f0f9ff);border:1px solid #c7d2fe;border-radius:8px;padding:6px 12px;font-size:11px;color:#4338ca;font-weight:500;display:flex;align-items:center;gap:6px}
        .sr-save-ind{font-size:11px;font-weight:600;white-space:nowrap;min-width:80px}
        .sr-src{font-size:10px;color:#aab4c8;white-space:nowrap}
        .sr-kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:10px 14px 0}
        .sr-report .sr-table-wrap{overflow-x:auto;background:#fff;border-radius:12px;margin:0 14px 14px;box-shadow:0 1px 6px rgba(67,97,238,.07);border:1px solid #e8ecf4}
        .sr-report table{border-collapse:collapse;font-size:11px;width:100%}
        .sr-report thead th{background:#eef2ff;color:#4361ee;font-size:10px;font-weight:700;padding:5px 4px;text-align:center;border:1px solid #dde3f8;white-space:nowrap}
        .sr-report thead tr:nth-child(2) th{background:#f8f9ff;color:#4a5568;border-bottom:2px solid #dde3f8;position:sticky;top:0}
        .sr-report thead tr:nth-child(2) th.col-stt,.sr-report thead tr:nth-child(2) th.col-grp,.sr-report thead tr:nth-child(2) th.col-msdl,.sr-report thead tr:nth-child(2) th.col-name{background:#eef2ff}
        .sr-report .col-stt{position:sticky;left:0;z-index:5;min-width:34px;max-width:34px;background:#f8f9ff}
        .sr-report .col-grp{position:sticky;left:34px;z-index:5;min-width:70px;max-width:70px;background:#f8f9ff}
        .sr-report .col-msdl{position:sticky;left:104px;z-index:5;min-width:72px;max-width:72px;background:#f8f9ff}
        .sr-report .col-name{position:sticky;left:176px;z-index:5;min-width:140px;max-width:140px;background:#f8f9ff;border-right:2px solid #dde3f8 !important}
        .sr-report td{border:1px solid #edf0f9;padding:3px;vertical-align:top}
        .sr-report tbody tr:hover td{background:#fafbff !important}
        .sr-report tbody tr:hover td.col-stt,.sr-report tbody tr:hover td.col-grp,.sr-report tbody tr:hover td.col-msdl,.sr-report tbody tr:hover td.col-name{background:#eef2ff !important}
        .sr-report .day-sun{background:#fee2e2 !important;color:#dc2626 !important}
        .sr-report .day-sat{background:#fef9c3 !important;color:#d97706 !important}
        .sr-report .day-cell{cursor:pointer;width:86px;min-width:86px;max-width:86px;min-height:34px;transition:background .12s;overflow:hidden}
        .sr-report .day-cell:hover{background:#eff6ff !important}
        .sr-report .case-card{border-radius:5px;padding:2px 3px;margin-bottom:2px;border:1.5px solid transparent;overflow:visible;width:100%;box-sizing:border-box;position:relative}
        .sr-report .case-note-mark{position:absolute;top:-1px;right:-1px;width:0;height:0;border-style:solid;border-width:0 8px 8px 0;border-color:transparent #cbd5e1 transparent transparent;cursor:pointer;z-index:4;opacity:.55;transition:border-color .12s,opacity .12s}
        .sr-report .case-note-mark:hover{opacity:1}
        .sr-report .case-note-mark.has-note{border-color:transparent #dc2626 transparent transparent;opacity:1}
        .sr-report .case-card.none{background:#fee2e2;border-color:#fca5a5}
        .sr-report .case-card.paid{background:#fef9c3;border-color:#fde68a}
        .sr-report .case-card.issued{background:#dcfce7;border-color:#86efac}
        .sr-report .case-card-top{display:flex;align-items:center;gap:2px;margin-bottom:2px}
        .sr-report .case-fee-input{font-size:10px;border:none;background:transparent;outline:none;font-weight:700;cursor:text;font-family:inherit;flex:1;min-width:0;color:inherit}
        .sr-report .case-pill-del{width:13px;height:13px;border-radius:50%;flex-shrink:0;background:rgba(0,0,0,.12);border:none;cursor:pointer;font-size:9px;display:flex;align-items:center;justify-content:center;color:inherit;line-height:1}
        .sr-report .case-pill-del:hover{background:#ef4444;color:#fff}
        .sr-report .status-btns{display:flex;gap:2px;width:100%}
        .sr-report .status-btn{flex:1;border:none;border-radius:3px;cursor:pointer;font-size:9px;font-weight:800;padding:2px 1px;font-family:inherit;opacity:.32;transition:opacity .12s,transform .1s;text-align:center;overflow:hidden}
        .sr-report .status-btn:hover:not(:disabled){opacity:.65}
        .sr-report .status-btn.active{opacity:1;transform:scale(1.06);box-shadow:0 1px 4px rgba(0,0,0,.2)}
        .sr-report .status-btn:disabled{cursor:default}
        .sr-report .status-btn.s-none{background:#fca5a5;color:#7f1d1d}
        .sr-report .status-btn.s-paid{background:#fde68a;color:#78350f}
        .sr-report .status-btn.s-issued{background:#86efac;color:#14532d}
        .sr-report .editable-input{font-size:11px;border:none;background:transparent;outline:none;width:100%;font-family:inherit;cursor:default;padding:1px 2px;color:#1a1f36}
        .sr-report .editable-input:focus{background:#eff6ff;border-radius:4px;cursor:text}
        .sr-report .editable-input:read-only{cursor:default}
        .sr-report .editable-input.sr-name{font-weight:600}
        .sr-report .col-total{background:#eff6ff;color:#1d4ed8;font-weight:700;min-width:72px;text-align:center}
        .sr-report .col-nofee{background:#fdf2f8;color:#be185d;font-weight:700;min-width:72px;text-align:center}
        .sr-report .col-issued{background:#f0fdf4;color:#15803d;font-weight:700;min-width:72px;text-align:center}
        .sr-report .col-paid{background:#fefce8;color:#a16207;font-weight:700;min-width:72px;text-align:center}
        .sr-report .sr-c{text-align:center;font-weight:700;color:#8896aa;font-size:11px}
        .sr-report .sr-cellflex{display:flex;align-items:center;gap:3px}
        .sr-report .sr-link{text-decoration:none;flex-shrink:0}
        .sr-report .sr-mini-del{width:13px;height:13px;border-radius:50%;background:#fca5a5;border:none;cursor:pointer;font-size:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#7f1d1d}
        .sr-report .sr-dayhead-first{position:sticky;left:0;background:#eef2ff;z-index:6;font-size:10px;font-weight:700;color:#4361ee;padding:5px 8px;text-align:left}
        .ov-sun{background:#fee2e2 !important;color:#dc2626 !important}
        .ov-sat{background:#fef9c3 !important;color:#d97706 !important}
        .sr-ov-total{background:#eff6ff;color:#1d4ed8;font-weight:700;text-align:center}
        .sr-ov-issued{background:#f0fdf4;color:#15803d;font-weight:700;text-align:center}
        .sr-ov-paid{background:#fefce8;color:#a16207;font-weight:700;text-align:center}
        .sr-ov-nofee{background:#fdf2f8;color:#be185d;font-weight:700;text-align:center}
        .sr-form-input{width:100%;border:1.5px solid #e8ecf4;border-radius:8px;padding:9px 12px;font-size:13px;font-family:inherit;outline:none;margin-bottom:10px;background:#fff;color:#1a1f36;box-sizing:border-box}
        .sr-form-input:focus{border-color:#4361ee}
        .sr-btn-primary{width:100%;background:#4361ee;color:#fff;border:none;border-radius:9px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
        .sr-btn-primary:hover{background:#3451d1}
        .sr-audit-item{display:flex;gap:10px;padding:8px 10px;background:#f8f9ff;border-radius:8px;border:1px solid #e8ecf4}
        .sr-empty{text-align:center;padding:20px;color:#8896aa;font-size:12px}
        @media (max-width:900px){.sr-kpis{grid-template-columns:repeat(3,1fr)}}
      `}</style>

      {/* ── TOOLBAR ── */}
      <div className="sr-toolbar">
        <div className="sr-tool-group">
          <span style={{ fontSize: 14, fontWeight: 800, color: '#4361ee', marginRight: 4 }}>D07</span>
          <span className="sr-tool-label">Doanh số {YEAR}</span>
        </div>
        <div className="sr-tool-sep" />
        <div className="sr-tool-group">
          <span className="sr-tool-label">Tháng</span>
          <select className="sr-compact" value={month} onChange={(e) => changeMonth(parseInt(e.target.value, 10))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>T{m}/{YEAR}</option>
            ))}
          </select>
        </div>
        <div className="sr-tool-group">
          <span className="sr-tool-label">Ngày</span>
          <select className="sr-compact" value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)}>
            <option value="all">Tất cả</option>
            {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
              <option key={d} value={String(d)}>Ngày {d}</option>
            ))}
          </select>
        </div>
        <div className="sr-tool-group">
          <span className="sr-tool-label">Sắp xếp</span>
          <select className="sr-compact" value={sortType} onChange={(e) => applySorting(e.target.value)}>
            <option value="default">Mặc định</option>
            <option value="group">Mã nhóm</option>
            <option value="highest">Phí cao nhất</option>
            <option value="issued">Phát hành nhiều nhất</option>
          </select>
        </div>
        <div className="sr-tool-sep" />
        <div className="sr-tool-group">
          {TABS.map((t) => (
            <button key={t.id} className={`sr-btn sr-btn-tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="sr-tool-sep" />
        <div className="sr-tool-group">
          <button className="sr-btn sr-btn-export" onClick={exportExcel}>⬇ Excel</button>
          {isAdmin && <button className="sr-btn sr-btn-purple" onClick={addPerson}>＋ TVV</button>}
          {isAdmin && <button className="sr-btn sr-btn-green" onClick={flushSave}>💾 Lưu</button>}
        </div>
        <span className="sr-save-ind" style={{ color: saveInfo.color }}>{saveInfo.text}</span>
        <span className="sr-src" title="Firestore key đang đọc">key: {source || '…'}</span>
        <button className="sr-btn sr-btn-purple" onClick={openAuditLog}>🕘 Lịch sử</button>
        {!isAdmin && <span style={{ fontSize: 11, color: '#8896aa' }}>🔒 Chế độ xem — đăng nhập admin để chỉnh sửa</span>}
        <div className="sr-clock">{clock}</div>
      </div>

      {/* ── KPI BAR ── */}
      <div className="sr-kpis">
        <div className="kpi-card c1">
          <div className="kpi-label">Tổng TVV</div>
          <div className="kpi-value" style={{ color: '#4361ee' }}>{loading ? '—' : kpi.tvv}</div>
        </div>
        <div className="kpi-card c4">
          <div className="kpi-label">Tổng hồ sơ</div>
          <div className="kpi-value" style={{ color: '#7209b7' }}>{loading ? '—' : kpi.cases}</div>
        </div>
        <div className="kpi-card c3">
          <div className="kpi-label">Tổng phí</div>
          <div className="kpi-value" style={{ color: '#1d4ed8' }}>{loading ? '—' : fmtM(kpi.total)}</div>
        </div>
        <div className="kpi-card c6">
          <div className="kpi-label">Phát hành</div>
          <div className="kpi-value" style={{ color: '#15803d' }}>{loading ? '—' : fmtM(kpi.issued)}</div>
        </div>
        <div className="kpi-card c5">
          <div className="kpi-label">Pending</div>
          <div className="kpi-value" style={{ color: '#a16207' }}>{loading ? '—' : fmtM(kpi.pending)}</div>
        </div>
        <div className="kpi-card c7">
          <div className="kpi-label">Chưa phí</div>
          <div className="kpi-value" style={{ color: '#be123c' }}>{loading ? '—' : fmtM(kpi.noFee)}</div>
        </div>
      </div>

      {/* ── HINT ── */}
      <div className="sr-hint" style={{ marginTop: 10 }}>
        <span>💡</span>
        {isAdmin
          ? 'Click vào ô ngày để thêm hồ sơ · Hover hồ sơ để xóa · Chỉnh sửa trực tiếp trên ô'
          : 'Bảng báo cáo doanh số tháng — liên hệ admin để chỉnh sửa số liệu'}
      </div>

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <div style={{ fontSize: 13, color: '#8896aa' }}>Đang tải dữ liệu tháng {month}/{YEAR}...</div>
        </div>
      )}

      {!loading && !hasRemoteData && (
        <div className="sr-hint" style={{ background: 'linear-gradient(90deg,#fef3c7,#fef9c3)', borderColor: '#fcd34d', color: '#92400e' }}>
          <span>⚠️</span>
          Chưa có dữ liệu tháng T{month}/{YEAR} — đang hiển thị 1 dòng mẫu.&nbsp;
          {isAdmin ? 'Nhập số liệu rồi bấm Lưu để tạo báo cáo tháng.' : 'Vui lòng liên hệ admin.'}
        </div>
      )}

      {/* ══════════ REPORT TAB ══════════ */}
      {!loading && activeTab === 'report' && (
        <div className="sr-report">
          <div className="sr-table-wrap">
            <table key={rev}>
              <thead>
                <tr>
                  <th colSpan={4} className="sr-dayhead-first">PHÍ NGÀY</th>
                  {dayList.map((d) => (
                    <th key={d}>
                      <div style={{ color: '#8896aa', fontSize: 9 }}>N{d}</div>
                      <div style={{ color: '#4361ee', fontWeight: 800 }}>{dailyTotals[d] ? fmtM(dailyTotals[d]) : ''}</div>
                    </th>
                  ))}
                  <th colSpan={4} />
                </tr>
                <tr>
                  <th className="col-stt">#</th>
                  <th className="col-grp">Nhóm</th>
                  <th className="col-msdl">MSDL</th>
                  <th className="col-name" style={{ textAlign: 'left', paddingLeft: 8 }}>Họ tên</th>
                  {dayList.map((d) => {
                    const dow = dayOfWeek(month, d)
                    const cls = dow === 0 ? 'day-sun' : dow === 6 ? 'day-sat' : ''
                    return <th key={d} className={cls} style={{ minWidth: 68 }}>{d}</th>
                  })}
                  <th className="col-total">Tổng phí</th>
                  <th className="col-nofee">Chưa phí</th>
                  <th className="col-issued">Phát hành</th>
                  <th className="col-paid">Có phí chưa PH</th>
                </tr>
              </thead>
              <tbody>
                {reportData.map((p, pi) => {
                  const s = rowSummary(p)
                  return (
                    <tr key={pi}>
                      <td className="col-stt sr-c">{pi + 1}</td>
                      <td className="col-grp">
                        <div className="sr-cellflex">
                          {isAdmin && <button className="sr-mini-del" title="Xóa" onClick={() => deletePerson(pi)}>×</button>}
                          <input className="editable-input" defaultValue={p.group || ''}
                            key={`g${pi}-${rev}-${p.group}`}
                            readOnly={!isAdmin}
                            onBlur={(e) => updateField(pi, 'group', e.target.value)} />
                        </div>
                      </td>
                      <td className="col-msdl">
                        <input className="editable-input" defaultValue={p.msdl || ''}
                          key={`m${pi}-${rev}-${p.msdl}`}
                          readOnly={!isAdmin}
                          onBlur={(e) => updateField(pi, 'msdl', e.target.value)} />
                      </td>
                      <td className="col-name">
                        <div className="sr-cellflex">
                          <input className="editable-input sr-name" defaultValue={p.name || ''}
                            key={`n${pi}-${rev}-${p.name}`}
                            readOnly={!isAdmin}
                            onBlur={(e) => updateField(pi, 'name', e.target.value)} />
                          <a href={`/tvv-profile.html?code=${encodeURIComponent(p.msdl || '')}`}
                            target="_blank" rel="noreferrer" title="Mở Hồ sơ TVV đầy đủ" className="sr-link">🔗</a>
                        </div>
                      </td>
                      {dayList.map((d) => {
                        const cases = ((p.daily || {})[d] || {}).cases || []
                        return (
                          <td key={d} className="day-cell"
                            onClick={isAdmin ? () => openCaseModal(pi, d) : undefined}
                            style={isAdmin ? undefined : { cursor: 'default' }}>
                            {cases.map((item, ci) => (
                              <div key={ci} className={`case-card ${item.status || 'none'}`}
                                onClick={(e) => e.stopPropagation()}>
                                <div className={`case-note-mark ${item.note ? 'has-note' : ''}`}
                                  title={item.note || 'Bấm để thêm ghi chú'}
                                  onClick={(e) => { e.stopPropagation(); editCaseNote(pi, d, ci) }} />
                                <div className="case-card-top">
                                  <input type="number" className="case-fee-input"
                                    defaultValue={item.fee || ''}
                                    key={`f${pi}-${d}-${ci}-${rev}-${item.fee}`}
                                    placeholder="0" readOnly={!isAdmin}
                                    onClick={(e) => e.stopPropagation()}
                                    onBlur={(e) => updateCaseFee(pi, d, ci, e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }} />
                                  {isAdmin && (
                                    <button className="case-pill-del"
                                      onClick={(e) => { e.stopPropagation(); deleteCase(pi, d, ci) }}>×</button>
                                  )}
                                </div>
                                <div className="status-btns">
                                  {[['none', 'CF', 'Chưa phí'], ['paid', 'CP', 'Có phí (chưa PH)'], ['issued', 'PH', 'Phát hành']].map(([v, lbl, title]) => (
                                    <button key={v} type="button"
                                      className={`status-btn s-${v} ${item.status === v ? 'active' : ''}`}
                                      title={title} disabled={!isAdmin}
                                      onClick={(e) => { e.stopPropagation(); updateCaseStatus(pi, d, ci, v) }}>{lbl}</button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </td>
                        )
                      })}
                      <td className="col-total">{fmt(s.totalFee)}</td>
                      <td className="col-nofee">{fmt(s.noFee)}</td>
                      <td className="col-issued">{fmt(s.issued)}</td>
                      <td className="col-paid">{fmt(s.paidNI)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════ OVERVIEW TAB ══════════ */}
      {!loading && activeTab === 'overview' && (
        <div style={{ padding: '0 14px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="sr-btn sr-btn-export" onClick={exportOverviewExcel}>⬇ Xuất Excel (Overview)</button>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th style={{ textAlign: 'left', minWidth: 160 }}>TVV</th>
                  {dayList.map((d) => {
                    const dow = dayOfWeek(month, d)
                    const cls = dow === 0 ? 'ov-sun' : dow === 6 ? 'ov-sat' : ''
                    return <th key={d} className={cls} style={{ textAlign: 'center' }}>{d}</th>
                  })}
                  <th style={{ textAlign: 'center' }}>Tổng</th>
                  <th style={{ textAlign: 'center' }}>PH</th>
                  <th style={{ textAlign: 'center' }}>CPF</th>
                  <th style={{ textAlign: 'center' }}>CF</th>
                </tr>
              </thead>
              <tbody>
                {reportData.map((p, i) => {
                  let total = 0, issued = 0, paid = 0, noFee = 0
                  const cells = dayList.map((d) => {
                    const dd = (p.daily || {})[d] || { cases: [] }
                    let dayTot = 0, best = ''
                    ;(dd.cases || []).forEach((c) => {
                      const v = Number(c.fee || 0); dayTot += v; total += v
                      if (c.status === 'issued') { issued += v; best = 'issued' }
                      else if (c.status === 'paid') { paid += v; if (best !== 'issued') best = 'paid' }
                      else if (c.status === 'none') { noFee += v; if (!best) best = 'none' }
                    })
                    const color = best === 'issued' ? '#15803d' : best === 'paid' ? '#a16207' : best === 'none' ? '#be123c' : undefined
                    return { d, dayTot, color }
                  })
                  return (
                    <tr key={i}>
                      <td style={{ textAlign: 'center', color: '#8896aa', fontSize: 10.5 }}>{i + 1}</td>
                      <td>
                        <div style={{ fontSize: 9.5, color: '#8896aa' }}>{p.group} · {p.msdl}</div>
                        <div style={{ fontWeight: 700, fontSize: 11.5 }}>{p.name}</div>
                      </td>
                      {cells.map(({ d, dayTot, color }) => (
                        <td key={d} style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 600, color }}>
                          {dayTot ? dayTot.toLocaleString('vi-VN') : ''}
                        </td>
                      ))}
                      <td className="sr-ov-total">{fmt(total)}</td>
                      <td className="sr-ov-issued">{fmt(issued)}</td>
                      <td className="sr-ov-paid">{fmt(paid)}</td>
                      <td className="sr-ov-nofee">{fmt(noFee)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════ SUMMARY TAB ══════════ */}
      {!loading && activeTab === 'summary' && (
        <div style={{ padding: '0 14px 14px' }}>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'center' }}>STT</th>
                  <th style={{ textAlign: 'center' }}>Mã nhóm</th>
                  <th style={{ textAlign: 'center' }}>MSDL</th>
                  <th style={{ textAlign: 'left', minWidth: 160 }}>Họ tên</th>
                  <th style={{ textAlign: 'center' }}>Hồ sơ</th>
                  <th style={{ textAlign: 'center' }}>Tổng phí</th>
                  <th style={{ textAlign: 'center' }}>Phát hành</th>
                  <th style={{ textAlign: 'center' }}>Pending</th>
                  <th style={{ textAlign: 'center' }}>Chưa phí</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ textAlign: 'center', color: '#8896aa' }}>{i + 1}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ background: '#f0f4ff', color: '#4361ee', padding: '2px 7px', borderRadius: 5, fontSize: 10.5, fontWeight: 700 }}>{r.p.group}</span>
                    </td>
                    <td style={{ textAlign: 'center', color: '#8896aa', fontSize: 10.5 }}>{r.p.msdl}</td>
                    <td style={{ fontWeight: 600 }}>{r.p.name}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{r.cases}</td>
                    <td style={{ textAlign: 'center', color: '#1d4ed8', fontWeight: 700 }}>{fmt(r.fee)}</td>
                    <td style={{ textAlign: 'center', color: '#15803d', fontWeight: 700 }}>{fmt(r.issued)}</td>
                    <td style={{ textAlign: 'center', color: '#a16207', fontWeight: 700 }}>{fmt(r.pending)}</td>
                    <td style={{ textAlign: 'center', color: '#be123c', fontWeight: 700 }}>{fmt(r.noFee)}</td>
                  </tr>
                ))}
                <tr style={{ background: '#f0f4ff', fontWeight: 800 }}>
                  <td colSpan={4} style={{ textAlign: 'right', paddingRight: 12, color: '#4361ee' }}>TỔNG</td>
                  <td style={{ textAlign: 'center', color: '#7209b7' }}>{summary.totals.tC}</td>
                  <td style={{ textAlign: 'center', color: '#1d4ed8' }}>{fmt(summary.totals.tF)}</td>
                  <td style={{ textAlign: 'center', color: '#15803d' }}>{fmt(summary.totals.tI)}</td>
                  <td style={{ textAlign: 'center', color: '#a16207' }}>{fmt(summary.totals.tP)}</td>
                  <td style={{ textAlign: 'center', color: '#be123c' }}>{fmt(summary.totals.tN)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════ MODAL THÊM HỒ SƠ ══════════ */}
      {caseModal && (
        <div className="modal-overlay" onClick={() => setCaseModal(null)}>
          <div className="modal-box" style={{ maxWidth: 340 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">➕ Thêm hồ sơ</div>
              <button className="modal-close" onClick={() => setCaseModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12, color: '#8896aa', marginBottom: 10 }}>
                {reportData[caseModal.pi]?.name} — Ngày {caseModal.d}/T{month}
              </div>
              <input type="number" className="sr-form-input" placeholder="Phí đóng (VND)"
                value={mFee} onChange={(e) => setMFee(e.target.value)} />
              <select className="sr-form-input" value={mStatus} onChange={(e) => setMStatus(e.target.value)}>
                <option value="none">🔴 Chưa phí</option>
                <option value="paid">🟡 Có phí (chưa PH)</option>
                <option value="issued">🟢 Đã phát hành</option>
              </select>
              <textarea className="sr-form-input" placeholder="Ghi chú (tuỳ chọn, giống comment trong Excel)"
                value={mNote} onChange={(e) => setMNote(e.target.value)}
                style={{ minHeight: 56, resize: 'vertical', fontFamily: 'inherit' }} />
              <button className="sr-btn-primary" onClick={saveModalCase}>Lưu hồ sơ</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MODAL LỊCH SỬ AUDIT ══════════ */}
      {auditOpen && (
        <div className="modal-overlay" onClick={() => setAuditOpen(false)}>
          <div className="modal-box" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">🕘 Lịch sử thay đổi</div>
                <div style={{ fontSize: 11, color: '#8896aa' }}>20 thay đổi gần nhất của tháng đang xem</div>
              </div>
              <button className="modal-close" onClick={() => setAuditOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              {auditLoading && <div className="sr-empty">Đang tải...</div>}
              {!auditLoading && auditLogs === null && (
                <div className="sr-empty" style={{ color: '#dc2626' }}>
                  Lỗi tải lịch sử. Có thể cần tạo Firestore index cho audit_log (month, at).
                </div>
              )}
              {!auditLoading && Array.isArray(auditLogs) && auditLogs.length === 0 && (
                <div className="sr-empty">Chưa có thay đổi nào được ghi nhận cho tháng này</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(auditLogs || []).map((l) => {
                  const time = l.at?.toDate
                    ? l.at.toDate().toLocaleString('vi-VN')
                    : (l.at ? new Date(l.at).toLocaleString('vi-VN') : '—')
                  return (
                    <div key={l.id} className="sr-audit-item">
                      <span style={{ fontSize: 15, flexShrink: 0 }}>{AUDIT_ICON[l.action] || '•'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11.5, color: '#1a1f36', fontWeight: 500 }}>{l.detail || ''}</div>
                        <div style={{ fontSize: 10, color: '#8896aa', marginTop: 2 }}>{l.user || '—'} · {time}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
