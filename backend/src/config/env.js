/**
 * Log missing environment variables at startup (does not exit).
 * Voice sessions need the "voice" group; memory extraction also needs OpenAI + Pinecone.
 */
export function logEnvStatus() {
  const groups = {
    voice: ['XAI_API_KEY', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'],
    memory: ['OPENAI_API_KEY', 'PINECONE_API_KEY'],
    flights: ['DUFFEL_ACCESS_TOKEN'],
    notion: ['NOTION_API_KEY'],
  };

  for (const [name, keys] of Object.entries(groups)) {
    const missing = keys.filter((k) => !process.env[k]?.trim());
    if (missing.length) {
      console.warn(
        `[artemis] Missing ${name} env: ${missing.join(', ')} — related features will fail until set.`
      );
    }
  }
}
