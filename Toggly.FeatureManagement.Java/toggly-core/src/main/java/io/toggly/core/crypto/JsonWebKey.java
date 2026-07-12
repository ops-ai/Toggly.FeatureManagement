package io.toggly.core.crypto;

/**
 * JSON Web Key (EC P-256) used for ES256 signature verification.
 */
public final class JsonWebKey {

    private final String kty;
    private final String kid;
    private final String crv;
    private final String x;
    private final String y;
    private final String alg;
    private final String use;
    private final Long exp;

    public JsonWebKey(
            String kty,
            String kid,
            String crv,
            String x,
            String y,
            String alg,
            String use,
            Long exp) {
        this.kty = kty;
        this.kid = kid;
        this.crv = crv;
        this.x = x;
        this.y = y;
        this.alg = alg != null ? alg : "ES256";
        this.use = use != null ? use : "sig";
        this.exp = exp;
    }

    public String getKty() {
        return kty;
    }

    public String getKid() {
        return kid;
    }

    public String getCrv() {
        return crv;
    }

    public String getX() {
        return x;
    }

    public String getY() {
        return y;
    }

    public String getAlg() {
        return alg;
    }

    public String getUse() {
        return use;
    }

    public Long getExp() {
        return exp;
    }
}
