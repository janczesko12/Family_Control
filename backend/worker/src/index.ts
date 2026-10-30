interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
}

type Json = Record<string, any>;

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface FirebaseClaims extends Json {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  auth_time: number;
  firebase?: { sign_in_provider?: string };
}

let cachedJwks: { keys: Json[]; expiresAt: number } | null = null;
let cachedGoogleToken: { token: string; expiresAt: number } | null = null;

const encoder = new TextEncoder();
const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function jsonResponse(data: Json, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Authorization, Content-Type",
    },
  });
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) output[i] = binary.charCodeAt(i);
  return output;
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < value.length; i++) binary += String.fromCharCode(value[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function parseJwtPart<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

async function getFirebaseKeys(): Promise<Json[]> {
  if (cachedJwks && cachedJwks.expiresAt > Date.now()) return cachedJwks.keys;
  const response = await fetch(FIREBASE_JWKS_URL);
  if (!response.ok) throw new ApiError(503, "auth_keys_unavailable", "Nie można zweryfikować tokenu Firebase.");
  const body = await response.json() as { keys?: Json[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new ApiError(503, "auth_keys_unavailable", "Nie można pobrać kluczy Firebase.");
  }
  const cacheControl = response.headers.get("cache-control") ?? "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] ?? 3600);
  cachedJwks = { keys: body.keys, expiresAt: Date.now() + Math.max(60, maxAge) * 1000 };
  return body.keys;
}

async function verifyFirebaseToken(request: Request, env: Env): Promise<FirebaseClaims> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new ApiError(401, "unauthenticated", "Brak tokenu logowania.");
  }
  const token = authorization.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) throw new ApiError(401, "invalid_token", "Nieprawidłowy token Firebase.");

  let header: Json;
  let claims: FirebaseClaims;
  try {
    header = parseJwtPart<Json>(parts[0]);
    claims = parseJwtPart<FirebaseClaims>(parts[1]);
  } catch {
    throw new ApiError(401, "invalid_token", "Nieprawidłowy token Firebase.");
  }

  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new ApiError(401, "invalid_token", "Nieobsługiwany token Firebase.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    claims.aud !== env.FIREBASE_PROJECT_ID ||
    claims.iss !== "https://securetoken.google.com/" + env.FIREBASE_PROJECT_ID ||
    typeof claims.sub !== "string" || claims.sub.length === 0 || claims.sub.length > 128 ||
    typeof claims.exp !== "number" || claims.exp <= now ||
    typeof claims.iat !== "number" || claims.iat > now + 300 ||
    typeof claims.auth_time !== "number" || claims.auth_time > now + 300
  ) {
    throw new ApiError(401, "invalid_token", "Token Firebase wygasł lub ma nieprawidłowe dane.");
  }

  const jwk = (await getFirebaseKeys()).find((key) => key.kid === header.kid);
  if (!jwk) throw new ApiError(401, "invalid_token", "Nieznany klucz podpisujący token Firebase.");

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    decodeBase64Url(parts[2]),
    encoder.encode(parts[0] + "." + parts[1]),
  );
  if (!valid) throw new ApiError(401, "invalid_token", "Podpis tokenu Firebase jest nieprawidłowy.");
  return claims;
}

function pemToBytes(pem: string): Uint8Array {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getGoogleAccessToken(env: Env): Promise<string> {
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > Date.now() + 60_000) {
    return cachedGoogleToken.token;
  }
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new ApiError(503, "worker_not_configured", "Brakuje konfiguracji konta usługi Firebase.");
  }

  let serviceAccount: Json;
  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new ApiError(503, "worker_not_configured", "Konfiguracja konta usługi Firebase nie jest poprawnym JSON-em.");
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new ApiError(503, "worker_not_configured", "Konto usługi Firebase nie zawiera wymaganych danych.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = encodeBase64Url(encoder.encode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: FIRESTORE_SCOPE + " " + FCM_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })));
  const signingInput = header + "." + payload;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(String(serviceAccount.private_key)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, encoder.encode(signingInput));
  const assertion = signingInput + "." + encodeBase64Url(new Uint8Array(signature));

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const result = await response.json() as { access_token?: string; expires_in?: number };
  if (!response.ok || !result.access_token) {
    throw new ApiError(502, "google_auth_failed", "Google nie wydał tokenu dostępu dla Workera.");
  }
  cachedGoogleToken = {
    token: result.access_token,
    expiresAt: Date.now() + Number(result.expires_in ?? 3600) * 1000,
  };
  return result.access_token;
}

function encodeValue(value: any): Json {
  if (value === null || value === undefined) return { nullValue: "NULL_VALUE" };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value) } };
  throw new Error("Nieobsługiwany typ pola Firestore.");
}

function encodeFields(fields: Json): Json {
  const result: Json = {};
  for (const [key, value] of Object.entries(fields)) result[key] = encodeValue(value);
  return result;
}

function decodeValue(value: Json): any {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return new Date(value.timestampValue);
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields ?? {});
  return null;
}

function decodeFields(fields: Json): Json {
  const result: Json = {};
  for (const [key, value] of Object.entries(fields ?? {})) result[key] = decodeValue(value as Json);
  return result;
}

function documentName(projectId: string, path: string): string {
  return "projects/" + projectId + "/databases/(default)/documents/" + path;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

class FirestoreRest {
  private root: string;
  constructor(private env: Env) {
    this.root = "https://firestore.googleapis.com/v1/projects/" +
      env.FIREBASE_PROJECT_ID + "/databases/(default)/documents";
  }

  private async call(url: string, method = "GET", body?: Json): Promise<any> {
    const accessToken = await getGoogleAccessToken(this.env);
    const response = await fetch(url, {
      method,
      headers: {
        authorization: "Bearer " + accessToken,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new ApiError(
        response.status >= 500 ? 502 : response.status,
        "firestore_error",
        "Operacja Firestore nie powiodła się (" + response.status + ").",
      );
    }
    return parsed;
  }

  async get(path: string, transaction?: string): Promise<{ fields: Json; name: string } | null> {
    const url = new URL(this.root + "/" + encodePath(path));
    if (transaction) url.searchParams.set("transaction", transaction);
    const result = await this.call(url.toString());
    if (!result) return null;
    return { fields: decodeFields(result.fields ?? {}), name: result.name };
  }

  async list(path: string, pageSize = 500): Promise<Array<{ fields: Json; name: string }>> {
    const url = new URL(this.root + "/" + encodePath(path));
    url.searchParams.set("pageSize", String(pageSize));
    const result = await this.call(url.toString());
    return (result?.documents ?? []).map((doc: Json) => ({
      fields: decodeFields(doc.fields ?? {}),
      name: doc.name,
    }));
  }

  async beginTransaction(): Promise<string> {
    const result = await this.call(this.root + ":beginTransaction", "POST", {});
    if (!result?.transaction) throw new ApiError(502, "transaction_failed", "Nie udało się rozpocząć transakcji Firestore.");
    return result.transaction;
  }

  async commit(writes: Json[], transaction?: string): Promise<void> {
    await this.call(this.root + ":commit", "POST", {
      writes,
      ...(transaction ? { transaction } : {}),
    });
  }

  async rollback(transaction: string): Promise<void> {
    await this.call(this.root + ":rollback", "POST", { transaction });
  }

  makeCreate(path: string, fields: Json, timestamps: string[] = []): Json {
    return {
      update: { name: documentName(this.env.FIREBASE_PROJECT_ID, path), fields: encodeFields(fields) },
      currentDocument: { exists: false },
      ...(timestamps.length ? {
        updateTransforms: timestamps.map((fieldPath) => ({
          fieldPath,
          setToServerValue: "REQUEST_TIME",
        })),
      } : {}),
    };
  }

  makeUpdate(path: string, fields: Json, timestamps: string[] = []): Json {
    return {
      update: { name: documentName(this.env.FIREBASE_PROJECT_ID, path), fields: encodeFields(fields) },
      updateMask: { fieldPaths: Object.keys(fields) },
      ...(timestamps.length ? {
        updateTransforms: timestamps.map((fieldPath) => ({
          fieldPath,
          setToServerValue: "REQUEST_TIME",
        })),
      } : {}),
    };
  }
}

function randomDocumentId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function requireParent(claims: FirebaseClaims): void {
  if (claims.firebase?.sign_in_provider === "anonymous") {
    throw new ApiError(403, "permission-denied", "Konto anonimowe TV nie może wykonać tej operacji.");
  }
}

async function ensureFamily(db: FirestoreRest, claims: FirebaseClaims): Promise<Json> {
  requireParent(claims);
  const transaction = await db.beginTransaction();
  try {
    const user = await db.get("users/" + claims.sub, transaction);
    if (user) {
      if (user.fields.role !== "parent") {
        throw new ApiError(403, "permission-denied", "To konto nie ma roli rodzica.");
      }
      if (typeof user.fields.familyId === "string" && user.fields.familyId.length > 0) {
        await db.rollback(transaction);
        return { familyId: user.fields.familyId };
      }
    }

    const familyId = randomDocumentId();
    const userFields: Json = {
      familyId,
      role: "parent",
      displayName: typeof (claims as Json).name === "string" ? (claims as Json).name : "",
    };
    const writes = [
      db.makeCreate("families/" + familyId, {
        name: "Moja rodzina",
        parentIds: [claims.sub],
      }, ["createdAt"]),
      user
        ? db.makeUpdate("users/" + claims.sub, { ...userFields }, ["createdAt"])
        : db.makeCreate("users/" + claims.sub, userFields, ["createdAt"]),
    ];
    await db.commit(writes, transaction);
    return { familyId };
  } catch (error) {
    try { await db.rollback(transaction); } catch { /* transakcja mogła zostać zakończona */ }
    throw error;
  }
}

async function getServerTime(): Promise<Json> {
  return { serverTimeMillis: Date.now() };
}

async function createTvPairingSession(db: FirestoreRest, claims: FirebaseClaims): Promise<Json> {
  if (claims.firebase?.sign_in_provider !== "anonymous") {
    throw new ApiError(403, "permission-denied", "Telewizor musi być zalogowany anonimowo.");
  }
  const random = crypto.getRandomValues(new Uint32Array(1))[0];
  const code = String(100000 + (random % 900000));
  const sessionId = randomDocumentId();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const codeHash = await sha256(code);

  await db.commit([
    db.makeCreate("pairingSessions/" + sessionId, {
      tvUid: claims.sub,
      codeHash,
      failedAttempts: 0,
      status: "pending",
      expiresAt: new Date(expiresAt),
    }, ["createdAt"]),
  ]);
  return { sessionId, code, tvUid: claims.sub, expiresAt };
}

async function claimPairingSession(db: FirestoreRest, claims: FirebaseClaims, body: Json): Promise<Json> {
  requireParent(claims);
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const tvUid = typeof body.tvUid === "string" ? body.tvUid.trim() : "";
  const deviceName = (typeof body.deviceName === "string" ? body.deviceName.trim() : "Telewizor TCL")
    .slice(0, 60) || "Telewizor TCL";
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(sessionId) || !/^\d{6}$/.test(code) || !tvUid) {
    throw new ApiError(400, "invalid-argument", "Nieprawidłowe dane parowania.");
  }

  const transaction = await db.beginTransaction();
  try {
    const user = await db.get("users/" + claims.sub, transaction);
    const session = await db.get("pairingSessions/" + sessionId, transaction);
    if (!user || user.fields.role !== "parent" || typeof user.fields.familyId !== "string") {
      throw new ApiError(403, "permission-denied", "Brak profilu rodzica. Zaloguj się ponownie.");
    }
    if (!session || session.fields.status !== "pending") {
      throw new ApiError(404, "not-found", "Sesja parowania nie istnieje lub została już użyta.");
    }
    const expiresAt = session.fields.expiresAt instanceof Date ? session.fields.expiresAt.getTime() : 0;
    if (expiresAt <= Date.now()) throw new ApiError(410, "deadline-exceeded", "Kod parowania wygasł.");
    if (session.fields.tvUid !== tvUid) throw new ApiError(403, "permission-denied", "Kod nie należy do tego telewizora.");

    const failedAttempts = Number(session.fields.failedAttempts ?? 0);
    if (failedAttempts >= 5) {
      throw new ApiError(429, "resource-exhausted", "Zbyt wiele błędnych prób. Wygeneruj nowy kod na TV.");
    }
    const submittedHash = await sha256(code);
    if (!constantTimeEqual(submittedHash, String(session.fields.codeHash ?? ""))) {
      await db.commit([
        db.makeUpdate("pairingSessions/" + sessionId, { failedAttempts: failedAttempts + 1 }),
      ], transaction);
      throw new ApiError(403, "permission-denied", "Niepoprawny kod parowania.");
    }

    const familyId = user.fields.familyId as string;
    const deviceId = randomDocumentId();
    const devicePath = "families/" + familyId + "/devices/" + deviceId;
    await db.commit([
      db.makeCreate(devicePath, {
        name: deviceName,
        platform: "android_tv",
        tvUid,
        isLocked: true,
        remainingSeconds: 0,
        sessionEndServerMillis: 0,
        dailyLimitSeconds: 7200,
        usedSecondsToday: 0,
        lockReason: "initial",
      }, ["createdAt", "lastSeenAt", "lastSyncAt"]),
      db.makeUpdate("pairingSessions/" + sessionId, {
        status: "claimed",
        familyId,
        deviceId,
        claimedBy: claims.sub,
      }, ["claimedAt"]),
    ], transaction);
    return { familyId, deviceId };
  } catch (error) {
    try { await db.rollback(transaction); } catch { /* transakcja mogła zostać zakończona */ }
    throw error;
  }
}

async function revokeAnonymousTv(db: FirestoreRest, claims: FirebaseClaims, body: Json): Promise<Json> {
  requireParent(claims);
  const familyId = typeof body.familyId === "string" ? body.familyId.trim() : "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  if (!familyId || !deviceId) throw new ApiError(400, "invalid-argument", "Brak identyfikatora rodziny lub TV.");

  const user = await db.get("users/" + claims.sub);
  if (!user || user.fields.role !== "parent" || user.fields.familyId !== familyId) {
    throw new ApiError(403, "permission-denied", "Brak uprawnień do tej rodziny.");
  }
  const device = await db.get("families/" + familyId + "/devices/" + deviceId);
  if (!device) throw new ApiError(404, "not-found", "Nie znaleziono urządzenia.");
  await db.commit([
    db.makeUpdate("families/" + familyId + "/devices/" + deviceId, {
      isLocked: true,
      lockReason: "revoked",
    }, ["revokedAt"]),
  ]);
  return { ok: true };
}

async function notifyParents(
  db: FirestoreRest,
  env: Env,
  claims: FirebaseClaims,
  body: Json,
): Promise<Json> {
  if (claims.firebase?.sign_in_provider !== "anonymous") {
    throw new ApiError(403, "permission-denied", "Powiadomienia o stanie TV może wysyłać tylko konto telewizora.");
  }
  const familyId = typeof body.familyId === "string" ? body.familyId.trim() : "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  if (!familyId || !deviceId || typeof body.previousIsLocked !== "boolean") {
    throw new ApiError(400, "invalid-argument", "Nieprawidłowe dane powiadomienia.");
  }

  const device = await db.get("families/" + familyId + "/devices/" + deviceId);
  if (!device || device.fields.tvUid !== claims.sub || device.fields.revokedAt) {
    throw new ApiError(403, "permission-denied", "To konto TV nie ma już dostępu do urządzenia.");
  }
  const isLocked = device.fields.isLocked === true;
  if (isLocked === body.previousIsLocked) return { sent: 0, changed: false };

  const family = await db.get("families/" + familyId);
  const parentIds = Array.isArray(family?.fields.parentIds) ? family?.fields.parentIds as string[] : [];
  const tokens: string[] = [];
  for (const parentId of parentIds.slice(0, 10)) {
    const documents = await db.list("users/" + parentId + "/notificationTokens", 100);
    for (const document of documents) {
      const token = typeof document.fields.token === "string"
        ? document.fields.token
        : document.name.split("/").pop();
      if (token && !tokens.includes(token)) tokens.push(token);
      if (tokens.length >= 30) break;
    }
    if (tokens.length >= 30) break;
  }
  if (tokens.length === 0) return { sent: 0, changed: true };

  const accessToken = await getGoogleAccessToken(env);
  const locked = isLocked;
  const payload = {
    message: {
      token: "",
      notification: {
        title: locked ? "Telewizor zablokowany" : "Telewizor odblokowany",
        body: device.fields.lockReason === "time_exhausted"
          ? "Limit czasu został wykorzystany."
          : "Stan telewizora został zmieniony.",
      },
      data: { deviceId, isLocked: String(locked) },
    },
  };

  let sent = 0;
  let failed = 0;
  for (const token of tokens) {
    payload.message.token = token;
    const response = await fetch(
      "https://fcm.googleapis.com/v1/projects/" + env.FIREBASE_PROJECT_ID + "/messages:send",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + accessToken,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    if (response.ok) sent++;
    else failed++;
  }
  return { sent, failed, changed: true };
}

async function route(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return jsonResponse({ ok: true });
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: { code: "method-not-allowed", message: "Użyj metody POST." } }, 405);
  }

  try {
    if (!env.FIREBASE_PROJECT_ID) {
      throw new ApiError(503, "worker_not_configured", "Brakuje FIREBASE_PROJECT_ID.");
    }
    const claims = await verifyFirebaseToken(request, env);
    let body: Json = {};
    try {
      body = await request.json() as Json;
    } catch {
      throw new ApiError(400, "invalid-json", "Treść żądania nie jest poprawnym JSON-em.");
    }
    const db = new FirestoreRest(env);
    const path = new URL(request.url).pathname.replace(/\/+$/, "");

    let data: Json;
    switch (path) {
      case "/ensureFamily":
        data = await ensureFamily(db, claims);
        break;
      case "/getServerTime":
        data = await getServerTime();
        break;
      case "/createTvPairingSession":
        data = await createTvPairingSession(db, claims);
        break;
      case "/claimPairingSession":
        data = await claimPairingSession(db, claims, body);
        break;
      case "/revokeAnonymousTv":
        data = await revokeAnonymousTv(db, claims, body);
        break;
      case "/notifyParents":
        data = await notifyParents(db, env, claims, body);
        break;
      default:
        return jsonResponse({ ok: false, error: { code: "not-found", message: "Nie znaleziono endpointu." } }, 404);
    }
    return jsonResponse({ ok: true, data });
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonResponse({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    console.error("Family Control Worker request failed.");
    return jsonResponse({
      ok: false,
      error: { code: "internal", message: "Wystąpił błąd backendu. Spróbuj ponownie." },
    }, 500);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return route(request, env);
  },
};
