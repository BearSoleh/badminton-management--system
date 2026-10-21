import { Component } from 'react'
import type { ReactNode } from 'react'

export class RouteErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError() { return {failed:true} }
  render() {
    if(this.state.failed) return <section role="alert"><h1>We couldn’t open this page.</h1><p className="text-muted mt-4">Check your connection, then reload to try again.</p><button className="button primary mt-6" onClick={()=>window.location.reload()}>Reload page</button></section>
    return this.props.children
  }
}
