/** @returns {boolean} */
export function isFirebaseClientConfigured() {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID;
  if (!apiKey?.trim() || !projectId?.trim() || !appId?.trim()) {
    return false;
  }
  const placeholder =
    apiKey.includes('your_') ||
    projectId.includes('your_') ||
    appId.includes('your_');
  return !placeholder;
}
