import { useCallback } from 'react';
import { VoiceButton } from './components/VoiceButton.jsx';
import { StatusIndicator } from './components/StatusIndicator.jsx';
import { ConversationLog } from './components/ConversationLog.jsx';
import { TextComposer } from './components/TextComposer.jsx';
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
    lastError,
    logLines,
    beginPushToTalk,
    endPushToTalk,
    endSession,
    sendTextMessage,
    textSending,
  } = useVoiceSession(user);

  const onPressStart = useCallback(() => {
    void beginPushToTalk();
  }, [beginPushToTalk]);

  const onPressEnd = useCallback(() => {
    endPushToTalk();
  }, [endPushToTalk]);

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
    <div style={shell}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          maxWidth: '420px',
          marginBottom: '0.5rem',
        }}
      >
        <h1 style={{ ...title, margin: 0, fontSize: '1.35rem' }}>Artemis</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => {
              endSession();
              void logout();
            }}
            style={ghostBtn}
          >
            Sign out
          </button>
        </div>
      </header>

      <VoiceButton
        voiceState={voiceState}
        onPressStart={onPressStart}
        onPressEnd={onPressEnd}
      />

      <StatusIndicator
        voiceState={voiceState}
        connectionState={connectionState}
      />

      {lastError ? (
        <p
          style={{
            color: '#d66',
            fontSize: '0.85rem',
            marginTop: '1rem',
            textAlign: 'center',
            maxWidth: '320px',
          }}
        >
          {lastError}
        </p>
      ) : null}

      <ConversationLog lines={logLines} />

      <TextComposer
        disabled={connectionState !== 'connected'}
        sending={textSending}
        onSend={sendTextMessage}
      />

      <button
        type="button"
        onClick={endSession}
        style={{ ...ghostBtn, marginTop: '1.5rem' }}
      >
        End voice session
      </button>
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
