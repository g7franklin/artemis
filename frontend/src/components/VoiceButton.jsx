import { useCallback, useState } from 'react';

/**
 * @param {{
 *   voiceState: string,
 *   disabled?: boolean,
 *   onPressStart: () => void,
 *   onPressEnd: () => void,
 * }} props
 */
export function VoiceButton({
  voiceState,
  disabled = false,
  onPressStart,
  onPressEnd,
}) {
  const [pressing, setPressing] = useState(false);

  const start = useCallback(() => {
    if (disabled) return;
    setPressing(true);
    onPressStart();
  }, [disabled, onPressStart]);

  const end = useCallback(() => {
    setPressing(false);
    onPressEnd();
  }, [onPressEnd]);

  const visualState = pressing
    ? 'listening'
    : voiceState === 'speaking' || voiceState === 'thinking'
      ? voiceState
      : 'idle';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.5rem',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onPointerDown={(e) => {
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          start();
        }}
        onPointerUp={(e) => {
          try {
            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          } catch {
            /* ignore */
          }
          end();
        }}
        onPointerLeave={(e) => {
          if (e.buttons === 0) end();
        }}
        onPointerCancel={(e) => {
          try {
            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          } catch {
            /* ignore */
          }
          end();
        }}
        style={{
          width: 'min(88vw, 280px)',
          height: 'min(88vw, 280px)',
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
          transform: pressing ? 'scale(0.97)' : 'scale(1)',
        }}
        aria-label="Hold to talk to Artemis"
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
          fontSize: '0.85rem',
          color: '#666',
          maxWidth: '260px',
          textAlign: 'center',
        }}
      >
        Hold the button while you speak. Release when you&apos;re done.
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
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 24 24"
      fill="none"
      style={{
        position: 'relative',
        zIndex: 1,
        margin: 'auto',
        display: 'block',
        paddingTop: '4px',
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
            maxHeight: '100px',
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
