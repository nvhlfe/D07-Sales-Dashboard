import React, { useRef, useState } from 'react'

export default function SalesReportTab() {
  const iframeRef = useRef()
  const [loaded, setLoaded] = useState(false)

  return (
    <div style={{ 
      margin: 0, 
      padding: 0,
      height: 'calc(100vh - 57px)',  // full height minus topbar
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Loading overlay */}
      {!loaded && (
        <div style={{
          position: 'absolute', top: 57, left: 220, right: 0, bottom: 0,
          background: '#f0f4ff', zIndex: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 12,
        }}>
          <div className="spinner" />
          <div style={{ fontSize: 13, color: '#8896aa' }}>Đang tải Sales Report...</div>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src="./sales-report.html"
        style={{
          width: '100%',
          flex: 1,
          border: 'none',
          display: 'block',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.3s',
        }}
        onLoad={() => setLoaded(true)}
        title="Sales Report"
      />
    </div>
  )
}
