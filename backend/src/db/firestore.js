import admin from 'firebase-admin';

let appInitialized = false;

function ensureApp() {
  if (appInitialized) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY'
    );
  }
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
  appInitialized = true;
}

function db() {
  ensureApp();
  return admin.firestore();
}

/**
 * @param {string} idToken
 * @returns {Promise<admin.auth.DecodedIdToken>}
 */
export async function verifyFirebaseIdToken(idToken) {
  ensureApp();
  return admin.auth().verifyIdToken(idToken);
}

/**
 * @param {string} userId
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function getUserProfile(userId) {
  const snap = await db().collection('users').doc(userId).get();
  if (!snap.exists) return null;
  return snap.data() ?? null;
}

/**
 * @param {string} userId
 * @param {Record<string, unknown>} data
 */
export async function saveUserProfile(userId, data) {
  await db()
    .collection('users')
    .doc(userId)
    .set(
      {
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

/**
 * @param {string} userId
 * @param {string} transcript
 * @param {unknown} memories
 */
export async function logConversation(userId, transcript, memories) {
  await db()
    .collection('users')
    .doc(userId)
    .collection('sessions')
    .add({
      transcript,
      memoriesExtracted: memories ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

/**
 * @param {string} userId
 * @param {number} limit
 * @returns {Promise<Array<{ id: string; transcript: string; createdAt?: unknown; memoriesExtracted?: unknown }>>}
 */
export async function getRecentConversations(userId, limit = 10) {
  const snap = await db()
    .collection('users')
    .doc(userId)
    .collection('sessions')
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      transcript: data.transcript ?? '',
      createdAt: data.createdAt,
      memoriesExtracted: data.memoriesExtracted,
    };
  });
}
