package io.toggly.core

import io.toggly.core.models.FeatureFlags
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Response
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec

/**
 * Verifies signed definitions without altering the signed JSON bytes.
 *
 * The definitions service signs the exact raw defs JSON plus its timestamp,
 * using a double SHA-256 digest and an ES256 P-256 signature.
 */
internal object SignedDefsVerify {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    internal data class SignedEnvelope(
        val defsRaw: String,
        val signature: String,
        val timestamp: Long,
        val kid: String
    )

    /**
     * Extracts the exact raw JSON text of a top-level property.
     */
    internal fun extractRawJsonProperty(text: String, key: String): String? {
        var index = 0
        var depth = 0
        var inString = false
        var escape = false

        while (index < text.length) {
            val character = text[index]
            if (inString) {
                if (escape) {
                    escape = false
                } else if (character == '\\') {
                    escape = true
                } else if (character == '"') {
                    inString = false
                }
                index++
                continue
            }

            when (character) {
                '"' -> {
                    if (depth == 1) {
                        val keyEnd = findStringEnd(text, index) ?: return null
                        val propertyName = text.substring(index + 1, keyEnd)
                        var valueStart = keyEnd + 1
                        while (valueStart < text.length && text[valueStart].isWhitespace()) {
                            valueStart++
                        }
                        if (propertyName == key && valueStart < text.length && text[valueStart] == ':') {
                            valueStart++
                            while (valueStart < text.length && text[valueStart].isWhitespace()) {
                                valueStart++
                            }
                            return extractJsonValue(text, valueStart)
                        }
                        index = keyEnd + 1
                        continue
                    }
                    inString = true
                }

                '{', '[' -> depth++
                '}', ']' -> depth--
            }
            index++
        }

        return null
    }

    internal fun parseSignedEnvelope(body: String): SignedEnvelope {
        val envelope = json.parseToJsonElement(body).jsonObject
        val defsRaw = extractRawJsonProperty(body, "defs")
            ?: extractRawJsonProperty(body, "data")
            ?: throw IllegalArgumentException("Signed envelope missing defs")

        return SignedEnvelope(
            defsRaw = defsRaw,
            signature = envelope.string("signature").also {
                require(it.isNotEmpty()) { "Missing signature" }
            },
            timestamp = envelope.string("timestamp").toLongOrNull()
                ?: throw IllegalArgumentException("Invalid signed timestamp"),
            kid = envelope.string("kid").also {
                require(it.isNotEmpty()) { "Missing kid" }
            }
        )
    }

    internal fun parseDefinitions(defsRaw: String): FeatureFlags {
        return json.decodeFromString(defsRaw)
    }

    internal fun doubleSha256(payload: String): ByteArray {
        val firstDigest = MessageDigest.getInstance("SHA-256")
            .digest(payload.toByteArray(Charsets.UTF_8))
        return MessageDigest.getInstance("SHA-256").digest(firstDigest)
    }

    internal fun verify(
        envelope: SignedEnvelope,
        jwksBody: String
    ) {
        val keys = json.parseToJsonElement(jwksBody).jsonObject["keys"]?.jsonArray
            ?: throw IllegalArgumentException("JWKS missing keys")
        val jwk = findJwk(keys.map { it.jsonObject }, envelope.kid)
            ?: throw IllegalArgumentException("No matching JWK for kid ${envelope.kid}")
        val key = createPublicKey(jwk, envelope.kid)
        val digest = doubleSha256("${envelope.defsRaw}|${envelope.timestamp}")
        val signature = decodeBase64(envelope.signature)
        val derSignature = if (signature.size == 64) p1363ToDer(signature) else signature

        val verifier = Signature.getInstance("NONEwithECDSA")
        verifier.initVerify(key)
        verifier.update(digest)
        if (!verifier.verify(derSignature)) {
            throw IllegalArgumentException("Invalid signature")
        }
    }

    internal fun fetchJwks(response: Response): String {
        if (!response.isSuccessful) {
            throw TogglyException.HttpError(response.code, response.message)
        }
        return response.body?.string()
            ?: throw TogglyException.InvalidResponse("Empty JWKS response body")
    }

    private fun findJwk(keys: List<JsonObject>, kid: String): JsonObject? {
        for (key in keys) {
            if (key["kid"]?.jsonPrimitive?.content == kid) {
                return key
            }
        }
        return null
    }

    private fun findStringEnd(text: String, start: Int): Int? {
        var escape = false
        for (index in start + 1 until text.length) {
            when {
                escape -> escape = false
                text[index] == '\\' -> escape = true
                text[index] == '"' -> return index
            }
        }
        return null
    }

    private fun extractJsonValue(text: String, start: Int): String? {
        if (start >= text.length) {
            return null
        }

        return when (text[start]) {
            '{', '[' -> extractCompositeValue(text, start)
            '"' -> {
                val end = findStringEnd(text, start) ?: return null
                text.substring(start, end + 1)
            }

            else -> {
                var end = start
                while (end < text.length && text[end] !in ",}] \t\r\n") {
                    end++
                }
                text.substring(start, end).takeIf { it.isNotEmpty() }
            }
        }
    }

    private fun extractCompositeValue(text: String, start: Int): String? {
        var depth = 0
        var inString = false
        var escape = false
        for (index in start until text.length) {
            val character = text[index]
            if (inString) {
                if (escape) {
                    escape = false
                } else if (character == '\\') {
                    escape = true
                } else if (character == '"') {
                    inString = false
                }
                continue
            }

            when (character) {
                '"' -> inString = true
                '{', '[' -> depth++
                '}', ']' -> {
                    depth--
                    if (depth == 0) {
                        return text.substring(start, index + 1)
                    }
                }
            }
        }
        return null
    }

    private fun createPublicKey(jwk: JsonObject, expectedKid: String): ECPublicKey {
        require((jwk["kty"]?.jsonPrimitive?.content ?: "EC") == "EC") { "Unsupported JWK type" }
        require((jwk["alg"]?.jsonPrimitive?.content ?: "ES256") == "ES256") { "Unsupported JWK algorithm" }
        require((jwk["crv"]?.jsonPrimitive?.content ?: "P-256") == "P-256") { "Unsupported JWK curve" }

        val x = decodeBase64(jwk.string("x"))
        val y = decodeBase64(jwk.string("y"))
        val calculatedKid = calculateKid(x, y)
        require(jwk.string("kid") == calculatedKid) { "JWK kid does not match coordinates" }
        require(calculatedKid == expectedKid) { "Signed response kid does not match JWK" }

        val parameters = AlgorithmParameters.getInstance("EC").apply {
            init(ECGenParameterSpec("secp256r1"))
        }.getParameterSpec(ECParameterSpec::class.java)
        val keySpec = ECPublicKeySpec(
            ECPoint(BigInteger(1, x), BigInteger(1, y)),
            parameters
        )
        return KeyFactory.getInstance("EC").generatePublic(keySpec) as ECPublicKey
    }

    private fun JsonObject.string(name: String): String {
        return this[name]?.jsonPrimitive?.content
            ?: throw IllegalArgumentException("Missing $name")
    }

    private fun calculateKid(x: ByteArray, y: ByteArray): String {
        val coordinates = ByteArray(x.size + y.size)
        x.copyInto(coordinates)
        y.copyInto(coordinates, destinationOffset = x.size)
        val sha1 = MessageDigest.getInstance("SHA-1").digest(coordinates)
        return sha1.joinToString(separator = "") { "%02X".format(it) } + "ES256"
    }

    /**
     * Decode standard or URL-safe Base64 without java.util.Base64 (API 26+)
     * or android.util.Base64 (unavailable in plain JVM unit tests).
     */
    private fun decodeBase64(value: String): ByteArray {
        val normalized = value.replace('-', '+').replace('_', '/')
        val padded = normalized.padEnd((normalized.length + 3) / 4 * 4, '=')
        require(padded.length % 4 == 0) { "Invalid base64 length" }

        val out = ArrayList<Byte>(padded.length / 4 * 3)
        var index = 0
        while (index < padded.length) {
            val n0 = base64AlphabetValue(padded[index++])
            val n1 = base64AlphabetValue(padded[index++])
            val c2 = padded[index++]
            val c3 = padded[index++]
            val n2 = if (c2 == '=') 0 else base64AlphabetValue(c2)
            val n3 = if (c3 == '=') 0 else base64AlphabetValue(c3)
            val triple = (n0 shl 18) or (n1 shl 12) or (n2 shl 6) or n3
            out.add((triple shr 16).toByte())
            if (c2 != '=') {
                out.add((triple shr 8).toByte())
            }
            if (c3 != '=') {
                out.add(triple.toByte())
            }
        }
        return out.toByteArray()
    }

    private fun base64AlphabetValue(character: Char): Int {
        return when (character) {
            in 'A'..'Z' -> character - 'A'
            in 'a'..'z' -> character - 'a' + 26
            in '0'..'9' -> character - '0' + 52
            '+' -> 62
            '/' -> 63
            else -> throw IllegalArgumentException("Invalid base64 character: $character")
        }
    }

    private fun p1363ToDer(signature: ByteArray): ByteArray {
        require(signature.size == 64) { "P1363 ES256 signatures must be 64 bytes" }
        val r = derInteger(signature.copyOfRange(0, 32))
        val s = derInteger(signature.copyOfRange(32, 64))
        val sequenceLength = r.size + s.size
        require(sequenceLength < 128) { "Unsupported ECDSA signature length" }
        return byteArrayOf(0x30, sequenceLength.toByte()) + r + s
    }

    private fun derInteger(value: ByteArray): ByteArray {
        val firstNonZero = value.indexOfFirst { it != 0.toByte() }
        val trimmed = if (firstNonZero == -1) byteArrayOf(0) else value.copyOfRange(firstNonZero, value.size)
        val encoded = if (trimmed[0].toInt() and 0x80 != 0) byteArrayOf(0) + trimmed else trimmed
        return byteArrayOf(0x02, encoded.size.toByte()) + encoded
    }
}
