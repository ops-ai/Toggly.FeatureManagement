// Top-level build file for Toggly Android SDK

plugins {
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.maven.publish) apply false
}

allprojects {
    group = "io.toggly"
    version = "1.0.0"
}

tasks.register("clean", Delete::class) {
    delete(rootProject.layout.buildDirectory)
}
