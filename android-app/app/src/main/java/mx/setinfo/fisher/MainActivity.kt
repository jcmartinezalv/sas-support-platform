package mx.setinfo.fisher

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = SecureSessionStore(this)
        setContent {
            FisherTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    FisherApp(store)
                }
            }
        }
    }
}

@Composable private fun FisherTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFF59E3a5), secondary = Color(0xFF8aaFa2), background = Color(0xFF071E22), surface = Color(0xFF12343B), surfaceVariant = Color(0xFF1A444a), error = Color(0xFFFFB4AB)), content = content)
}

@Composable private fun FisherApp(store: SecureSessionStore) {
    var session by remember { mutableStateOf(store.load()) }
    var server by remember { mutableStateOf(store.serverUrl()) }
    val api = remember(server) { FisherApi(server) }
    var refreshing by remember { mutableStateOf(false) }
    var refreshWarning by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(session?.refreshToken, server) {
        while (session != null) {
            val current = session ?: break
            if (!refreshing && isExpiring(current.accessExpiresAt)) {
                refreshing = true
                api.refresh(current.refreshToken, store.deviceId()) { result -> result.fold({ store.save(it); session = it; refreshWarning = null; refreshing = false }, { error -> if (error is HttpFailure && error.status in 401..403) { store.clear(); session = null } else { refreshWarning = "Reconectando sin cerrar tu sesión" }; refreshing = false }) }
            }
            delay(60_000)
        }
    }
    if (session == null) LoginScreen(server, { server = it; store.saveServerUrl(it) }) { username, password, finished ->
        api.login(username, password, store.deviceId()) { result -> result.fold({ store.save(it); session = it; finished(null) }, { finished(it.message ?: "No fue posible iniciar sesión") }) }
    } else if (session!!.mustChangePassword) ChangePasswordScreen(api, session!!) {
        store.clear(); session = null
    } else HomeScreen(api, store, session!!, refreshing, refreshWarning, onLogout = { api.logout(session!!.accessToken) { }; store.clear(); session = null })
}

@Composable private fun ChangePasswordScreen(api: FisherApi, session: Session, completed: () -> Unit) {
    var current by remember { mutableStateOf("") }; var next by remember { mutableStateOf("") }; var confirm by remember { mutableStateOf("") }; var error by remember { mutableStateOf<String?>(null) }; var busy by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Protege tu acceso", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text("Debes reemplazar la contraseña temporal antes de consultar información de Fisher.", color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(20.dp))
        OutlinedTextField(current, { current = it }, Modifier.fillMaxWidth(), label = { Text("Contraseña temporal") }, visualTransformation = PasswordVisualTransformation())
        OutlinedTextField(next, { next = it }, Modifier.fillMaxWidth(), label = { Text("Nueva contraseña") }, visualTransformation = PasswordVisualTransformation())
        OutlinedTextField(confirm, { confirm = it }, Modifier.fillMaxWidth(), label = { Text("Confirmar nueva contraseña") }, visualTransformation = PasswordVisualTransformation())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
        Button({
            if (next.length < 12 || next != confirm) { error = "La nueva contraseña debe tener 12 caracteres o más y coincidir."; return@Button }
            busy = true; error = null
            api.changePassword(session.accessToken, current, next) { result -> result.fold({ completed() }, { error = it.message ?: "No fue posible cambiar la contraseña"; busy = false }) }
        }, Modifier.fillMaxWidth().padding(top = 16.dp), enabled = !busy && current.isNotBlank() && next.isNotBlank()) { Text(if (busy) "Actualizando…" else "Guardar y volver a entrar") }
    }
}
@Composable private fun LoginScreen(server: String, onServer: (String) -> Unit, onLogin: (String, String, (String?) -> Unit) -> Unit) {
    var username by remember { mutableStateOf("") }; var password by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf<String?>(null) }
    val loginFieldColors = OutlinedTextFieldDefaults.colors(
        focusedTextColor = Color.White,
        unfocusedTextColor = Color.White,
        cursorColor = MaterialTheme.colorScheme.primary,
        focusedBorderColor = MaterialTheme.colorScheme.primary,
        unfocusedBorderColor = Color(0xFF90A4AE),
        focusedLabelColor = MaterialTheme.colorScheme.primary,
        unfocusedLabelColor = Color(0xFFaFD8Da),
        focusedContainerColor = Color(0xFF0B2A30),
        unfocusedContainerColor = Color(0xFF0B2A30)
    )
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Fisher", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold); Text("Supervisión móvil segura", color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(28.dp)); OutlinedTextField(server, onServer, Modifier.fillMaxWidth(), label = { Text("Servidor HTTPS") }, colors = loginFieldColors)
        OutlinedTextField(username, { username = it }, Modifier.fillMaxWidth(), label = { Text("Usuario") }, colors = loginFieldColors)
        OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Contraseña") }, visualTransformation = PasswordVisualTransformation(), colors = loginFieldColors)
        if (!server.startsWith("https://")) Text("El servidor debe usar HTTPS.", color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
        Spacer(Modifier.height(16.dp)); Button({ busy = true; error = null; onLogin(username, password) { message -> error = message; busy = false } }, Modifier.fillMaxWidth(), enabled = !busy && server.startsWith("https://") && username.isNotBlank() && password.isNotBlank()) { Text(if (busy) "Conectando…" else "Iniciar sesión") }
        Text("La aplicación no ejecuta reparaciones; las acciones sensibles conservan aprobación en el servidor.", Modifier.padding(top = 16.dp), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun HomeScreen(api: FisherApi, store: SecureSessionStore, session: Session, refreshing: Boolean, refreshWarning: String?, onLogout: () -> Unit) {
    var tab by remember { mutableIntStateOf(0) }; var dashboard by remember { mutableStateOf(store.loadDashboard()?.let { runCatching { JSONObject(it) }.getOrNull() }) }; var activity by remember { mutableStateOf<JSONObject?>(null) }; var notifications by remember { mutableStateOf<JSONObject?>(null) }; var knowledge by remember { mutableStateOf<JSONObject?>(null) }; var preferences by remember { mutableStateOf<JSONObject?>(null) }; var activityLimit by remember { mutableIntStateOf(20) }; var notificationLimit by remember { mutableIntStateOf(20) }; var offline by remember { mutableStateOf(false) }
    fun loadMobileData() {
        api.dashboard(session.accessToken) { result -> result.fold({ dashboard = it; store.saveDashboard(it.toString()); offline = false }, { offline = true }) }
        api.activity(session.accessToken, activityLimit) { it.onSuccess { value -> activity = value; offline = false }.onFailure { offline = true } }
        api.notifications(session.accessToken, notificationLimit) { it.onSuccess { value -> notifications = value; offline = false }.onFailure { offline = true } }
        api.knowledge(session.accessToken) { it.onSuccess { value -> knowledge = value; offline = false }.onFailure { offline = true } }
        api.notificationPreferences(session.accessToken) { it.onSuccess { value -> preferences = value }.onFailure { offline = true } }
    }
    LaunchedEffect(session.accessToken) { loadMobileData() }
    Scaffold(topBar = { Surface(Modifier.fillMaxWidth().statusBarsPadding()) { Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Fisher", fontWeight = FontWeight.Bold); Text("${session.displayName} · ${mobileRoleLabel(session.role)}${if (refreshing) " · actualizando" else if (refreshWarning != null) " · reconectando" else ""}", style = MaterialTheme.typography.bodySmall) }; TextButton(onLogout) { Text("Salir") } } } }, bottomBar = { NavigationBar { listOf("Tablero" to "⌂", "Alertas" to "!", "Actividad" to "↻", "Consultar" to "?", "Ajustes" to "⚙").forEachIndexed { index, item -> NavigationBarItem(tab == index, { tab = index }, { Text(item.second) }, label = { Text(item.first) }) } } }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) { if (offline) Surface(color = MaterialTheme.colorScheme.secondaryContainer) { Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) { Text("Sin conexión · mostrando datos guardados", Modifier.weight(1f)); TextButton({ loadMobileData() }) { Text("Reintentar") } } }; Box(Modifier.weight(1f).fillMaxWidth()) { when (tab) { 0 -> DashboardScreen(dashboard); 1 -> NotificationsScreen(api, session.accessToken, notifications, notificationLimit, { notificationLimit = minOf(100, notificationLimit + 20); api.notifications(session.accessToken, notificationLimit) { result -> result.onSuccess { notifications = it } } }) { api.notifications(session.accessToken, notificationLimit) { result -> result.onSuccess { notifications = it } } }; 2 -> ActivityScreen(activity, activityLimit) { activityLimit = minOf(100, activityLimit + 20); api.activity(session.accessToken, activityLimit) { result -> result.onSuccess { activity = it } } }; 3 -> SolutionsScreen(api, session.accessToken, session.role, knowledge) { knowledge = it }; 4 -> ChatScreen(api, session.accessToken); else -> PreferencesScreen(api, session.accessToken, preferences) { preferences = it } } } }
    }
}

@Composable private fun DashboardScreen(data: JSONObject?) {
    if (data == null) return Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    val counts = data.getJSONObject("counts"); val metrics = listOf("Tickets abiertos" to counts.optInt("openTickets"), "Urgentes" to counts.optInt("urgentTickets"), "Sesiones remotas" to counts.optInt("activeRemoteSessions"), "Agentes en línea" to counts.optInt("onlineAgents"), "Conocimiento pendiente" to counts.optInt("pendingKnowledge"))
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { item { Text("Estado operativo", style = MaterialTheme.typography.headlineSmall) }; items(metrics) { metric -> Card(Modifier.fillMaxWidth()) { Row(Modifier.padding(18.dp)) { Text(metric.first, Modifier.weight(1f)); Text(metric.second.toString(), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary) } } }; val tickets = data.optJSONArray("tickets"); if (tickets != null) items(tickets.length()) { i -> val item = tickets.getJSONObject(i); ListItem(headlineContent = { Text(item.optString("subject")) }, supportingContent = { Text("${item.optString("id")} · ${mobileStatusLabel(item.optString("status"))}") }, trailingContent = { AssistChip(onClick = {}, label = { Text(mobilePriorityLabel(item.optString("priority"))) }) }) } }
}

@Composable private fun SolutionsScreen(api: FisherApi, token: String, role: String, data: JSONObject?, updated: (JSONObject) -> Unit) {
    val articles = data?.optJSONArray("articles")
    val canReview = role == "admin" || role == "supervisor"
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Text("Soluciones de Fisher", style = MaterialTheme.typography.headlineSmall); Text("Revisa el ranking y decide qué conocimiento puede reutilizar Fisher.", style = MaterialTheme.typography.bodySmall) }
        if (articles == null) item { CircularProgressIndicator(Modifier.padding(24.dp)) }
        else if (articles.length() == 0) item { Text("No hay soluciones para revisar.") }
        else items(articles.length()) { index ->
            val article = articles.getJSONObject(index); val status = article.optString("status", "pending_review"); val score = article.optInt("reviewScore", 0)
            Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) { Text(article.optString("title", "Solución"), Modifier.weight(1f), fontWeight = FontWeight.Bold); AssistChip(onClick = {}, label = { Text("Ranking $score/100") }) }
                Text("Estado: ${mobileKnowledgeStatus(status)}", color = if (status == "approved") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary)
                Text(article.optString("researchSummary", article.optString("category", "Propuesta de Fisher")), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
                if (canReview && status == "pending_review") Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                    Button({ api.reviewKnowledge(token, article.optString("id"), "approved") { result -> result.onSuccess { api.knowledge(token) { it.onSuccess(updated) } } } }) { Text("Aceptar") }
                    OutlinedButton({ api.reviewKnowledge(token, article.optString("id"), "rejected") { result -> result.onSuccess { api.knowledge(token) { it.onSuccess(updated) } } } }) { Text("Rechazar") }
                }
            } }
        }
    }
}
@Composable private fun NotificationsScreen(api: FisherApi, token: String, data: JSONObject?, limit: Int, loadMore: () -> Unit, refresh: () -> Unit) {
    val alerts = data?.optJSONArray("notifications")
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Alertas", style = MaterialTheme.typography.headlineSmall); Text("${data?.optInt("unread") ?: 0} sin leer", color = MaterialTheme.colorScheme.primary) }; if ((data?.optInt("unread") ?: 0) > 0) TextButton({ api.markAllNotificationsRead(token) { refresh() } }) { Text("Leer todas") } } }
        if (alerts == null) item { CircularProgressIndicator(Modifier.padding(24.dp)) }
        else if (alerts.length() == 0) item { Text("No hay alertas pendientes.", Modifier.padding(top = 24.dp)) }
        else {
            items(alerts.length()) { index ->
                val alert = alerts.getJSONObject(index); val unread = alert.isNull("readAt")
                Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp)) { Text(alert.optString("title"), fontWeight = FontWeight.Bold, color = if (alert.optString("severity") == "critical") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary); Text(alert.optString("message")); if (unread) TextButton({ api.markNotificationRead(token, alert.getString("id")) { refresh() } }) { Text("Marcar como leída") } } }
            }
            if (alerts.length() >= limit && limit < 100) item { TextButton(loadMore, Modifier.fillMaxWidth()) { Text("Cargar más alertas") } }
        }
    }
}
@Composable private fun PreferencesScreen(api: FisherApi, token: String, data: JSONObject?, updated: (JSONObject) -> Unit) {
    if (data == null) return Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    val options = listOf("urgentTickets" to "Tickets urgentes", "fisherCritical" to "Actividad crítica de Fisher", "knowledgeReview" to "Conocimiento listo para revisar")
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Alertas que deseas recibir", style = MaterialTheme.typography.headlineSmall)
        Text("Estos ajustes se guardan para tu usuario.", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(16.dp))
        options.forEach { option ->
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(option.second, Modifier.weight(1f)); Switch(data.optBoolean(option.first, true), { enabled ->
                    val next = JSONObject(data.toString()).put(option.first, enabled)
                    api.updateNotificationPreferences(token, next) { result -> result.onSuccess(updated) }
                })
            }
        }
    }
}
@Composable private fun ActivityScreen(data: JSONObject?, limit: Int, loadMore: () -> Unit) {
    val events = data?.optJSONArray("events")
    LazyColumn(Modifier.fillMaxSize().padding(16.dp)) {
        item { Text("Actividad de Fisher", style = MaterialTheme.typography.headlineSmall) }
        if (events == null) item { CircularProgressIndicator(Modifier.padding(24.dp)) }
        else {
            if (events.length() == 0) item { Text("No hay actividad reciente.", Modifier.padding(top = 24.dp)) }
            items(events.length()) { index -> val event = events.getJSONObject(index); ListItem(headlineContent = { Text(mobileActionLabel(event.optString("action"))) }, supportingContent = { Text("${event.optString("entityId")} · ${mobileDateLabel(event.optString("createdAt"))}") }) }
            if (events.length() >= limit && limit < 100) item { TextButton(loadMore, Modifier.fillMaxWidth()) { Text("Cargar más actividad") } }
        }
    }
}
@Composable private fun ChatScreen(api: FisherApi, token: String) {
    var input by remember { mutableStateOf("") }; var messages by remember { mutableStateOf(listOf("Fisher" to "Puedo resumir tickets urgentes, un ticket TCK, propuestas pendientes o mi actividad reciente.")) }; var busy by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().padding(16.dp)) { LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) { items(messages) { message -> Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) { Text(message.first, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold); Text(message.second) } } } }; Row(verticalAlignment = Alignment.CenterVertically) { OutlinedTextField(input, { input = it }, Modifier.weight(1f), label = { Text("Pregunta a Fisher") }); Spacer(Modifier.width(8.dp)); Button({ val question = input; input = ""; busy = true; messages = messages + ("Tú" to question); api.ask(token, question) { result -> messages = messages + ("Fisher" to result.fold(::formatFisherAnswer, { it.message ?: "No fue posible consultar" })); busy = false } }, enabled = input.isNotBlank() && !busy) { Text(if (busy) "Consultando…" else "Enviar") } } }
}






private fun mobileRoleLabel(value: String): String = mapOf(
    "admin" to "Administrador", "supervisor" to "Supervisor", "technician" to "Técnico", "viewer" to "Consulta"
)[value.lowercase()] ?: "Usuario"

private fun mobileStatusLabel(value: String): String = mapOf(
    "open" to "Abierto", "in_progress" to "En progreso", "waiting_customer" to "Espera al cliente",
    "resolved" to "Resuelto", "closed" to "Cerrado", "pending_review" to "Por revisar", "active" to "Activo"
)[value.lowercase()] ?: "Estado actualizado"

private fun mobilePriorityLabel(value: String): String = mapOf(
    "urgent" to "Urgente", "high" to "Alta", "normal" to "Normal", "low" to "Baja"
)[value.lowercase()] ?: "Normal"

private fun mobileActionLabel(value: String): String = mapOf(
    "ticket.created" to "Ticket creado", "ticket.updated" to "Ticket actualizado",
    "remote.created" to "Soporte remoto solicitado", "remote.started" to "Soporte remoto iniciado",
    "remote.closed" to "Soporte remoto finalizado", "fisher.diagnosed" to "Fisher completó un diagnóstico",
    "knowledge.approved" to "Solución aprobada", "knowledge.rejected" to "Solución rechazada"
)[value.lowercase()] ?: value.replace('_', ' ').replace('.', ' ').replaceFirstChar { it.titlecase(Locale("es", "MX")) }

private fun mobileKnowledgeStatus(value: String): String = mapOf("pending_review" to "Pendiente", "approved" to "Aprobada", "rejected" to "Rechazada")[value] ?: value

private fun mobileDateLabel(value: String): String = runCatching {
    DateTimeFormatter.ofPattern("d MMM, HH:mm", Locale("es", "MX")).withZone(ZoneId.systemDefault()).format(Instant.parse(value))
}.getOrDefault("Fecha no disponible")

private fun formatFisherAnswer(answer: JSONObject): String =
    listOf("message", "summary", "text")
        .firstNotNullOfOrNull { key -> answer.optString(key).takeIf(String::isNotBlank) }
        ?: "Fisher completó la consulta, pero no devolvió un resumen legible."
private fun isExpiring(value: String): Boolean = runCatching {
    value.isBlank() || Instant.parse(value).toEpochMilli() <= System.currentTimeMillis() + 120_000
}.getOrDefault(true)






