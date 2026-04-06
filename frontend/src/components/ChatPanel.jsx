import { useCallback, useEffect, useRef, useState } from 'react';

/** @returns {{ kind: 'chat', role: 'user' | 'assistant', text: string } | { kind: 'system', text: string }} */
function parseLogLine(line) {
  const trimmed = line.trim();
  const m = /^(You|Artemis):\s*(.*)$/s.exec(trimmed);
  if (m) {
    const role = m[1] === 'You' ? 'user' : 'assistant';
    const text = (m[2] ?? '').trim() || '…';
    return { kind: 'chat', role, text };
  }
  return { kind: 'system', text: trimmed };
}

/**
 * @param {{
 *   lines: string[],
 *   disabled?: boolean,
 *   sending?: boolean,
 *   onSend: (text: string) => void | Promise<void>,
 *   onStartNewSession?: () => void | Promise<void>,
 *   onStopChat?: () => void | Promise<void>,
 *   restartingSession?: boolean,
 * }} props
 */
export function ChatPanel({
  lines,
  disabled = false,
  sending = false,
  onSend,
  onStartNewSession,
  onStopChat,
  restartingSession = false,
}) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const bottomRef = useRef(null);

  const submit = useCallback(async () => {
    const t = value.trim();
    if (!t || disabled || sending) return;
    setValue('');
    await onSend(t);
  }, [value, disabled, sending, onSend]);

  const locked = disabled || sending;
  const canSend = !locked && value.trim().length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <div
      className="chat-panel-root"
      style={{
        marginTop: '0.35rem',
        width: '100%',
        maxHeight: 'min(292px, 38dvh)',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <style>{`
        .chat-panel-root .chat-panel-card {
          border-radius: 14px;
          padding: 1px;
          flex: 1;
          min-height: 0;
          max-height: 100%;
          display: flex;
          flex-direction: column;
          background: linear-gradient(
            145deg,
            rgba(220, 80, 90, 0.22),
            rgba(255, 255, 255, 0.08) 38%,
            rgba(120, 140, 200, 0.18) 100%
          );
          box-shadow:
            0 4px 28px rgba(0, 0, 0, 0.4),
            0 0 0 1px rgba(255, 255, 255, 0.05) inset;
        }
        .chat-panel-root .chat-panel-inner {
          border-radius: 13px;
          background: linear-gradient(180deg, #18181f 0%, #0f0f14 100%);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
        }
        .chat-panel-root .chat-panel-messages {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 0.45rem 0.55rem 0.5rem;
          scroll-behavior: smooth;
        }
        @media (max-height: 520px) {
          .chat-panel-root .chat-panel-hint {
            display: none;
          }
        }
        .chat-panel-root .chat-panel-messages::-webkit-scrollbar {
          width: 6px;
        }
        .chat-panel-root .chat-panel-messages::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.03);
          border-radius: 4px;
        }
        .chat-panel-root .chat-panel-messages::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.12);
          border-radius: 4px;
        }
        .chat-panel-root .chat-panel-messages::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.18);
        }
        .chat-panel-root .chat-bubble-user {
          margin-left: 1.1rem;
          border-radius: 14px 14px 4px 14px;
          background: linear-gradient(145deg, rgba(200, 55, 70, 0.35), rgba(140, 35, 50, 0.25));
          border: 1px solid rgba(232, 85, 96, 0.22);
          color: #f0e8ea;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
        }
        .chat-panel-root .chat-bubble-assistant {
          margin-right: 1.1rem;
          border-radius: 14px 14px 14px 4px;
          background: linear-gradient(145deg, rgba(45, 55, 85, 0.55), rgba(28, 34, 52, 0.65));
          border: 1px solid rgba(130, 155, 220, 0.15);
          color: #e2e6f2;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
        }
        .chat-panel-root .chat-panel-input {
          width: 100%;
          min-height: 36px;
          max-height: 72px;
          padding: 0.45rem 0.55rem;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.35);
          color: #ececf0;
          font-size: 0.8125rem;
          line-height: 1.4;
          font-family: inherit;
          resize: none;
          outline: none;
          transition:
            border-color 0.2s ease,
            box-shadow 0.2s ease,
            background 0.2s ease;
        }
        .chat-panel-root .chat-panel-input::placeholder {
          color: #5c5c68;
        }
        .chat-panel-root .chat-panel-input:hover:not(:disabled) {
          border-color: rgba(255, 255, 255, 0.14);
          background: rgba(0, 0, 0, 0.28);
        }
        .chat-panel-root .chat-panel-input:focus {
          border-color: rgba(220, 90, 100, 0.45);
          box-shadow: 0 0 0 3px rgba(220, 80, 90, 0.12);
          background: rgba(0, 0, 0, 0.4);
        }
        .chat-panel-root .chat-panel-input:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .chat-panel-root .chat-panel-send {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
          min-width: 4.5rem;
          padding: 0.45rem 0.65rem;
          border-radius: 10px;
          border: none;
          font-weight: 600;
          font-size: 0.75rem;
          letter-spacing: 0.02em;
          cursor: pointer;
          color: #fff;
          background: linear-gradient(145deg, #c73d4a, #8f2835);
          box-shadow:
            0 2px 12px rgba(200, 60, 75, 0.35),
            0 1px 0 rgba(255, 255, 255, 0.12) inset;
          transition:
            transform 0.15s ease,
            box-shadow 0.2s ease,
            filter 0.2s ease,
            opacity 0.2s ease;
        }
        .chat-panel-root .chat-panel-send:hover:not(:disabled) {
          filter: brightness(1.08);
          box-shadow:
            0 4px 18px rgba(200, 60, 75, 0.45),
            0 1px 0 rgba(255, 255, 255, 0.15) inset;
        }
        .chat-panel-root .chat-panel-send:active:not(:disabled) {
          transform: scale(0.97);
        }
        .chat-panel-root .chat-panel-send:disabled {
          opacity: 0.38;
          cursor: not-allowed;
          filter: grayscale(0.3);
          box-shadow: none;
        }
        @keyframes chat-panel-dot {
          0%, 80%, 100% {
            opacity: 0.35;
            transform: scale(0.85);
          }
          40% {
            opacity: 1;
            transform: scale(1);
          }
        }
        .chat-panel-root .chat-panel-dot {
          animation: chat-panel-dot 0.9s ease-in-out infinite;
        }
        .chat-panel-root .chat-panel-new-btn {
          flex-shrink: 0;
          padding: 0.28rem 0.5rem;
          border-radius: 8px;
          font-size: 0.65rem;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: #a8a8b8;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          white-space: nowrap;
        }
        .chat-panel-root .chat-panel-new-btn:hover:not(:disabled) {
          color: #c8c8d8;
          background: rgba(255, 255, 255, 0.09);
          border-color: rgba(255, 255, 255, 0.14);
        }
        .chat-panel-root .chat-panel-new-btn:disabled {
          opacity: 0.5;
          cursor: wait;
        }
      `}</style>

      <div className="chat-panel-card">
        <div className="chat-panel-inner">
          <div
            style={{
              flexShrink: 0,
              padding: '0.45rem 0.55rem 0.4rem',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.35rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                minWidth: 0,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: focused
                    ? 'linear-gradient(145deg, #e85560, #b03040)'
                    : 'rgba(255,255,255,0.2)',
                  boxShadow: focused
                    ? '0 0 10px rgba(232, 85, 96, 0.6)'
                    : 'none',
                  transition: 'background 0.2s, box-shadow 0.2s',
                }}
              />
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#c8c8d4',
                  letterSpacing: '0.03em',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                Conversation
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                flexShrink: 0,
              }}
            >
              {onStartNewSession ? (
                <button
                  type="button"
                  className="chat-panel-new-btn"
                  disabled={restartingSession}
                  aria-busy={restartingSession}
                  title={
                    restartingSession
                      ? 'Starting new session…'
                      : 'End this chat and connect fresh'
                  }
                  aria-label={
                    restartingSession
                      ? 'Starting new session'
                      : 'Start new chat'
                  }
                  onClick={() => void onStartNewSession()}
                >
                  {restartingSession ? '…' : 'New chat'}
                </button>
              ) : null}
              {onStopChat ? (
                <button
                  type="button"
                  className="chat-panel-new-btn"
                  disabled={disabled || restartingSession}
                  title={
                    disabled
                      ? 'Connect first to stop chat'
                      : 'Hang up: close connection and stop the mic; keep messages on screen'
                  }
                  aria-label="Stop chat"
                  onClick={() => void onStopChat()}
                >
                  Stop chat
                </button>
              ) : null}
              <span
                style={{
                  fontSize: '0.58rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: '#5c5c6c',
                }}
              >
                Live
              </span>
            </div>
          </div>

          <div className="chat-panel-messages">
            {lines.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '48px',
                  padding: '0.35rem 0.35rem 0.15rem',
                  textAlign: 'center',
                }}
              >
                <div
                  aria-hidden
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '8px',
                    marginBottom: '0.35rem',
                    background:
                      'linear-gradient(145deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                />
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.72rem',
                    color: '#7a7a8a',
                    lineHeight: 1.45,
                    maxWidth: '240px',
                  }}
                >
                  Mic or type below — messages show here.
                </p>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.45rem',
                }}
              >
                {lines.map((line, i) => {
                  const parsed = parseLogLine(line);
                  const key = `${i}-${line.slice(0, 32)}`;

                  if (parsed.kind === 'system') {
                    return (
                      <div
                        key={key}
                        style={{
                          display: 'flex',
                          justifyContent: 'center',
                          padding: '0.15rem 0',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '0.68rem',
                            color: '#6a6a78',
                            lineHeight: 1.4,
                            textAlign: 'center',
                            maxWidth: '95%',
                            padding: '0.35rem 0.65rem',
                            borderRadius: '8px',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.05)',
                          }}
                        >
                          {parsed.text}
                        </span>
                      </div>
                    );
                  }

                  const isUser = parsed.role === 'user';
                  return (
                    <div
                      key={key}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isUser ? 'flex-end' : 'flex-start',
                        gap: '0.2rem',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.62rem',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.12em',
                          color: isUser ? '#c07078' : '#8898c8',
                          paddingLeft: isUser ? 0 : '0.15rem',
                          paddingRight: isUser ? '0.15rem' : 0,
                        }}
                      >
                        {isUser ? 'You' : 'Artemis'}
                      </span>
                      <div
                        className={
                          isUser ? 'chat-bubble-user' : 'chat-bubble-assistant'
                        }
                        style={{
                          padding: '0.4rem 0.6rem',
                          fontSize: '0.8rem',
                          lineHeight: 1.45,
                          maxWidth: '92%',
                          wordBreak: 'break-word',
                        }}
                      >
                        {parsed.text}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div
            style={{
              flexShrink: 0,
              borderTop: '1px solid rgba(255,255,255,0.08)',
              padding: '0.5rem 0.6rem 0.45rem',
              background: 'linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.22) 100%)',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'flex-end',
              }}
            >
              <textarea
                className="chat-panel-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder={
                  sending
                    ? 'Sending…'
                    : disabled
                      ? 'Connect to send a message…'
                      : 'Type a message…'
                }
                rows={1}
                disabled={locked}
                aria-label="Message to Artemis"
              />
              <button
                type="button"
                className="chat-panel-send"
                onClick={() => void submit()}
                disabled={!canSend}
                aria-busy={sending}
              >
                {sending ? (
                  <SendingDots />
                ) : (
                  <>
                    <SendIcon />
                    Send
                  </>
                )}
              </button>
            </div>
            <p
              className="chat-panel-hint"
              style={{
                margin: '0.35rem 0 0',
                fontSize: '0.62rem',
                color: '#5a5a68',
                letterSpacing: '0.02em',
                lineHeight: 1.35,
              }}
            >
              <span style={{ color: '#7a7a8a' }}>Enter</span> send ·{' '}
              <span style={{ color: '#7a7a8a' }}>Shift+Enter</span> line
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

function SendingDots() {
  return (
    <span
      style={{
        display: 'inline-flex',
        gap: '3px',
        alignItems: 'center',
        padding: '0 0.15rem',
      }}
      aria-hidden
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="chat-panel-dot"
          style={{
            width: '4px',
            height: '4px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.85)',
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </span>
  );
}
