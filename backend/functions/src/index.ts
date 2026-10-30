import { randomInt, createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getMessaging } from 'firebase-admin/messaging';

initializeApp();
const db = getFirestore();
const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS = 5;

function requireUid(request: { auth?: { uid: string } | null }): string {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Zaloguj się.');
  return request.auth.uid;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', 'Nieprawidłowe pole: ' + field + '.');
  }
  return value.trim();
}

/** Tworzy profil rodzica i rodzinę atomowo; klient nie może sam nadać sobie roli. */
export const ensureFamily = onCall(async (request) => {
  const uid = requireUid(request);
  const provider = request.auth?.token.firebase?.sign_in_provider;
  if (provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'Konto anonimowe TV nie może tworzyć rodziny rodzica.');
  }
  const userRef = db.doc('users/' + uid);

  return db.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    if (user.exists) {
      if (user.get('role') !== 'parent') {
        throw new HttpsError('permission-denied', 'To konto nie ma roli rodzica.');
      }
      const familyId = user.get('familyId');
      if (typeof familyId === 'string' && familyId.length > 0) return { familyId };
    }

    const familyRef = db.collection('families').doc();
    tx.create(familyRef, {
      name: 'Moja rodzina',
      parentIds: [uid],
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(userRef, {
      familyId: familyRef.id,
      role: 'parent',
      displayName: request.auth?.token.name ?? '',
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { familyId: familyRef.id };
  });
});

/** Wywoływane przez TV zalogowany anonimowo. Kod parowania jest haszowany w bazie. */
export const createTvPairingSession = onCall(async (request) => {
  const tvUid = request.auth?.uid;
  if (!tvUid) throw new HttpsError('unauthenticated', 'Telewizor musi być zalogowany anonimowo.');

  const code = String(randomInt(100000, 1000000));
  const sessionRef = db.collection('pairingSessions').doc();
  const codeHash = createHash('sha256').update(code).digest('hex');
  const expiresAt = Date.now() + PAIRING_TTL_MS;

  await sessionRef.create({
    tvUid,
    codeHash,
    failedAttempts: 0,
    status: 'pending',
    expiresAt: Timestamp.fromMillis(expiresAt),
    createdAt: FieldValue.serverTimestamp(),
  });

  return { sessionId: sessionRef.id, code, tvUid, expiresAt };
});

/**
 * Rodzic przejmuje sesję TV. familyId pochodzi wyłącznie z users/{uid},
 * a claim oraz utworzenie urządzenia są jedną transakcją.
 */
export const claimPairingSession = onCall(async (request) => {
  const uid = requireUid(request);
  const sessionId = requireString(request.data?.sessionId, 'sessionId');
  const code = requireString(request.data?.code, 'code');
  const tvUid = requireString(request.data?.tvUid, 'tvUid');
  const nameRaw = typeof request.data?.deviceName === 'string' ? request.data.deviceName.trim() : '';
  const deviceName = (nameRaw || 'Telewizor TCL').slice(0, 60);

  if (!/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'Kod parowania musi mieć 6 cyfr.');
  }

  const userRef = db.doc('users/' + uid);
  const sessionRef = db.doc('pairingSessions/' + sessionId);
  const deviceId = db.collection('families').doc().id;

  const result = await db.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    const session = await tx.get(sessionRef);

    if (!user.exists || user.get('role') !== 'parent' || typeof user.get('familyId') !== 'string') {
      return { error: 'parent-profile' as const };
    }
    if (!session.exists || session.get('status') !== 'pending') return { error: 'session' as const };

    const expiresAt = session.get('expiresAt') as Timestamp | undefined;
    if (!expiresAt || expiresAt.toMillis() <= Date.now()) return { error: 'expired' as const };
    if (session.get('tvUid') !== tvUid) return { error: 'tv-mismatch' as const };

    const failedAttempts = Number(session.get('failedAttempts') ?? 0);
    if (failedAttempts >= MAX_PAIRING_ATTEMPTS) return { error: 'locked' as const };

    const submittedHash = createHash('sha256').update(code).digest('hex');
    if (submittedHash !== session.get('codeHash')) {
      tx.update(sessionRef, { failedAttempts: failedAttempts + 1 });
      return { error: 'code' as const };
    }

    const familyId = user.get('familyId') as string;
    const deviceRef = db.doc('families/' + familyId + '/devices/' + deviceId);
    tx.create(deviceRef, {
      name: deviceName,
      platform: 'android_tv',
      tvUid,
      isLocked: true,
      remainingSeconds: 0,
      sessionEndServerMillis: 0,
      dailyLimitSeconds: 7200,
      usedSecondsToday: 0,
      lockReason: 'initial',
      createdAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
      lastSyncAt: FieldValue.serverTimestamp(),
    });
    tx.update(sessionRef, {
      status: 'claimed',
      familyId,
      deviceId,
      claimedBy: uid,
      claimedAt: FieldValue.serverTimestamp(),
    });
    return { familyId, deviceId };
  });

  if ('error' in result) {
    switch (result.error) {
      case 'parent-profile':
        throw new HttpsError('permission-denied', 'Brak profilu rodzica. Zaloguj się ponownie.');
      case 'expired':
        throw new HttpsError('deadline-exceeded', 'Kod parowania wygasł.');
      case 'locked':
        throw new HttpsError('resource-exhausted', 'Zbyt wiele błędnych prób. Wygeneruj nowy kod na TV.');
      case 'code':
        throw new HttpsError('permission-denied', 'Niepoprawny kod parowania.');
      case 'tv-mismatch':
        throw new HttpsError('permission-denied', 'Kod nie należy do tego telewizora.');
      default:
        throw new HttpsError('not-found', 'Sesja parowania nie istnieje lub została już użyta.');
    }
  }
  return result;
});

export const auditCommand = onDocumentCreated(
  'families/{familyId}/devices/{deviceId}/commands/{commandId}',
  async (event) => {
    const snap = event.data;
    if (!snap || snap.get('status') !== 'pending') return;
    await db.doc('families/' + event.params.familyId + '/devices/' + event.params.deviceId)
      .update({ lastCommandAt: FieldValue.serverTimestamp() });
  },
);

/** Powiadomienia tylko po zmianie blokady, nie przy każdym heartbeat TV. */
export const notifyParents = onDocumentUpdated(
  'families/{familyId}/devices/{deviceId}',
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.isLocked === after.isLocked) return;

    const family = await db.doc('families/' + event.params.familyId).get();
    const parentIds = (family.get('parentIds') as string[] | undefined) ?? [];
    const tokens: string[] = [];
    for (const parentId of parentIds) {
      const tokenDocs = await db.collection('users/' + parentId + '/notificationTokens').get();
      tokenDocs.forEach((doc) => tokens.push(doc.id));
    }
    if (!tokens.length) return;

    const locked = after.isLocked === true;
    await getMessaging().sendEachForMulticast({
      tokens: tokens.slice(0, 500),
      notification: {
        title: locked ? 'Telewizor zablokowany' : 'Telewizor odblokowany',
        body: after.lockReason === 'time_exhausted'
          ? 'Limit czasu został wykorzystany.'
          : 'Stan telewizora został zmieniony.',
      },
      data: { deviceId: event.params.deviceId, isLocked: String(locked) },
    });
  },
);

export const revokeAnonymousTv = onCall(async (request) => {
  const uid = requireUid(request);
  const familyId = requireString(request.data?.familyId, 'familyId');
  const deviceId = requireString(request.data?.deviceId, 'deviceId');
  const user = await db.doc('users/' + uid).get();

  if (!user.exists || user.get('role') !== 'parent' || user.get('familyId') !== familyId) {
    throw new HttpsError('permission-denied', 'Brak uprawnień do tej rodziny.');
  }

  const deviceRef = db.doc('families/' + familyId + '/devices/' + deviceId);
  const device = await deviceRef.get();
  if (!device.exists) throw new HttpsError('not-found', 'Nie znaleziono urządzenia.');
  const tvUid = device.get('tvUid');

  await deviceRef.update({
    revokedAt: FieldValue.serverTimestamp(),
    isLocked: true,
    lockReason: 'revoked',
  });
  if (typeof tvUid === 'string') {
    try {
      await getAuth().revokeRefreshTokens(tvUid);
    } catch {
      // revokedAt w Firestore pozostaje źródłem prawdy, nawet jeśli konto Auth nie istnieje.
    }
  }
  return { ok: true };
});
