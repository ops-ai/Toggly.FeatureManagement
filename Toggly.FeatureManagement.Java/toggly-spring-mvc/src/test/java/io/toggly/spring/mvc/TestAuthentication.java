package io.toggly.spring.mvc;

import org.springframework.security.core.Authentication;

import java.util.Collection;

public final class TestAuthentication implements Authentication {
    private final Collection<?> authorities;

    public TestAuthentication(Collection<?> authorities) {
        this.authorities = authorities;
    }

    @Override
    public String getName() {
        return "security-user";
    }

    @Override
    public Collection<?> getAuthorities() {
        return authorities;
    }

    public static final class Authority {
        private final String name;

        public Authority(String name) {
            this.name = name;
        }

        public String getAuthority() {
            return name;
        }
    }
}
