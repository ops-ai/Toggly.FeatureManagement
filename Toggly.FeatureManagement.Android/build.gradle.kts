// Top-level build file for Toggly Android SDK

plugins {
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.maven.publish) apply false
    alias(libs.plugins.kover)
}

allprojects {
    group = "io.toggly"
    version = "1.1.0"
}

dependencies {
    kover(project(":toggly-android-core"))
    kover(project(":toggly-compose"))
    kover(project(":toggly-views"))
    kover(project(":toggly-room"))
    kover(project(":toggly-datastore"))
}

tasks.register("clean", Delete::class) {
    delete(rootProject.layout.buildDirectory)
}
