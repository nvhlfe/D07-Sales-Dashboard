// ─────────────────────────────────────────────────────────────────
// 🎯 SẮP CHẠM ĐÍCH + UNIT THEO ĐÍCH ĐẾN — logic thuần (test bằng node).
// Lan duyệt 23/11/2026 (bản đầy đủ): bảng Unit cũ trong tab TVV chỉ
// đếm % Active — mốc sàn 15tr IP, nhìn vào không push được ai. Bản
// này tổng hợp các ĐÍCH CAO HƠN từ chính dữ liệu AG-PE mà công ty đã
// tính sẵn "còn thiếu bao nhiêu" cho từng TVV:
//   - PE: hạng tạm tính (ketQuaTamTinh) cao hơn hạng hiện tại và
//     pe_fycCanThem > 0 → còn thiếu bấy nhiêu FYC để lên hạng.
//     (pe_thangCanThem > 0 thì ghi kèm: còn thiếu tháng hoạt động.)
//   - MDRT: lấy mốc GẦN NHẤT còn thiếu trong 3 mốc FYP cần thêm
//     (MDRT → COT → TOT); đã đạt thì tính vào "đã đạt MDRT".
//   - Thưởng quý: fycCanThem > 0 → còn thiếu bấy nhiêu FYC để tăng
//     mức thưởng; kèm quy_thuongTangThem (số tiền thưởng tăng thêm).
//   - Star Club: không có số "còn thiếu" trong file → chỉ đếm số vé
//     tạm đạt theo Unit (sc_soVe), không đưa vào danh sách cá nhân.
// Mọi số "còn thiếu" lấy THẲNG từ file AG-PE, không tự đặt ngưỡng.
// Đơn vị tiền: triệu đồng (đúng đơn vị các trường AG-PE).
// ─────────────────────────────────────────────────────────────────

const num = (v) => {
  if (v == null) return 0
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function peRank(val) {
  const v = String(val || '').toUpperCase()
  if (v.includes('KIM CƯƠNG')) return 3
  if (v.includes('BẠCH KIM')) return 2
  if (v.includes('VÀNG') || v.includes('VANG')) return 1
  return 0
}

const hasMdrtLabel = (v) => {
  const s = String(v || '').toUpperCase()
  return s.includes('MDRT') && !s.includes('NOT MDRT') || s.includes('COT') || s.includes('TOT')
}

/**
 * agList: mảng TVV từ AG-PE (các trường như trong parseExcel.js).
 * Trả {
 *   nearList: [{ msdl, name, unit, type: 'pe'|'mdrt'|'quy', dich,
 *                gap, gapUnit: 'FYC'|'FYP', extra }],
 *   counts: { pe, mdrt, quy, total },
 *   byUnit: [{ unit, peNear, peGapFyc, mdrtNear, mdrtDat, quyNear,
 *              quyThuongTang, starVe, nearTotal }],
 * }
 * nearList xếp theo gap tăng dần (ít tiền nhất lên đầu = dễ đẩy nhất).
 */
export function buildMilestones(agList) {
  const nearList = []
  const unitMap = new Map()
  const unitOf = (u) => {
    const key = u || '—'
    if (!unitMap.has(key)) {
      unitMap.set(key, {
        unit: key, peNear: 0, peGapFyc: 0, mdrtNear: 0, mdrtDat: 0,
        quyNear: 0, quyThuongTang: 0, starVe: 0, nearTotal: 0,
      })
    }
    return unitMap.get(key)
  }

  ;(agList || []).forEach((ag) => {
    const u = unitOf(ag.unit)
    const base = { msdl: String(ag.msddl || ''), name: ag.agentName || '', unit: ag.unit || '' }

    // 💎 PE — sắp lên hạng
    const peGap = num(ag.pe_fycCanThem)
    if (peGap > 0 && peRank(ag.ketQuaTamTinh) > peRank(ag.peHienTai)) {
      const thang = num(ag.pe_thangCanThem)
      nearList.push({
        ...base, type: 'pe', dich: `lên ${ag.ketQuaTamTinh}`,
        gap: peGap, gapUnit: 'FYC',
        extra: thang > 0 ? `còn thiếu ${thang} tháng HĐ` : '',
      })
      u.peNear += 1; u.peGapFyc += peGap; u.nearTotal += 1
    }

    // 🏆 MDRT — đã đạt thì đếm riêng VÀ vẫn xét mốc cao hơn (COT/TOT);
    // chưa đạt thì lấy mốc gần nhất còn thiếu trong MDRT → COT → TOT.
    const daDatMdrt = hasMdrtLabel(ag.mdrt) || hasMdrtLabel(ag.mdrt_daDat)
    if (daDatMdrt) u.mdrtDat += 1
    {
      const steps = [
        ['MDRT', num(ag.mdrt_fypCanMdrt)],
        ['COT', num(ag.mdrt_fypCanCot)],
        ['TOT', num(ag.mdrt_fypCanTot)],
      ]
      const step = steps.slice(daDatMdrt ? 1 : 0).find(([, gap]) => gap > 0)
      if (step) {
        nearList.push({
          ...base, type: 'mdrt', dich: `đạt ${step[0]}`,
          gap: step[1], gapUnit: 'FYP', extra: '',
        })
        u.mdrtNear += 1; u.nearTotal += 1
      }
    }

    // 💰 Thưởng quý — sắp tăng mức
    const quyGap = num(ag.fycCanThem)
    if (quyGap > 0) {
      const tang = num(ag.quy_thuongTangThem)
      nearList.push({
        ...base, type: 'quy', dich: 'tăng mức thưởng quý',
        gap: quyGap, gapUnit: 'FYC',
        extra: tang > 0 ? `+${tang}tr tiền thưởng` : '',
      })
      u.quyNear += 1; u.quyThuongTang += tang; u.nearTotal += 1
    }

    // ⭐ Star Club — chỉ đếm vé theo Unit
    u.starVe += num(ag.sc_soVe)
  })

  nearList.sort((a, b) => a.gap - b.gap)
  const byUnit = [...unitMap.values()]
    .filter((u) => u.nearTotal > 0 || u.mdrtDat > 0 || u.starVe > 0)
    .sort((a, b) => b.nearTotal - a.nearTotal || b.quyThuongTang - a.quyThuongTang)

  return {
    nearList,
    counts: {
      pe: nearList.filter((x) => x.type === 'pe').length,
      mdrt: nearList.filter((x) => x.type === 'mdrt').length,
      quy: nearList.filter((x) => x.type === 'quy').length,
      total: nearList.length,
    },
    byUnit,
  }
}
