package io.toggly.core.util;

import java.util.Optional;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Soft-decodes variant configuration payloads to a requested Java type.
 *
 * <p>Missing values and bind failures return {@code null} / empty
 * {@link Optional} — never throw solely for shape mismatch.</p>
 *
 * <p>Uses Jackson {@code ObjectMapper.convertValue} when
 * {@code com.fasterxml.jackson.databind.ObjectMapper} is on the classpath
 * (already a test dependency of toggly-core; add jackson-databind at runtime
 * for POJO binding). Without Jackson, only {@link Class#isInstance} casts
 * succeed.</p>
 */
public final class VariantValueCodec {

    private static final Logger LOGGER = Logger.getLogger(VariantValueCodec.class.getName());

    private VariantValueCodec() {
    }

    /**
     * Soft-bind {@code raw} as {@code type}.
     *
     * @param raw  untyped configuration value (may be null)
     * @param type target class (may be null)
     * @param <T>  target type
     * @return bound value, or null on missing / mismatch
     */
    public static <T> T decode(Object raw, Class<T> type) {
        if (raw == null || type == null) {
            return null;
        }
        if (type.isInstance(raw)) {
            return type.cast(raw);
        }
        Object mapper = JacksonHolder.MAPPER;
        if (mapper == null) {
            return null;
        }
        try {
            @SuppressWarnings("unchecked")
            T bound = (T) JacksonHolder.convertValue(mapper, raw, type);
            return bound;
        } catch (RuntimeException e) {
            LOGGER.log(Level.FINEST, "Variant value bind failed for " + type.getName(), e);
            return null;
        }
    }

    /**
     * Soft-bind as {@link Optional}.
     *
     * @param raw  untyped configuration value
     * @param type target class
     * @param <T>  target type
     * @return optional of bound value, or empty on missing / mismatch
     */
    public static <T> Optional<T> decodeOptional(Object raw, Class<T> type) {
        return Optional.ofNullable(decode(raw, type));
    }

    /**
     * Lazily resolves Jackson via reflection so toggly-core stays free of a
     * required jackson-databind runtime dependency.
     */
    private static final class JacksonHolder {
        private static final Object MAPPER = createMapper();

        private JacksonHolder() {
        }

        private static Object createMapper() {
            try {
                Class<?> mapperClass = Class.forName("com.fasterxml.jackson.databind.ObjectMapper");
                return mapperClass.getDeclaredConstructor().newInstance();
            } catch (ReflectiveOperationException | LinkageError e) {
                return null;
            }
        }

        private static Object convertValue(Object mapper, Object raw, Class<?> type) {
            try {
                return mapper.getClass()
                        .getMethod("convertValue", Object.class, Class.class)
                        .invoke(mapper, raw, type);
            } catch (ReflectiveOperationException e) {
                Throwable cause = e.getCause() != null ? e.getCause() : e;
                if (cause instanceof RuntimeException) {
                    throw (RuntimeException) cause;
                }
                throw new IllegalArgumentException(cause);
            }
        }
    }
}
