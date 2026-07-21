import * as XLSX from 'xlsx'

function fmt(val) {
  if (val === null || val === undefined || val === '') return null
  const n = parseFloat(val)
  if (isNaN(n)) return null
  return Math.round(n * 10) / 10
}
// 2-decimal precision variant — used for FYC where 1dp rounding loses meaningful detail
function fmt2(val) {
  if (val === null || val === undefined || val === '') return null
  const n = parseFloat(val)
  if (isNaN(n)) return null
  return Math.round(n * 100) / 100
}
function fmtInt(val) {
  const n = parseFloat(val)
  if (isNaN(n)) return 0
  return Math.round(n)
}
function fmtDate(val) {
  if (!val) return null
  if (val instanceof Date) return val.toLocaleDateString('vi-VN')
  const s = String(val)
  if (s.includes('T')) return s.split('T')[0]
  return s
}

export async function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true })
        resolve(extractData(wb))
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

function extractData(wb) {
  const result = {}

  // ===== TẤT CẢ SHEET THÁNG X → Dashboard KPIs + monthly per-agent =====
  // Đọc tất cả sheet có tên "Tháng N" (1-12), lấy sheet mới nhất cho KPI
  const agentMonthly = {}

  // Helper: parse 1 sheet tháng, trả về { headers, allRows, d07rows, C, sheetMonth }
  function parseMonthSheet(wsName) {
    const ws = wb.Sheets[wsName]
    if (!ws) return null
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1 })
    // Detect header row by finding which row contains 'YearMonth'
    // Tháng 5: row 0 rỗng, header ở row 1, data từ row 2
    // Tháng 6+: header ở row 0, data từ row 1
    let headerRow, dataStart
    const headerRowIdx = raw.findIndex(row => Array.isArray(row) && row.includes('YearMonth'))
    if (headerRowIdx >= 0) {
      headerRow = raw[headerRowIdx] || []
      dataStart = headerRowIdx + 1
    } else {
      headerRow = raw[0] || []; dataStart = 1
    }
    const allRows = raw.slice(dataStart)
    const d07rows = allRows.filter(r => r[11] === 'D07')
    const col = (name) => headerRow.indexOf(name)
    const C = {
      AGCODE: col('AGCode'), AGNAME: col('AGName'), AGLEVEL: col('AGLevel'),
      BRANCH: col('BranchCode'), UNIT: col('UnitCode'),
      NET_MP: col('Net Manpower'), FYC: col('FYC'), FYP: col('FYP'),
      APE_NET: col('APE Net'), IP_NET: col('IP Net'), CASE_NET: col('Case Net'),
      FYC_YTD: col('FYC YTD'), IP_YTD: col('IP Net YTD'), APE_YTD: col('APE Net YTD'),
      FYP_YTD: col('FYP YTD'), SYC: col('SYC'), RYC: col('RYC'),
      ACT_FYC: col('Active Net (FYC)'), ACT_CASE: col('Active Net (Case)'),
      MDRT: col('MDRT Title'), TLDTPTT: col('TLDTPTT'),
      FYC_L12M: col('FYC L12M'), APE_SUB: col('APE Sub'),
      MONTH: col('YearMonth'),
    }
    // Detect sheet month number from name "Tháng N"
    const mNum = parseInt(wsName.replace(/[^0-9]/g, ''))
    return { C, d07rows, allRows, mNum }
  }

  // Collect all Tháng sheets sorted by month number
  const thangSheets = wb.SheetNames
    .filter(n => /^Tháng\s*\d+$/i.test(n))
    .sort((a, b) => {
      const ma = parseInt(a.replace(/[^0-9]/g, ''))
      const mb = parseInt(b.replace(/[^0-9]/g, ''))
      return ma - mb
    })

  // Latest sheet → KPIs & top agents
  const latestSheetName = thangSheets[thangSheets.length - 1]
  const latestSheet = latestSheetName ? parseMonthSheet(latestSheetName) : null

  if (latestSheet) {
    const { C, d07rows } = latestSheet
    const sum = (ci) => d07rows.reduce((acc, r) => acc + (parseFloat(r[ci]) || 0), 0)

    result.kpis = {
      netManpower: fmtInt(sum(C.NET_MP)),
      fycThang:    fmt(sum(C.FYC)),
      fypThang:    fmt(sum(C.FYP)),
      apeNet:      fmt(sum(C.APE_NET)),
      ipNet:       fmtInt(sum(C.IP_NET)),
      caseNet:     fmtInt(sum(C.CASE_NET)),
      fycYtd:      fmt(sum(C.FYC_YTD)),
      ipNetYtd:    fmt(sum(C.IP_YTD)),
      apeNetYtd:   fmt(sum(C.APE_YTD)),
      fypYtd:      fmt(sum(C.FYP_YTD)),
      syc:         fmt(sum(C.SYC)),
      ryc:         fmt(sum(C.RYC)),
      tongDaiLy:   d07rows.length,
      activeFyc:   fmtInt(sum(C.ACT_FYC)),
      activeCase:  fmtInt(sum(C.ACT_CASE)),
      mdrt:        d07rows.filter(r => r[C.MDRT] && r[C.MDRT] !== 'Not MDRT').length,
      dataMonth:   latestSheet.mNum,  // tháng mấy
    }

    const agentMap = {}
    d07rows.forEach(r => {
      const code = String(r[C.AGCODE] || '').trim()
      if (!code) return
      if (!agentMap[code]) agentMap[code] = {
        code, name: r[C.AGNAME], level: r[C.AGLEVEL], branch: r[C.BRANCH],
        fyc: 0, fyp: 0, ape: 0, ipNet: 0, caseNet: 0, syc: 0
      }
      agentMap[code].fyc    += parseFloat(r[C.FYC])    || 0
      agentMap[code].fyp    += parseFloat(r[C.FYP])    || 0
      agentMap[code].ipNet  += parseFloat(r[C.IP_NET]) || 0
      agentMap[code].ape    += parseFloat(r[C.APE_NET])|| 0
      agentMap[code].caseNet+= parseFloat(r[C.CASE_NET])|| 0
      agentMap[code].syc    += parseFloat(r[C.SYC])    || 0
    })
    result.topAgents = Object.values(agentMap)
      .sort((a, b) => b.fyp - a.fyp).slice(0, 20)
      .map(a => ({ ...a, fyc: fmt2(a.fyc), fyp: fmt(a.fyp), ape: fmt(a.ape),
                          ipNet: fmt(a.ipNet), caseNet: fmt(a.caseNet), syc: fmt(a.syc) }))

    result.levelDist = Object.entries(
      d07rows.reduce((acc, r) => {
        const lv = r[C.AGLEVEL] || 'Other'
        acc[lv] = (acc[lv] || 0) + 1
        return acc
      }, {})
    ).map(([name, value]) => ({ name, value }))

    result.officeData = [{
      vanPhong: 'GA710 - Quận 7',
      netMp: fmtInt(sum(C.NET_MP)), fyc: fmt(sum(C.FYC)),
      apeNet: fmt(sum(C.APE_NET)), caseNet: fmtInt(sum(C.CASE_NET))
    }]
  }

  // Build per-month KPI snapshots for all Tháng sheets
  const monthlyKpis = {}
  thangSheets.forEach(wsName => {
    const parsed = parseMonthSheet(wsName)
    if (!parsed) return
    const { C, d07rows, mNum } = parsed
    const sum2 = (ci) => d07rows.reduce((acc, r) => acc + (parseFloat(r[ci]) || 0), 0)

    // Build agent map for this month's top agents
    const agMap = {}
    d07rows.forEach(r => {
      const code = String(r[C.AGCODE] || '').trim()
      if (!code) return
      if (!agMap[code]) agMap[code] = {
        code, name: r[C.AGNAME], level: r[C.AGLEVEL], branch: r[C.BRANCH],
        fyc: 0, fyp: 0, ape: 0, ipNet: 0, caseNet: 0, syc: 0
      }
      agMap[code].fyc    += parseFloat(r[C.FYC])     || 0
      agMap[code].fyp    += parseFloat(r[C.FYP])     || 0
      agMap[code].ipNet  += parseFloat(r[C.IP_NET])  || 0
      agMap[code].ape    += parseFloat(r[C.APE_NET]) || 0
      agMap[code].caseNet+= parseFloat(r[C.CASE_NET])|| 0
      agMap[code].syc    += parseFloat(r[C.SYC])     || 0
    })

    monthlyKpis[mNum] = {
      dataMonth: mNum,
      netManpower: fmtInt(sum2(C.NET_MP)),
      fycThang:    fmt(sum2(C.FYC)),
      fypThang:    fmt(sum2(C.FYP)),
      apeNet:      fmt(sum2(C.APE_NET)),
      ipNet:       fmtInt(sum2(C.IP_NET)),
      caseNet:     fmtInt(sum2(C.CASE_NET)),
      fycYtd:      fmt(sum2(C.FYC_YTD)),
      ipNetYtd:    fmt(sum2(C.IP_YTD)),
      apeNetYtd:   fmt(sum2(C.APE_YTD)),
      fypYtd:      fmt(sum2(C.FYP_YTD)),
      syc:         fmt(sum2(C.SYC)),
      ryc:         fmt(sum2(C.RYC)),
      tongDaiLy:   d07rows.length,
      activeFyc:   fmtInt(sum2(C.ACT_FYC)),
      activeCase:  fmtInt(sum2(C.ACT_CASE)),
      mdrt:        d07rows.filter(r => r[C.MDRT] && r[C.MDRT] !== 'Not MDRT').length,
      topAgents:   Object.values(agMap)
        .sort((a, b) => b.fyp - a.fyp).slice(0, 20)
        .map(a => ({ ...a, fyc: fmt2(a.fyc), fyp: fmt(a.fyp), ape: fmt(a.ape),
                            ipNet: fmt(a.ipNet), caseNet: fmt(a.caseNet), syc: fmt(a.syc) })),
      officeData: [{
        vanPhong: 'GA710 - Quận 7',
        netMp: fmtInt(sum2(C.NET_MP)), fyc: fmt(sum2(C.FYC)),
        apeNet: fmt(sum2(C.APE_NET)), caseNet: fmtInt(sum2(C.CASE_NET))
      }],
    }
  })
  result.monthlyKpis = monthlyKpis
  result.availableMonths = Object.keys(monthlyKpis).map(Number).sort((a,b)=>a-b)

  // All Tháng sheets → per-agent monthly history
  const monthLabel = (ym) => {
    if (!ym) return null
    const m = parseInt(String(ym).slice(4))
    return isNaN(m) ? null : `T${m}`
  }

  thangSheets.forEach(wsName => {
    const parsed = parseMonthSheet(wsName)
    if (!parsed) return
    const { C, allRows } = parsed
    allRows.filter(r => r[11] === 'D07').forEach(r => {
      const code = String(r[C.AGCODE] || '').trim()
      if (!code) return
      const mLabel = monthLabel(r[C.MONTH])
      if (!mLabel) return
      if (!agentMonthly[code]) agentMonthly[code] = {}
      if (!agentMonthly[code][mLabel]) {
        agentMonthly[code][mLabel] = {
          month: mLabel, hd: 0, ip: 0, fyp: 0, fyc: 0, syc: 0,
          act: false, fycL12m: 0, hdYtd: 0, fycYtd: 0, fypYtd: 0, ipYtd: 0
        }
      }
      const m = agentMonthly[code][mLabel]
      m.hd   += parseFloat(r[C.IP_NET])  || 0
      m.ip   += parseFloat(r[C.APE_SUB]) || 0
      m.fyp  += parseFloat(r[C.FYP])     || 0
      m.fyc  += parseFloat(r[C.FYC])     || 0
      m.syc  += parseFloat(r[C.SYC])     || 0
      if (parseFloat(r[C.ACT_FYC]) > 0) m.act = true
      m.fycL12m = parseFloat(r[C.FYC_L12M]) || m.fycL12m
      m.hdYtd   = parseFloat(r[C.IP_YTD])   || m.hdYtd
      m.fycYtd  = parseFloat(r[C.FYC_YTD])  || m.fycYtd
      m.fypYtd  = parseFloat(r[C.FYP_YTD])  || m.fypYtd
      m.ipYtd   = parseFloat(r[C.APE_YTD])  || m.ipYtd
    })
  })

  // ===== GA data → GA tab =====
  if (wb.SheetNames.includes('GA data')) {
    const ws = wb.Sheets['GA data']
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1 })
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

    // Row mapping (0-indexed):
    // Row 3:  PLANNING FYP  (col 4-15 = Jan-Dec, col 16 = TOTAL)
    // Row 4:  FYP achieved
    // Row 5:  REC
    // Row 6:  ACT
    // Row 7:  ACT RATIO
    // Row 8:  CASE/ACT
    // Row 9:  APE/ACT
    // Row 10: CASE SIZE
    // Row 11: PC
    // Row 12: PE
    // Row 13: MP
    // Row 14: TLDTPTT

    const getRow = (ri) => raw[ri] || []
    const mData = (ri) => months.map((m, i) => {
      const val = (getRow(ri))[4 + i]
      return { month: m, value: fmt(val) }
    })

    // ACT RATIO: raw 0-1 → *100 for %
    const actRatioRaw = months.map((m, i) => {
      const v = parseFloat((getRow(7))[4 + i])
      return { month: m, value: isNaN(v) ? null : Math.round(v * 1000) / 10 }
    })
    // TLDTPTT: raw already % (83.8)
    const tldtRaw = months.map((m, i) => {
      const v = parseFloat((getRow(14))[4 + i])
      return { month: m, value: isNaN(v) ? null : Math.round(v * 10) / 10 }
    })

    result.gaData = {
      // Planning
      planFyp:   mData(3),
      // Achieved rows
      fyp2026:   months.map((m, i) => ({
        month: m,
        achieved: fmt((getRow(4))[4+i]),
        plan:     fmt((getRow(3))[4+i]),
      })),
      rec:       mData(5),
      act2026:   mData(6),
      actRatio:  actRatioRaw,
      caseAct:   mData(8),
      apeAct:    mData(9),
      caseSize:  mData(10),
      pc:        mData(11),
      pe:        mData(12),
      mp2026:    mData(13),
      tldtptt:   tldtRaw,
      // Totals
      totalFypPlan:    fmt((getRow(3))[16]),
      totalFypYtd:     fmt((getRow(4))[16]),
      totalRec:        fmt((getRow(5))[16]),
      totalAct:        fmt((getRow(6))[16]),
      totalActRatio:   fmt((getRow(7))[16]),
      totalCaseAct:    fmt((getRow(8))[16]),
      totalApeAct:     fmt((getRow(9))[16]),
      totalCaseSize:   fmt((getRow(10))[16]),
      totalPc:         fmt((getRow(11))[16]),
      totalPe:         fmt((getRow(12))[16]),
      totalMp:         fmt((getRow(13))[16]),
      totalTldtptt:    fmt((getRow(14))[16]),
    }

    // ===== Operational YoY: pre-calculated 2025/2026 table (cols 18-21, rows 2-9) =====
    // Manpower, # ACT, ACT Ratio, Case/ACT, Case Size, APE/Month, APE/Year
    const yoyLabelRow = (ri) => String((getRow(ri))[18] || '').trim()
    const opsYoY = {}
    for (let ri = 3; ri <= 9; ri++) {
      const label = yoyLabelRow(ri)
      if (!label) continue
      const v2025 = parseFloat((getRow(ri))[19])
      const v2026 = parseFloat((getRow(ri))[20])
      const growth = parseFloat((getRow(ri))[21])
      opsYoY[label] = {
        v2025: isNaN(v2025) ? null : v2025,
        v2026: isNaN(v2026) ? null : v2026,
        growthPct: isNaN(growth) ? null : Math.round((growth - 1) * 1000) / 10, // 1.116 → +11.6%
      }
    }
    result.gaData.opsYoY = {
      manpower: opsYoY['MANPOWER'],
      actCount: opsYoY['# ACT'],
      actRatio: opsYoY['ACT RATIO'],
      caseAct:  opsYoY['CASE/ACT'],
      caseSize: opsYoY['CASE SIZE'],
      apeMonth: opsYoY['APE/Month'],
      apeYear:  opsYoY['APE/Year'],
    }

    // ===== YoY FYP comparison: 2024 (row19) / 2025 (row20) / 2026 (row23) =====
    // Row 23 (2026) only has a value for months that have actually run —
    // we detect "real" months by checking against availableMonths-style logic:
    // a month is valid if it's a positive number AND not absurdly large
    // (catches the same kind of stray-cell bug seen in ACT RATIO col 9).
    const fypByYearRow = { 2024: 19, 2025: 20, 2026: 23 }
    const fypByYear = {}
    Object.entries(fypByYearRow).forEach(([year, ri]) => {
      const row = getRow(parseInt(ri))
      fypByYear[year] = months.map((m, i) => {
        const v = parseFloat(row[4 + i])
        if (isNaN(v) || v < 0 || v > 5000) return null
        return Math.round(v * 10) / 10
      })
    })

    // Outlier guard for the running year (2026): a month's FYP that is
    // wildly smaller than the median of other valid months in the same
    // year is almost certainly a misplaced cell (seen before with ACT
    // RATIO bleeding into an adjacent column). We don't hard-delete it —
    // we just exclude it from YTD/quarter math so 1 bad cell can't skew
    // a growth-rate the manager will act on.
    function median(arr) {
      const s = [...arr].sort((a,b) => a-b)
      const mid = Math.floor(s.length / 2)
      return s.length % 2 ? s[mid] : (s[mid-1] + s[mid]) / 2
    }
    {
      const valid2026 = fypByYear['2026'].filter(v => v != null)
      if (valid2026.length >= 3) {
        const med = median(valid2026)
        fypByYear['2026'] = fypByYear['2026'].map(v => {
          if (v == null) return null
          // Flag as outlier if value is <15% of the median of its peers
          // (a real low month would rarely be this extreme relative to others)
          if (med > 0 && v < med * 0.15) return null
          return v
        })
      }
    }

    // Quarter aggregation helper
    const QUARTERS = { Q1: [0,1,2], Q2: [3,4,5], Q3: [6,7,8], Q4: [9,10,11] }
    function sumQuarter(monthArr, qIdxs) {
      const vals = qIdxs.map(i => monthArr[i]).filter(v => v != null)
      if (vals.length === 0) return null
      return Math.round(vals.reduce((a,b) => a+b, 0) * 10) / 10
    }

    const fypQuarters = {}
    Object.entries(QUARTERS).forEach(([q, idxs]) => {
      fypQuarters[q] = {
        2024: sumQuarter(fypByYear['2024'], idxs),
        2025: sumQuarter(fypByYear['2025'], idxs),
        2026: sumQuarter(fypByYear['2026'], idxs),
      }
    })

    // YTD comparison: sum only months that have run in 2026 (non-null),
    // then compare same month-range in 2025/2024 for an apples-to-apples view
    const monthsRunIdx = fypByYear['2026']
      .map((v, i) => v != null ? i : null)
      .filter(i => i !== null)
    function sumYtd(monthArr, idxs) {
      const vals = idxs.map(i => monthArr[i]).filter(v => v != null)
      if (vals.length === 0) return null
      return Math.round(vals.reduce((a,b)=>a+b,0) * 10) / 10
    }
    const fypYtdByYear = {
      2024: sumYtd(fypByYear['2024'], monthsRunIdx),
      2025: sumYtd(fypByYear['2025'], monthsRunIdx),
      2026: sumYtd(fypByYear['2026'], monthsRunIdx),
    }

    function growthPct(cur, prev) {
      if (cur == null || prev == null || prev === 0) return null
      return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10
    }

    result.gaData.fypYoY = {
      byMonth: months.map((m, i) => ({
        month: m,
        y2024: fypByYear['2024'][i],
        y2025: fypByYear['2025'][i],
        y2026: fypByYear['2026'][i],
        growthYoY: growthPct(fypByYear['2026'][i], fypByYear['2025'][i]),
      })),
      byQuarter: Object.entries(fypQuarters).map(([q, v]) => ({
        quarter: q,
        y2024: v['2024'], y2025: v['2025'], y2026: v['2026'],
        growthYoY: growthPct(v['2026'], v['2025']),
      })),
      ytd: {
        ...fypYtdByYear,
        monthsCovered: monthsRunIdx.map(i => months[i]),
        growthYoY: growthPct(fypYtdByYear[2026], fypYtdByYear[2025]),
        growthVs2024: growthPct(fypYtdByYear[2026], fypYtdByYear[2024]),
      },
    }

    // APE YTD: sheet only has APE/Year totals for 2025 (no monthly breakdown),
    // so 2025 YTD is estimated by prorating the annual figure across the same
    // number of months covered by 2026's actual data.
    //
    // IMPORTANT: "months covered" must come from the same source as the 2026
    // APE figure itself (the Tháng N sheets via result.kpis.dataMonth), NOT
    // from monthsRunIdx (which counts non-null FYP months in the GA data
    // sheet). Those two can drift — e.g. GA data's FYP row only filled to T5
    // while Tháng N sheets already have T6 — which silently mis-prorates the
    // 2025 estimate and produces a wrong growth %.
    const apeYear2025 = result.gaData.opsYoY?.apeYear?.v2025 ?? null
    const apeMonthsCovered = result.kpis?.dataMonth || monthsRunIdx.length || 1
    const apeYtd2025Estimate = apeYear2025 != null
      ? Math.round(apeYear2025 / 12 * apeMonthsCovered * 100) / 100
      : null
    const apeYtd2026 = result.kpis?.apeNetYtd ?? null
    result.gaData.apeYoY = {
      ytd2025Estimate: apeYtd2025Estimate,
      ytd2026: apeYtd2026,
      monthsCovered: Array.from({ length: apeMonthsCovered }, (_, i) => months[i]),
      growthYoY: growthPct(apeYtd2026, apeYtd2025Estimate),
      isEstimate: true,
    }
  }

  // ===== UM-OFF sheet =====
  if (wb.SheetNames.includes('UM-OFF')) {
    const ws = wb.Sheets['UM-OFF']
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1 })

    // Validate structure: header row 2 should contain expected key labels
    // at their expected positions. If not, warn (data may be misaligned).
    const expectedHeaders = {
      9: 'PC', 10: 'FYC', 14: 'TLDTPTT', 22: 'TVV', 28: 'ACT',
    }
    const headerRow = (raw[2] || []).map(h => String(h || '').toUpperCase())
    const warnings = []
    Object.entries(expectedHeaders).forEach(([colIdx, keyword]) => {
      const cell = headerRow[colIdx] || ''
      if (!cell.includes(keyword)) {
        warnings.push(`UM-OFF cột ${colIdx}: kỳ vọng chứa "${keyword}" nhưng thấy "${cell || '(rỗng)'}"`)
      }
    })
    if (warnings.length > 0) {
      result._warnings = result._warnings || []
      result._warnings.push(...warnings)
    }

    const rows = raw.slice(3).filter(r => r[0] !== null && r[0] !== undefined && r[0] !== '' && !isNaN(parseFloat(r[0])))
    result.umList = rows.map(r => ({
      stt: fmtInt(r[0]), off: r[1], bm: r[2], unit: r[3],
      leaderCode: String(r[4] || '').trim(),
      leaderName: r[5], agType: r[6], appDate: fmtDate(r[7]),
      phone: String(r[8] || ''),
      pcHienTai: r[9], fycPhongTT: fmt(r[10]),
      tvvmcl: fmt(r[11]), tvvmclGen1_50pct: fmt(r[12]),
      tongTvvmclGen1: fmt(r[13]), tldtptt: r[14] != null && !isNaN(parseFloat(r[14])) ? Math.round(parseFloat(r[14]) * 1000) / 10 : null,
      pcTamDat: r[15], pcDuKien: r[16],
      fycCanThem: fmt(r[18]), tvvMoiCl: fmt(r[19]),
      tongFyc: fmt(r[21]), tongTvvAct: fmt(r[22]),
      tldtpttQuy: r[23] != null ? Math.round(parseFloat(r[23]) * 1000) / 10 : null, // raw 0-1 → %
      mucHoTro: r[24] != null ? Math.round(parseFloat(r[24]) * 1000) / 10 : null, // 0.12→12%
      mucChiTra: r[25] != null ? Math.round(parseFloat(r[25]) * 1000) / 10 : null, // 0.8→80%
      tienThuong: fmt(r[26]), fycTangMucThuong: fmt(r[27]),
      luotActCanThem: fmt(r[28]), thuongTangThem: fmt(r[30]),
      // UM MOC columns
      moc_fyc6thang: fmt(r[32]), moc_luotTvvAct: fmt(r[33]),
      moc_tvvMoiCl: fmt(r[34]), moc_tongLuot: fmt(r[35]),
      moc_tldtptt: r[36] != null ? Math.round(parseFloat(r[36]) * 1000) / 10 : null,
      moc_tamDat: r[37],
      moc_fycCanThem: fmt(r[38]), moc_luotCanThem: fmt(r[39]),
      moc_tldtCanThem: r[40],
      // Star Club nhóm
      luotTvvHdTb: fmt(r[42]), tongIp: r[43],
      tamThoaDK: r[44], veThamDu: r[45],
    }))
  }

  // ===== AG-PE sheet → TVV list =====
  // Column mapping (row 4 = header, data starts row 5)
  const COL = {
    NO: 0, OFFICE: 1, BAN: 2, UNIT: 3, MSDL: 4, AGNAME: 5,
    APPDATE: 7, PHONE: 8, MDRT2026: 9,
    // A. PRU ELITE
    PE_HIENTAI: 10,       // PE HIỆN TẠI
    FYC_12M: 11,          // FYC trong 12 tháng vừa qua
    ACT1: 12,             // Hoạt động tháng thứ 1
    ACT2: 13,             // Hoạt động tháng thứ 2
    ACT3: 14,             // Hoạt động tháng thứ 3
    TONGHD3M: 15,         // Tổng số HĐ 3 tháng vừa qua
    TLDTPTT: 16,          // TLDTPTT
    KQ_TAMTINH: 17,       // Kết quả tạm tính
    PE_DUKIEN: 18,        // PE dự kiến
    NANG_TLDTPTT: 19,     // Nâng TLDTPTT (cần khôi phục)
    PE_FYC_CANTHEM: 20,   // FYC cần thêm (PE)
    PE_THANG_CANTHEM: 21, // Số tháng Act/Quý cần thêm
    // B. THƯỞNG QUÝ CÁ NHÂN
    FYC_QUY: 23,          // FYC trong quý
    SYC_QUY: 24,          // SYC trong quý
    TLDTPTT_QUY: 25,      // TLDTPTT (thưởng quý)
    MUC_HO_TRO: 26,       // Mức hỗ trợ
    MUC_CHI_TRA: 27,      // Mức chi trả
    THUONG_TAMTINH: 28,   // Thưởng tạm tính
    FYC_TANG_MUC: 29,     // FYC cần để tăng mức thưởng
    THUONG_TANGTHER: 30,  // Thưởng dự kiến tăng thêm
    // C. MDRT 2027
    FYP_2026: 32,         // FYP 2026 (lũy kế)
    FYP_CAN_MDRT: 33,     // FYP cần MDRT
    FYP_CAN_COT: 34,      // FYP cần COT
    FYP_CAN_TOT: 35,      // FYP cần TOT
    MDRT_OT_Q3: 36,       // MDRT OT Quý 3
    MDRT_OT_Q2: 37,       // MDRT OT Quý 2
    MDRT_OT_Q1: 38,       // MDRT OT Quý 1
    MDRT_DA_DAT: 39,      // Đã đạt
    // UM Promotion (skip 41-44)
    // D. STAR CLUB
    SC_SLHD: 45,          // SLHĐ còn hiệu lực
    SC_TLDTPTT: 46,       // TLDTPTT (Star Club promotion)
    SC_TAMDAT: 47,        // Tạm Đạt (promotion)
    SC_HS: 49,            // HS nộp và phát hành
    SC_TLDTPTT2: 50,      // TLDTPTT (Star Club chính)
    SC_TLDTHD: 51,        // TLDTHD
    SC_TONG_IP: 52,       // Tổng IP
    SC_TAM_THOA: 53,      // Tạm thỏa điều kiện đạt vé
    SC_SO_VE: 54,         // Số Vé Tạm Đạt
    SC_VE: 55,            // Vé Tham Dự Tạm Đạt
    // MDRT 2027 summary
    MDRT2027_LEVEL: 59,   // MDRT 2027 level (MDRT/COT/TOT)
    MDRT2027_FYP_CHI_TIEU: 61,  // CHỈ TIÊU FYP
    MDRT2027_FYC_CHI_TIEU: 62,  // CHỈ TIÊU FYC
    MDRT2027_INCOME_CHI_TIEU: 63, // CHỈ TIÊU INCOME
  }

  if (wb.SheetNames.includes('AG-PE')) {
    const ws = wb.Sheets['AG-PE']
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1 })

    // Validate structure: header row 4 should contain expected keywords
    const headerRow4 = (raw[4] || []).map(h => String(h || '').toUpperCase())
    const expectedAgPe = { 10: 'PE', 16: 'TLDTPTT', 23: 'FYC', 45: 'SLHĐ' }
    const agPeWarnings = []
    Object.entries(expectedAgPe).forEach(([colIdx, keyword]) => {
      const cell = headerRow4[colIdx] || ''
      if (!cell.includes(keyword)) {
        agPeWarnings.push(`AG-PE cột ${colIdx}: kỳ vọng chứa "${keyword}" nhưng thấy "${cell || '(rỗng)'}"`)
      }
    })
    if (agPeWarnings.length > 0) {
      result._warnings = result._warnings || []
      result._warnings.push(...agPeWarnings)
    }

    // data rows start at row index 5 (0-based)
    const rows = raw.slice(5).filter(r => r[COL.NO] !== null && r[COL.NO] !== undefined && !isNaN(parseFloat(r[COL.NO])))

    result.agList = rows.map(r => {
      const code = String(r[COL.MSDL] || '').trim()
      // Get monthly data from Tháng 5
      const monthly = agentMonthly[code]
        ? Object.values(agentMonthly[code]).sort((a, b) => {
            const mA = parseInt(a.month.replace('T',''))
            const mB = parseInt(b.month.replace('T',''))
            return mA - mB
          }).map(m => ({
            ...m,
            hd: fmt(m.hd), ip: fmt(m.ip), fyp: fmt(m.fyp), fyc: fmt(m.fyc), syc: fmt(m.syc),
            fycL12m: fmt(m.fycL12m), hdYtd: fmt(m.hdYtd), fycYtd: fmt(m.fycYtd),
            fypYtd: fmt(m.fypYtd), ipYtd: fmt(m.ipYtd)
          }))
        : []

      return {
        no: fmtInt(r[COL.NO]),
        office: r[COL.OFFICE], ban: r[COL.BAN], unit: r[COL.UNIT],
        msddl: code,
        agentName: r[COL.AGNAME],
        appDate: fmtDate(r[COL.APPDATE]),
        phone: String(r[COL.PHONE] || '—'),
        mdrt: r[COL.MDRT2026],

        // A. PRU ELITE
        peHienTai: r[COL.PE_HIENTAI],
        fyc12m: fmt(r[COL.FYC_12M]),
        act1: r[COL.ACT1], act2: r[COL.ACT2], act3: r[COL.ACT3],
        tongHd3m: fmt(r[COL.TONGHD3M]),
        tldtptt: r[COL.TLDTPTT] != null ? Math.round(parseFloat(r[COL.TLDTPTT]) * 1000) / 10 : null,
        ketQuaTamTinh: r[COL.KQ_TAMTINH],
        peDuKien: r[COL.PE_DUKIEN],
        pe_nangTldtptt: r[COL.NANG_TLDTPTT],
        pe_fycCanThem: fmt(r[COL.PE_FYC_CANTHEM]),
        pe_thangCanThem: fmt(r[COL.PE_THANG_CANTHEM]),

        // B. THƯỞNG QUÝ
        fyc: fmt(r[COL.FYC_QUY]),
        syc: fmt(r[COL.SYC_QUY]),
        quy_tldtptt: r[COL.TLDTPTT_QUY] != null ? Math.round(parseFloat(r[COL.TLDTPTT_QUY]) * 1000) / 10 : null,
        mucHoTro: r[COL.MUC_HO_TRO] != null ? Math.round(parseFloat(r[COL.MUC_HO_TRO]) * 1000) / 10 : null, // 0.12→12%
        mucChiTra: r[COL.MUC_CHI_TRA] != null ? Math.round(parseFloat(r[COL.MUC_CHI_TRA]) * 1000) / 10 : null, // 0.8→80%
        thuongTamTinh: fmt(r[COL.THUONG_TAMTINH]),
        fycCanThem: fmt(r[COL.FYC_TANG_MUC]),
        quy_thuongTangThem: fmt(r[COL.THUONG_TANGTHER]),

        // C. MDRT 2027
        fypYtd: fmt(r[COL.FYP_2026]),
        mdrt_fypCanMdrt: fmt(r[COL.FYP_CAN_MDRT]),
        mdrt_fypCanCot: fmt(r[COL.FYP_CAN_COT]),
        mdrt_fypCanTot: fmt(r[COL.FYP_CAN_TOT]),
        mdrt_otQ3: r[COL.MDRT_OT_Q3],
        mdrt_otQ2: r[COL.MDRT_OT_Q2],
        mdrt_otQ1: r[COL.MDRT_OT_Q1],
        mdrt_daDat: r[COL.MDRT_DA_DAT],
        mdrt2027_level: r[COL.MDRT2027_LEVEL],
        mdrt2027_fypChiTieu: r[COL.MDRT2027_FYP_CHI_TIEU],
        mdrt2027_fycChiTieu: r[COL.MDRT2027_FYC_CHI_TIEU],
        mdrt2027_incomeChiTieu: r[COL.MDRT2027_INCOME_CHI_TIEU],

        // D. STAR CLUB
        sc_slhd: fmt(r[COL.SC_SLHD]),
        sc_tldtpttPromo: r[COL.SC_TLDTPTT] != null && !isNaN(parseFloat(r[COL.SC_TLDTPTT])) ? Math.round(parseFloat(r[COL.SC_TLDTPTT]) * 1000) / 10 : null,
        sc_tamDatPromo: r[COL.SC_TAMDAT],
        sc_hs: fmt(r[COL.SC_HS]),
        sc_tldtptt: r[COL.SC_TLDTPTT2] != null && !isNaN(parseFloat(r[COL.SC_TLDTPTT2])) ? Math.round(parseFloat(r[COL.SC_TLDTPTT2]) * 1000) / 10 : null,
        sc_tldthd: r[COL.SC_TLDTHD] != null && !isNaN(parseFloat(r[COL.SC_TLDTHD])) ? Math.round(parseFloat(r[COL.SC_TLDTHD]) * 1000) / 10 : null,
        sc_tongIp: r[COL.SC_TONG_IP],
        sc_tamThoa: r[COL.SC_TAM_THOA],
        sc_soVe: fmt(r[COL.SC_SO_VE]),
        sc_ve: r[COL.SC_VE],

        // Monthly KQ from Tháng 5
        monthly,
      }
    })
  }

  return result
}

export function formatNum(val) {
  if (val === null || val === undefined) return '-'
  const n = parseFloat(val)
  if (isNaN(n)) return '-'
  const rounded = Math.round(n * 10) / 10
  return rounded === Math.round(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)
}

// 2-decimal display variant — used for FYC, where 1dp rounding hides
// meaningful precision (e.g. distinguishing 4.96 from 5.00 near a threshold)
export function formatNum2(val) {
  if (val === null || val === undefined) return '-'
  const n = parseFloat(val)
  if (isNaN(n)) return '-'
  const rounded = Math.round(n * 100) / 100
  return rounded === Math.round(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)
}

export function formatBig(val) {
  if (val === null || val === undefined) return '-'
  const n = parseFloat(val)
  if (isNaN(n)) return '-'
  if (Math.abs(n) >= 1000) return (Math.round(n / 10) / 100).toFixed(1) + 'T'
  return formatNum(n)
}
