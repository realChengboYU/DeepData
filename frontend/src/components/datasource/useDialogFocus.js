import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// 对话框焦点管理（符合 Web Interface Guidelines）：
// - 打开时把焦点移入对话框容器（tabIndex=-1，保持 role=dialog 标签可被读屏播报）；
// - Tab / Shift+Tab 在对话框内循环（焦点陷阱），不会逃到背景；
// - 关闭时把焦点还给打开前的元素。
// 可选 initialFocus=false：由容器内 autoFocus 元素接管初始焦点（如勾选表的搜索框）。
export function useDialogFocus(dialogRef, open, { initialFocus = true } = {}) {
  const restoreRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const el = dialogRef.current
    if (!el) return
    restoreRef.current = document.activeElement

    const raf = requestAnimationFrame(() => {
      if (initialFocus) {
        el.focus({ preventScroll: true })
      }
    })

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return
      const nodes = Array.from(el.querySelectorAll(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement || n.getClientRects().length,
      )
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeyDown, true)
      const prev = restoreRef.current
      if (prev && typeof prev.focus === 'function') {
        prev.focus({ preventScroll: true })
      }
    }
  }, [open, dialogRef, initialFocus])
}
