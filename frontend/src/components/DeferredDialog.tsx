import { Component, Suspense, type ReactNode } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

interface Props {
  children: ReactNode
  onClose: () => void
}

class DialogErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <Dialog open onOpenChange={open => { if (!open) this.props.onClose() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>弹窗加载失败</DialogTitle>
            <DialogDescription>请检查网络连接后重新加载页面。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={this.props.onClose}>关闭</Button>
            <Button onClick={() => window.location.reload()}>重新加载</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }
}

export function DeferredDialog({ children, onClose }: Props) {
  return (
    <DialogErrorBoundary onClose={onClose}>
      <Suspense fallback={(
        <Dialog open onOpenChange={open => { if (!open) onClose() }}>
          <DialogContent className="max-w-sm" aria-busy="true" aria-describedby={undefined}>
            <DialogTitle className="sr-only">加载中</DialogTitle>
            <div className="mx-auto my-4 size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
          </DialogContent>
        </Dialog>
      )}>
        {children}
      </Suspense>
    </DialogErrorBoundary>
  )
}
