/**
 * Removes trailing voice-only cues (Greg says them to the app; they should not
 * appear in logs, memory extraction, or text sent to the model).
 *
 * @param {string} text
 * @returns {string}
 */
export function stripEndTurnCueFromUserText(text) {
  let t = text.trim();
  let prev;
  const trailingCues = [
    /\s*,?\s*over\s+and\s+out\s*[\s.,!?…'"”]*$/i,
    /\s*,?\s*stay\s+smooth,?\s+(arty|already)\s*[\s.,!?…'"”]*$/i,
  ];
  do {
    prev = t;
    for (const re of trailingCues) {
      t = t.replace(re, '').trim();
    }
  } while (t !== prev);
  return t;
}
