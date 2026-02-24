package io.toggly.core

import io.toggly.core.models.TogglyConfig
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class SmokeTest {

    @Test
    fun `loads live evaluated flags`() = runTest {
        val appKey = System.getenv("TOGGLY_SMOKE_APP_KEY_FRONTEND")
        if (appKey.isNullOrBlank()) {
            return@runTest
        }

        val service = TogglyService(
            TogglyConfig(
                appKey = appKey,
                environment = "Production",
                baseUri = "https://definitions.toggly.io",
                refreshInterval = 0
            )
        )

        service.init()

        assertTrue(service.isFeatureOn("FlagOn"))
        assertTrue(service.isFeatureOff("FlagOff"))
        assertFalse(service.isFeatureOn("FlagOff"))
    }

    @Test
    fun `WebSocket connects and receives initial message`() {
        val appKey = System.getenv("TOGGLY_SMOKE_APP_KEY_FRONTEND")
        if (appKey.isNullOrBlank()) {
            return
        }

        val client = OkHttpClient.Builder()
            .readTimeout(30, TimeUnit.SECONDS)
            .connectTimeout(15, TimeUnit.SECONDS)
            .build()

        val request = Request.Builder()
            .url("wss://definitions.toggly.io/$appKey/ws")
            .build()

        val latch = CountDownLatch(1)
        var definitionsMessage: String? = null
        var error: Throwable? = null

        val ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val json = JSONObject(text)
                val type = json.optString("type", "")
                if (type == "ping") {
                    return // skip ping messages, wait for definitions
                }
                definitionsMessage = text
                latch.countDown()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                error = t
                latch.countDown()
            }
        })

        assertTrue("WebSocket timed out after 30 seconds", latch.await(30, TimeUnit.SECONDS))

        if (error != null) {
            throw AssertionError("WebSocket connection error", error)
        }

        val json = JSONObject(definitionsMessage!!)
        val type = json.getString("type")
        assertTrue(
            "Expected type to be 'definitions' or 'evaluated', got '$type'",
            type == "definitions" || type == "evaluated"
        )
        assertTrue("Expected 'timestamp' field in message", json.has("timestamp"))

        ws.close(1000, "Test complete")
        client.dispatcher.executorService.shutdown()
    }
}
