# Toggly Java SDK

Official Java SDK for [Toggly](https://toggly.io) feature flags and experimentation platform.

<p align="center">
  <a href="https://search.maven.org/search?q=g:io.toggly"><img src="https://img.shields.io/maven-central/v/io.toggly/toggly-core" alt="Maven Central"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

## Features

- **Zero-dependency core** - Works anywhere Java runs
- **Spring Boot auto-configuration** - Just add the dependency
- **Spring MVC integration** - Interceptors, annotations, and argument resolvers
- **Spring WebFlux support** - Reactive APIs and filters
- **Servlet integration** - Works with any servlet container
- **Distributed caching** - Caffeine and Redis support
- **Deterministic rollouts** - Consistent user experience across requests

## Installation

### Maven

```xml
<!-- Core (required) -->
<dependency>
    <groupId>io.toggly</groupId>
    <artifactId>toggly-core</artifactId>
    <version>1.0.0</version>
</dependency>

<!-- Spring Boot (recommended) -->
<dependency>
    <groupId>io.toggly</groupId>
    <artifactId>toggly-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>

<!-- Spring MVC -->
<dependency>
    <groupId>io.toggly</groupId>
    <artifactId>toggly-spring-mvc</artifactId>
    <version>1.0.0</version>
</dependency>

<!-- Spring WebFlux -->
<dependency>
    <groupId>io.toggly</groupId>
    <artifactId>toggly-spring-webflux</artifactId>
    <version>1.0.0</version>
</dependency>

<!-- Servlet -->
<dependency>
    <groupId>io.toggly</groupId>
    <artifactId>toggly-servlet</artifactId>
    <version>1.0.0</version>
</dependency>

<!-- Caching (optional) -->
<dependency>
    <groupId>io.toggly</groupId>
    <artifactId>toggly-cache-caffeine</artifactId>
    <version>1.0.0</version>
</dependency>

<dependency>
    <groupId>io.toggly</groupId>
    <artifactId>toggly-cache-redis</artifactId>
    <version>1.0.0</version>
</dependency>
```

### Gradle

```kotlin
// Core
implementation("io.toggly:toggly-core:1.0.0")

// Spring Boot
implementation("io.toggly:toggly-spring-boot-starter:1.0.0")
```

## Quick Start

### Spring Boot

Add your configuration to `application.yml`:

```yaml
toggly:
  app-key: your-app-key
  environment: Production
  refresh-interval-seconds: 30
```

Inject and use:

```java
@Service
public class MyService {
    private final TogglyClient toggly;

    public MyService(TogglyClient toggly) {
        this.toggly = toggly;
    }

    public void doSomething() {
        if (toggly.isEnabled("new-feature")) {
            // New behavior
        } else {
            // Old behavior
        }
    }
}
```

### Plain Java

```java
TogglyConfig config = TogglyConfig.builder()
    .appKey("your-app-key")
    .environment("Production")
    .build();

TogglyClient client = new TogglyClient(config);

if (client.isEnabled("my-feature")) {
    // Feature is enabled
}
```

### With User Context

```java
EvaluationContext context = EvaluationContext.builder()
    .identity("user-123")
    .group("beta-testers")
    .trait("plan", "premium")
    .build();

if (client.isEnabled("premium-feature", context)) {
    // Feature is enabled for this user
}
```

## Spring MVC Integration

### Controller Annotations

```java
@RestController
public class MyController {

    @GetMapping("/beta-feature")
    @FeatureGate("beta-feature")
    public ResponseEntity<String> betaFeature() {
        return ResponseEntity.ok("Beta feature!");
    }

    @GetMapping("/dashboard")
    public String dashboard(@FeatureFlag("new-dashboard") boolean useNew) {
        return useNew ? "dashboard-v2" : "dashboard-v1";
    }
}
```

### Context from Headers

Register the interceptor:

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new TogglyContextInterceptor(
            new HeaderContextResolver("X-User-Id", "X-User-Groups")
        ));
    }
}
```

## Spring WebFlux Integration

```java
@RestController
public class ReactiveController {
    private final ReactiveTogglyClient toggly;

    @GetMapping("/api/data")
    public Mono<Data> getData() {
        return toggly.isEnabled("new-api")
            .flatMap(enabled -> enabled
                ? newDataService.getData()
                : oldDataService.getData());
    }
}
```

## Caching

### Caffeine (In-Memory)

```java
SnapshotProvider cachedProvider = new CaffeineCachingSnapshotProvider(
    new HttpSnapshotProvider(config),
    CaffeineCacheConfig.builder()
        .expireAfterWrite(Duration.ofMinutes(5))
        .refreshAfterWrite(Duration.ofMinutes(1))
        .build()
);

TogglyClient client = new TogglyClient(config, cachedProvider);
```

### Redis (Distributed)

```java
SnapshotProvider redisProvider = new RedisCachingSnapshotProvider(
    new HttpSnapshotProvider(config),
    RedisCacheConfig.builder()
        .host("redis.example.com")
        .port(6379)
        .ttl(Duration.ofMinutes(5))
        .build()
);
```

## Custom Evaluators

Register custom filter evaluators:

```java
client.getRegistry().register("MyCustomFilter",
    (filter, featureKey, context) -> {
        String value = filter.getStringParameter("value");
        return "expected".equals(value);
    });
```

## Actuator Endpoints

When using Spring Boot Actuator:

- `GET /actuator/toggly` - List all features and states
- `GET /actuator/toggly/{key}` - Get specific feature info
- `POST /actuator/toggly` - Refresh definitions

## Requirements

- Java 11+
- Spring Boot 3.0+ (for Spring modules)
- Spring Framework 6.0+ (for Spring MVC/WebFlux)

## Documentation

Full documentation: [https://docs.toggly.io/sdks/java](https://docs.toggly.io/sdks/java)

## License

MIT License - see [LICENSE](LICENSE) for details.
