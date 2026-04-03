const LABELS = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
};

export function StatusIndicator({ voiceState, connectionState }) {
  const conn =
    connectionState === 'connected'
      ? ''
      : connectionState === 'connecting'
        ? ' · Connecting…'
        : connectionState === 'reconnecting'
          ? ' · Reconnecting…'
          : '';

  const label = LABELS[voiceState] ?? voiceState;

  return (
    <div
      style={{
        textAlign: 'center',
        fontSize: '0.95rem',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: '#888',
        marginTop: '1.25rem',
      }}
    >
      {label}
      <span style={{ fontWeight: 400, opacity: 0.85 }}>{conn}</span>
    </div>
  );
}
