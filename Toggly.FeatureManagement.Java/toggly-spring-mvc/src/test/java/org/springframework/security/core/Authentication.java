package org.springframework.security.core;

import java.security.Principal;
import java.util.Collection;

/** Minimal test-scope shape of the optional Spring Security contract. */
public interface Authentication extends Principal {
    Collection<?> getAuthorities();
}
