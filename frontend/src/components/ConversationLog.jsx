import { useEffect, useRef } from 'react';

export function ConversationLog({ lines }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  if (!lines.length) {
    return null;
  }

  return (
    <div
      style={{
        marginTop: '2rem',
        maxHeight: '28vh',
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
      {lines.map((line, i) => (
        <div key={`${i}-${line.slice(0, 24)}`}>{line}</div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
