package io.toggly.acceptance

import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.lifecycleScope
import io.toggly.compose.Feature
import io.toggly.compose.FeatureGate
import io.toggly.compose.TogglyProvider
import io.toggly.core.TogglyEntityContext
import io.toggly.core.TogglyService
import io.toggly.core.models.AppStateType
import io.toggly.core.models.FeatureRequirement
import io.toggly.core.models.TogglyConfig
import io.toggly.datastore.createDataStoreStorage
import io.toggly.room.createRoomStorage
import io.toggly.views.bindToFeatureFlag
import kotlinx.coroutines.launch

/** Host-only app: an explicit local URL is required; no production endpoint is embedded. */
class AcceptanceActivity : ComponentActivity() {
    private var service: TogglyService? = null
    private var variantService: TogglyService? = null
    private val status = mutableStateOf("Idle: supply local endpoint and runProbe extra")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val endpoint = intent.getStringExtra("endpoint")?.trimEnd('/')
        if (endpoint == null || !Regex("^http://(10\\.0\\.2\\.2|127\\.0\\.0\\.1):[0-9]+$").matches(endpoint)) {
            setContent { Text(status.value) }
            return
        }
        val config = TogglyConfig(
            appKey = "local-public-android", environment = "Acceptance", baseUri = endpoint,
            identity = "native-a", useSignedDefinitions = true, verifySignatures = true,
            enableLiveUpdates = false, refreshInterval = 0, metricsBaseUrl = endpoint,
            onTelemetryDiagnostic = { code -> Log.w("TogglyAcceptance", "telemetry diagnostic: $code") },
            storage = createRoomStorage(this)
        )
        val core = TogglyService(config)
        service = core
        variantService = TogglyService(config.copy(
            enableVariants = true, enableTelemetry = false,
            storage = createDataStoreStorage(this)
        ))
        setContent {
            TogglyProvider(core) {
                Column {
                    Feature("checkout") { Text("Compose checkout enabled") }
                    Feature("disabled", negate = true) { Text("Compose negated off") }
                    FeatureGate(listOf("checkout", "disabled"), FeatureRequirement.ANY) {
                        Text("Compose any gate")
                    }
                    AndroidView(factory = { context ->
                        TextView(context).apply {
                            text = "Views checkout enabled"
                            visibility = View.GONE
                            bindToFeatureFlag("checkout", this@AcceptanceActivity, core)
                        }
                    })
                    Text(status.value)
                }
            }
        }
        if (intent.getBooleanExtra("runProbe", false)) lifecycleScope.launch { runProbe(core) }
    }

    private suspend fun runProbe(core: TogglyService) {
        try {
            check(core.init().error == null) { "signed definitions init failed" }
            check(core.isFeatureOn("checkout"))
            check(!core.isFeatureOn("disabled"))
            check(core.evaluateFeatureGate(listOf("checkout", "disabled"), FeatureRequirement.ANY))
            check(!core.evaluateFeatureGate(listOf("checkout", "disabled"), FeatureRequirement.ALL))
            check(core.evaluateFeatureGate(listOf("disabled"), negate = true))
            val vip = TogglyEntityContext("Order", "vip", mapOf("Vip" to true))
            val standard = TogglyEntityContext("Order", "standard", mapOf("Vip" to false))
            check(core.isFeatureEnabled("ExpressCheckout", vip))
            check(!core.isFeatureEnabled("ExpressCheckout", standard))
            check(!core.isFeatureEnabled("ExpressCheckout"))
            core.recordUsage("checkout", "preview-a")
            core.recordView("checkout", "preview-a")
            core.incrementCounter("orders", 2.0)
            core.setGauge("queue", 3.5)
            core.flushTelemetry()

            val variants = requireNotNull(variantService)
            check(variants.init().error == null) { "signed variants init failed" }
            check(variants.getVariant("checkout")?.name == "blue")
            check(variants.getVariantValue("checkout") == 7L)

            check(core.setIdentity("native-b", "local-minted-fixture").error == null)
            core.recordUsage("after-replacement")
            core.flushTelemetry()
            status.value = "PUBLIC_ANDROID_API_PROBE_PASS"
            Log.i("TogglyAcceptance", status.value)
        } catch (error: Throwable) {
            status.value = "PUBLIC_ANDROID_API_PROBE_FAIL: ${error.message}"
            Log.e("TogglyAcceptance", status.value, error)
        }
    }

    override fun onPause() {
        Log.i("TogglyAcceptance", "LIFECYCLE_BACKGROUND")
        service?.let { lifecycleScope.launch { it.setAppState(AppStateType.BACKGROUND) } }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        Log.i("TogglyAcceptance", "LIFECYCLE_ACTIVE")
        service?.let { lifecycleScope.launch { it.setAppState(AppStateType.ACTIVE) } }
    }

    override fun onDestroy() {
        variantService?.dispose()
        service?.dispose()
        Log.i("TogglyAcceptance", "LIFECYCLE_DISPOSED")
        super.onDestroy()
    }
}
