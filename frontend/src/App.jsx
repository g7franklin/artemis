import { useCallback } from 'react';
import { VoiceButton } from './components/VoiceButton.jsx';
import { StatusIndicator } from './components/StatusIndicator.jsx';
import { ChatPanel } from './components/ChatPanel.jsx';
import { isFirebaseClientConfigured } from './lib/firebaseConfig.js';
import { useAuth } from './hooks/useAuth.js';
import { useVoiceSession } from './hooks/useVoiceSession.js';

export default function App() {
  if (!isFirebaseClientConfigured()) {
    return (
      <div style={shell}>
        <h1 style={title}>Artemis</h1>
        <p style={subtitle}>
          Set your Firebase web keys in <code style={code}>frontend/.env</code>{' '}
          (see <code style={code}>.env.example</code>), then restart the dev
          server.
        </p>
      </div>
    );
  }

  return <AppMain />;
}

function AppMain() {
  const { user, loading, error: authError, signInWithGoogle, logout } =
    useAuth();
  const {
    connectionState,
    voiceState,
    micLive,
    assistantPlaybackActive,
    lastError,
    logLines,
    toggleMic,
    endSession,
    clearChatLog,
    stopChat,
    sendTextMessage,
    textSending,
  } = useVoiceSession(user);

  const onToggleMic = useCallback(() => {
    void toggleMic();
  }, [toggleMic]);

  if (loading) {
    return (
      <div style={shell}>
        <p style={{ color: '#666' }}>Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={shell}>
        <h1 style={title}>Artemis</h1>
        <p style={subtitle}>Sign in to talk with your voice companion.</p>
        {authError ? (
          <p style={{ color: '#c44', fontSize: '0.9rem' }}>{authError}</p>
        ) : null}
        <button type="button" onClick={signInWithGoogle} style={primaryBtn}>
          Continue with Google
        </button>
      </div>
    );
  }

  return (
    <div className="app-main-shell">
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          maxWidth: '420px',
          flexShrink: 0,
          marginBottom: '0.2rem',
        }}
      >
        <h1 style={{ ...title, margin: 0, fontSize: 'clamp(1.05rem, 4vw, 1.3rem)' }}>
          Artemis
        </h1>
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={async () => {
              await endSession();
              void logout();
            }}
            style={{ ...ghostBtn, padding: '0.32rem 0.6rem', fontSize: '0.75rem' }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div style={{ flexShrink: 0 }}>
        <VoiceButton
          voiceState={voiceState}
          micLive={micLive}
          assistantPlaybackActive={assistantPlaybackActive}
          disabled={connectionState !== 'connected'}
          onToggle={onToggleMic}
        />
      </div>

      <div style={{ flexShrink: 0 }}>
        <StatusIndicator
          voiceState={voiceState}
          connectionState={connectionState}
        />
      </div>

      {lastError ? (
        <p
          style={{
            color: '#d66',
            fontSize: '0.72rem',
            marginTop: '0.25rem',
            marginBottom: 0,
            textAlign: 'center',
            maxWidth: '100%',
            padding: '0 0.25rem',
            lineHeight: 1.35,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            flexShrink: 0,
          }}
        >
          {lastError}
        </p>
      ) : null}

      <div className="app-main-chat-slot">
        <ChatPanel
          lines={logLines}
          disabled={connectionState !== 'connected'}
          sending={textSending}
          onSend={sendTextMessage}
          onClearChat={clearChatLog}
          onStopChat={() => void stopChat()}
        />
      </div>
    </div>
  );
}

const code = {
  fontSize: '0.85em',
  color: '#c9b037',
  background: 'rgba(255,255,255,0.06)',
  padding: '0.1em 0.35em',
  borderRadius: '4px',
};

const shell = {
  minHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'max(1.25rem, env(safe-area-inset-top)) 1.25rem max(1.5rem, env(safe-area-inset-bottom))',
};

const title = {
  fontWeight: 600,
  letterSpacing: '-0.02em',
  marginBottom: '0.35rem',
};

const subtitle = {
  color: '#888',
  marginBottom: '1.5rem',
  textAlign: 'center',
  maxWidth: '320px',
  lineHeight: 1.5,
};

const primaryBtn = {
  background: '#e8e8e8',
  color: '#0a0a0a',
  border: 'none',
  padding: '0.75rem 1.35rem',
  borderRadius: '10px',
  fontWeight: 600,
};

const ghostBtn = {
  background: 'transparent',
  color: '#888',
  border: '1px solid rgba(255,255,255,0.12)',
  padding: '0.4rem 0.75rem',
  borderRadius: '8px',
  fontSize: '0.8rem',
};
