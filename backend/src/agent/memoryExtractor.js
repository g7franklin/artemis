import {
  retrieveMemories,
  storeMemory,
  supersedeMemory,
} from '../memory/pinecone.js';

const CATEGORIES = new Set([
  'personal_fact',
  'preference',
  'goal',
  'project',
  'emotional',
  'instruction',
]);

const EXTRACTION_SYSTEM = `You are extracting long-term memories about a user named Greg from a voice conversation transcript.
Return ONLY a JSON array (no markdown, no commentary). Each element must be an object with:
- "text": concise third-person fact suitable for retrieval (one sentence).
- "category": one of: personal_fact, preference, goal, project, emotional, instruction
- "isContradiction": boolean — true if this statement replaces something Greg used to believe or a fact that is no longer true.
- "contradicts": string or null — if isContradiction, a short paraphrase of the OLD belief/fact being replaced; else null.

Skip small talk, greetings, and tool readouts unless they reveal something personal about Greg.
If nothing worth storing, return [].`;

function normalizeJsonText(s) {
  let t = String(s).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) {
    t = fence[1].trim();
  } else if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }
  return t;
}

function parseJsonToMemoryArray(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.memories)) return parsed.memories;
  if (parsed && Array.isArray(parsed.items)) return parsed.items;
  return [];
}

/**
 * Parse {"conflict": boolean} from model output (markdown / extra prose tolerant).
 * @param {string} content
 * @returns {boolean | null}
 */
function parseConflictBoolean(content) {
  try {
    const normalized = normalizeJsonText(content);
    try {
      const j = JSON.parse(normalized);
      if (typeof j.conflict === 'boolean') return j.conflict;
    } catch {
      const start = normalized.indexOf('{');
      const end = normalized.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const j = JSON.parse(normalized.slice(start, end + 1));
        if (typeof j.conflict === 'boolean') return j.conflict;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Tolerate markdown fences and leading/trailing prose from the model.
 * @param {unknown} content
 * @returns {unknown[]}
 */
function parseMemoryArrayFromContent(content) {
  try {
    const normalized = normalizeJsonText(content);
    try {
      return parseJsonToMemoryArray(normalized);
    } catch {
      const start = normalized.indexOf('[');
      const end = normalized.lastIndexOf(']');
      if (start >= 0 && end > start) {
        return parseJsonToMemoryArray(normalized.slice(start, end + 1));
      }
      throw new Error('No JSON array found in model output');
    }
  } catch (e) {
    const preview = String(content).slice(0, 280);
    console.error('[memoryExtractor] JSON parse failed:', e?.message || e, preview);
    return [];
  }
}

async function chatGrokJson(userContent) {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error('Missing XAI_API_KEY');
  const model = process.env.XAI_CHAT_MODEL || 'grok-2-latest';
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM },
        {
          role: 'user',
          content: `Transcript:\n\n${userContent}\n\nRespond with the JSON array only.`,
        },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`xAI chat failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content in xAI chat response');
  return parseMemoryArrayFromContent(content);
}

/**
 * Find an existing vector id to supersede when the model flagged a contradiction.
 * @param {string} userId
 * @param {string} newText
 * @param {string | null} contradictsHint
 */
async function resolveSupersedeTarget(userId, newText, contradictsHint) {
  const q =
    contradictsHint && String(contradictsHint).trim().length > 0
      ? String(contradictsHint).trim()
      : newText;
  const hits = await retrieveMemories(q, userId, 8);
  const threshold = Number(process.env.MEMORY_SUPERSEDE_MIN_SCORE || 0.78);
  const hit = hits.find((h) => h.score >= threshold);
  return hit?.id ?? null;
}

/**
 * Optional second pass: if a new memory is extremely similar to an existing one, skip duplicate storage.
 */
async function isNearDuplicate(userId, text) {
  const hits = await retrieveMemories(text, userId, 1);
  const threshold = Number(process.env.MEMORY_DEDUPE_MIN_SCORE || 0.97);
  return hits[0]?.score >= threshold;
}

/**
 * @param {string} transcript
 * @param {string} userId
 * @returns {Promise<Array<{ text: string, category: string, storedId?: string, supersededId?: string }>>}
 */
export async function extractAndStoreMemories(transcript, userId) {
  const trimmed = transcript?.trim() ?? '';
  if (trimmed.length < 20) {
    return [];
  }

  let raw;
  try {
    raw = await chatGrokJson(trimmed);
  } catch (e) {
    console.error('[memoryExtractor] extraction LLM failed', e);
    throw e;
  }

  const results = [];
  const iso = () => new Date().toISOString();

  for (const item of raw) {
    if (!item || typeof item.text !== 'string') continue;
    const text = item.text.trim();
    if (text.length < 3) continue;

    let category =
      typeof item.category === 'string'
        ? item.category.trim().toLowerCase()
        : 'personal_fact';
    if (!CATEGORIES.has(category)) {
      category = 'personal_fact';
    }

    const isContradiction = Boolean(item.isContradiction);
    const contradicts =
      item.contradicts != null ? String(item.contradicts) : null;

    if (isContradiction) {
      const targetId = await resolveSupersedeTarget(
        userId,
        text,
        contradicts
      );
      if (targetId) {
        try {
          await supersedeMemory(userId, targetId);
        } catch (e) {
          console.error('[memoryExtractor] supersede failed', targetId, e);
        }
        const { id } = await storeMemory(text, {
          userId,
          category,
          timestamp: iso(),
          status: 'active',
        });
        results.push({
          text,
          category,
          storedId: id,
          supersededId: targetId,
        });
      } else {
        const { id } = await storeMemory(text, {
          userId,
          category,
          timestamp: iso(),
          status: 'active',
        });
        results.push({ text, category, storedId: id });
      }
      continue;
    }

    if (await isNearDuplicate(userId, text)) {
      results.push({ text, category, skipped: true, reason: 'near_duplicate' });
      continue;
    }

    const similar = await retrieveMemories(text, userId, 3);
    const top = similar[0];
    const conflictCheckScore = Number(
      process.env.MEMORY_CONFLICT_CHECK_SCORE || 0.88
    );
    if (
      top &&
      top.score >= conflictCheckScore &&
      top.text &&
      top.text.toLowerCase() !== text.toLowerCase()
    ) {
      const key = process.env.XAI_API_KEY;
      const model = process.env.XAI_CHAT_MODEL || 'grok-2-latest';
      const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            {
              role: 'system',
              content:
                'Reply with JSON only: {"conflict": true|false} — true if NEW fact contradicts or replaces OLD fact.',
            },
            {
              role: 'user',
              content: `OLD: ${top.text}\nNEW: ${text}`,
            },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const c = data.choices?.[0]?.message?.content?.trim() ?? '';
        const conflict = parseConflictBoolean(c);
        if (conflict === true) {
          await supersedeMemory(userId, top.id);
          const { id } = await storeMemory(text, {
            userId,
            category,
            timestamp: iso(),
            status: 'active',
          });
          results.push({
            text,
            category,
            storedId: id,
            supersededId: top.id,
            conflictResolved: true,
          });
          continue;
        }
      }
    }

    const { id } = await storeMemory(text, {
      userId,
      category,
      timestamp: iso(),
      status: 'active',
    });
    results.push({ text, category, storedId: id });
  }

  return results;
}
