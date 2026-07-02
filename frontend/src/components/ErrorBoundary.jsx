import { Component } from 'react'

// ErrorBoundary — a render crash in one view must never blank the whole app
// (the sidebar stays usable and the error is visible instead of a white page).
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('view crashed:', error, info.componentStack)
  }

  componentDidUpdate(prevProps) {
    // Navigating to a different view retries the render.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="p-8">
        <div className="bg-[#13131e] border border-red-500/25 rounded-2xl p-8 max-w-xl">
          <p className="text-sm text-gray-200 font-medium mb-1">This view hit an error</p>
          <p className="text-xs text-gray-500 mb-4">
            The rest of the dashboard is still running — switch tabs or reload. If it keeps
            happening after a hard refresh (Ctrl+Shift+R), the cached app shell may be stale.
          </p>
          <pre className="text-[11px] text-red-400/80 font-mono whitespace-pre-wrap break-all mb-4">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="text-xs px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
