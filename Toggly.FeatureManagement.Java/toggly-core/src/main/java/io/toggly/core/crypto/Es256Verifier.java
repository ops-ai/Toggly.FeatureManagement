package io.toggly.core.crypto;

import io.toggly.core.exception.TogglySignatureException;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.AlgorithmParameters;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.util.Base64;
import java.util.Locale;
import java.util.Set;

/**
 * Verifies ES256 signatures for Toggly signed definitions.
 *
 * <p>Matches Go/worker behavior: payload = raw defs JSON + "|" + timestamp,
 * double SHA-256, then ECDSA P-256 verify (IEEE P1363 or DER).</p>
 */
public final class Es256Verifier {

    private Es256Verifier() {
    }

    /**
     * Verifies a signed definitions payload.
     *
     * @param rawDefsJson exact JSON text of the {@code defs} property
     * @param timestamp unix-seconds timestamp included in the signed payload
     * @param signatureBase64 standard Base64 encoding of the ES256 signature
     * @param kid key id to look up in the JWKS
     * @param jwks JWKS containing the public key
     * @param allowedKids optional allow-list of kids (null/empty = allow all)
     * @throws TogglySignatureException if verification fails
     */
    public static void verify(
            String rawDefsJson,
            long timestamp,
            String signatureBase64,
            String kid,
            JsonWebKeySet jwks,
            Set<String> allowedKids) {
        if (rawDefsJson == null) {
            throw new TogglySignatureException("Missing signed defs JSON");
        }
        if (signatureBase64 == null || signatureBase64.isEmpty()) {
            throw new TogglySignatureException("Missing signature");
        }
        if (kid == null || kid.isEmpty()) {
            throw new TogglySignatureException("Missing key id");
        }
        if (jwks == null) {
            throw new TogglySignatureException("Missing JWKS");
        }

        JsonWebKey jwk = jwks.findByKid(kid);
        if (jwk == null) {
            throw new TogglySignatureException("No matching JWK for kid: " + kid);
        }

        ECPublicKey publicKey = parseAndValidateKey(jwk, allowedKids);
        byte[] digest = doubleSha256(rawDefsJson + "|" + timestamp);
        byte[] signature = decodeSignature(signatureBase64);

        if (signature.length == 64) {
            // IEEE P1363 raw r||s (Web Crypto)
            if (!verifyP1363(publicKey, digest, signature)) {
                throw new TogglySignatureException("Invalid signature");
            }
            return;
        }

        // Fall back to ASN.1/DER (e.g. Azure Key Vault)
        if (!verifyDer(publicKey, digest, signature)) {
            throw new TogglySignatureException("Invalid signature");
        }
    }

    static byte[] doubleSha256(String payload) {
        try {
            MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
            byte[] first = sha256.digest(payload.getBytes(StandardCharsets.UTF_8));
            return sha256.digest(first);
        } catch (Exception e) {
            throw new TogglySignatureException("Failed to hash payload", e);
        }
    }

    static ECPublicKey parseAndValidateKey(JsonWebKey jwk, Set<String> allowedKids) {
        if (!"ES256".equals(jwk.getAlg())) {
            throw new TogglySignatureException("Unsupported alg: " + jwk.getAlg());
        }
        if (!"P-256".equals(jwk.getCrv())) {
            throw new TogglySignatureException("Unsupported crv: " + jwk.getCrv());
        }
        if (allowedKids != null && !allowedKids.isEmpty() && !allowedKids.contains(jwk.getKid())) {
            throw new TogglySignatureException("kid not allowed: " + jwk.getKid());
        }

        byte[] xBytes = decodeBase64Url(jwk.getX());
        byte[] yBytes = decodeBase64Url(jwk.getY());
        String computedKid = computeKid(xBytes, yBytes);
        if (!computedKid.equals(jwk.getKid())) {
            throw new TogglySignatureException(
                    "Invalid kid: expected " + computedKid + ", got " + jwk.getKid());
        }

        try {
            AlgorithmParameters parameters = AlgorithmParameters.getInstance("EC");
            parameters.init(new ECGenParameterSpec("secp256r1"));
            ECParameterSpec ecSpec = parameters.getParameterSpec(ECParameterSpec.class);
            ECPoint point = new ECPoint(new BigInteger(1, xBytes), new BigInteger(1, yBytes));
            ECPublicKeySpec keySpec = new ECPublicKeySpec(point, ecSpec);
            KeyFactory keyFactory = KeyFactory.getInstance("EC");
            PublicKey publicKey = keyFactory.generatePublic(keySpec);
            return (ECPublicKey) publicKey;
        } catch (Exception e) {
            throw new TogglySignatureException("Failed to parse EC public key", e);
        }
    }

    static String computeKid(byte[] xBytes, byte[] yBytes) {
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            sha1.update(xBytes);
            sha1.update(yBytes);
            byte[] digest = sha1.digest();
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format(Locale.ROOT, "%02X", b));
            }
            return sb + "ES256";
        } catch (Exception e) {
            throw new TogglySignatureException("Failed to compute kid", e);
        }
    }

    private static boolean verifyP1363(ECPublicKey publicKey, byte[] digest, byte[] signature) {
        try {
            byte[] der = p1363ToDer(signature);
            return verifyDer(publicKey, digest, der);
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean verifyDer(ECPublicKey publicKey, byte[] digest, byte[] signature) {
        try {
            Signature verifier = Signature.getInstance("NONEwithECDSA");
            verifier.initVerify(publicKey);
            verifier.update(digest);
            return verifier.verify(signature);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Converts IEEE P1363 (r||s, 64 bytes) to ASN.1 DER encoding.
     */
    static byte[] p1363ToDer(byte[] p1363) {
        if (p1363.length != 64) {
            throw new IllegalArgumentException("P1363 signature must be 64 bytes");
        }
        byte[] r = trimLeadingZeros(p1363, 0, 32);
        byte[] s = trimLeadingZeros(p1363, 32, 32);

        int length = 2 + r.length + 2 + s.length;
        byte[] der = new byte[2 + length];
        int idx = 0;
        der[idx++] = 0x30;
        der[idx++] = (byte) length;
        der[idx++] = 0x02;
        der[idx++] = (byte) r.length;
        System.arraycopy(r, 0, der, idx, r.length);
        idx += r.length;
        der[idx++] = 0x02;
        der[idx++] = (byte) s.length;
        System.arraycopy(s, 0, der, idx, s.length);
        return der;
    }

    private static byte[] trimLeadingZeros(byte[] src, int offset, int length) {
        int start = offset;
        int end = offset + length;
        while (start < end - 1 && src[start] == 0) {
            start++;
        }
        // Ensure positive integer encoding (leading 0x00 if high bit set)
        boolean needsPad = (src[start] & 0x80) != 0;
        int outLen = end - start + (needsPad ? 1 : 0);
        byte[] out = new byte[outLen];
        if (needsPad) {
            System.arraycopy(src, start, out, 1, end - start);
        } else {
            System.arraycopy(src, start, out, 0, end - start);
        }
        return out;
    }

    private static byte[] decodeSignature(String signatureBase64) {
        try {
            return Base64.getDecoder().decode(signatureBase64);
        } catch (IllegalArgumentException e) {
            throw new TogglySignatureException("Failed to decode signature", e);
        }
    }

    private static byte[] decodeBase64Url(String value) {
        try {
            return Base64.getUrlDecoder().decode(value);
        } catch (IllegalArgumentException e) {
            // Some JWKS may use standard base64
            try {
                return Base64.getDecoder().decode(value);
            } catch (IllegalArgumentException ex) {
                throw new TogglySignatureException("Failed to decode JWK coordinate", ex);
            }
        }
    }
}
