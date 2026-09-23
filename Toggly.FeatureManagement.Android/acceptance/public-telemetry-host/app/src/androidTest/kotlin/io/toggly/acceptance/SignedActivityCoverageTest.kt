package io.toggly.acceptance

import android.content.Intent
import android.os.SystemClock
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import java.util.zip.GZIPInputStream

/** Exercises the signed app Activity itself, complementing direct SDK API tests. */
@RunWith(AndroidJUnit4::class)
class SignedActivityCoverageTest {
    @Test fun signedActivityLifecycleDeliversBeforeAndAfterReplacement() {
        val pair = KeyPairGenerator.getInstance("EC").apply {
            initialize(ECGenParameterSpec("secp256r1"))
        }.generateKeyPair()
        val coordinates = (pair.public as ECPublicKey).w
        val x = fixedLength(coordinates.affineX)
        val y = fixedLength(coordinates.affineY)
        val kid = MessageDigest.getInstance("SHA-1").digest(x + y)
            .joinToString("") { "%02X".format(it) } + "ES256"
        val b64url = Base64.getUrlEncoder().withoutPadding()
        val jwks = """{"keys":[{"kty":"EC","use":"sig","kid":"$kid","crv":"P-256","alg":"ES256","x":"${b64url.encodeToString(x)}","y":"${b64url.encodeToString(y)}"}]}"""
        fun signed(defs: String): String {
            val timestamp = System.currentTimeMillis() / 1000
            val sha = MessageDigest.getInstance("SHA-256")
            val first = sha.digest("$defs|$timestamp".toByteArray())
            val digest = sha.digest(first)
            val signature = Signature.getInstance("NONEwithECDSA").apply {
                initSign(pair.private)
                update(digest)
            }
            val raw = derToRaw(signature.sign())
            return """{"defs":$defs,"timestamp":$timestamp,"signature":"${Base64.getEncoder().encodeToString(raw)}","kid":"$kid"}"""
        }
        val flags = signed("""{"checkout":true,"disabled":false,"ExpressCheckout":{"requirement":"all","rules":[{"property":"Vip","op":"eq","type":"boolean","value":"true"}]}}""")
        val variants = signed("""{"checkout":{"enabled":true,"variant":"blue","configurationValue":7},"disabled":{"enabled":false}}""")
        val packets = CopyOnWriteArrayList<JSONObject>()
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (request.method == "POST" && request.path == "/api/frontend/telemetry") {
                        val bytes = request.body.readByteArray()
                        val body = if (request.getHeader("Content-Encoding") == "gzip")
                            GZIPInputStream(bytes.inputStream()).readBytes() else bytes
                        packets += JSONObject(body.decodeToString())
                        return MockResponse().setResponseCode(202)
                    }
                    val body = when {
                        request.path?.startsWith("/.well-known/jwks") == true -> jwks
                        request.path?.contains("evaluated-variants-signed") == true -> variants
                        request.path?.contains("evaluated-signed") == true -> flags
                        else -> return MockResponse().setResponseCode(404)
                    }
                    return MockResponse().setResponseCode(200)
                        .addHeader("Content-Type", "application/json").setBody(body)
                }
            }
            server.start()
            val intent = Intent(ApplicationProvider.getApplicationContext(), AcceptanceActivity::class.java)
                .putExtra("endpoint", "http://127.0.0.1:${server.port}")
                .putExtra("runProbe", true)
            ActivityScenario.launch<AcceptanceActivity>(intent).use { activity ->
                waitForPacket(packets) { it.has("i") && it.optJSONObject("f")?.has("after-replacement") == true }
                assertTrue(packets.any { it.optString("u") == "native-a" })
                assertTrue(packets.any { it.optString("i") == "local-minted-fixture" })
                activity.moveToState(Lifecycle.State.STARTED)
                activity.moveToState(Lifecycle.State.RESUMED)
            }
            waitForPacket(packets) { it.optJSONObject("f")?.has("teardown") == true }
            assertTrue(packets.all { it.getString("k") == "local-public-android" })
        }
    }

    private fun waitForPacket(packets: List<JSONObject>, predicate: (JSONObject) -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 15_000
        while (SystemClock.elapsedRealtime() < deadline && packets.none(predicate)) SystemClock.sleep(100)
        assertTrue("expected signed Activity packet; got $packets", packets.any(predicate))
    }

    private fun fixedLength(value: BigInteger): ByteArray = value.toByteArray().let { bytes ->
        when {
            bytes.size == 32 -> bytes
            bytes.size > 32 -> bytes.copyOfRange(bytes.size - 32, bytes.size)
            else -> ByteArray(32 - bytes.size) + bytes
        }
    }

    private fun derToRaw(der: ByteArray): ByteArray {
        var index = 2
        val rLength = der[index + 1].toInt()
        val r = BigInteger(1, der.copyOfRange(index + 2, index + 2 + rLength))
        index += 2 + rLength
        val sLength = der[index + 1].toInt()
        val s = BigInteger(1, der.copyOfRange(index + 2, index + 2 + sLength))
        return fixedLength(r) + fixedLength(s)
    }
}
