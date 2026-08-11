package mx.setinfo.fisher

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class Session(val accessToken: String, val refreshToken: String, val displayName: String, val role: String, val mustChangePassword: Boolean = false, val accessExpiresAt: String = "", val refreshExpiresAt: String = "")

class SecureSessionStore(context: Context) {
    private val preferences = context.getSharedPreferences("fisher_secure", Context.MODE_PRIVATE)
    private val alias = "fisher_mobile_session"

    fun serverUrl(): String = preferences.getString("server_url", null) ?: "https://setinfo.sytes.net"
    fun saveServerUrl(value: String) = preferences.edit().putString("server_url", value.trim().trimEnd('/')).apply()
    fun deviceId(): String = preferences.getString("device_id", null) ?: UUID.randomUUID().toString().also {
        preferences.edit().putString("device_id", it).apply()
    }

    fun save(session: Session) = preferences.edit().putString("session", encrypt(listOf(session.accessToken, session.refreshToken, session.displayName, session.role, session.mustChangePassword.toString(), session.accessExpiresAt, session.refreshExpiresAt).joinToString("\n"))).apply()

    fun load(): Session? = runCatching {
        val values = decrypt(preferences.getString("session", null) ?: return null).split("\n", limit = 7)
        if (values.size >= 4) Session(values[0], values[1], values[2], values[3], values.getOrNull(4)?.toBoolean() ?: false, values.getOrNull(5).orEmpty(), values.getOrNull(6).orEmpty()) else null
    }.getOrNull()

    fun saveDashboard(json: String) = preferences.edit().putString("dashboard_cache", encrypt(json)).apply()
    fun loadDashboard(): String? = runCatching { decrypt(preferences.getString("dashboard_cache", null) ?: return null) }.getOrNull()
    fun clearDashboard() = preferences.edit().remove("dashboard_cache").apply()
    fun clear() = preferences.edit().remove("session").apply()

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            generateKey()
        }
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        return Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray()), Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)))
    }
}




