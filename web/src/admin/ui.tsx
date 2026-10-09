import type { ReactNode } from 'react'
import { scoreClass } from './api'

export function Panel({
  title,
  extra,
  children,
  flush,
}: {
  title: ReactNode
  extra?: ReactNode
  children: ReactNode
  flush?: boolean
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        <div style={{ flex: 1 }} />
        {extra}
      </div>
      <div className={`panel-body${flush ? ' flush' : ''}`}>{children}</div>
    </section>
  )
}

export function StatCard({
  label,
  value,
  unit,
  foot,
}: {
  label: string
  value: ReactNode
  unit?: string
  foot?: ReactNode
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  )
}

export function ScorePill({ score }: { score: number | null | undefined }) {
  const cls = scoreClass(score)
  return <span className={`score-pill ${cls}`}>{score == null ? '未评分' : Math.round(score)}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="mask-modal" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="panel-title">{title}</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * 简单确认弹窗 —— 不用 window.confirm，避免被浏览器拦或被误当成脚本弹窗
 */
export function Confirm({
  title,
  message,
  danger,
  confirmText = '确认',
  onConfirm,
  onClose,
}: {
  title: string
  message: ReactNode
  danger?: boolean
  confirmText?: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-sm" onClick={onClose}>
            取消
          </button>
          <button
            className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmText}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>{message}</div>
    </Modal>
  )
}
