package ru.twmmarket.apkupdate

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Свой класс провайдера, чтобы не пересекаться с другими FileProvider в приложении. */
class ApkFileProvider : FileProvider()

@InvokeArg
class DownloadArgs {
    lateinit var url: String
    var sha256: String? = null
}

/**
 * Обновление приложения: скачать APK выпуска с GitHub в личную папку
 * приложения, сверить SHA-256 и открыть системный установщик.
 * Установщик Android сам проверяет, что обновление подписано тем же ключом.
 */
@TauriPlugin
class ApkUpdatePlugin(private val activity: Activity) : Plugin(activity) {
    @Volatile private var state = "idle"
    @Volatile private var downloaded = 0L
    @Volatile private var total = 0L
    @Volatile private var error: String? = null

    private fun dir(): File = File(activity.cacheDir, "updates")
    private fun apkFile(): File = File(dir(), "TWM-Market.apk")

    /** Скачивать можно только выпуски с GitHub (и его хранилища файлов). */
    private fun allowedHost(url: URL): Boolean =
        url.protocol == "https" && (url.host == "github.com" || url.host.endsWith(".githubusercontent.com"))

    @Command
    fun download(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadArgs::class.java)
        if (state == "downloading") {
            invoke.resolve(JSObject())
            return
        }
        val start = try {
            URL(args.url)
        } catch (e: Exception) {
            invoke.reject("Неверный адрес обновления")
            return
        }
        if (!allowedHost(start)) {
            invoke.reject("Обновление можно скачать только с GitHub")
            return
        }
        state = "downloading"
        downloaded = 0
        total = 0
        error = null
        Thread {
            val part = File(dir(), "TWM-Market.apk.part")
            try {
                dir().mkdirs()
                var url = start
                var connection: HttpURLConnection
                var redirects = 0
                // GitHub отвечает переадресацией на хранилище файлов — проходим её сами,
                // проверяя каждый адрес.
                while (true) {
                    connection = url.openConnection() as HttpURLConnection
                    connection.instanceFollowRedirects = false
                    connection.connectTimeout = 20_000
                    connection.readTimeout = 30_000
                    val code = connection.responseCode
                    if (code in 300..399) {
                        val location = connection.getHeaderField("Location") ?: throw Exception("GitHub не указал, откуда скачивать")
                        connection.disconnect()
                        url = URL(url, location)
                        if (!allowedHost(url)) throw Exception("Обновление можно скачать только с GitHub")
                        redirects += 1
                        if (redirects > 5) throw Exception("Слишком много переадресаций")
                        continue
                    }
                    if (code != 200) throw Exception("GitHub ответил $code")
                    break
                }
                total = connection.contentLengthLong
                val digest = MessageDigest.getInstance("SHA-256")
                connection.inputStream.use { input ->
                    part.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            digest.update(buffer, 0, read)
                            downloaded += read
                        }
                    }
                }
                connection.disconnect()
                val actual = digest.digest().joinToString("") { "%02x".format(it) }
                val expected = args.sha256?.trim()?.lowercase()
                if (!expected.isNullOrEmpty() && expected != actual) {
                    throw Exception("Файл повреждён при загрузке (не совпала контрольная сумма). Попробуйте ещё раз.")
                }
                val target = apkFile()
                if (target.exists()) target.delete()
                if (!part.renameTo(target)) throw Exception("Не удалось сохранить обновление")
                state = "ready"
            } catch (e: Exception) {
                part.delete()
                error = e.message ?: e.toString()
                state = "error"
            }
        }.start()
        invoke.resolve(JSObject())
    }

    @Command
    fun status(invoke: Invoke) {
        val result = JSObject()
        result.put("state", state)
        result.put("downloaded", downloaded)
        result.put("total", total)
        error?.let { result.put("error", it) }
        invoke.resolve(result)
    }

    @Command
    fun install(invoke: Invoke) {
        val file = apkFile()
        if (state != "ready" || !file.exists()) {
            invoke.reject("Обновление ещё не скачано")
            return
        }
        val result = JSObject()
        try {
            // С Android 8 установку из приложения нужно один раз разрешить в настройках.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
                val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName))
                activity.startActivity(settings)
                result.put("needsPermission", true)
                invoke.resolve(result)
                return
            }
            val uri = FileProvider.getUriForFile(activity, activity.packageName + ".apkupdate", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
            result.put("needsPermission", false)
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject("Не удалось открыть установщик: ${e.message ?: e}")
        }
    }
}
