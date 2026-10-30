package pl.familycontrol.tv

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

object WorkerApi {
    fun post(baseUrl: String, path: String, idToken: String, payload: JSONObject): JSONObject {
        require(baseUrl.startsWith("https://")) { "Adres backendu musi zaczynać się od https://." }
        val connection = URL(baseUrl.trimEnd('/') + "/api/" + path.trimStart('/'))
            .openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 15_000
        connection.readTimeout = 20_000
        connection.doOutput = true
        connection.setRequestProperty("Authorization", "Bearer " + idToken)
        connection.setRequestProperty("Content-Type", "application/json")
        try {
            val bytes = payload.toString().toByteArray(StandardCharsets.UTF_8)
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() } ?: "{}"
            val response = try { JSONObject(responseText) } catch (_: Exception) { JSONObject() }
            if (status !in 200..299) {
                throw IllegalStateException(response.optString("error").ifBlank { "Błąd backendu HTTP " + status })
            }
            return response
        } finally {
            connection.disconnect()
        }
    }
}
