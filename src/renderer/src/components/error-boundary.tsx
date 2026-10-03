import { Component, type ReactNode } from 'react'

/** Shows a render error in place instead of blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error) {
    console.error(`[${this.props.label}] render error`, error)
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="m-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-[12px]">
        <div className="font-medium text-destructive">The {this.props.label} panel hit an error</div>
        <pre className="mt-1 font-mono text-[11px] whitespace-pre-wrap">{this.state.error.message}</pre>
        <button className="mt-2 text-primary hover:underline" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
