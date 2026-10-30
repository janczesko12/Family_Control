package pl.familycontrol.tv

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.os.Bundle
import android.os.SystemClock
import android.util.Base64
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import com.google.firebase.functions.FirebaseFunctions
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Calendar
import java.util.Locale
import org.json.JSONObject
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

class FamilyDeviceAdminReceiver : DeviceAdminReceiver()

data class TvState(
    val familyId: String? = null,
    val deviceId: String? = null,
    val isLocked: Boolean = true,
    val remainingSeconds: Long = 0,
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
        viewModel = ViewModelProvider(this, TvViewModel.Factory(applicationContext, this))[TvViewModel::class.java]
        setContent { FamilyControlTv(viewModel) }
    }

    override fun onBackPressed() {
        if (viewModel.state.value.isLocked) return
        super.onBackPressed()
    }
}

class TvViewModel(private val appContext: Context, private val activity: Activity) : ViewModel() {
    private val auth = FirebaseAuth.getInstance()
    private val db = FirebaseFirestore.getInstance()
    private val functions = FirebaseFunctions.getInstance()
    private val prefs = appContext.getSharedPreferences("family_control_tv", Context.MODE_PRIVATE)
    private val pin = PinVerifier(prefs)
    private val _state = MutableStateFlow(TvState())
    val state: StateFlow<TvState> = _state
    private var deviceListener: ListenerRegistration? = null
    private var commandListener: ListenerRegistration? = null
    private var sessionListener: ListenerRegistration? = null
    private var lastTickElapsed = SystemClock.elapsedRealtime()

    init {
        auth.signInAnonymously().addOnSuccessListener { start() }.addOnFailureListener { message(it.message) }
        viewModelScope.launch {
            while (true) {
                delay(1000)
                tick()
            }
        }
    }

    private fun start() {
        val familyId = prefs.getString("familyId", null)
        val deviceId = prefs.getString("deviceId", null)
        if (familyId != null && deviceId != null) listenToDevice(familyId, deviceId) else createPairingSession()
    }

    private fun createPairingSession() {
        functions.getHttpsCallable("createTvPairingSession").call().addOnSuccessListener { result ->
            val data = result.getData() as Map<*, *>
            val id = data["sessionId"] as String
            val code = data["code"] as String
            val expires = (data["expiresAt"] as Number).toLong()
            prefs.edit().putString("pairingSessionId", id).apply()
            _state.value = _state.value.copy(pairingSessionId = id, pairingCode = code, pairingExpiresAt = expires, message = null)
            listenToSession(id)
        }.addOnFailureListener { message(it.message) }
    }

    private fun listenToSession(sessionId: String) {
        sessionListener?.remove()
        sessionListener = db.collection("pairingSessions").document(sessionId).addSnapshotListener { snapshot, error ->
            if (error != null) return@addSnapshotListener
            val familyId = snapshot?.getString("familyId")
            val deviceId = snapshot?.getString("deviceId")
            if (snapshot?.getString("status") == "claimed" && familyId != null && deviceId != null) {
                prefs.edit().putString("familyId", familyId).putString("deviceId", deviceId).remove("pairingSessionId").apply()
                sessionListener?.remove()
                listenToDevice(familyId, deviceId)
            }
        }
    }

    private fun listenToDevice(familyId: String, deviceId: String) {
        deviceListener?.remove(); commandListener?.remove()
        val ref = db.collection("families/$familyId/devices").document(deviceId)
        deviceListener = ref.addSnapshotListener { snapshot, error ->
            if (error != null || snapshot == null || !snapshot.exists()) return@addSnapshotListener
            val locked = snapshot.getBoolean("isLocked") ?: true
            val remaining = snapshot.getLong("remainingSeconds") ?: 0L
            _state.value = _state.value.copy(familyId = familyId, deviceId = deviceId, isLocked = locked, remainingSeconds = remaining, message = null)
            if (locked) KioskController(activity).enterIfPermitted()
        }
        commandListener = ref.collection("commands").whereEqualTo("status", "pending").orderBy("createdAt", Query.Direction.ASCENDING).addSnapshotListener { snapshot, error ->
            if (error != null) { message("Synchronizacja poleceń: ${error.message}"); return@addSnapshotListener }
            snapshot?.documents?.forEach { applyCommand(it.id, it.data ?: emptyMap()) }
        }
    }

    private fun applyCommand(commandId: String, command: Map<String, Any>) {
        val familyId = _state.value.familyId ?: return
        val deviceId = _state.value.deviceId ?: return
        if (prefs.getString("lastAppliedCommandId", null) == commandId) {
            acknowledge(familyId, deviceId, commandId, emptyMap()); return
        }
        val type = command["type"] as? String ?: return
        val payload = command["payload"] as? Map<*, *> ?: emptyMap<Any, Any>()
        val current = _state.value
        var locked = current.isLocked
        var remaining = current.remainingSeconds
        var reason = "parent_manual"
        when (type) {
            "lock" -> { locked = true; reason = payload["reason"] as? String ?: reason }
            "unlock" -> { locked = false; reason = payload["reason"] as? String ?: reason }
            "add_time" -> remaining += (payload["seconds"] as? Number)?.toLong() ?: 0
            "set_limit" -> { remaining = (payload["seconds"] as? Number)?.toLong() ?: 0; if (remaining > 0) locked = false }
            "reset_day" -> remaining = 0
            "set_pin" -> {
                val salt = payload["salt"] as? String
                val verifier = payload["verifier"] as? String
                if (salt != null && verifier != null) pin.replace(salt, verifier)
            }
            "set_weekly_limits" -> {
                val limits = payload["limits"] as? Map<*, *>
                if (limits != null) prefs.edit().putString("weeklyLimits", JSONObject(limits.mapKeys { it.key.toString() }).toString()).apply()
            }
        }
        prefs.edit().putString("lastAppliedCommandId", commandId).apply()
        _state.value = current.copy(isLocked = locked, remainingSeconds = remaining)
        val update = mapOf<String, Any>("isLocked" to locked, "remainingSeconds" to remaining, "lastAppliedCommandId" to commandId, "lastSeenAt" to FieldValue.serverTimestamp(), "lastSyncAt" to FieldValue.serverTimestamp(), "lockReason" to reason, "clockTrusted" to true, "updatedAt" to FieldValue.serverTimestamp())
        db.document("families/$familyId/devices/$deviceId").update(update).addOnSuccessListener {
            acknowledge(familyId, deviceId, commandId, mapOf("isLocked" to locked, "remainingSeconds" to remaining))
            if (type == "lock" || type == "unlock") db.collection("families/$familyId/devices/$deviceId/history").add(mapOf("type" to type, "reason" to reason, "actorUid" to auth.currentUser?.uid, "createdAt" to FieldValue.serverTimestamp(), "usedSeconds" to 0))
            if (locked) KioskController(activity).enterIfPermitted()
        }
    }

    private fun acknowledge(familyId: String, deviceId: String, commandId: String, result: Map<String, Any>) {
        db.document("families/$familyId/devices/$deviceId/commands/$commandId").update("status", "acknowledged", "appliedAt", FieldValue.serverTimestamp(), "deviceResult", result)
    }

    fun unlockWithPin(value: String): Boolean {
        if (!pin.verify(value)) return false
        val familyId = _state.value.familyId ?: return true
        val deviceId = _state.value.deviceId ?: return true
        val update = mapOf<String, Any>("isLocked" to false, "lastSyncAt" to FieldValue.serverTimestamp(), "lastSeenAt" to FieldValue.serverTimestamp(), "lockReason" to "pin", "clockTrusted" to true)
        _state.value = _state.value.copy(isLocked = false)
        db.document("families/$familyId/devices/$deviceId").update(update)
        db.collection("families/$familyId/devices/$deviceId/history").add(mapOf("type" to "unlock", "reason" to "pin", "actorUid" to auth.currentUser?.uid, "createdAt" to FieldValue.serverTimestamp(), "usedSeconds" to 0))
        return true
    }

    private fun tick() {
        val current = _state.value
        val now = SystemClock.elapsedRealtime()
        applyDayScheduleIfNeeded(current)
        if (!current.isLocked && current.remainingSeconds > 0 && now - lastTickElapsed >= 1000) {
            val delta = ((now - lastTickElapsed) / 1000).coerceAtMost(10)
            val remaining = (current.remainingSeconds - delta).coerceAtLeast(0)
            _state.value = current.copy(remainingSeconds = remaining, isLocked = remaining == 0L)
            if (remaining == 0L) {
                val f = current.familyId; val d = current.deviceId
                if (f != null && d != null) {
                    db.document("families/$f/devices/$d").update("isLocked", true, "remainingSeconds", 0, "lockReason", "time_exhausted", "lastSyncAt", FieldValue.serverTimestamp())
                    db.collection("families/$f/devices/$d/history").add(mapOf("type" to "lock", "reason" to "time_exhausted", "actorUid" to auth.currentUser?.uid, "createdAt" to FieldValue.serverTimestamp(), "usedSeconds" to 0))
                }
            }
        }
        lastTickElapsed = now
    }

    private fun applyDayScheduleIfNeeded(current: TvState) {
        val schedule = prefs.getString("weeklyLimits", null) ?: return
        val calendar = Calendar.getInstance()
        val day = if (calendar.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY) 7 else calendar.get(Calendar.DAY_OF_WEEK) - 1
        if (prefs.getInt("scheduleDay", 0) == day) return
        val limit = JSONObject(schedule).optLong(day.toString(), -1)
        if (limit < 0) return
        prefs.edit().putInt("scheduleDay", day).apply()
        _state.value = current.copy(remainingSeconds = limit, isLocked = limit == 0L)
        val familyId = current.familyId; val deviceId = current.deviceId
        if (familyId != null && deviceId != null) db.document("families/$familyId/devices/$deviceId").update("remainingSeconds", limit, "isLocked", limit == 0L, "dailyLimitSeconds", limit, "usedSecondsToday", 0, "lastSyncAt", FieldValue.serverTimestamp())
    }

    private fun message(value: String?) { _state.value = _state.value.copy(message = value ?: "Nieznany błąd") }
    override fun onCleared() { deviceListener?.remove(); commandListener?.remove(); sessionListener?.remove(); super.onCleared() }

    class Factory(private val context: Context, private val activity: Activity) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T = TvViewModel(context, activity) as T
    }
}

class PinVerifier(private val prefs: android.content.SharedPreferences) {
    private val random = SecureRandom()
    init { if (!prefs.contains("pinSalt")) replace("default", "6744") }
    fun verify(value: String): Boolean {
        val blockedUntil = prefs.getLong("blockedUntil", 0)
        if (blockedUntil > System.currentTimeMillis()) return false
        val ok = derive(value, prefs.getString("pinSalt", "default")!!) == prefs.getString("pinVerifier", "")
        if (ok) prefs.edit().putInt("failedAttempts", 0).apply()
        else {
            val attempts = prefs.getInt("failedAttempts", 0) + 1
            prefs.edit().putInt("failedAttempts", attempts).apply()
            if (attempts >= 5) prefs.edit().putLong("blockedUntil", System.currentTimeMillis() + 60_000).putInt("failedAttempts", 0).apply()
        }
        return ok
    }
    fun replace(salt: String, verifier: String) {
        val actualSalt = if (salt == "default") randomSalt() else salt
        val actualVerifier = if (salt == "default") derive(verifier, actualSalt) else verifier
        prefs.edit().putString("pinSalt", actualSalt).putString("pinVerifier", actualVerifier).apply()
    }
    private fun randomSalt(): String = Base64.encodeToString(ByteArray(16).also(random::nextBytes), Base64.NO_WRAP)
    private fun derive(value: String, salt: String): String {
        val spec = PBEKeySpec(value.toCharArray(), Base64.decode(salt, Base64.DEFAULT), 120_000, 256)
        return Base64.encodeToString(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded, Base64.NO_WRAP)
    }
}

class KioskController(private val activity: Activity) {
    fun enterIfPermitted() {
        val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (dpm.isLockTaskPermitted(activity.packageName)) activity.startLockTask()
    }
}

@Composable
fun FamilyControlTv(viewModel: TvViewModel) {
    val state by viewModel.state.collectAsState()
    MaterialTheme { Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when {
            state.deviceId == null -> PairingScreen(state)
            state.isLocked -> LockedScreen(state, viewModel)
            else -> UnlockedScreen(state)
        }
    } }
}

@Composable
private fun PairingScreen(state: TvState) {
    val code = state.pairingCode ?: "------"
    val bitmap = remember(code) { if (code == "------") null else makeQr("fc://pair?session=${state.pairingSessionId}&code=$code&tvUid=${FirebaseAuth.getInstance().currentUser?.uid}") }
    Box(Modifier.fillMaxSize().padding(48.dp), contentAlignment = Alignment.Center) { Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        if (bitmap != null) Image(bitmap.asImageBitmap(), contentDescription = "Kod QR parowania", modifier = Modifier.size(240.dp))
        Spacer(Modifier.width(32.dp))
        Column(horizontalAlignment = Alignment.CenterHorizontally) { Text("FAMILY CONTROL", fontSize = 28.sp, fontWeight = FontWeight.Bold); Spacer(Modifier.height(16.dp)); Text("Zeskanuj kod QR w aplikacji rodzica"); Spacer(Modifier.height(16.dp)); Text(code, fontSize = 38.sp, letterSpacing = 6.sp); Text("Kod ważny przez 5 minut", fontSize = 16.sp); state.message?.let { Text(it, color = MaterialTheme.colorScheme.error) } }
    } }
}

@Composable
private fun LockedScreen(state: TvState, viewModel: TvViewModel) {
    BackHandler(true) {}
    var input by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant).padding(48.dp), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text("TELEWIZOR ZABLOKOWANY", fontSize = 34.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(10.dp)); Text("Czas korzystania z telewizora dobiegł końca")
        Spacer(Modifier.height(24.dp)); OutlinedTextField(value = "•".repeat(input.length), onValueChange = {}, readOnly = true, label = { Text("PIN") }, visualTransformation = PasswordVisualTransformation())
        Spacer(Modifier.height(18.dp)); LazyVerticalGrid(columns = GridCells.Fixed(3), modifier = Modifier.width(360.dp).height(250.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { items((1..9).toList()) { number -> Button(onClick = { if (input.length < 8) input += number }) { Text(number.toString(), fontSize = 22.sp) } }; item { OutlinedButton(onClick = { input = input.dropLast(1) }) { Text("⌫") } }; item { Button(onClick = { if (viewModel.unlockWithPin(input)) { input = ""; error = null } else { error = "Niepoprawny PIN lub czasowa blokada prób"; input = "" } }) { Text("OK") } }; item { OutlinedButton(onClick = { input = "" }) { Text("C") } } }
        error?.let { Spacer(Modifier.height(10.dp)); Text(it, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(14.dp)); Text("Możesz też odblokować telewizor z aplikacji rodzica.", fontSize = 14.sp)
    } }
}

@Composable
private fun UnlockedScreen(state: TvState) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Text("TELEWIZOR ODBLOKOWANY", fontSize = 30.sp, fontWeight = FontWeight.Bold); Spacer(Modifier.height(20.dp)); Card { Text(formatSeconds(state.remainingSeconds), modifier = Modifier.padding(horizontal = 44.dp, vertical = 28.dp), fontSize = 48.sp) }; Spacer(Modifier.height(12.dp)); Text("Pozostały czas") } } }

private fun formatSeconds(total: Long): String = "${total / 60}:${(total % 60).toString().padStart(2, '0')}"

private fun makeQr(value: String): Bitmap? = try {
    val matrix = MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, 360, 360)
    Bitmap.createBitmap(360, 360, Bitmap.Config.ARGB_8888).also { bitmap -> for (x in 0 until 360) for (y in 0 until 360) bitmap.setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE) }
} catch (_: Exception) { null }
