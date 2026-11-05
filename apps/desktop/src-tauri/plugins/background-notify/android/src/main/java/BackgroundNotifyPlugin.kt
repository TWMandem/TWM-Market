package ru.twmmarket.bgnotify

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * Хранилище фоновой проверки: адрес сервера, ключ устройства и номер
 * последнего показанного уведомления. Лежит в личной папке приложения.
 */
internal object Store {
    private const val FILE = "twm_background_notify"
    const val NO_CURSOR = -1L

    fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun clear(context: Context) = prefs(context).edit().clear().apply()

    /** Сдвинуть отметку вперёд (назад — никогда). */
    fun advance(context: Context, id: Long) {
        val p = prefs(context)
        if (id > p.getLong("cursor", NO_CURSOR)) p.edit().putLong("cursor", id).apply()
    }
}

internal object Notifier {
    private const val CHANNEL = "twm_updates"

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL) != null) return
        val channel = NotificationChannel(CHANNEL, "Сообщения и сделки", NotificationManager.IMPORTANCE_DEFAULT)
        channel.description = "Новые сообщения, предложения цены, сделки и изменения в избранном"
        manager.createNotificationChannel(channel)
    }

    fun allowed(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /** Ссылки внутри приложения: только пути вида /chats/…, /listing/… и т. п. */
    private fun safeLink(link: String?): String? =
        if (link != null && Regex("^/[a-z0-9/_-]{1,120}$", RegexOption.IGNORE_CASE).matches(link)) link else null

    fun show(context: Context, id: Long, title: String, body: String, link: String?) {
        if (!allowed(context)) return
        ensureChannel(context)
        val path = safeLink(link)
        // Нажатие открывает приложение на нужном экране (ссылка twm-market://open/…).
        val intent = if (path != null) {
            Intent(Intent.ACTION_VIEW, Uri.parse("twm-market://open$path")).setPackage(context.packageName)
        } else {
            context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(
            context,
            (id % Int.MAX_VALUE).toInt(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.twm_notification)
            .setColor(0xFFFFB224.toInt())
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        try {
            // Номер уведомления с сервера: одно и то же уведомление не появится дважды.
            NotificationManagerCompat.from(context).notify("twm", (id % Int.MAX_VALUE).toInt(), notification)
        } catch (e: SecurityException) {
            // Разрешение на уведомления отозвали — просто не показываем.
        }
    }
}

/** Фоновая проверка: спросить сервер о новых уведомлениях и показать их. */
class PollWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val context = applicationContext
        val prefs = Store.prefs(context)
        val api = prefs.getString("apiUrl", null) ?: return Result.success()
        val token = prefs.getString("token", null) ?: return Result.success()
        val cursor = prefs.getLong("cursor", Store.NO_CURSOR)
        val query = if (cursor >= 0) "?after=$cursor" else ""
        return try {
            val connection = URL("$api/v1/push/poll$query").openConnection() as HttpURLConnection
            connection.connectTimeout = 15_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("Authorization", "Device $token")
            connection.setRequestProperty("Accept", "application/json")
            val code = connection.responseCode
            if (code == 401) {
                // Вышли из аккаунта на всех устройствах или аккаунт заблокирован:
                // приложение зарегистрирует устройство заново при следующем входе.
                Store.clear(context)
                WorkManager.getInstance(context).cancelUniqueWork(WORK)
                return Result.success()
            }
            if (code != 200) return Result.success()
            val text = connection.inputStream.bufferedReader().use { it.readText() }
            connection.disconnect()
            val json = JSONObject(text)
            val items = json.optJSONArray("items")
            // Приложение на экране — уведомления показывает оно само.
            if (items != null && !BackgroundNotifyPlugin.foreground) {
                for (i in 0 until items.length()) {
                    val item = items.getJSONObject(i)
                    val link = if (item.isNull("link")) null else item.optString("link")
                    Notifier.show(context, item.getLong("id"), item.optString("title"), item.optString("body"), link)
                }
            }
            Store.advance(context, json.optLong("cursor", cursor))
            Result.success()
        } catch (e: Exception) {
            // Нет сети и т. п. — попробуем в следующий раз.
            Result.success()
        }
    }

    companion object {
        const val WORK = "twm-background-notify"
    }
}

@InvokeArg
class StartArgs {
    lateinit var apiUrl: String
    lateinit var token: String
}

@InvokeArg
class SeenArgs {
    var id: Long = 0
}

@InvokeArg
class StatusBarArgs {
    var light: Boolean = false
}

@InvokeArg
class NotifyArgs {
    var id: Long = 0
    var title: String = ""
    var body: String = ""
    var link: String? = null
}

@TauriPlugin
class BackgroundNotifyPlugin(private val activity: Activity) : Plugin(activity) {
    private val context: Context get() = activity.applicationContext

    companion object {
        /** Приложение на экране (не свёрнуто): тогда уведомления Android не нужны. */
        @Volatile
        var foreground = false
    }

    // Отступы под строку состояния и панель жестов, в пикселях CSS.
    @Volatile private var safeTop = 0f
    @Volatile private var safeBottom = 0f

    override fun onResume() {
        foreground = true
    }

    override fun onPause() {
        foreground = false
    }

    /**
     * Android 15 рисует приложение под строкой состояния и панелью жестов.
     * Передаём их высоту в интерфейс CSS-переменными --safe-top / --safe-bottom.
     */
    override fun load(webView: WebView) {
        super.load(webView)
        foreground = true
        val density = activity.resources.displayMetrics.density
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            safeTop = bars.top / density
            safeBottom = bars.bottom / density
            (view as WebView).evaluateJavascript(
                "document.documentElement.style.setProperty('--safe-top','${safeTop}px');" +
                    "document.documentElement.style.setProperty('--safe-bottom','${safeBottom}px');",
                null,
            )
            insets
        }
        ViewCompat.requestApplyInsets(webView)
    }

    @Command
    fun insets(invoke: Invoke) {
        val result = JSObject()
        result.put("top", safeTop.toDouble())
        result.put("bottom", safeBottom.toDouble())
        invoke.resolve(result)
    }

    @Command
    fun statusBar(invoke: Invoke) {
        val args = invoke.parseArgs(StatusBarArgs::class.java)
        activity.runOnUiThread {
            val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
            controller.isAppearanceLightStatusBars = args.light
            controller.isAppearanceLightNavigationBars = args.light
        }
        invoke.resolve(JSObject())
    }

    @Command
    fun start(invoke: Invoke) {
        val args = invoke.parseArgs(StartArgs::class.java)
        if (!args.apiUrl.startsWith("https://") && !args.apiUrl.startsWith("http://")) {
            invoke.reject("Неверный адрес сервера")
            return
        }
        val prefs = Store.prefs(context)
        val sameToken = prefs.getString("token", null) == args.token
        val editor = prefs.edit()
        editor.putString("apiUrl", args.apiUrl.trimEnd('/'))
        editor.putString("token", args.token)
        // Новый ключ — начинаем с текущего момента: старые уведомления не показываем.
        if (!sameToken) editor.putLong("cursor", Store.NO_CURSOR)
        editor.apply()
        val request = PeriodicWorkRequest.Builder(PollWorker::class.java, 15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PollWorker.WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
        invoke.resolve(JSObject())
    }

    @Command
    fun stop(invoke: Invoke) {
        val token = Store.prefs(context).getString("token", null)
        WorkManager.getInstance(context).cancelUniqueWork(PollWorker.WORK)
        Store.clear(context)
        val result = JSObject()
        if (token != null) result.put("token", token)
        invoke.resolve(result)
    }

    @Command
    fun status(invoke: Invoke) {
        val result = JSObject()
        result.put("active", Store.prefs(context).getString("token", null) != null)
        result.put("permission", Notifier.allowed(context))
        invoke.resolve(result)
    }

    @Command
    fun seen(invoke: Invoke) {
        val args = invoke.parseArgs(SeenArgs::class.java)
        Store.advance(context, args.id)
        invoke.resolve(JSObject())
    }

    @Command
    fun notify(invoke: Invoke) {
        val args = invoke.parseArgs(NotifyArgs::class.java)
        // Свёрнуто — показать уведомление Android; на экране — игрок видит его в приложении.
        if (!foreground) Notifier.show(context, args.id, args.title, args.body, args.link)
        Store.advance(context, args.id)
        invoke.resolve(JSObject())
    }
}
