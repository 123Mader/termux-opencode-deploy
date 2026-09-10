package com.psyche.agentdock

import android.content.Context
import android.os.Build
import java.io.File
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

object CoreProcess {

    const val HOST = "127.0.0.1"
    const val PORT = 8765
    const val MCP_URL = "http://$HOST:$PORT/mcp"

    private const val MAX_LOG = 6000
    private const val MAX_RESTARTS = 5

    private val listeners = CopyOnWriteArrayList<(String) -> Unit>()
    private val logBuf = StringBuilder(MAX_LOG)
    private val procRef = AtomicReference<Process?>(null)
    private val explicitlyStopped = AtomicBoolean(true)
    private var restarts = 0
    private val restartLock = Any()

    fun isRunning(): Boolean = procRef.get()?.isAlive == true

    fun addLogListener(l: (String) -> Unit) {
        listeners.add(l)
        synchronized(logBuf) { l(logBuf.toString()) }
    }

    fun removeLogListener(l: (String) -> Unit) {
        listeners.remove(l)
    }

    private fun appendLog(line: String) {
        val snapshot: String
        synchronized(logBuf) {
            logBuf.append(line).append('\n')
            val excess = logBuf.length - MAX_LOG
            if (excess > 0) logBuf.delete(0, excess)
            snapshot = logBuf.toString()
        }
        val copy = snapshot
        Thread {
            listeners.forEach { runCatching { it(copy) } }
        }.start()
    }

    fun logSnapshot(): String = synchronized(logBuf) { logBuf.toString() }

    fun token(context: Context): String {
        val p = context.getSharedPreferences("agentdock", Context.MODE_PRIVATE)
        var t = p.getString("auth_token", null)
        if (t == null) {
            t = UUID.randomUUID().toString().replace("-", "")
            p.edit().putString("auth_token", t).apply()
        }
        return t!!
    }

    fun regenerateToken(context: Context): String {
        val t = UUID.randomUUID().toString().replace("-", "")
        context.getSharedPreferences("agentdock", Context.MODE_PRIVATE)
            .edit().putString("auth_token", t).apply()
        return t
    }

    fun start(context: Context): Boolean {
        if (isRunning()) return true
        explicitlyStopped.set(false)
        synchronized(restartLock) {
            if (procRef.get()?.isAlive == true) return true
            return launch(context.applicationContext)
        }
    }

    fun stop() {
        explicitlyStopped.set(true)
        procRef.getAndSet(null)?.let {
            runCatching { it.destroy() }
        }
        appendLog("已停止 AgentDock")
    }

    private fun launch(ctx: Context): Boolean {
        val bin = deployBinary(ctx)
        if (bin == null) {
            appendLog("启动失败：未找到匹配 ABI 的 agentdock 二进制")
            return false
        }
        appendLog("二进制就绪：${bin.absolutePath}")

        val appDir = ctx.filesDir
        val tmpDir = File(appDir, "tmp").apply { mkdirs() }
        val homeDir = File(appDir, "home").apply { mkdirs() }
        val home = File(appDir, ".agentdock").apply { mkdirs() }
        val defaultDir = File(appDir, "AgentDock").apply { mkdirs() }
        val tok = token(ctx)

        val env = HashMap<String, String>()
        System.getenv().forEach { (k, v) -> env[k] = v }
        env.put("HOME", homeDir.absolutePath)
        env.put("TMP", tmpDir.absolutePath)
        env.put("TMPDIR", tmpDir.absolutePath)
        env.put("AGENTDOCK_HOME", home.absolutePath)
        env.put("AGENTDOCK_DEFAULT_DIR", defaultDir.absolutePath)
        env.put("AGENTDOCK_HOST", HOST)
        env.put("AGENTDOCK_PORT", PORT.toString())
        env.put("AGENTDOCK_AUTH_TOKEN", tok)
        env.put("AGENTDOCK_ACP_ENABLED", "false")
        env.put("AGENTDOCK_BROWSER_ENABLED", "false")

        val pb = ProcessBuilder(
            bin.absolutePath,
            "--host", HOST,
            "--port", PORT.toString(),
            "--log-level", "info"
        )
        pb.environment().clear()
        pb.environment().putAll(env)
        pb.redirectErrorStream(true)

        return try {
            val p = pb.start()
            procRef.set(p)
            Thread {
                try {
                    p.inputStream.bufferedReader().forEachLine { appendLog(it) }
                } catch (_: Exception) {
                }
                val code = runCatching { p.exitValue() }.getOrDefault(-1)
                appendLog("agentdock 进程退出，code=$code")
                handleExit(ctx)
            }.start()
            appendLog("AgentDock 已启动：$MCP_URL")
            true
        } catch (e: Exception) {
            appendLog("启动失败：$e")
            false
        }
    }

    private fun handleExit(ctx: Context) {
        if (explicitlyStopped.get()) return
        synchronized(restartLock) {
            if (explicitlyStopped.get()) return
            if (procRef.get()?.isAlive == true) return
            if (restarts >= MAX_RESTARTS) {
                appendLog("重启次数达到上限，请手动重新启动")
                return
            }
            restarts++
            appendLog("尝试自动重启（第 $restarts 次）")
            launch(ctx)
        }
    }

    private fun deployBinary(ctx: Context): File? {
        val abi = pickAbi()
        val destDir = File(ctx.filesDir, "bin").apply { mkdirs() }
        val dest = File(destDir, "agentdock")
        if (dest.exists() && dest.length() > 0) {
            dest.setExecutable(true, true)
            return dest
        }
        return try {
            ctx.assets.open("agentdock/$abi/agentdock").use { ins ->
                dest.outputStream().use { outs -> ins.copyTo(outs) }
            }
            dest.setExecutable(true, true)
            appendLog("部署核心 $abi -> ${dest.absolutePath}")
            dest
        } catch (e: Exception) {
            appendLog("部署二进制失败：$e")
            null
        }
    }

    fun pickAbi(): String {
        val wanted = listOf("arm64-v8a", "x86_64")
        for (abi in Build.SUPPORTED_ABIS) {
            if (abi in wanted) return abi
        }
        return "arm64-v8a"
    }
}