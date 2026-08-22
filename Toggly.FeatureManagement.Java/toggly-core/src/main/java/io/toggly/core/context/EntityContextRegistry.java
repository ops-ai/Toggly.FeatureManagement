package io.toggly.core.context;

import io.toggly.core.config.TogglyConfig;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Local mapper registry plus optional startup PUT to {@code sdk/{appKey}/contexts}.
 */
public final class EntityContextRegistry {

    private static final Logger LOGGER = Logger.getLogger(EntityContextRegistry.class.getName());
    private static final Map<String, EntityContextSchemaRegistration> SCHEMAS = new ConcurrentHashMap<>();
    private static final Map<String, Function<Object, TogglyEntityContext>> MAPPERS = new ConcurrentHashMap<>();

    private EntityContextRegistry() {}

    public static void registerContext(String kind, Function<Object, TogglyEntityContext> mapper) {
        registerContext(kind, mapper, null);
    }

    public static void registerContext(
            String kind,
            Function<Object, TogglyEntityContext> mapper,
            EntityContextSchemaRegistration schema) {
        if (kind == null || mapper == null) {
            throw new IllegalArgumentException("kind and mapper are required");
        }
        MAPPERS.put(kind, mapper);
        if (schema != null) {
            SCHEMAS.put(kind, schema.withKind(kind));
        }
    }

    public static TogglyEntityContext map(String kind, Object entity) {
        Function<Object, TogglyEntityContext> mapper = MAPPERS.get(kind);
        return mapper != null ? mapper.apply(entity) : null;
    }

    public static List<EntityContextSchemaRegistration> getSchemaRegistrations() {
        return new ArrayList<>(SCHEMAS.values());
    }

    public static void clear() {
        SCHEMAS.clear();
        MAPPERS.clear();
    }

    public static void registerAtStartup(TogglyConfig config) {
        if (config == null || !config.isRegisterContextsOnStartup()) {
            return;
        }
        if (config.getAppKey() == null || config.getAppKey().isEmpty()) {
            return;
        }
        List<EntityContextSchemaRegistration> registrations = getSchemaRegistrations();
        if (registrations.isEmpty()) {
            return;
        }
        String payload = buildPayload(registrations);
        String base = config.getBaseUrl();
        if (base == null || base.isEmpty()) {
            return;
        }
        if (!base.endsWith("/")) {
            base = base + "/";
        }
        String url = base + "sdk/" + config.getAppKey() + "/contexts";
        try {
            HttpURLConnection connection = (HttpURLConnection) URI.create(url).toURL().openConnection();
            connection.setRequestMethod("PUT");
            connection.setConnectTimeout((int) Math.min(config.getConnectTimeout().toMillis(), Integer.MAX_VALUE));
            connection.setReadTimeout((int) Math.min(config.getReadTimeout().toMillis(), Integer.MAX_VALUE));
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            byte[] body = payload.getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = connection.getOutputStream()) {
                os.write(body);
            }
            int status = connection.getResponseCode();
            if (config.isDebug()) {
                if (status >= 200 && status < 300) {
                    LOGGER.fine("[Toggly] Registered " + registrations.size() + " entity context kind(s) at startup.");
                } else {
                    LOGGER.warning("[Toggly] Entity context registration returned HTTP " + status
                            + ". Dashboard catalog was not updated.");
                }
            }
        } catch (Exception e) {
            if (config.isDebug()) {
                LOGGER.log(Level.WARNING, "[Toggly] Entity context registration failed.", e);
            }
        }
    }

    static String buildPayload(List<EntityContextSchemaRegistration> registrations) {
        StringBuilder sb = new StringBuilder("{\"contexts\":[");
        boolean first = true;
        for (EntityContextSchemaRegistration registration : registrations) {
            if (!first) {
                sb.append(',');
            }
            first = false;
            sb.append("{\"kind\":\"").append(escape(registration.kind())).append("\"");
            sb.append(",\"keyProperty\":\"").append(escape(registration.keyProperty())).append("\"");
            String display = registration.displayName() != null ? registration.displayName() : registration.kind();
            sb.append(",\"displayName\":\"").append(escape(display)).append("\"");
            sb.append(",\"properties\":[");
            boolean firstProp = true;
            for (EntityContextPropertySchema property : registration.properties()) {
                if (!firstProp) {
                    sb.append(',');
                }
                firstProp = false;
                sb.append("{\"name\":\"").append(escape(property.name())).append("\"");
                sb.append(",\"type\":\"").append(escape(property.type())).append("\"}");
            }
            sb.append("]}");
        }
        sb.append("]}");
        return sb.toString();
    }

    private static String escape(String value) {
        if (value == null) {
            return "";
        }
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public record EntityContextPropertySchema(String name, String type) {}

    public record EntityContextSchemaRegistration(
            String kind,
            String keyProperty,
            String displayName,
            List<EntityContextPropertySchema> properties) {

        public EntityContextSchemaRegistration withKind(String newKind) {
            return new EntityContextSchemaRegistration(
                    newKind,
                    keyProperty,
                    displayName != null ? displayName : newKind,
                    properties != null ? properties : List.of());
        }
    }
}
