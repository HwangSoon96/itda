import { Component } from 'react'
import type { ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() {
    return { error: true }
  }
  render() {
    return this.state.error ? (
      <main className="card mvp-startup">
        <h1>화면을 불러오지 못했어요</h1>
        <p>저장된 기록은 PC에 남아 있어요. 다시 불러와 주세요.</p>
        <button className="button" onClick={() => location.reload()}>
          다시 불러오기
        </button>
      </main>
    ) : (
      this.props.children
    )
  }
}
