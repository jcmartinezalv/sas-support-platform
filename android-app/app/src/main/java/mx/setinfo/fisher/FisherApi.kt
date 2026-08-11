package mx.setinfo.fisher

import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class HttpFailure(val status: Int, message: String) : Exception(message)

class FisherApi(private val baseUrl: String) {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    fun login(username: String, password: String, deviceId: String, done: (Result<Session>) -> Unit) = request("POST", "/api/mobile/v1/auth/login", null,
        JSONObject().put("username", username).put("password", password).put("deviceId", deviceId).put("deviceName", "Android").put("platform", "android")) { result ->
        done(result.map { json -> parseSession(json.getJSONObject("session"), username) })
    }

    fun refresh(refreshToken: String, deviceId: String, done: (Result<Session>) -> Unit) = request("POST", "/api/mobile/v1/auth/refresh", null, JSONObject().put("refreshToken", refreshToken).put("deviceId", deviceId)) { result -> done(result.map { parseSession(it.getJSONObject("session")) }) }

    private fun parseSession(session: JSONObject, fallbackName: String = "Usuario"): Session {
        val user = session.getJSONObject("user")
        return Session(session.getString("accessToken"), session.getString("refreshToken"), user.optString("displayName", fallbackName), user.optString("role", "viewer"), user.optBoolean("mustChangePassword", false), session.optString("accessExpiresAt"), session.optString("refreshExpiresAt"))
    }
    fun dashboard(token: String, done: (Result<JSONObject>) -> Unit) = request("GET", "/api/mobile/v1/dashboard", token, null) { done(it.map { body -> body.getJSONObject("dashboard") }) }
    fun activity(token: String, limit: Int = 20, done: (Result<JSONObject>) -> Unit) = request("GET", "/api/mobile/v1/activity?limit=$limit", token, null, done)
    fun notificationPreferences(token: String, done: (Result<JSONObject>) -> Unit) = request("GET", "/api/mobile/v1/notification-preferences", token, null) { done(it.map { body -> body.getJSONObject("preferences") }) }
    fun updateNotificationPreferences(token: String, values: JSONObject, done: (Result<JSONObject>) -> Unit) = request("PUT", "/api/mobile/v1/notification-preferences", token, values) { done(it.map { body -> body.getJSONObject("preferences") }) }
    fun notifications(token: String, limit: Int = 20, done: (Result<JSONObject>) -> Unit) = request("GET", "/api/mobile/v1/notifications?limit=$limit", token, null, done)
    fun markAllNotificationsRead(token: String, done: (Result<JSONObject>) -> Unit) = request("POST", "/api/mobile/v1/notifications/read-all", token, JSONObject(), done)
    fun markNotificationRead(token: String, id: String, done: (Result<JSONObject>) -> Unit) = request("POST", "/api/mobile/v1/notifications/$id/read", token, JSONObject(), done)
    fun ask(token: String, message: String, done: (Result<JSONObject>) -> Unit) = request("POST", "/api/mobile/v1/fisher/ask", token, JSONObject().put("message", message)) { done(it.map { body -> body.getJSONObject("answer") }) }    fun knowledge(token: String, status: String? = null, done: (Result<JSONObject>) -> Unit) = request("GET", "/api/mobile/v1/knowledge" + (status?.let { "?status=" + it } ?: ""), token, null, done)
    fun reviewKnowledge(token: String, id: String, status: String, done: (Result<JSONObject>) -> Unit) = request("PATCH", "/api/mobile/v1/knowledge/$id", token, JSONObject().put("status", status), done)
    fun changePassword(token: String, currentPassword: String, newPassword: String, done: (Result<JSONObject>) -> Unit) = request("POST", "/api/mobile/v1/auth/change-password", token, JSONObject().put("currentPassword", currentPassword).put("newPassword", newPassword), done)
    fun logout(token: String, done: () -> Unit) = request("POST", "/api/mobile/v1/auth/logout", token, JSONObject()) { done() }

    private fun request(method: String, path: String, token: String?, body: JSONObject?, done: (Result<JSONObject>) -> Unit) {
        worker.execute {
            var attempt = 0
            var result: Result<JSONObject>
            do {
                result = runCatching {
                    val connection = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
                    connection.requestMethod = method
                    connection.connectTimeout = 12_000
                    connection.readTimeout = 20_000
                    connection.setRequestProperty("Accept", "application/json")
                    connection.setRequestProperty("Content-Type", "application/json")
                    token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
                    if (body != null) connection.outputStream.use { it.write(body.toString().toByteArray()) }
                    val code = connection.responseCode
                    val text = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
                    if (code !in 200..299) throw HttpFailure(code, JSONObject(text.ifBlank { "{}" }).optString("error", "Error HTTP $code"))
                    JSONObject(text)
                }
                attempt += 1
                val failure = result.exceptionOrNull()
                val retryable = attempt < 3 && (method == "GET" || path.endsWith("/auth/refresh")) && (failure !is HttpFailure || failure.status >= 500)
                if (!retryable) break
                Thread.sleep(250L * attempt)
            } while (true)
            main.post { done(result) }
        }
    }
}










