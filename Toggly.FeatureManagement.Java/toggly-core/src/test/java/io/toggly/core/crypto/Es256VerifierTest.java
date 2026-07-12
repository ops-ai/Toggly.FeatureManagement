package io.toggly.core.crypto;

import io.toggly.core.exception.TogglySignatureException;
import org.junit.jupiter.api.Test;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class Es256VerifierTest {

    @Test
    void verifySucceedsWithValidP1363Signature() throws Exception {
        KeyPair pair = generateP256KeyPair();
        ECPublicKey pub = (ECPublicKey) pair.getPublic();
        ECPrivateKey priv = (ECPrivateKey) pair.getPrivate();

        byte[] x = pad32(pub.getW().getAffineX().toByteArray());
        byte[] y = pad32(pub.getW().getAffineY().toByteArray());
        String kid = computeKid(x, y);

        JsonWebKey jwk = new JsonWebKey(
                "EC", kid, "P-256",
                Base64.getUrlEncoder().withoutPadding().encodeToString(x),
                Base64.getUrlEncoder().withoutPadding().encodeToString(y),
                "ES256", "sig", null);
        JsonWebKeySet jwks = new JsonWebKeySet(List.of(jwk));

        String defs = "[{\"featureKey\":\"demo\",\"filters\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}],\"requirementType\":\"Any\"}]";
        long ts = 1730000000L;
        String payload = defs + "|" + ts;
        byte[] digest = doubleSha256(payload);
        byte[] p1363 = signP1363(priv, digest);
        String signature = Base64.getEncoder().encodeToString(p1363);

        assertThatCode(() -> Es256Verifier.verify(defs, ts, signature, kid, jwks, null))
                .doesNotThrowAnyException();
    }

    @Test
    void verifyFailsWithCorruptSignature() throws Exception {
        KeyPair pair = generateP256KeyPair();
        ECPublicKey pub = (ECPublicKey) pair.getPublic();
        ECPrivateKey priv = (ECPrivateKey) pair.getPrivate();

        byte[] x = pad32(pub.getW().getAffineX().toByteArray());
        byte[] y = pad32(pub.getW().getAffineY().toByteArray());
        String kid = computeKid(x, y);

        JsonWebKey jwk = new JsonWebKey(
                "EC", kid, "P-256",
                Base64.getUrlEncoder().withoutPadding().encodeToString(x),
                Base64.getUrlEncoder().withoutPadding().encodeToString(y),
                "ES256", "sig", null);
        JsonWebKeySet jwks = new JsonWebKeySet(List.of(jwk));

        String defs = "[]";
        long ts = 1730000000L;
        byte[] p1363 = signP1363(priv, doubleSha256(defs + "|" + ts));
        p1363[0] ^= (byte) 0xff;
        String signature = Base64.getEncoder().encodeToString(p1363);

        assertThatThrownBy(() -> Es256Verifier.verify(defs, ts, signature, kid, jwks, null))
                .isInstanceOf(TogglySignatureException.class)
                .hasMessageContaining("Invalid signature");
    }

    @Test
    void verifyRespectsAllowedKidAllowList() throws Exception {
        KeyPair pair = generateP256KeyPair();
        ECPublicKey pub = (ECPublicKey) pair.getPublic();
        ECPrivateKey priv = (ECPrivateKey) pair.getPrivate();

        byte[] x = pad32(pub.getW().getAffineX().toByteArray());
        byte[] y = pad32(pub.getW().getAffineY().toByteArray());
        String kid = computeKid(x, y);

        JsonWebKey jwk = new JsonWebKey(
                "EC", kid, "P-256",
                Base64.getUrlEncoder().withoutPadding().encodeToString(x),
                Base64.getUrlEncoder().withoutPadding().encodeToString(y),
                "ES256", "sig", null);
        JsonWebKeySet jwks = new JsonWebKeySet(List.of(jwk));

        String defs = "[]";
        long ts = 1730000000L;
        String signature = Base64.getEncoder().encodeToString(
                signP1363(priv, doubleSha256(defs + "|" + ts)));

        assertThatCode(() -> Es256Verifier.verify(defs, ts, signature, kid, jwks, Set.of(kid)))
                .doesNotThrowAnyException();

        assertThatThrownBy(() -> Es256Verifier.verify(
                defs, ts, signature, kid, jwks, Set.of("nope")))
                .isInstanceOf(TogglySignatureException.class)
                .hasMessageContaining("kid not allowed");
    }

    @Test
    void verifyFailsWhenKidMissingFromJwks() throws Exception {
        JsonWebKeySet jwks = new JsonWebKeySet(Collections.emptyList());
        assertThatThrownBy(() -> Es256Verifier.verify(
                "[]", 1L, Base64.getEncoder().encodeToString(new byte[64]), "missing", jwks, null))
                .isInstanceOf(TogglySignatureException.class)
                .hasMessageContaining("No matching JWK");
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
        // Minimal DER parse: SEQUENCE { INTEGER r, INTEGER s }
        int idx = 2; // skip 0x30 len
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
        // BigInteger.toByteArray may include a sign byte
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
