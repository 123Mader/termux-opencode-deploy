package com.psyche.agentdock

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    private lateinit var btnToggle: Button
    private lateinit var statusView: TextView
    private lateinit var urlView: TextView
    private lateinit var tokenView: TextView
    private lateinit var logView: TextView

    private val logListener: (String) -> Unit = { log ->
        runOnUiThread { logView.text = log }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        btnToggle = findViewById(R.id.btn_toggle)
        statusView = findViewById(R.id.status)
        urlView = findViewById(R.id.mcp_url)
        tokenView = findViewById(R.id.auth_token)
        logView = findViewById(R.id.log_view)

        urlView.text = CoreProcess.MCP_URL
        tokenView.text = CoreProcess.token(this)

        btnToggle.setOnClickListener {
            if (CoreProcess.isRunning()) {
                AgentDockService.stop(this)
                btnToggle.text = "启动 AgentDock"
                statusView.text = "状态：已停止"
            } else {
                requestNotificationPermissionIfNeeded()
                AgentDockService.start(this)
                btnToggle.text = "停止 AgentDock"
                statusView.text = "状态：正在启动…"
            }
        }

        findViewById<Button>(R.id.btn_copy_url).setOnClickListener {
            copy(CoreProcess.MCP_URL)
        }

        findViewById<Button>(R.id.btn_copy_token).setOnClickListener {
            copy(tokenView.text.toString())
        }

        findViewById<Button>(R.id.btn_regenerate_token).setOnClickListener {
            val t = CoreProcess.regenerateToken(this)
            tokenView.text = t
            Toast.makeText(this, "已生成新 Token（重启服务后生效）", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onResume() {
        super.onResume()
        refreshUISnapshot()
        CoreProcess.addLogListener(logListener)
    }

    override fun onPause() {
        CoreProcess.removeLogListener(logListener)
        super.onPause()
    }

    private fun refreshUISnapshot() {
        val running = CoreProcess.isRunning()
        statusView.text = if (running) "状态：运行中（${CoreProcess.MCP_URL}）" else "状态：未启动"
        btnToggle.text = if (running) "停止 AgentDock" else "启动 AgentDock"
        tokenView.text = CoreProcess.token(this)
        logView.text = CoreProcess.logSnapshot()
    }

    private fun copy(text: String) {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("agentdock", text))
        Toast.makeText(this, "已复制", Toast.LENGTH_SHORT).show()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            }
        }
    }
}