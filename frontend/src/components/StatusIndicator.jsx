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
        fontSize: '0.7rem',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: '#888',
        marginTop: '0.3rem',
      }}
    >
      {label}
      <span style={{ fontWeight: 400, opacity: 0.85 }}>{conn}</span>
    </div>
  );
}
