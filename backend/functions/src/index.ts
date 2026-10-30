import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getMessaging } from 'firebase-admin/messaging';

initializeApp();
const db = getFirestore();

function requireParent(request: { auth?: { uid: string } | null }): string {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Zaloguj się jako rodzic.');
  return request.auth.uid;
}

export const ensureFamily = onCall(async (request) => {
  const uid = requireParent(request);
  const userRef = db.doc(`users/${uid}`);
  const existing = await userRef.get();
  if (existing.exists && existing.get('familyId')) return { familyId: existing.get('familyId') };

  const familyRef = db.collection('families').doc();
  const batch = db.batch();
  batch.set(familyRef, {
    name: 'Moja rodzina',
    parentIds: [uid],
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(userRef, {
    familyId: familyRef.id,
    role: 'parent',
    displayName: request.auth?.token.name ?? '',
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return { familyId: familyRef.id };
});

export const createPairingSession = onCall(async (request) => {
  const uid = requireParent(request);
  const user = await db.doc(`users/${uid}`).get();
  if (!user.exists || user.get('role') !== 'parent') throw new HttpsError('permission-denied', 'Brak uprawnień rodzica.');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const sessionId = db.collection('pairingSessions').doc().id;
  const codeHash = createHash('sha256').update(code).digest('hex');
  await db.doc(`pairingSessions/${sessionId}`).set({
    familyId: user.get('familyId'),
    createdBy: uid,
    codeHash,
    status: 'pending',
    expiresAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { sessionId, code, expiresAt: Date.now() + 5 * 60 * 1000 };
});

export const createTvPairingSession = onCall(async (request) => {
  const tvUid = request.auth?.uid;
  if (!tvUid) throw new HttpsError('unauthenticated', 'TV musi być zalogowany anonimowo.');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const sessionId = db.collection('pairingSessions').doc().id;
  const codeHash = createHash('sha256').update(code).digest('hex');
  await db.doc(`pairingSessions/${sessionId}`).set({
    tvUid,
    codeHash,
    status: 'pending',
    expiresAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { sessionId, code, tvUid, expiresAt: Date.now() + 5 * 60 * 1000 };
});

export const claimPairingSession = onCall(async (request) => {
  const uid = requireParent(request);
  const { sessionId, code, deviceName, tvUid } = request.data as Record<string, unknown>;
  if (typeof sessionId !== 'string' || typeof code !== 'string' || typeof tvUid !== 'string') {
    throw new HttpsError('invalid-argument', 'Niepełne dane parowania.');
  }
  const sessionRef = db.doc(`pairingSessions/${sessionId}`);
  const session = await sessionRef.get();
  const data = session.data();
  if (!session.exists || !data || data.status !== 'pending' || data.expiresAt.toMillis() < Date.now()) {
    throw new HttpsError('deadline-exceeded', 'Sesja parowania wygasła.');
  }
  if (createHash('sha256').update(code).digest('hex') !== data.codeHash) {
    throw new HttpsError('permission-denied', 'Niepoprawny kod parowania.');
  }
  if (data.tvUid !== tvUid) throw new HttpsError('permission-denied', 'Sesja nie należy do tego TV.');
  const user = await db.doc(`users/${uid}`).get();
  if (user.get('familyId') !== data.familyId) throw new HttpsError('permission-denied', 'Nieprawidłowa rodzina.');

  const deviceRef = db.collection(`families/${data.familyId}/devices`).doc();
  const batch = db.batch();
  batch.set(deviceRef, {
    name: typeof deviceName === 'string' && deviceName.trim() ? deviceName.trim() : 'Telewizor TCL',
    platform: 'android_tv',
    tvUid,
    isLocked: true,
    remainingSeconds: 0,
    dailyLimitSeconds: 7200,
    usedSecondsToday: 0,
    clockTrusted: true,
    createdAt: FieldValue.serverTimestamp(),
    lastSeenAt: FieldValue.serverTimestamp(),
  });
  batch.update(sessionRef, {
    status: 'claimed',
    claimedBy: uid,
    deviceId: deviceRef.id,
    claimedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { familyId: data.familyId, deviceId: deviceRef.id };
});

export const auditCommand = onDocumentCreated(
  'families/{familyId}/devices/{deviceId}/commands/{commandId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const command = snap.data();
    if (command.status !== 'pending') return;
    await db.doc(`families/${event.params.familyId}/devices/${event.params.deviceId}`).update({
      lastCommandAt: FieldValue.serverTimestamp(),
    });
  },
);

export const notifyParents = onDocumentUpdated(
  'families/{familyId}/devices/{deviceId}',
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    const lockChanged = before.isLocked !== after.isLocked;
    const connectionChanged = Boolean(before.lastSeenAt) !== Boolean(after.lastSeenAt);
    if (!lockChanged && !connectionChanged) return;
    const family = await db.doc(`families/${event.params.familyId}`).get();
    const parentIds = (family.get('parentIds') as string[] | undefined) ?? [];
    const tokens: string[] = [];
    for (const uid of parentIds) {
      const tokenDocs = await db.collection(`users/${uid}/notificationTokens`).get();
      tokenDocs.forEach((doc) => tokens.push(doc.id));
    }
    if (tokens.length === 0) return;
    const title = after.isLocked ? 'Telewizor zablokowany' : 'Telewizor odblokowany';
    const body = after.lockReason === 'time_exhausted' ? 'Dzienny limit czasu został wykorzystany.' : 'Stan telewizora został zmieniony.';
    await getMessaging().sendEachForMulticast({ tokens: tokens.slice(0, 500), notification: { title, body }, data: { deviceId: event.params.deviceId, isLocked: String(after.isLocked) } });
  },
);

export const revokeAnonymousTv = onCall(async (request) => {
  const uid = requireParent(request);
  const { familyId, deviceId } = request.data as Record<string, unknown>;
  const user = await db.doc(`users/${uid}`).get();
  if (!user.exists || user.get('familyId') !== familyId || user.get('role') !== 'parent') {
    throw new HttpsError('permission-denied', 'Brak uprawnień.');
  }
  const device = await db.doc(`families/${familyId}/devices/${deviceId}`).get();
  const tvUid = device.get('tvUid');
  if (typeof tvUid === 'string') await getAuth().revokeRefreshTokens(tvUid);
  await db.doc(`families/${familyId}/devices/${deviceId}`).update({ revokedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

