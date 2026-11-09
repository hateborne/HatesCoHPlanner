import { Component, type ReactNode } from 'react';

/**
 * Last line of defence: if rendering throws (a build the checks didn't catch, a data mismatch),
 * show what happened and offer to clear the remembered build instead of leaving a blank page --
 * otherwise the same saved build would blank the app again on every reload.
 */
export class CrashGuard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('planner crashed:', error);
  }

  private reset = () => {
    for (const get of [() => sessionStorage, () => localStorage]) {
      try {
        get().removeItem('hcp.current');
      } catch {
        /* storage unavailable */
      }
    }
    location.replace(location.pathname + location.search);
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#000814', color: '#cfe8ff', fontFamily: "'Montreal', Verdana, sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 640, textAlign: 'center' }}>
          <h1 style={{ color: '#ffd200', fontSize: 26 }}>Something went wrong</h1>
          <p style={{ fontSize: 16, lineHeight: 1.4 }}>
            The planner hit an error showing this build ({this.state.error.message}). Reloading may help; if it keeps happening, clear the remembered build and
            start fresh. Builds saved in the build menu are kept.
          </p>
          <p style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button className="info-button" style={{ position: 'static' }} onClick={() => location.reload()}>
              Reload
            </button>
            <button className="info-button" style={{ position: 'static' }} onClick={this.reset}>
              Clear remembered build
            </button>
          </p>
        </div>
      </div>
    );
  }
}
