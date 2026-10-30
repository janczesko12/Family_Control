package pl.familycontrol.tv

import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Bundle
import android.os.SystemClock
import android.util.Base64
import android.view.View
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

class FamilyDeviceAdminReceiver : DeviceAdminReceiver()

data class TvState(
    val familyId: String? = null,
    val deviceId: String? = null,
    val isLocked: Boolean = true,
    val remainingSeconds: Long = 0,
    val sessionEndServerMillis: Long = 0,
    val pairingSessionId: String? = null,
    val pairingCode: String? = null,
    val pairingExpiresAt: Long? = null,
    val message: String? = null,
)

class MainActivity : ComponentActivity() {
    private lateinit var viewModel: TvViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        )
        viewModel = ViewModelProvider(this, TvViewModel.Factory(applicationContext, this))
            [TvViewModel::class.java]
        setContent { FamilyControlTv(viewModel) }
    }

    override fun onResume() {
        super.onResume()
        KioskController(this).apply(viewModel.state.value.isLocked)
    }
}

class TvViewModel(private val appContext: Context, private val activity: Activity) : ViewModel() {
    private val auth = FirebaseAuth.getInstance()
    private val db = FirebaseFirestore.getInstance()
    private val prefs = appContext.getSharedPreferences("family_control_tv", Context.MODE_PRIVATE)
    private val pin = PinVerifier(prefs)
    private val _state = MutableStateFlow(
        TvState(
            familyId = prefs.getString("familyId", null),
            deviceId = prefs.getString("deviceId", null),
            isLocked = prefs.getBoolean("isLocked", true),
            remainingSeconds = prefs.getLong("remainingSeconds", 0),
            sessionEndServerMillis = prefs.getLong("sessionEndServerMillis", 0),
        )
    )
    val state: StateFlow<TvState> = _state
    private var deviceListener: ListenerRegistration? = null
    private var commandListener: ListenerRegistration? = null
    private var sessionListener: ListenerRegistration? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var serverOffsetMillis = prefs.getLong("serverTimeOffsetMillis", 0)
    private var lastHeartbeatElapsed = SystemClock.elapsedRealtime()

    init {
        val start = {
            val familyId = prefs.getString("familyId", null)
            val deviceId = prefs.getString("deviceId", null)
            if (familyId != null && deviceId != null) listenToDevice(familyId, deviceId)
            else createPairingSession()
        }
        if (auth.currentUser != null) start()
        else auth.signInAnonymously().addOnSuccessListener { start() }
            .addOnFailureListener { message("Logowanie TV: ${it.message}") }

        viewModelScope.launch {
            while (true) {
                delay(1000)
                tick()
            }
        }
    }

    private fun callWorker(
        endpoint: String,
        body: Map<String, Any>,
        onSuccess: (JSONObject) -> Unit,
        onFailure: (String) -> Unit = {},
    ) {
        val user = auth.currentUser
        if (user == null) {
            onFailure("Telewizor nie jest zalogowany.")
            return
        }
        user.getIdToken(false)
            .addOnSuccessListener { tokenResult ->
                val token = tokenResult.token
                if (token.isNullOrBlank()) {
                    onFailure("Nie udało się pobrać tokenu Firebase.")
                    return@addOnSuccessListener
                }
                Thread {
                    var connection: HttpURLConnection? = null
                    try {
                        val baseUrl = BuildConfig.FAMILY_CONTROL_API_URL.trimEnd('/')
                        require(!baseUrl.contains("YOUR-SUBDOMAIN")) {
                            "Ustaw FAMILY_CONTROL_API_URL w konfiguracji Gradle."
                        }
                        connection = URL("$baseUrl/$endpoint").openConnection() as HttpURLConnection
                        connection.requestMethod = "POST"
                        connection.connectTimeout = 15000
                        connection.readTimeout = 20000
                        connection.doOutput = true
                        connection.setRequestProperty("Authorization", "Bearer $token")
                        connection.setRequestProperty("Content-Type", "application/json")
                        connection.outputStream.use {
                            it.write(JSONObject(body).toString().toByteArray(Charsets.UTF_8))
                        }
                        val status = connection.responseCode
                        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                        val responseText = stream?.bufferedReader()?.use { it.readText() } ?: ""
                        val response = if (responseText.isBlank()) JSONObject() else JSONObject(responseText)
                        if (status in 200..299 && response.optBoolean("ok")) {
                            val data = response.optJSONObject("data") ?: response
                            mainHandler.post { onSuccess(data) }
                        } else {
                            val error = response.optJSONObject("error")
                            val reason = error?.optString("message")?.takeIf { it.isNotBlank() }
                                ?: "Backend zwrócił HTTP $status."
                            mainHandler.post { onFailure(reason) }
                        }
                    } catch (error: Exception) {
                        mainHandler.post { onFailure(error.message ?: "Nie udało się połączyć z backendem.") }
                    } finally {
                        connection?.disconnect()
                    }
                }.start()
            }
            .addOnFailureListener { error ->
                onFailure(error.message ?: "Nie udało się pobrać tokenu Firebase.")
            }
    }

    private fun notifyLockChange(previousIsLocked: Boolean) {
        val current = _state.value
        val familyId = current.familyId ?: return
        val deviceId = current.deviceId ?: return
        callWorker(
            "notifyParents",
            mapOf(
                "familyId" to familyId,
                "deviceId" to deviceId,
                "previousIsLocked" to previousIsLocked,
            ),
            onSuccess = { },
            onFailure = { /* Push is best-effort; locking itself must not depend on FCM. */ },
        )
    }

    private fun syncServerClock(onComplete: () -> Unit) {
        callWorker("getServerTime", emptyMap(), onSuccess = { data ->
            val serverMillis = data.optLong("serverTimeMillis", 0L)
            if (serverMillis > 0L) {
                serverAnchorMillis = serverMillis
                serverAnchorWallMillis = System.currentTimeMillis()
                serverAnchorElapsed = SystemClock.elapsedRealtime()
                serverOffsetMillis = serverMillis - serverAnchorWallMillis
                prefs.edit()
                    .putLong("serverAnchorMillis", serverAnchorMillis)
                    .putLong("serverAnchorWallMillis", serverAnchorWallMillis)
                    .putLong("serverTimeOffsetMillis", serverOffsetMillis)
                    .apply()
            }
            onComplete()
        }, onFailure = {
            // Offline startup uses the last persisted server-time anchor.
            onComplete()
        })
    }

    private fun updateServerAnchor(serverMillis: Long) {
        serverAnchorMillis = serverMillis
        serverAnchorWallMillis = System.currentTimeMillis()
        serverAnchorElapsed = SystemClock.elapsedRealtime()
        serverOffsetMillis = serverMillis - serverAnchorWallMillis
        prefs.edit()
            .putLong("serverAnchorMillis", serverAnchorMillis)
            .putLong("serverAnchorWallMillis", serverAnchorWallMillis)
            .putLong("serverTimeOffsetMillis", serverOffsetMillis)
            .apply()
    }

    private fun createPairingSession() {
        callWorker("createTvPairingSession", emptyMap(), onSuccess = { data ->
            val id = data.optString("sessionId").takeIf { it.isNotBlank() } ?: return@callWorker
            val code = data.optString("code").takeIf { it.isNotBlank() } ?: return@callWorker
            prefs.edit().putString("pairingSessionId", id).apply()
            val expiresAt = data.optLong("expiresAt", 0L)
            _state.value = _state.value.copy(
                pairingSessionId = id,
                pairingCode = code,
                pairingExpiresAt = expiresAt,
                message = null,
            )
            listenToSession(id)
        }, onFailure = { message("Nie można utworzyć kodu parowania: $it") })
    }

    private fun listenToSession(sessionId: String) {
        sessionListener?.remove()
        sessionListener = db.collection("pairingSessions").document(sessionId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    message("Błąd sesji parowania: ${error.message}")
                    return@addSnapshotListener
                }
                if (snapshot?.getString("status") == "claimed") {
                    val familyId = snapshot.getString("familyId")
                    val deviceId = snapshot.getString("deviceId")
                    if (familyId != null && deviceId != null) {
                        prefs.edit().putString("familyId", familyId).putString("deviceId", deviceId)
                            .remove("pairingSessionId").apply()
                        sessionListener?.remove()
                        listenToDevice(familyId, deviceId)
                    } else message("Sesja przejęta, ale brakuje danych urządzenia.")
                }
            }
    }

    private fun listenToDevice(familyId: String, deviceId: String) {
        deviceListener?.remove()
        commandListener?.remove()
        val ref = db.collection("families").document(familyId).collection("devices").document(deviceId)

        deviceListener = ref.addSnapshotListener { snapshot, error ->
            if (error != null) {
                message("Synchronizacja TV: ${error.message}")
                return@addSnapshotListener
            }
            if (snapshot == null || !snapshot.exists()) return@addSnapshotListener

            if (snapshot.getTimestamp("revokedAt") != null) {
                _state.value = _state.value.copy(isLocked = true, message = "Urządzenie zostało odłączone.")
                KioskController(activity).apply(true)
                return@addSnapshotListener
            }

            snapshot.getTimestamp("lastSyncAt")?.toDate()?.time?.let { lastServerSync ->
                // A stale cached timestamp must not move the server clock backwards.
                if (kotlin.math.abs(lastServerSync - serverNowMillis()) <= 120_000L) {
                    updateServerAnchor(lastServerSync)
                }
            }
            val end = snapshot.getLong("sessionEndServerMillis") ?: 0L
            val lastSync = snapshot.getTimestamp("lastSyncAt")?.toDate()?.time ?: 0L
            val pinUnlockAt = prefs.getLong("pinUnlockAt", 0L)
            val keepLocalPin = prefs.getBoolean("localPinUnlocked", false) && lastSync < pinUnlockAt
            if (prefs.getBoolean("localPinUnlocked", false) && !keepLocalPin) {
                prefs.edit().putBoolean("localPinUnlocked", false).putLong("pinUnlockAt", 0).apply()
            }
            val locked = if (keepLocalPin) false else (snapshot.getBoolean("isLocked") ?: true)
            val remaining = if (end > 0L) {
                ((end - serverNowMillis()) / 1000L).coerceAtLeast(0L)
            } else snapshot.getLong("remainingSeconds") ?: 0L

            _state.value = _state.value.copy(
                familyId = familyId, deviceId = deviceId, isLocked = locked,
                remainingSeconds = remaining, sessionEndServerMillis = end, message = null,
            )
            persistState()
            KioskController(activity).apply(locked)
        }

        commandListener = ref.collection("commands")
            .whereEqualTo("status", "pending")
            .orderBy("createdAt", Query.Direction.ASCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    message("Błąd poleceń: ${error.message}")
                    return@addSnapshotListener
                }
                snapshot?.documents?.forEach { applyCommand(it.id) }
            }
    }

    private fun applyCommand(commandId: String) {
        val familyId = _state.value.familyId ?: return
        val deviceId = _state.value.deviceId ?: return
        val deviceRef = db.collection("families").document(familyId)
            .collection("devices").document(deviceId)
        val commandRef = deviceRef.collection("commands").document(commandId)

        db.runTransaction { tx ->
            val command = tx.get(commandRef)
            if (!command.exists() || command.getString("status") != "pending") return@runTransaction null
            val createdAt = command.getTimestamp("createdAt") ?: return@runTransaction null
            val payload = command.get("payload") as? Map<*, *> ?: emptyMap<Any, Any>()
            val device = tx.get(deviceRef)
            val oldEnd = device.getLong("sessionEndServerMillis") ?: 0L
            val oldRemaining = if (oldEnd > 0L) {
                ((oldEnd - createdAt.toDate().time) / 1000L).coerceAtLeast(0L)
            } else device.getLong("remainingSeconds") ?: 0L

            val previousIsLocked = device.getBoolean("isLocked") ?: true
            var locked = previousIsLocked
            var end = oldEnd
            var remaining = oldRemaining
            var reason = "parent_manual"
            when (command.getString("type")) {
                "lock" -> {
                    locked = true
                    reason = (payload["reason"] as? String) ?: "parent_manual"
                }
                "unlock" -> {
                    locked = false
                    if (remaining <= 0L) end = 0L
                }
                "add_time" -> {
                    val seconds = (payload["seconds"] as? Number)?.toLong() ?: 0L
                    require(seconds in 1..86400) { "Nieprawidłowa liczba sekund." }
                    end = maxOf(oldEnd, createdAt.toDate().time) + seconds * 1000L
                    remaining = ((end - createdAt.toDate().time) / 1000L).coerceAtLeast(0L)
                    locked = false
                    reason = "time_added"
                }
                "set_limit" -> {
                    val seconds = (payload["seconds"] as? Number)?.toLong() ?: 0L
                    require(seconds in 0..86400) { "Nieprawidłowy limit." }
                    end = if (seconds == 0L) 0L else createdAt.toDate().time + seconds * 1000L
                    remaining = seconds
                    locked = seconds == 0L
                    reason = if (locked) "time_exhausted" else "limit_set"
                }
                "reset_day" -> {
                    end = 0L
                    remaining = 0L
                    locked = true
                    reason = "time_exhausted"
                }
                "set_pin" -> {
                    val salt = payload["salt"] as? String
                    val verifier = payload["verifier"] as? String
                    if (salt != null && verifier != null) pin.replace(salt, verifier)
                }
                else -> throw IllegalArgumentException("Nieobsługiwany typ polecenia.")
            }

            tx.update(deviceRef, mapOf(
                "isLocked" to locked,
                "remainingSeconds" to remaining,
                "sessionEndServerMillis" to end,
                "lastAppliedCommandId" to commandId,
                "lastSeenAt" to FieldValue.serverTimestamp(),
                "lastSyncAt" to FieldValue.serverTimestamp(),
                "lockReason" to reason,
                "clockTrusted" to true,
                "updatedAt" to FieldValue.serverTimestamp(),
            ))
            tx.update(commandRef, mapOf(
                "status" to "acknowledged",
                "appliedAt" to FieldValue.serverTimestamp(),
                "deviceResult" to mapOf(
                    "isLocked" to locked,
                    "remainingSeconds" to remaining,
                    "sessionEndServerMillis" to end,
                ),
            ))
            Pair(Triple(locked, remaining, end), previousIsLocked)
        }.addOnSuccessListener { outcome ->
            if (outcome != null) {
                val result = outcome.first
                _state.value = _state.value.copy(
                    isLocked = result.first,
                    remainingSeconds = result.second,
                    sessionEndServerMillis = result.third,
                )
                persistState()
                KioskController(activity).apply(result.first)
                if (outcome.second != result.first) notifyLockChange(outcome.second)
                db.collection("families").document(familyId).collection("devices").document(deviceId)
                    .collection("history").add(mapOf(
                        "type" to if (result.first) "lock" else "unlock",
                        "reason" to "parent_command",
                        "actorUid" to auth.currentUser?.uid,
                        "createdAt" to FieldValue.serverTimestamp(),
                        "usedSeconds" to 0,
                    ))
            }
        }.addOnFailureListener { message("Nie udało się wykonać polecenia: ${it.message}") }
    }

    fun unlockWithPin(value: String): Boolean {
        if (!pin.verify(value)) return false
        val current = _state.value
        prefs.edit().putBoolean("localPinUnlocked", true)
            .putLong("pinUnlockAt", System.currentTimeMillis()).putBoolean("isLocked", false).apply()
        _state.value = current.copy(isLocked = false)
        KioskController(activity).apply(false)

        val familyId = current.familyId
        val deviceId = current.deviceId
        if (familyId != null && deviceId != null) {
            val ref = db.collection("families").document(familyId).collection("devices").document(deviceId)
            ref.update(
                "isLocked", false,
                "lastSyncAt", FieldValue.serverTimestamp(),
                "lastSeenAt", FieldValue.serverTimestamp(),
                "lockReason", "pin",
            ).addOnSuccessListener {
                if (current.isLocked) notifyLockChange(true)
            }
            ref.collection("history").add(mapOf(
                "type" to "unlock",
                "reason" to "pin",
                "actorUid" to auth.currentUser?.uid,
                "createdAt" to FieldValue.serverTimestamp(),
                "usedSeconds" to 0,
            ))
        }
        return true
    }

    private fun tick() {
        val current = _state.value
        val pairingExpiry = current.pairingExpiresAt
        if (current.deviceId == null && pairingExpiry != null && pairingExpiry > 0L &&
            serverNowMillis() >= pairingExpiry
        ) {
            sessionListener?.remove()
            prefs.edit().remove("pairingSessionId").apply()
            _state.value = current.copy(
                pairingSessionId = null,
                pairingCode = null,
                pairingExpiresAt = null,
            )
            createPairingSession()
        }
        if (!current.isLocked && current.sessionEndServerMillis > 0L) {
            val remaining = ((current.sessionEndServerMillis - serverNowMillis()) / 1000L).coerceAtLeast(0L)
            if (remaining != current.remainingSeconds) {
                _state.value = current.copy(remainingSeconds = remaining, isLocked = remaining == 0L)
                persistState()
            }
            if (remaining == 0L && !current.isLocked) {
                val familyId = current.familyId
                val deviceId = current.deviceId
                if (familyId != null && deviceId != null) {
                    val ref = db.collection("families").document(familyId).collection("devices").document(deviceId)
                    ref.update(
                        "isLocked", true,
                        "remainingSeconds", 0L,
                        "sessionEndServerMillis", 0L,
                        "lockReason", "time_exhausted",
                        "lastSyncAt", FieldValue.serverTimestamp(),
                        "lastSeenAt", FieldValue.serverTimestamp(),
                    ).addOnSuccessListener {
                        notifyLockChange(false)
                    }
                    ref.collection("history").add(mapOf(
                        "type" to "lock",
                        "reason" to "time_exhausted",
                        "actorUid" to auth.currentUser?.uid,
                        "createdAt" to FieldValue.serverTimestamp(),
                        "usedSeconds" to 0,
                    ))
                }
                KioskController(activity).apply(true)
            }
        }

        val elapsed = SystemClock.elapsedRealtime()
        if (elapsed - lastHeartbeatElapsed >= 30_000L) {
            lastHeartbeatElapsed = elapsed
            val familyId = current.familyId
            val deviceId = current.deviceId
            if (familyId != null && deviceId != null) {
                db.collection("families").document(familyId).collection("devices").document(deviceId)
                    .update("lastSeenAt", FieldValue.serverTimestamp(), "lastSyncAt", FieldValue.serverTimestamp())
            }
        }
    }

    private fun serverNowMillis(): Long {
        return if (serverAnchorMillis > 0L) {
            serverAnchorMillis + (SystemClock.elapsedRealtime() - serverAnchorElapsed)
        } else {
            System.currentTimeMillis() + serverOffsetMillis
        }
    }

    private fun persistState() {
        val s = _state.value
        prefs.edit().putBoolean("isLocked", s.isLocked)
            .putLong("remainingSeconds", s.remainingSeconds)
            .putLong("sessionEndServerMillis", s.sessionEndServerMillis).apply()
    }

    private fun message(text: String?) {
        _state.value = _state.value.copy(message = text ?: "Nieznany błąd")
    }

    override fun onCleared() {
        deviceListener?.remove()
        commandListener?.remove()
        sessionListener?.remove()
        super.onCleared()
    }

    class Factory(private val context: Context, private val activity: Activity) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = TvViewModel(context, activity) as T
    }
}

class PinVerifier(private val prefs: android.content.SharedPreferences) {
    private val random = SecureRandom()

    init {
        if (!prefs.contains("pinSalt")) replace("default", "6744")
    }

    fun verify(value: String): Boolean {
        if (value.length !in 4..8 || value.any { !it.isDigit() }) return false
        if (prefs.getLong("blockedUntil", 0L) > System.currentTimeMillis()) return false
        val salt = prefs.getString("pinSalt", null) ?: return false
        val expected = prefs.getString("pinVerifier", null) ?: return false
        val ok = derive(value, salt) == expected
        if (ok) prefs.edit().putInt("failedAttempts", 0).apply()
        else {
            val attempts = prefs.getInt("failedAttempts", 0) + 1
            if (attempts >= 5) {
                prefs.edit().putLong("blockedUntil", System.currentTimeMillis() + 60_000L)
                    .putInt("failedAttempts", 0).apply()
            } else prefs.edit().putInt("failedAttempts", attempts).apply()
        }
        return ok
    }

    fun replace(salt: String, verifier: String) {
        val actualSalt = if (salt == "default") randomSalt() else salt
        val actualVerifier = if (salt == "default") derive(verifier, actualSalt) else verifier
        prefs.edit().putString("pinSalt", actualSalt).putString("pinVerifier", actualVerifier).apply()
    }

    private fun randomSalt(): String =
        Base64.encodeToString(ByteArray(16).also(random::nextBytes), Base64.NO_WRAP)

    private fun derive(value: String, salt: String): String {
        val spec = PBEKeySpec(value.toCharArray(), Base64.decode(salt, Base64.DEFAULT), 120_000, 256)
        return Base64.encodeToString(
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded,
            Base64.NO_WRAP,
        )
    }
}

class KioskController(private val activity: Activity) {
    fun apply(locked: Boolean) {
        val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(activity, FamilyDeviceAdminReceiver::class.java)
        val manager = activity.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        try {
            if (dpm.isDeviceOwnerApp(activity.packageName)) {
                dpm.setLockTaskPackages(admin, arrayOf(activity.packageName))
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS)
                }
            }
            val mode = manager.lockTaskModeState
            if (locked) {
                if (dpm.isLockTaskPermitted(activity.packageName) && mode == ActivityManager.LOCK_TASK_MODE_NONE) {
                    activity.startLockTask()
                }
            } else if (mode != ActivityManager.LOCK_TASK_MODE_NONE) {
                activity.stopLockTask()
            }
        } catch (_: SecurityException) {
            // Bez Device Owner pozostaje tylko blokada wewnątrz aplikacji.
        } catch (_: IllegalStateException) {
            // Aktywność mogła już opuścić pierwszy plan.
        }
    }
}

@Composable
fun FamilyControlTv(viewModel: TvViewModel) {
    val state by viewModel.state.collectAsState()
    MaterialTheme {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            when {
                state.deviceId == null -> PairingScreen(state)
                state.isLocked -> LockedScreen(viewModel)
                else -> UnlockedScreen(state)
            }
        }
    }
}

@Composable
private fun PairingScreen(state: TvState) {
    val code = state.pairingCode ?: "------"
    val bitmap = remember(code) {
        if (code == "------") null
        else makeQr("fc://pair?session=${state.pairingSessionId}&code=$code&tvUid=${FirebaseAuth.getInstance().currentUser?.uid}")
    }
    Box(Modifier.fillMaxSize().padding(48.dp), contentAlignment = Alignment.Center) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            if (bitmap != null) Image(bitmap.asImageBitmap(), "Kod QR", Modifier.size(240.dp))
            Spacer(Modifier.width(32.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("FAMILY CONTROL", fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(16.dp))
                Text("Zeskanuj kod QR w aplikacji rodzica")
                Spacer(Modifier.height(16.dp))
                Text(code, fontSize = 38.sp, letterSpacing = 6.sp)
                Text("Kod ważny przez 5 minut", fontSize = 16.sp)
                state.message?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

@Composable
private fun LockedScreen(viewModel: TvViewModel) {
    BackHandler(true) {}
    var input by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant).padding(48.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("TELEWIZOR ZABLOKOWANY", fontSize = 34.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
            Text("Czas korzystania z telewizora dobiegł końca")
            Spacer(Modifier.height(24.dp))
            OutlinedTextField(
                value = "•".repeat(input.length), onValueChange = {}, readOnly = true,
                label = { Text("PIN") }, visualTransformation = PasswordVisualTransformation(),
            )
            Spacer(Modifier.height(18.dp))
            LazyVerticalGrid(
                columns = GridCells.Fixed(3), modifier = Modifier.width(360.dp).height(250.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items((1..9).toList()) { n ->
                    Button(onClick = { if (input.length < 8) input += n }) { Text(n.toString(), fontSize = 22.sp) }
                }
                item { OutlinedButton(onClick = { input = input.dropLast(1) }) { Text("⌫") } }
                item {
                    Button(onClick = {
                        if (viewModel.unlockWithPin(input)) { input = ""; error = null }
                        else { error = "Niepoprawny PIN lub czasowa blokada prób"; input = "" }
                    }) { Text("OK") }
                }
                item { OutlinedButton(onClick = { input = "" }) { Text("C") } }
            }
            error?.let { Spacer(Modifier.height(10.dp)); Text(it, color = MaterialTheme.colorScheme.error) }
            Spacer(Modifier.height(14.dp))
            Text("Możesz też odblokować telewizor z aplikacji rodzica.", fontSize = 14.sp)
        }
    }
}

@Composable
private fun UnlockedScreen(state: TvState) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("TELEWIZOR ODBLOKOWANY", fontSize = 30.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(20.dp))
            Card {
                Text(formatSeconds(state.remainingSeconds), Modifier.padding(horizontal = 44.dp, vertical = 28.dp), fontSize = 48.sp)
            }
            Spacer(Modifier.height(12.dp))
            Text("Pozostały czas")
        }
    }
}

private fun formatSeconds(total: Long): String =
    "${total / 60}:${(total % 60).toString().padStart(2, '0')}"

private fun makeQr(value: String): Bitmap? = try {
    val matrix = MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, 360, 360)
    Bitmap.createBitmap(360, 360, Bitmap.Config.ARGB_8888).also { bitmap ->
        for (x in 0 until 360) for (y in 0 until 360) {
            bitmap.setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        }
    }
} catch (_: Exception) { null }
