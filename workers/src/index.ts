import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
}

interface FirestoreDocument {
  name: string;
  fields?: Record<string, unknown>;
  updateTime?: string;
}

interface AuthUser {
  uid: string;
  provider: string;
  claims: JWTPayload;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

let accessTokenCache: { token: string; expiresAt: number; projectId: string } | null = null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
  });
}

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64(input: string): Uint8Array {
  const binary = atob(input);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === "object") {
    return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
  }
  throw new ApiError(400, "Nieobsługiwany typ danych.");
}

function encodeFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]));
}

function decodeValue(value: Record<string, any>): any {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return new Date(value.timestampValue);
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields ?? {});
  return null;
}

function decodeFields(fields: Record<string, any> = {}): Record<string, any> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

function documentName(env: Env, path: string): string {
  return "projects/" + env.FIREBASE_PROJECT_ID + "/databases/(default)/documents/" + path;
}

function firestoreUrl(env: Env, path: string): string {
  return "https://firestore.googleapis.com/v1/" + documentName(env, path);
}

async function getServiceAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (accessTokenCache && accessTokenCache.projectId === env.FIREBASE_PROJECT_ID &&
      accessTokenCache.expiresAt > now + 120) {
    return accessTokenCache.token;
  }

  let serviceAccount: { client_email?: string; private_key?: string; project_id?: string };
  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new ApiError(500, "Sekret konta serwisowego Firebase ma nieprawidłowy format JSON.");
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new ApiError(500, "Konto serwisowe Firebase nie zawiera client_email lub private_key.");
  }
  if (serviceAccount.project_id && serviceAccount.project_id !== env.FIREBASE_PROJECT_ID) {
    throw new ApiError(500, "Konto serwisowe należy do innego projektu Firebase.");
  }

  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + claims;
  const pem = serviceAccount.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    decodeBase64(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsigned),
  ));
  const assertion = unsigned + "." + base64Url(signature);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await response.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !body.access_token) {
    throw new ApiError(502, "Nie udało się uzyskać dostępu do usług Google: " + (body.error ?? response.status));
  }
  accessTokenCache = {
    token: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600),
    projectId: env.FIREBASE_PROJECT_ID,
  };
  return body.access_token;
}

async function firestoreRequest(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const token = await getServiceAccessToken(env);
  const response = await fetch(firestoreUrl(env, path), {
    ...init,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (response.status === 404) return null;
  const raw = await response.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) {
    console.error("Firestore REST error", response.status, data?.error?.status);
    throw new ApiError(response.status === 409 || response.status === 412 ? 409 : 502,
      "Operacja Firestore nie powiodła się.");
  }
  return data;
}

async function getDocument(env: Env, path: string): Promise<{ data: Record<string, any>; updateTime?: string; name: string } | null> {
  const doc = await firestoreRequest(env, path) as FirestoreDocument | null;
  if (!doc) return null;
  return { data: decodeFields((doc.fields ?? {}) as Record<string, any>), updateTime: doc.updateTime, name: doc.name };
}

async function listDocuments(env: Env, collectionPath: string): Promise<FirestoreDocument[]> {
  const token = await getServiceAccessToken(env);
  const url = firestoreUrl(env, collectionPath) + "?pageSize=1000";
  const response = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!response.ok) return [];
  const body = await response.json() as { documents?: FirestoreDocument[] };
  return body.documents ?? [];
}

async function commit(env: Env, writes: Record<string, unknown>[]): Promise<void> {
  const token = await getServiceAccessToken(env);
  const response = await fetch(
    "https://firestore.googleapis.com/v1/projects/" + env.FIREBASE_PROJECT_ID +
      "/databases/(default)/documents:commit",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ writes }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    console.error("Firestore commit failed", response.status, body.slice(0, 500));
    throw new ApiError(response.status === 409 || response.status === 412 ? 409 : 502,
      "Nie udało się zapisać danych w Firestore.");
  }
}

function updateWrite(env: Env, path: string, fields: Record<string, unknown>, updateTime?: string): Record<string, unknown> {
  const write: Record<string, unknown> = {
    update: { name: documentName(env, path), fields: encodeFields(fields) },
    updateMask: { fieldPaths: Object.keys(fields) },
  };
  if (updateTime) write.currentDocument = { updateTime };
  return write;
}

function createWrite(env: Env, path: string, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    update: { name: documentName(env, path), fields: encodeFields(fields) },
    updateMask: { fieldPaths: Object.keys(fields) },
    currentDocument: { exists: false },
  };
}

async function authenticate(request: Request, env: Env): Promise<AuthUser> {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new ApiError(401, "Brak tokenu logowania Firebase.");
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(match[1], FIREBASE_JWKS, {
      issuer: "https://securetoken.google.com/" + env.FIREBASE_PROJECT_ID,
      audience: env.FIREBASE_PROJECT_ID,
      algorithms: ["RS256"],
    });
    payload = result.payload;
  } catch {
    throw new ApiError(401, "Token Firebase jest nieprawidłowy lub wygasł.");
  }
  const uid = payload.sub;
  const authTime = payload.auth_time;
  const firebaseClaims = payload.firebase as Record<string, unknown> | undefined;
  const provider = firebaseClaims?.sign_in_provider;
  if (!uid || typeof authTime !== "number" || authTime > Date.now() / 1000 ||
      typeof provider !== "string") {
    throw new ApiError(401, "Token Firebase nie zawiera wymaganych danych.");
  }
  return { uid, provider, claims: payload };
}

async function requireParent(request: Request, env: Env): Promise<{ auth: AuthUser; familyId: string; user: Record<string, any> }> {
  const auth = await authenticate(request, env);
  if (auth.provider === "anonymous") throw new ApiError(403, "Konto telewizora nie może wykonywać operacji rodzica.");
  const profile = await getDocument(env, "users/" + auth.uid);
  const familyId = profile?.data.familyId;
  if (!profile || profile.data.role !== "parent" || typeof familyId !== "string" || !familyId) {
    throw new ApiError(403, "Konto nie ma aktywnego profilu rodzica.");
  }
  return { auth, familyId, user: profile.data };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "Nieprawidłowe pole: " + name + ".");
  return value.trim();
}

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function ensureFamily(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth.provider === "anonymous") throw new ApiError(403, "Konto anonimowe TV nie może tworzyć rodziny rodzica.");
  const userPath = "users/" + auth.uid;
  const existing = await getDocument(env, userPath);
  if (existing) {
    if (existing.data.role !== "parent") throw new ApiError(403, "To konto nie ma roli rodzica.");
    if (typeof existing.data.familyId === "string" && existing.data.familyId) {
      return json({ familyId: existing.data.familyId });
    }
  }

  const familyId = randomId();
  const now = new Date();
  const family = {
    name: "Moja rodzina",
    parentIds: [auth.uid],
    createdAt: now,
  };
  const profile = {
    familyId,
    role: "parent",
    displayName: typeof auth.claims.name === "string" ? auth.claims.name : "",
    createdAt: existing?.data.createdAt ?? now,
  };
  try {
    const profileWrite = existing
      ? updateWrite(env, userPath, profile, existing.updateTime)
      : createWrite(env, userPath, profile);
    await commit(env, [
      createWrite(env, "families/" + familyId, family),
      profileWrite,
    ]);
    return json({ familyId });
  } catch (error) {
    const latest = await getDocument(env, userPath);
    if (latest?.data.role === "parent" && typeof latest.data.familyId === "string") {
      return json({ familyId: latest.data.familyId });
    }
    throw error;
  }
}

async function createTvPairingSession(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth.provider !== "anonymous") throw new ApiError(403, "Sesję parowania może utworzyć tylko konto TV.");
  const random = new Uint32Array(1);
  let number = 0;
  do {
    crypto.getRandomValues(random);
    number = random[0] % 900000;
  } while (number < 0);
  const code = String(100000 + number);
  const sessionId = randomId();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await commit(env, [createWrite(env, "pairingSessions/" + sessionId, {
    tvUid: auth.uid,
    codeHash: await sha256(code),
    failedAttempts: 0,
    status: "pending",
    expiresAt,
    createdAt: new Date(),
  })]);
  return json({ sessionId, code, tvUid: auth.uid, expiresAt: expiresAt.getTime() });
}

async function claimPairingSession(request: Request, env: Env, body: Record<string, any>): Promise<Response> {
  const { auth, familyId } = await requireParent(request, env);
  const sessionId = requireString(body.sessionId, "sessionId");
  const code = requireString(body.code, "code");
  const tvUid = requireString(body.tvUid, "tvUid");
  const name = typeof body.deviceName === "string" && body.deviceName.trim()
    ? body.deviceName.trim().slice(0, 60) : "Telewizor TCL";
  if (!/^\d{6}$/.test(code)) throw new ApiError(400, "Kod parowania musi mieć 6 cyfr.");

  const sessionPath = "pairingSessions/" + sessionId;
  const session = await getDocument(env, sessionPath);
  if (!session || session.data.status !== "pending") throw new ApiError(404, "Sesja parowania nie istnieje lub została już użyta.");
  if (!(session.data.expiresAt instanceof Date) || session.data.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(410, "Kod parowania wygasł.");
  }
  if (session.data.tvUid !== tvUid) throw new ApiError(403, "Kod nie należy do tego telewizora.");
  const attempts = Number(session.data.failedAttempts ?? 0);
  if (attempts >= 5) throw new ApiError(429, "Zbyt wiele błędnych prób. Wygeneruj nowy kod na TV.");

  const submittedHash = await sha256(code);
  if (!constantTimeEqual(submittedHash, String(session.data.codeHash ?? ""))) {
    await commit(env, [updateWrite(env, sessionPath, { failedAttempts: attempts + 1 }, session.updateTime)]);
    throw new ApiError(403, "Niepoprawny kod parowania.");
  }

  const deviceId = randomId();
  const devicePath = "families/" + familyId + "/devices/" + deviceId;
  const now = new Date();
  await commit(env, [
    createWrite(env, devicePath, {
      name,
      platform: "android_tv",
      tvUid,
      isLocked: true,
      remainingSeconds: 0,
      sessionEndServerMillis: 0,
      dailyLimitSeconds: 7200,
      usedSecondsToday: 0,
      lockReason: "initial",
      lastNotifiedIsLocked: true,
      createdAt: now,
      lastSeenAt: now,
      lastSyncAt: now,
    }),
    updateWrite(env, sessionPath, {
      status: "claimed",
      familyId,
      deviceId,
      claimedBy: auth.uid,
      claimedAt: now,
    }, session.updateTime),
  ]);
  return json({ familyId, deviceId });
}

async function sendCommand(request: Request, env: Env, body: Record<string, any>): Promise<Response> {
  const { auth, familyId } = await requireParent(request, env);
  const requestedFamily = requireString(body.familyId, "familyId");
  const deviceId = requireString(body.deviceId, "deviceId");
  const type = requireString(body.type, "type");
  if (requestedFamily !== familyId) throw new ApiError(403, "Urządzenie nie należy do tej rodziny.");

  const allowed = ["lock", "unlock", "add_time", "set_limit", "reset_day", "set_pin"];
  if (!allowed.includes(type)) throw new ApiError(400, "Nieobsługiwany typ polecenia.");
  const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
    ? body.payload as Record<string, unknown> : {};
  if (type === "add_time" || type === "set_limit") {
    const seconds = payload.seconds;
    if (!Number.isInteger(seconds) || (seconds as number) < (type === "add_time" ? 1 : 0) || (seconds as number) > 86400) {
      throw new ApiError(400, "Liczba sekund musi mieścić się w dozwolonym zakresie.");
    }
  }
  if (type === "set_pin" &&
      (typeof payload.salt !== "string" || typeof payload.verifier !== "string")) {
    throw new ApiError(400, "Nieprawidłowe dane PIN-u.");
  }

  const devicePath = "families/" + familyId + "/devices/" + deviceId;
  const device = await getDocument(env, devicePath);
  if (!device) throw new ApiError(404, "Nie znaleziono telewizora.");
  if (device.data.revokedAt) throw new ApiError(403, "To urządzenie zostało odłączone.");

  const commandId = randomId();
  const now = new Date();
  await commit(env, [
    createWrite(env, devicePath + "/commands/" + commandId, {
      commandId,
      type,
      payload,
      createdBy: auth.uid,
      createdAt: now,
      status: "pending",
    }),
    updateWrite(env, devicePath, { lastCommandAt: now }, device.updateTime),
  ]);
  return json({ ok: true, commandId });
}

async function notifyParentsForDevice(env: Env, familyId: string, deviceId: string): Promise<void> {
  const devicePath = "families/" + familyId + "/devices/" + deviceId;
  const device = await getDocument(env, devicePath);
  if (!device || typeof device.data.isLocked !== "boolean") return;
  const locked = device.data.isLocked as boolean;
  if (device.data.lastNotifiedIsLocked === locked) return;

  await commit(env, [updateWrite(env, devicePath, {
    lastNotifiedIsLocked: locked,
    lastStateNotificationAt: new Date(),
  }, device.updateTime)]);

  const family = await getDocument(env, "families/" + familyId);
  const parentIds = Array.isArray(family?.data.parentIds) ? family?.data.parentIds as string[] : [];
  const tokens: string[] = [];
  for (const parentId of parentIds.slice(0, 20)) {
    const tokenDocs = await listDocuments(env, "users/" + parentId + "/notificationTokens");
    for (const tokenDoc of tokenDocs) {
      const value = decodeFields(tokenDoc.fields ?? {}).token;
      if (typeof value === "string" && value) tokens.push(value);
    }
  }
  if (!tokens.length) return;

  const accessToken = await getServiceAccessToken(env);
  const title = locked ? "Telewizor zablokowany" : "Telewizor odblokowany";
  const body = device.data.lockReason === "time_exhausted"
    ? "Limit czasu został wykorzystany."
    : "Stan telewizora został zmieniony.";
  const endpoint = "https://fcm.googleapis.com/v1/projects/" + env.FIREBASE_PROJECT_ID + "/messages:send";
  for (let i = 0; i < Math.min(tokens.length, 500); i += 20) {
    const batch = tokens.slice(i, i + 20);
    await Promise.all(batch.map(async (token) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            data: { deviceId, isLocked: String(locked) },
          },
        }),
      });
      if (!response.ok) console.error("FCM send failed", response.status);
    }));
  }
}

async function reportDeviceState(request: Request, env: Env, body: Record<string, any>): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth.provider !== "anonymous") throw new ApiError(403, "Zgłoszenie stanu może wysłać tylko TV.");
  const familyId = requireString(body.familyId, "familyId");
  const deviceId = requireString(body.deviceId, "deviceId");
  const device = await getDocument(env, "families/" + familyId + "/devices/" + deviceId);
  if (!device || device.data.tvUid !== auth.uid) throw new ApiError(403, "To urządzenie nie jest przypisane do tego telewizora.");
  await notifyParentsForDevice(env, familyId, deviceId);
  return json({ ok: true });
}

async function revokeTv(request: Request, env: Env, body: Record<string, any>): Promise<Response> {
  const { familyId } = await requireParent(request, env);
  const requestedFamily = requireString(body.familyId, "familyId");
  const deviceId = requireString(body.deviceId, "deviceId");
  if (requestedFamily !== familyId) throw new ApiError(403, "Urządzenie nie należy do tej rodziny.");
  const path = "families/" + familyId + "/devices/" + deviceId;
  const device = await getDocument(env, path);
  if (!device) throw new ApiError(404, "Nie znaleziono urządzenia.");
  await commit(env, [updateWrite(env, path, {
    revokedAt: new Date(),
    isLocked: true,
    lockReason: "revoked",
  }, device.updateTime)]);
  await notifyParentsForDevice(env, familyId, deviceId);
  return json({ ok: true });
}

async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Użyj metody POST." }, 405);
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/+|\/+$/g, "").replace(/^api\/?/, "");
  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (declaredLength > 32_000) return json({ error: "Żądanie jest zbyt duże." }, 413);
  let body: Record<string, any> = {};
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("body");
    body = parsed as Record<string, any>;
  } catch {
    return json({ error: "Nieprawidłowy JSON." }, 400);
  }

  try {
    switch (route) {
      case "ensure-family":
        return await ensureFamily(request, env);
      case "server-time":
        await authenticate(request, env);
        return json({ serverTimeMillis: Date.now() });
      case "tv/pairing-session":
        return await createTvPairingSession(request, env);
      case "pairing/claim":
        return await claimPairingSession(request, env, body);
      case "commands":
        return await sendCommand(request, env, body);
      case "tv/device-state":
        return await reportDeviceState(request, env, body);
      case "tv/revoke":
        return await revokeTv(request, env, body);
      default:
        return json({ error: "Nie znaleziono endpointu." }, 404);
    }
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    console.error("Unhandled Worker error", error);
    return json({ error: "Wewnętrzny błąd backendu." }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
