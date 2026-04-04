import { useEffect, useRef } from 'react';

export function ConversationLog({ lines }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <div
      style={{
        marginTop: '1.25rem',
        width: '100%',
        maxWidth: '420px',
        minHeight: '120px',
        maxHeight: '32vh',
        overflowY: 'auto',
        padding: '0.75rem 1rem',
        borderRadius: '12px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        fontSize: '0.8rem',
        color: '#9a9a9a',
        lineHeight: 1.45,
      }}
    >
      {lines.length === 0 ? (
        <div style={{ color: '#666', fontStyle: 'italic' }}>
          Conversation log — speak or type below and messages will appear here.
        </div>
      ) : (
        lines.map((line, i) => (
          <div key={`${i}-${line.slice(0, 24)}`}>{line}</div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
