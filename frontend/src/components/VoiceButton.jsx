import { useCallback } from 'react';

/**
 * @param {{
 *   voiceState: string,
 *   micLive: boolean,
 *   assistantPlaybackActive?: boolean,
 *   disabled?: boolean,
 *   onToggle: () => void,
 * }} props
 */
export function VoiceButton({
  voiceState,
  micLive,
  assistantPlaybackActive = false,
  disabled = false,
  onToggle,
}) {
  const click = useCallback(() => {
    if (disabled) return;
    onToggle();
  }, [disabled, onToggle]);

  const visualState = micLive
    ? 'listening'
    : voiceState === 'thinking'
      ? 'thinking'
      : voiceState === 'speaking' || assistantPlaybackActive
        ? 'speaking'
        : 'idle';

  const btnSize = 'clamp(144px, 35vmin, 202px)';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.2rem',
        userSelect: 'none',
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={click}
        style={{
          width: btnSize,
          height: btnSize,
          borderRadius: '50%',
          border: 'none',
          background:
            visualState === 'listening'
              ? 'linear-gradient(145deg, #2a1518, #1a0a0c)'
              : 'linear-gradient(145deg, #1c1c22, #121218)',
          boxShadow:
            visualState === 'listening'
              ? '0 0 0 4px rgba(220, 60, 70, 0.35), 0 12px 40px rgba(0,0,0,0.5)'
              : '0 8px 32px rgba(0,0,0,0.45)',
          position: 'relative',
          overflow: 'hidden',
          opacity: disabled ? 0.45 : 1,
          transition: 'box-shadow 0.2s ease, transform 0.15s ease',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        aria-pressed={micLive}
        aria-label={
          micLive
            ? 'Stop sending and let Artemis reply'
            : visualState === 'speaking'
              ? 'Stop Artemis audio and start talking'
              : 'Start talking to Artemis'
        }
      >
        {visualState === 'listening' ? (
          <span
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              pointerEvents: 'none',
              animation: 'pulse-ring 1.2s ease-out infinite',
              border: '3px solid rgba(220, 60, 70, 0.55)',
            }}
          />
        ) : null}
        {visualState === 'thinking' ? (
          <span
            style={{
              position: 'absolute',
              inset: '-5px',
              borderRadius: '50%',
              pointerEvents: 'none',
              animation: 'spin-arc 1.35s linear infinite',
              border: '3px solid transparent',
              borderTopColor: 'rgba(130, 170, 255, 0.9)',
              borderRightColor: 'rgba(130, 170, 255, 0.15)',
            }}
          />
        ) : null}
        {visualState === 'speaking' ? (
          <WaveformBars />
        ) : (
          <MicIcon active={visualState === 'listening'} />
        )}
      </button>
      <p
        style={{
          margin: 0,
          fontSize: '0.68rem',
          color: '#666',
          maxWidth: 'min(280px, 92vw)',
          textAlign: 'center',
          lineHeight: 1.35,
          padding: '0 0.25rem',
        }}
      >
        Tap to talk · say &quot;over and out&quot; or tap again to send (Chrome
        / Edge). While Artemis is speaking, tap the mic to cut her off and talk.
        The mic turns on again after her audio finishes. Say &quot;stay smooth…&quot;
        to stop chat (saves memories, reconnects). After she replies, tap once
        to pause without sending if you haven&apos;t spoken yet.
      </p>
      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 1; }
          70% { transform: scale(1.08); opacity: 0.35; }
          100% { transform: scale(1.12); opacity: 0; }
        }
        @keyframes spin-arc {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function MicIcon({ active }) {
  const s = 'clamp(55px, 17.3vmin, 80px)';
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      style={{
        position: 'relative',
        zIndex: 1,
        margin: 'auto',
        display: 'block',
        paddingTop: '4px',
        width: s,
        height: s,
      }}
      aria-hidden
    >
      <path
        d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3z"
        stroke={active ? '#e85560' : '#c4c4cc'}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 11v1a4 4 0 0 0 8 0v-1M12 18v3"
        stroke={active ? '#e85560' : '#c4c4cc'}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WaveformBars() {
  const heights = [40, 65, 45, 80, 55, 72, 48];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '5px',
        height: '100%',
        position: 'relative',
        zIndex: 1,
      }}
      aria-hidden
    >
      {heights.map((h, i) => (
        <span
          key={i}
          style={{
            width: '6px',
            height: `${h}%`,
            maxHeight: 'min(56px, 45%)',
            background: 'linear-gradient(180deg, #7eb8ff, #4a7ac8)',
            borderRadius: '3px',
            animation: `wave 0.5s ease-in-out ${i * 0.07}s infinite alternate`,
          }}
        />
      ))}
      <style>{`
        @keyframes wave {
          from { transform: scaleY(0.45); opacity: 0.65; }
          to { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
