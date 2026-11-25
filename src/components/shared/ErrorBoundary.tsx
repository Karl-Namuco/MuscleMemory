import { Component, type ErrorInfo, type ReactNode } from 'react'
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application error', error, info.componentStack)
  }
  render() {
    if (this.state.failed)
      return (
        <main className="standalone-state">
          <h1>Let’s get you back.</h1>
          <p>The application could not open this screen. Your saved data has not been discarded.</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload application
          </button>
        </main>
      )
    return this.props.children
  }
}
