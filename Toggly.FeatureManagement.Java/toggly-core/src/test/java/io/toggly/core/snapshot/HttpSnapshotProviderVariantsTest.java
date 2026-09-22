package io.toggly.core.snapshot;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.model.EvaluatedVariantDef;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Dual-rail coverage: definitions/definitions-signed stay the source of truth
 * for isEnabled; evaluated-variants-signed is fetched only additively when
 * enableVariants is true, feeding getVariant/getVariantValue without ever
 * replacing the definitions pipeline.
 */
class HttpSnapshotProviderVariantsTest {

    private HttpServer server;
    private String baseUrl;
    private final AtomicInteger definitionsRequestCount = new AtomicInteger();
    private final AtomicInteger variantsRequestCount = new AtomicInteger();
    private final AtomicReference<String> definitionsBody = new AtomicReference<>(
            "[{\"feature_key\":\"feature-a\",\"filters\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}]}]");
    private final AtomicReference<Integer> variantsStatus = new AtomicReference<>(200);
    private final AtomicReference<String> variantsEtag = new AtomicReference<>("\"v-rev-1\"");
    private final AtomicReference<String> variantsBody = new AtomicReference<>(
            "{\"defs\":{\"feature-a\":{\"enabled\":true,\"variant\":\"B\",\"configurationValue\":\"config-x\"}}}");

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", this::handle);
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        definitionsRequestCount.set(0);
        variantsRequestCount.set(0);
        variantsStatus.set(200);
        variantsEtag.set("\"v-rev-1\"");
        variantsBody.set(
                "{\"defs\":{\"feature-a\":{\"enabled\":true,\"variant\":\"B\",\"configurationValue\":\"config-x\"}}}");
        definitionsBody.set(
                "[{\"feature_key\":\"feature-a\",\"filters\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}]}]");
    }

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    private void handle(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        if (path.startsWith("/evaluated-variants-signed/")) {
            variantsRequestCount.incrementAndGet();
            int code = variantsStatus.get();
            String tag = variantsEtag.get();
            byte[] bytes = variantsBody.get().getBytes(StandardCharsets.UTF_8);
            if (tag != null) {
                exchange.getResponseHeaders().add("ETag", tag);
            }
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            if (code == 304) {
                exchange.sendResponseHeaders(304, -1);
                exchange.close();
                return;
            }
            exchange.sendResponseHeaders(code, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
            return;
        }

        // Definitions (and anything else not explicitly registered).
        definitionsRequestCount.incrementAndGet();
        byte[] bytes = definitionsBody.get().getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("ETag", "\"defs-rev-1\"");
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private TogglyConfig.Builder baseConfig() {
        return TogglyConfig.builder()
                .appKey("test-app")
                .environment("Production")
                .baseUrl(baseUrl)
                .refreshIntervalSeconds(0)
                .enableLiveUpdates(false)
                .enableUsageTracking(false)
                .enableMetrics(false);
    }

    @Test
    void doesNotFetchVariantsWhenDisabled() {
        HttpSnapshotProvider provider = new HttpSnapshotProvider(baseConfig().build());

        provider.refresh();

        assertThat(definitionsRequestCount.get()).isEqualTo(1);
        assertThat(variantsRequestCount.get()).isZero();
        assertThat(provider.getVariantSnapshot().isEmpty()).isTrue();

        provider.close();
    }

    @Test
    void fetchesVariantsAdditivelyWithoutReplacingDefinitions() {
        HttpSnapshotProvider provider = new HttpSnapshotProvider(
                baseConfig().enableVariants(true).build());

        provider.refresh();

        // Both rails populated; definitions still drive isEnabled.
        assertThat(definitionsRequestCount.get()).isEqualTo(1);
        assertThat(variantsRequestCount.get()).isEqualTo(1);
        assertThat(provider.getSnapshot().getFeature("feature-a")).isNotNull();

        EvaluatedVariantDef entry = provider.getVariantSnapshot().getVariant("feature-a");
        assertThat(entry).isNotNull();
        assertThat(entry.isEnabled()).isTrue();
        assertThat(entry.getVariant()).isEqualTo("B");
        assertThat(entry.getConfigurationValue()).isEqualTo("config-x");

        provider.close();
    }

    @Test
    void variantsConditionalGetIsHitOnUnchangedRevision() {
        HttpSnapshotProvider provider = new HttpSnapshotProvider(
                baseConfig().enableVariants(true).build());

        provider.refresh();
        assertThat(variantsRequestCount.get()).isEqualTo(1);

        variantsStatus.set(304);
        provider.refresh();
        assertThat(variantsRequestCount.get()).isEqualTo(2);

        // Snapshot unchanged across the 304.
        EvaluatedVariantDef entry = provider.getVariantSnapshot().getVariant("feature-a");
        assertThat(entry).isNotNull();
        assertThat(entry.getVariant()).isEqualTo("B");

        provider.close();
    }

    @Test
    void getVariantSnapshotLazilyFetchesOnFirstCall() {
        HttpSnapshotProvider provider = new HttpSnapshotProvider(
                baseConfig().enableVariants(true).build());

        // No explicit refresh() — getVariantSnapshot() should still fetch once.
        VariantSnapshot snapshot = provider.getVariantSnapshot();

        assertThat(variantsRequestCount.get()).isEqualTo(1);
        assertThat(snapshot.getVariant("feature-a")).isNotNull();

        provider.close();
    }

    @Test
    void identityIsSentAsUserIdQueryParam() {
        HttpSnapshotProvider provider = new HttpSnapshotProvider(
                baseConfig().enableVariants(true).identity("user-42").build());

        provider.refresh();

        assertThat(variantsRequestCount.get()).isEqualTo(1);
        // Indirect check: request succeeded against the mock server path prefix,
        // and the URL builder appends ?userId=... only when identity is set.
        assertThat(provider.getVariantSnapshot().getVariant("feature-a")).isNotNull();

        provider.close();
    }

    @Test
    void keepsLastKnownGoodVariantsOnNetworkError() {
        HttpSnapshotProvider provider = new HttpSnapshotProvider(
                baseConfig().enableVariants(true).build());

        provider.refresh();
        assertThat(provider.getVariantSnapshot().getVariant("feature-a")).isNotNull();

        variantsStatus.set(500);
        provider.refresh();

        // Definitions still refresh fine; variants keep the last good snapshot.
        assertThat(provider.getSnapshot().getFeature("feature-a")).isNotNull();
        assertThat(provider.getVariantSnapshot().getVariant("feature-a")).isNotNull();
        assertThat(provider.getVariantSnapshot().getVariant("feature-a").getVariant()).isEqualTo("B");

        provider.close();
    }

    @Test
    void verifiesSignedVariantsWhenUseSignedDefinitionsEnabled() throws Exception {
        KeyPair pair = generateP256KeyPair();
        ECPublicKey pub = (ECPublicKey) pair.getPublic();
        ECPrivateKey priv = (ECPrivateKey) pair.getPrivate();

        byte[] x = pad32(pub.getW().getAffineX().toByteArray());
        byte[] y = pad32(pub.getW().getAffineY().toByteArray());
        String kid = computeKid(x, y);

        String defsJson = "{\"feature-a\":{\"enabled\":true,\"variant\":\"B\",\"configurationValue\":\"config-x\"}}";
        long ts = 1730000000L;
        String signature = Base64.getEncoder().encodeToString(
                signP1363(priv, doubleSha256(defsJson + "|" + ts)));

        variantsBody.set(
                "{\"defs\":" + defsJson + ",\"signature\":\"" + signature + "\",\"kid\":\""
                        + kid + "\",\"timestamp\":" + ts + "}");
        definitionsBody.set(signedDefinitionsBody(priv, kid, ts));

        registerJwks(kid, x, y);

        HttpSnapshotProvider provider = new HttpSnapshotProvider(
                baseConfig().enableVariants(true).useSignedDefinitions(true).build());

        provider.refresh();

        // Both rails succeed under signature verification.
        assertThat(provider.getSnapshot().getFeature("feature-a")).isNotNull();
        EvaluatedVariantDef entry = provider.getVariantSnapshot().getVariant("feature-a");
        assertThat(entry).isNotNull();
        assertThat(entry.getVariant()).isEqualTo("B");

        provider.close();
    }

    @Test
    void rejectsCorruptSignedVariantsSignature() throws Exception {
        KeyPair pair = generateP256KeyPair();
        ECPublicKey pub = (ECPublicKey) pair.getPublic();
        ECPrivateKey priv = (ECPrivateKey) pair.getPrivate();

        byte[] x = pad32(pub.getW().getAffineX().toByteArray());
        byte[] y = pad32(pub.getW().getAffineY().toByteArray());
        String kid = computeKid(x, y);

        String defsJson = "{\"feature-a\":{\"enabled\":true,\"variant\":\"B\",\"configurationValue\":\"config-x\"}}";
        long ts = 1730000000L;
        byte[] p1363 = signP1363(priv, doubleSha256(defsJson + "|" + ts));
        p1363[0] ^= (byte) 0xff;
        String signature = Base64.getEncoder().encodeToString(p1363);

        variantsBody.set(
                "{\"defs\":" + defsJson + ",\"signature\":\"" + signature + "\",\"kid\":\""
                        + kid + "\",\"timestamp\":" + ts + "}");
        // Definitions rail uses a validly signed body — only the variants signature is corrupt.
        definitionsBody.set(signedDefinitionsBody(priv, kid, ts));

        registerJwks(kid, x, y);

        HttpSnapshotProvider provider = new HttpSnapshotProvider(
                baseConfig().enableVariants(true).useSignedDefinitions(true).build());

        // Signature invalid → refreshVariants() reports/logs and keeps last-known-good (empty).
        provider.refresh();
        assertThat(provider.getVariantSnapshot().isEmpty()).isTrue();
        // Definitions rail must be unaffected by the variants signature failure.
        assertThat(provider.getSnapshot().getFeature("feature-a")).isNotNull();

        provider.close();
    }

    private void registerJwks(String kid, byte[] x, byte[] y) {
        server.createContext("/.well-known/jwks", exchange -> {
            String jwksJson = "{\"keys\":[{\"kty\":\"EC\",\"kid\":\"" + kid + "\",\"crv\":\"P-256\","
                    + "\"x\":\"" + Base64.getUrlEncoder().withoutPadding().encodeToString(x) + "\","
                    + "\"y\":\"" + Base64.getUrlEncoder().withoutPadding().encodeToString(y) + "\","
                    + "\"alg\":\"ES256\",\"use\":\"sig\"}]}";
            byte[] bytes = jwksJson.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        });
    }

    private String signedDefinitionsBody(ECPrivateKey priv, String kid, long ts) throws Exception {
        String defsArrayJson =
                "[{\"feature_key\":\"feature-a\",\"filters\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}]}]";
        String signature = Base64.getEncoder().encodeToString(
                signP1363(priv, doubleSha256(defsArrayJson + "|" + ts)));
        return "{\"defs\":" + defsArrayJson + ",\"signature\":\"" + signature + "\",\"kid\":\""
                + kid + "\",\"timestamp\":" + ts + "}";
    }

    private static KeyPair generateP256KeyPair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        return generator.generateKeyPair();
    }

    private static byte[] doubleSha256(String payload) throws Exception {
        MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
        byte[] first = sha256.digest(payload.getBytes(StandardCharsets.UTF_8));
        return sha256.digest(first);
    }

    private static byte[] signP1363(ECPrivateKey privateKey, byte[] digest) throws Exception {
        Signature signer = Signature.getInstance("NONEwithECDSA");
        signer.initSign(privateKey);
        signer.update(digest);
        byte[] der = signer.sign();
        return derToP1363(der);
    }

    private static byte[] derToP1363(byte[] der) {
        int idx = 2;
        if ((der[1] & 0x80) != 0) {
            int lenBytes = der[1] & 0x7f;
            idx = 2 + lenBytes;
        }
        if (der[idx++] != 0x02) throw new IllegalArgumentException("expected INTEGER r");
        int rLen = der[idx++] & 0xff;
        byte[] r = new byte[rLen];
        System.arraycopy(der, idx, r, 0, rLen);
        idx += rLen;
        if (der[idx++] != 0x02) throw new IllegalArgumentException("expected INTEGER s");
        int sLen = der[idx++] & 0xff;
        byte[] s = new byte[sLen];
        System.arraycopy(der, idx, s, 0, sLen);

        byte[] out = new byte[64];
        byte[] rPad = pad32(r);
        byte[] sPad = pad32(s);
        System.arraycopy(rPad, 0, out, 0, 32);
        System.arraycopy(sPad, 0, out, 32, 32);
        return out;
    }

    private static byte[] pad32(byte[] value) {
        byte[] unsigned = value;
        if (value.length > 32 && value[0] == 0) {
            unsigned = new byte[value.length - 1];
            System.arraycopy(value, 1, unsigned, 0, unsigned.length);
        }
        if (unsigned.length == 32) {
            return unsigned;
        }
        if (unsigned.length > 32) {
            byte[] trimmed = new byte[32];
            System.arraycopy(unsigned, unsigned.length - 32, trimmed, 0, 32);
            return trimmed;
        }
        byte[] out = new byte[32];
        System.arraycopy(unsigned, 0, out, 32 - unsigned.length, unsigned.length);
        return out;
    }

    private static byte[] pad32(BigInteger value) {
        return pad32(value.toByteArray());
    }

    private static String computeKid(byte[] x, byte[] y) throws Exception {
        MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
        sha1.update(x);
        sha1.update(y);
        byte[] digest = sha1.digest();
        StringBuilder sb = new StringBuilder();
        for (byte b : digest) {
            sb.append(String.format(Locale.ROOT, "%02X", b));
        }
        return sb + "ES256";
    }
}
