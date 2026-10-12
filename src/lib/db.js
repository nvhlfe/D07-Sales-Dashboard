// ─────────────────────────────────────────────────────────────
// src/lib/db.js — DATA LAYER DÙNG CHUNG (single source of truth)
// ─────────────────────────────────────────────────────────────
// Mọi tab trong dashboard (React hiện tại + các tab migrate sau này)
// đều đọc/ghi dữ liệu qua các hooks trong file này.
// - Khởi tạo Firebase ĐÚNG 1 LẦN (singleton), auth tập trung.
// - Không còn cảnh mỗi trang tự init Firebase / tự fetch riêng lẻ.
//
// Lưu ý kiến trúc hiện tại:
// - Doc tổng quan Excel (Data_Compensation_GA_D07.xlsx) nằm ở Realtime
//   Database `ga_d07/dashboard` (dạng chunked JSON) — giữ nguyên để
//   không làm gián đoạn dữ liệu production đang chạy.
// - Dữ liệu vận hành ngày (sales report, daily sales, pending, manmark)
//   nằm ở Firestore — các hooks dưới đây đọc trực tiếp.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { initializeApp, getApps } from 'firebase/app'
import { getDatabase, ref, onValue, set } from 'firebase/database'
import {
  getFirestore, doc, collection, addDoc,
  onSnapshot, setDoc, getDoc,
} from 'firebase/firestore'
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'firebase/auth'

// ── Config ────────────────────────────────────────────────────
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyASY63DlWIkvjybM1enPIpdZkxXJjrStQA",
  authDomain: "d07-sales-dashboard.firebaseapp.com",
  databaseURL: "https://d07-sales-dashboard-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "d07-sales-dashboard",
  storageBucket: "d07-sales-dashboard.firebasestorage.app",
  messagingSenderId: "820808715064",
  appId: "1:820808715064:web:62865b8b03b18b6a670fcd",
}
export const ADMIN_EMAIL = 'admin@d07.com'

// ── Key helpers (chuẩn hóa, luôn có năm) ─────────────────────
export const yyyyMKey = (year, month) => `${year}-${month}`        // "2026-8"
export const legacyMonthKey = (month) => `${month}`               // "8" (key cũ, chỉ để fallback đọc)
export const dateKey = (d) => {                                   // "2026-08-15"
  const dt = d instanceof Date ? d : new Date(d)
  const p = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

// ── Singleton init ──────────────────────────────────────────
let _fb = null
let _initError = null

export function initFirebase(config = FIREBASE_CONFIG) {
  if (_fb) return _fb
  try {
    // Giữ đúng behavior cũ: tái sử dụng app đã init (nếu có)
    const app = getApps().length ? getApps()[0] : initializeApp(config)
    _fb = {
      app,
      rtdb: getDatabase(app),
      fs: getFirestore(app),
      auth: getAuth(app),
    }
  } catch (e) {
    _initError = e
    console.error('[db] Firebase init failed:', e)
  }
  return _fb
}

export function getFirebase() {
  const fb = initFirebase()
  if (!fb) throw new Error('Firebase chưa được khởi tạo' + (_initError ? ': ' + _initError.message : ''))
  return fb
}

// ── Chuẩn hóa field đại lý (agCode cũ → msdl mới), tập trung 1 chỗ ──
export function normalizeAgent(row = {}) {
  if (row.msdl == null && row.agCode != null) {
    return { ...row, msdl: row.agCode }
  }
  return row
}

// ═════════════════════════════════════════════════════════════
// DOC TỔNG QUAN (Realtime Database — output của parseExcel)
// ═════════════════════════════════════════════════════════════
const FB_PATH = 'ga_d07/dashboard'
const FB_CHUNK = 800_000

function chunkJSON(json) {
  const out = []
  for (let i = 0; i < json.length; i += FB_CHUNK) out.push(json.slice(i, i + FB_CHUNK))
  return out
}
function assembleSnapshot(snapshot) {
  const val = snapshot.val()
  if (!val?.chunks) return null
  try { return { data: JSON.parse(val.chunks.join('')), updatedAt: val.updatedAt } }
  catch { return null }
}

/** Realtime subscription doc tổng quan. */
export function useDashboardDoc() {
  const [state, setState] = useState({ data: null, updatedAt: null, status: 'connecting' })
  useEffect(() => {
    let unsub = null
    try {
      const { rtdb } = getFirebase()
      unsub = onValue(
        ref(rtdb, FB_PATH),
        (snapshot) => {
          const result = assembleSnapshot(snapshot)
          setState({
            data: result?.data ?? null,
            updatedAt: result?.updatedAt ?? null,
            status: 'connected',
          })
        },
        (err) => {
          console.error('[db] dashboard onValue:', err)
          setState((s) => ({ ...s, status: 'error' }))
        }
      )
    } catch (e) {
      console.error('[db] useDashboardDoc:', e)
      setState((s) => ({ ...s, status: 'error' }))
    }
    return () => { if (unsub) unsub() }
  }, [])
  return state
}

/** Publish kết quả parseExcel lên RTDB (giữ nguyên cơ chế chunked cũ). */
export async function publishDashboardData(parsed) {
  const { rtdb } = getFirebase()
  const updatedAt = new Date().toISOString()
  await set(ref(rtdb, FB_PATH), {
    chunks: chunkJSON(JSON.stringify(parsed)),
    total: 1,
    updatedAt,
  })
  return updatedAt
}

// ═════════════════════════════════════════════════════════════
// FIRESTORE — dữ liệu vận hành
// ═════════════════════════════════════════════════════════════

/**
 * Doc báo cáo tháng `reports/{yyyy-m}`.
 * FIX bug key lệch: sales-report cũ ghi `reports/{m}` ("8") trong khi
 * manmark đọc `reports/{yyyy-m}` ("2026-8") → đọc key mới trước,
 * fallback key cũ nếu chưa có. Ghi mới LUÔN dùng key có năm.
 * Trả về { data, source, loading } — source cho biết đang đọc key nào.
 */
export function useReportsDoc(year, month) {
  const [state, setState] = useState({ data: null, source: null, loading: true })
  useEffect(() => {
    if (!year || !month) { setState((s) => ({ ...s, loading: false })); return }
    let cancelled = false
    let unsubLegacy = null
    const newKey = yyyyMKey(year, month)
    const legacyKey = legacyMonthKey(month)
    let unsubNew = null
    try {
      const { fs } = getFirebase()
      unsubNew = onSnapshot(
        doc(fs, 'reports', newKey),
        (snap) => {
          if (cancelled) return
          if (snap.exists()) {
            if (unsubLegacy) { unsubLegacy(); unsubLegacy = null }
            setState({ data: snap.data(), source: newKey, loading: false })
          } else if (!unsubLegacy) {
            unsubLegacy = onSnapshot(
              doc(fs, 'reports', legacyKey),
              (lsnap) => {
                if (cancelled) return
                setState({
                  data: lsnap.exists() ? lsnap.data() : null,
                  source: lsnap.exists() ? legacyKey : null,
                  loading: false,
                })
              },
              () => { if (!cancelled) setState((s) => ({ ...s, loading: false })) }
            )
          }
        },
        () => { if (!cancelled) setState((s) => ({ ...s, loading: false })) }
      )
    } catch (e) {
      console.error('[db] useReportsDoc:', e)
      if (!cancelled) setState((s) => ({ ...s, loading: false }))
    }
    return () => {
      cancelled = true
      if (unsubNew) unsubNew()
      if (unsubLegacy) unsubLegacy()
    }
  }, [year, month])
  return state
}

/** Ghi báo cáo tháng — luôn dùng key có năm. */
export async function saveReportsDoc(year, month, payload, updatedBy) {
  const { fs } = getFirebase()
  const updatedAt = new Date().toISOString()
  await setDoc(doc(fs, 'reports', yyyyMKey(year, month)), {
    ...payload, updatedAt, updatedBy: updatedBy || null,
  })
  return updatedAt
}

/** Doc daily sales `daily_sales_tvv/{yyyy-mm-dd}`. */
export function useDailySalesDoc(ymd) {
  const [state, setState] = useState({ data: null, loading: true })
  useEffect(() => {
    if (!ymd) { setState((s) => ({ ...s, loading: false })); return }
    let unsub = null
    try {
      const { fs } = getFirebase()
      unsub = onSnapshot(
        doc(fs, 'daily_sales_tvv', ymd),
        (snap) => setState({ data: snap.exists() ? snap.data() : null, loading: false }),
        () => setState((s) => ({ ...s, loading: false }))
      )
    } catch (e) {
      console.error('[db] useDailySalesDoc:', e)
      setState((s) => ({ ...s, loading: false }))
    }
    return () => { if (unsub) unsub() }
  }, [ymd])
  return state
}

export async function saveDailySalesDoc(ymd, payload, updatedBy) {
  const { fs } = getFirebase()
  const updatedAt = new Date().toISOString()
  await setDoc(doc(fs, 'daily_sales_tvv', ymd), {
    ...payload, updatedAt, updatedBy: updatedBy || null,
  })
  return updatedAt
}

/** Annotations hồ sơ pending `pending_cases/main`. */
export function usePendingCases() {
  const [state, setState] = useState({ data: null, loading: true })
  useEffect(() => {
    let unsub = null
    try {
      const { fs } = getFirebase()
      unsub = onSnapshot(
        doc(fs, 'pending_cases', 'main'),
        (snap) => setState({ data: snap.exists() ? snap.data() : null, loading: false }),
        () => setState((s) => ({ ...s, loading: false }))
      )
    } catch (e) {
      console.error('[db] usePendingCases:', e)
      setState((s) => ({ ...s, loading: false }))
    }
    return () => { if (unsub) unsub() }
  }, [])
  return state
}

export async function savePendingCases(payload, updatedBy) {
  const { fs } = getFirebase()
  const updatedAt = new Date().toISOString()
  await setDoc(doc(fs, 'pending_cases', 'main'), {
    ...payload, updatedAt, updatedBy: updatedBy || null,
  })
  return updatedAt
}

/** Cam kết tuần ManMark `manmark/{yyyy-m}`. */
export function useManMark(year, month) {
  const [state, setState] = useState({ data: null, loading: true })
  useEffect(() => {
    if (!year || !month) { setState((s) => ({ ...s, loading: false })); return }
    let unsub = null
    try {
      const { fs } = getFirebase()
      unsub = onSnapshot(
        doc(fs, 'manmark', yyyyMKey(year, month)),
        (snap) => setState({ data: snap.exists() ? snap.data() : null, loading: false }),
        () => setState((s) => ({ ...s, loading: false }))
      )
    } catch (e) {
      console.error('[db] useManMark:', e)
      setState((s) => ({ ...s, loading: false }))
    }
    return () => { if (unsub) unsub() }
  }, [year, month])
  return state
}

export async function saveManMark(year, month, payload, updatedBy) {
  const { fs } = getFirebase()
  const updatedAt = new Date().toISOString()
  await setDoc(doc(fs, 'manmark', yyyyMKey(year, month)), {
    ...payload, updatedAt, updatedBy: updatedBy || null,
  })
  return updatedAt
}

/** Ghi audit log (dùng chung cho các thao tác ghi tay). */
export async function logAudit({ month, action, detail, user }) {
  const { fs } = getFirebase()
  await addDoc(collection(fs, 'audit_log'), {
    month: month || null,
    action: action || '',
    detail: detail || '',
    user: user || null,
    at: new Date().toISOString(),
  })
}

/** Đọc 1 lần doc Firestore (dùng cho nhu cầu không cần realtime). */
export async function getDocOnce(col, id) {
  const { fs } = getFirebase()
  const snap = await getDoc(doc(fs, col, id))
  return snap.exists() ? snap.data() : null
}

// ═════════════════════════════════════════════════════════════
// AUTH tập trung
// ═════════════════════════════════════════════════════════════
export function useAuth() {
  const [user, setUser] = useState(null)
  useEffect(() => {
    try {
      const { auth } = getFirebase()
      return onAuthStateChanged(auth, setUser)
    } catch (e) {
      console.error('[db] useAuth:', e)
      return undefined
    }
  }, [])
  const login = async (email, password) => {
    const { auth } = getFirebase()
    await signInWithEmailAndPassword(auth, email, password)
  }
  const logout = async () => {
    const { auth } = getFirebase()
    await signOut(auth)
  }
  return { user, isAdmin: !!user && user.email === ADMIN_EMAIL, login, logout }
}
