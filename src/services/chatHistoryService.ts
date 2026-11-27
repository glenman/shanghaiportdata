import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase.js';
import { ChatMessage, ChatSessionRecord, CitedSource } from '../types.js';

// Constants synchronized verbatim with firebase-blueprint.json & firestore.rules
const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const MAX_ID_LEN = 128;
const MAX_TITLE_LEN = 120;
const MAX_PREVIEW_LEN = 300;
const MAX_CONTENT_LEN = 50000;
const MAX_QUERY_LEN = 5000;
const MAX_ERROR_LEN = 1000;
const MAX_SOURCES_LEN = 15;

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen);
}

export function sanitizeId(rawId: string, prefix = 'id'): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const candidate = cleaned.length > 0 ? cleaned : `${prefix}_${Date.now()}`;
  const truncated = candidate.slice(0, MAX_ID_LEN);
  if (!VALID_ID_REGEX.test(truncated)) {
    return `${prefix}_${Date.now()}`;
  }
  return truncated;
}

export function generateSessionId(): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return sanitizeId(`sess_${Date.now()}_${randomPart.slice(0, 16)}`, 'sess');
}

function buildSessionTitle(firstText: string): string {
  const normalized = firstText.replace(/\s+/g, ' ').trim();
  if (!normalized) return '新会话';
  return truncate(normalized, MAX_TITLE_LEN);
}

function buildPreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return truncate(normalized, MAX_PREVIEW_LEN);
}

function sanitizeSources(sources?: CitedSource[]): Record<string, unknown>[] | undefined {
  if (!Array.isArray(sources) || sources.length === 0) return undefined;
  return sources.slice(0, MAX_SOURCES_LEN).map((s, idx) => {
    const entry: Record<string, unknown> = {
      id: truncate(String(s.id || `src_${idx}`), 200),
      title: truncate(String(s.title || '未知来源'), 300),
      category: truncate(String(s.category || '历史资料'), 100),
      sourceFile: truncate(String(s.sourceFile || ''), 300),
      section: truncate(String(s.section || ''), 300),
      relevanceScore:
        typeof s.relevanceScore === 'number' && Number.isFinite(s.relevanceScore)
          ? s.relevanceScore
          : 0,
      excerpt: truncate(String(s.excerpt || ''), 1000),
    };
    if (s.matchDate !== undefined) {
      entry.matchDate = s.matchDate === null ? null : truncate(String(s.matchDate), 100);
    }
    if (s.competition !== undefined) {
      entry.competition = s.competition === null ? null : truncate(String(s.competition), 150);
    }
    if (s.opponent !== undefined) {
      entry.opponent = s.opponent === null ? null : truncate(String(s.opponent), 150);
    }
    if (s.scoreline !== undefined) {
      entry.scoreline = s.scoreline === null ? null : truncate(String(s.scoreline), 50);
    }
    return entry;
  });
}

function buildMessagePayload(sessionId: string, msg: ChatMessage): Record<string, unknown> {
  const msgId = sanitizeId(msg.id, msg.role);
  const content = truncate((msg.content || '').trim() || '（空内容）', MAX_CONTENT_LEN);
  const clientTimestamp =
    typeof msg.timestamp === 'number' && Number.isFinite(msg.timestamp) && msg.timestamp >= 0
      ? Math.floor(msg.timestamp)
      : Date.now();

  const payload: Record<string, unknown> = {
    id: msgId,
    sessionId,
    role: msg.role === 'user' ? 'user' : 'assistant',
    content,
    clientTimestamp,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (typeof msg.userQuery === 'string' && msg.userQuery.length > 0) {
    payload.userQuery = truncate(msg.userQuery, MAX_QUERY_LEN);
  }
  if (
    msg.retrievalMode === 'json_full_context' ||
    msg.retrievalMode === 'vector_rag' ||
    msg.retrievalMode === 'hybrid' ||
    msg.retrievalMode === 'authoritative_stats'
  ) {
    payload.retrievalMode = msg.retrievalMode;
  }
  if (typeof msg.retrievedCount === 'number' && Number.isFinite(msg.retrievedCount)) {
    payload.retrievedCount = Math.min(1000, Math.max(0, Math.floor(msg.retrievedCount)));
  }
  if (msg.feedback === 'like' || msg.feedback === 'dislike') {
    payload.feedback = msg.feedback;
  }
  if (typeof msg.error === 'string' && msg.error.length > 0) {
    payload.error = truncate(msg.error, MAX_ERROR_LEN);
  }
  const sanitizedSources = sanitizeSources(msg.sources);
  if (sanitizedSources) {
    payload.sources = sanitizedSources;
  }

  return payload;
}

function toEpochMs(val: unknown): number {
  if (val instanceof Timestamp) {
    return val.toMillis();
  }
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as any).toMillis === 'function') {
    return (val as any).toMillis();
  }
  return Date.now();
}

/**
 * Record a completed Q&A exchange into /chat_sessions/{sessionId}
 * Public visitors can only write validated entries; only verified admins can read or delete.
 */
export async function recordSessionExchange(params: {
  sessionId: string;
  isNewSession: boolean;
  previousMessageCount: number;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}): Promise<void> {
  const sessionId = sanitizeId(params.sessionId, 'sess');
  const sessionPath = `chat_sessions/${sessionId}`;
  const sessionRef = doc(db, 'chat_sessions', sessionId);

  const userPayload = buildMessagePayload(sessionId, params.userMessage);
  const assistantPayload = buildMessagePayload(sessionId, params.assistantMessage);
  const userMsgRef = doc(db, 'chat_sessions', sessionId, 'messages', String(userPayload.id));
  const assistantMsgRef = doc(db, 'chat_sessions', sessionId, 'messages', String(assistantPayload.id));

  const batch = writeBatch(db);
  const newCount = Math.min(10000, params.previousMessageCount + 2);
  const preview = buildPreview(params.assistantMessage.content || params.userMessage.content);

  if (params.isNewSession) {
    batch.set(sessionRef, {
      id: sessionId,
      title: buildSessionTitle(params.userMessage.content),
      messageCount: newCount,
      lastMessagePreview: preview,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.update(sessionRef, {
      messageCount: newCount,
      lastMessagePreview: preview,
      updatedAt: serverTimestamp(),
    });
  }

  batch.set(userMsgRef, userPayload);
  batch.set(assistantMsgRef, assistantPayload);

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, sessionPath);
  }
}

export async function recordMessageFeedback(
  sessionId: string,
  messageId: string,
  feedback: 'like' | 'dislike'
): Promise<void> {
  const safeSessionId = sanitizeId(sessionId, 'sess');
  const safeMsgId = sanitizeId(messageId, 'assistant');
  const msgPath = `chat_sessions/${safeSessionId}/messages/${safeMsgId}`;
  const msgRef = doc(db, 'chat_sessions', safeSessionId, 'messages', safeMsgId);

  try {
    await updateDoc(msgRef, {
      feedback,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, msgPath);
  }
}

/**
 * Admin-only: Subscribe to all recorded visitor chat sessions
 */
export function subscribeToAllSessions(
  onUpdate: (sessions: ChatSessionRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const colPath = 'chat_sessions';
  const q = query(collection(db, colPath));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: ChatSessionRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: String(data.title || '未命名会话'),
          messageCount: typeof data.messageCount === 'number' ? data.messageCount : 0,
          lastMessagePreview: String(data.lastMessagePreview || ''),
          createdAtMs: toEpochMs(data.createdAt),
          updatedAtMs: toEpochMs(data.updatedAt),
        };
      });
      list.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onUpdate(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, colPath);
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  );
}

/**
 * Admin-only: Subscribe to messages of a selected chat session
 */
export function subscribeToSessionMessages(
  sessionId: string,
  onUpdate: (messages: ChatMessage[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const safeSessionId = sanitizeId(sessionId, 'sess');
  const colPath = `chat_sessions/${safeSessionId}/messages`;
  const q = query(collection(db, 'chat_sessions', safeSessionId, 'messages'));

  return onSnapshot(
    q,
    (snapshot) => {
      const msgs: ChatMessage[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          role: data.role === 'user' ? 'user' : 'assistant',
          content: String(data.content || ''),
          timestamp:
            typeof data.clientTimestamp === 'number' ? data.clientTimestamp : toEpochMs(data.createdAt),
          sources: Array.isArray(data.sources) ? (data.sources as CitedSource[]) : undefined,
          error: typeof data.error === 'string' ? data.error : undefined,
          retrievedCount: typeof data.retrievedCount === 'number' ? data.retrievedCount : undefined,
          retrievalMode: data.retrievalMode,
          feedback: data.feedback === 'like' || data.feedback === 'dislike' ? data.feedback : undefined,
          userQuery: typeof data.userQuery === 'string' ? data.userQuery : undefined,
        };
      });
      msgs.sort((a, b) => a.timestamp - b.timestamp);
      onUpdate(msgs);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, colPath);
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  );
}

/**
 * Admin-only: Delete a session and all of its messages
 */
export async function deleteChatSession(sessionId: string): Promise<void> {
  const safeSessionId = sanitizeId(sessionId, 'sess');
  const messagesPath = `chat_sessions/${safeSessionId}/messages`;
  const sessionPath = `chat_sessions/${safeSessionId}`;

  let snapshot;
  try {
    snapshot = await getDocs(collection(db, 'chat_sessions', safeSessionId, 'messages'));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, messagesPath);
  }

  const msgDocs = snapshot.docs;
  for (let i = 0; i < msgDocs.length; i += 400) {
    const chunk = msgDocs.slice(i, i + 400);
    const batch = writeBatch(db);
    for (const d of chunk) {
      batch.delete(d.ref);
    }
    if (i + 400 >= msgDocs.length) {
      batch.delete(doc(db, 'chat_sessions', safeSessionId));
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, sessionPath);
    }
  }

  if (msgDocs.length === 0) {
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'chat_sessions', safeSessionId));
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, sessionPath);
    }
  }
}
