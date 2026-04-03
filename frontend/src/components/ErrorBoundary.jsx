import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[Artemis]', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
            background: '#0a0a0a',
            color: '#e8e8e8',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#888', fontSize: '0.9rem', maxWidth: '360px' }}>
            {this.state.error instanceof Error
              ? this.state.error.message
              : String(this.state.error)}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1.25rem',
              background: '#e8e8e8',
              color: '#0a0a0a',
              border: 'none',
              padding: '0.6rem 1.1rem',
              borderRadius: '8px',
              fontWeight: 600,
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
