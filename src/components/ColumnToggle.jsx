import React, { useState } from 'react'

/**
 * Nút "Cột hiển thị" dùng chung cho các bảng data (UM, TVV):
 * mở panel checkbox để bật/tắt từng cột. `columns` = [{key, label}],
 * `visible` = mảng key đang hiện, `onChange(nextVisibleArray)`.
 */
export default function ColumnToggle({ columns, visible, onChange }) {
  const [open, setOpen] = useState(false)
  const total = columns.length
  const shown = columns.filter((c) => visible.includes(c.key)).length

  const toggle = (key) => {
    onChange(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key])
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        className="btn btn-gray"
        onClick={() => setOpen((o) => !o)}
        title="Bật/tắt các cột dữ liệu của bảng"
        style={{ border: '1.5px solid #e8ecf4', background: open ? '#eef2ff' : '#f1f3f9' }}
      >
        🧩 Cột hiển thị: {shown}/{total} {open ? '▴' : '▾'}
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' }}
          />
          <div
            style={{
              position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 41,
              background: 'white', border: '1px solid #e8ecf4', borderRadius: 12,
              boxShadow: '0 12px 32px rgba(26,31,94,0.18)', padding: 10,
              minWidth: 220, maxHeight: 320, overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, padding: '0 2px' }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#1a1f36' }}>Chọn cột hiển thị</span>
              <button
                type="button"
                onClick={() => onChange(columns.map((c) => c.key))}
                style={{ border: 'none', background: 'none', color: '#4361ee', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}
              >
                Hiện tất cả
              </button>
            </div>
            {columns.map((c) => (
              <label
                key={c.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px',
                  borderRadius: 7, cursor: 'pointer', fontSize: 12.5, color: '#1a1f36',
                  background: visible.includes(c.key) ? '#f5f7ff' : 'white',
                }}
              >
                <input
                  type="checkbox"
                  checked={visible.includes(c.key)}
                  onChange={() => toggle(c.key)}
                  style={{ accentColor: '#4361ee', width: 15, height: 15, cursor: 'pointer' }}
                />
                {c.label}
              </label>
            ))}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setOpen(false)}
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
            >
              Xong
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Hook quản lý cột đang hiện cho 1 bảng: mặc định hiện tất cả,
 * ghi nhớ lựa chọn trong localStorage theo `storageKey`.
 * Trả về [visibleKeys, setVisibleKeys, show(key)].
 */
export function useVisibleColumns(storageKey, columns) {
  const allKeys = columns.map((c) => c.key)
  const [visible, setVisible] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
      if (Array.isArray(saved)) {
        const valid = allKeys.filter((k) => saved.includes(k))
        if (valid.length) return valid
      }
    } catch { /* localStorage không khả dụng → mặc định tất cả */ }
    return allKeys
  })
  const update = (next) => {
    setVisible(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* bỏ qua */ }
  }
  const show = (key) => visible.includes(key)
  return [visible, update, show]
}
