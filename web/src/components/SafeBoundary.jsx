import { Component } from 'react'

// Catches a crash inside one part of the page and shows a message there,
// instead of letting one broken chart blank the whole dashboard.
export default class SafeBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error) {
    console.error(`[${this.props.name ?? 'section'}]`, error)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="rounded-md border border-heat-red/40 bg-heat-red/5 px-4 py-3 text-sm">
        This part ({this.props.name ?? 'section'}) couldn't be displayed: {this.state.error.message}
        <button type="button" onClick={() => this.setState({ error: null })} className="ml-3 font-semibold text-sea underline">
          Try again
        </button>
      </div>
    )
  }
}
