package io.toggly.core.snapshot;

import com.sun.net.httpserver.HttpServer;
import io.toggly.core.config.TogglyConfig;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Arrays;
import java.util.Base64;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class HttpSnapshotProviderSignedTest {
    private HttpServer server;
    private KeyPair pair;
    private String kid;
    private String jwksBody;
    private final AtomicReference<String> definitionsBody = new AtomicReference<>();
    private final AtomicInteger jwksRequests = new AtomicInteger();
    private HttpSnapshotProvider provider;

    @BeforeEach
    void startServer() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        pair = generator.generateKeyPair();
        ECPublicKey publicKey = (ECPublicKey) pair.getPublic();
        byte[] x = coordinate(publicKey.getW().getAffineX().toByteArray());
        byte[] y = coordinate(publicKey.getW().getAffineY().toByteArray());
        kid = kid(x, y);
        String b64x = Base64.getUrlEncoder().withoutPadding().encodeToString(x);
        String b64y = Base64.getUrlEncoder().withoutPadding().encodeToString(y);
        jwksBody = "{\"keys\":[{\"kty\":\"EC\",\"kid\":\"" + kid
                + "\",\"crv\":\"P-256\",\"x\":\"" + b64x + "\",\"y\":\""
                + b64y + "\",\"alg\":\"ES256\",\"use\":\"sig\"}]}";
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/.well-known/jwks", exchange -> {
            jwksRequests.incrementAndGet();
            respond(exchange, jwksBody);
        });
        server.createContext("/definitions-signed/app/Production",
                exchange -> respond(exchange, definitionsBody.get()));
        server.start();
        TogglyConfig config = TogglyConfig.builder()
                .appKey("app")
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort())
                .useSignedDefinitions(true)
                .refreshIntervalSeconds(0)
                .enableLiveUpdates(false)
                .build();
        provider = new HttpSnapshotProvider(config);
    }

    @AfterEach
    void stopServer() {
        if (provider != null) provider.close();
        if (server != null) server.stop(0);
    }

    @Test
    void verifiesSignedDefinitionsAndKeepsLastKnownGoodOnOlderRevision() throws Exception {
        String current = "[{\"featureKey\":\"current\",\"filters\":[{\"name\":\"AlwaysOn\"}]}]";
        definitionsBody.set(signed(current, 200));

        FeatureSnapshot snapshot = provider.refresh();

        assertThat(snapshot.getFeature("current")).isNotNull();
        assertThat(snapshot.hasSignatureMetadata()).isTrue();
        assertThat(snapshot.getSignedDefsJson()).isEqualTo(current);
        assertThat(snapshot.getSignedTimestamp()).isEqualTo(200);
        assertThat(jwksRequests).hasValue(1);
        assertThat(provider.loadJwks()).isNotNull();

        definitionsBody.set(signed("[{\"featureKey\":\"older\"}]", 100));
        assertThat(provider.refresh()).isSameAs(snapshot);
        assertThat(provider.getSnapshot().getFeature("older")).isNull();
        assertThat(jwksRequests).hasValue(1);
    }

    @Test
    void persistedSignedSnapshotIsVerifiedBeforeApplyingAndInvalidSignatureIsRejected() throws Exception {
        String defs = "[{\"featureKey\":\"cached\"}]";
        definitionsBody.set(signed(defs, 200));
        FeatureSnapshot trusted = provider.refresh();
        provider.clear();
        assertThat(provider.applyCachedSnapshot(trusted)).isTrue();
        assertThat(provider.getSnapshot().getFeature("cached")).isNotNull();

        provider.clear();
        FeatureSnapshot tampered = trusted.withSignature(
                Base64.getEncoder().encodeToString(new byte[64]), kid, 200L, defs);
        assertThat(provider.applyCachedSnapshot(tampered)).isFalse();
        assertThat(provider.loadJwks()).isNotNull();
    }

    private String signed(String definitions, long timestamp) throws Exception {
        byte[] payload = (definitions + "|" + timestamp).getBytes(StandardCharsets.UTF_8);
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        byte[] digest = sha.digest(sha.digest(payload));
        Signature signer = Signature.getInstance("NONEwithECDSA");
        signer.initSign(pair.getPrivate());
        signer.update(digest);
        String signature = Base64.getEncoder().encodeToString(signer.sign());
        return "{\"defs\":" + definitions + ",\"timestamp\":" + timestamp
                + ",\"kid\":\"" + kid + "\",\"signature\":\"" + signature + "\"}";
    }

    private static byte[] coordinate(byte[] signed) {
        byte[] bytes = signed.length == 33 && signed[0] == 0
                ? Arrays.copyOfRange(signed, 1, signed.length)
                : signed;
        byte[] coordinate = new byte[32];
        System.arraycopy(bytes, 0, coordinate, 32 - bytes.length, bytes.length);
        return coordinate;
    }

    private static String kid(byte[] x, byte[] y) throws Exception {
        MessageDigest sha = MessageDigest.getInstance("SHA-1");
        sha.update(x);
        sha.update(y);
        StringBuilder id = new StringBuilder();
        for (byte b : sha.digest()) id.append(String.format(Locale.ROOT, "%02X", b));
        return id + "ES256";
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(200, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }
}
