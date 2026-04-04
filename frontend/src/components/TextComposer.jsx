import { useCallback, useState } from 'react';

/**
 * @param {{
 *   disabled?: boolean,
 *   sending?: boolean,
 *   onSend: (text: string) => void | Promise<void>,
 * }} props
 */
export function TextComposer({ disabled = false, sending = false, onSend }) {
  const [value, setValue] = useState('');

  const submit = useCallback(async () => {
    const t = value.trim();
    if (!t || disabled || sending) return;
    setValue('');
    await onSend(t);
  }, [value, disabled, sending, onSend]);

  return (
    <div
      style={{
        marginTop: '1.25rem',
        width: '100%',
        maxWidth: '420px',
      }}
    >
      <p
        style={{
          margin: '0 0 0.5rem',
          fontSize: '0.78rem',
          color: '#666',
          textAlign: 'center',
        }}
      >
        No mic? You can type to Artemis here — voice stays the default.
      </p>
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'flex-end',
        }}
      >
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Write a message…"
          rows={2}
          disabled={disabled || sending}
          aria-label="Message to Artemis"
          style={{
            flex: 1,
            resize: 'vertical',
            minHeight: '44px',
            maxHeight: '120px',
            padding: '0.55rem 0.65rem',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.05)',
            color: '#e4e4e8',
            fontSize: '0.9rem',
            lineHeight: 1.4,
            fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={disabled || sending || !value.trim()}
          style={{
            ...sendBtn,
            opacity: disabled || sending || !value.trim() ? 0.45 : 1,
          }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

const sendBtn = {
  flexShrink: 0,
  padding: '0.55rem 1rem',
  borderRadius: '10px',
  border: 'none',
  background: 'linear-gradient(145deg, #3a4a6a, #2a3550)',
  color: '#e8ecff',
  fontWeight: 600,
  fontSize: '0.85rem',
  cursor: 'pointer',
};
