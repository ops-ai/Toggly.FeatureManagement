plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "io.toggly.acceptance"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.toggly.acceptance.telemetry"
        minSdk = 24
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildTypes {
        debug {
            enableAndroidTestCoverage = true
        }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
}

dependencies {
    implementation(libs.toggly.core)
    implementation(libs.toggly.compose)
    implementation(libs.toggly.views)
    implementation(libs.toggly.room)
    implementation(libs.toggly.datastore)
    // Published AARs still declare OkHttp 4; pin 5.x into the app APK so
    // androidTest mockwebserver 5 resolves OkHttp 5 internals at runtime.
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.material3)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.androidx.appcompat)

    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.espresso)
    androidTestImplementation(libs.mockwebserver)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(platform(libs.androidx.compose.bom))
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}

configurations.configureEach {
    resolutionStrategy {
        force(
            "com.squareup.okhttp3:okhttp:${libs.versions.okhttp.get()}",
            "com.squareup.okhttp3:logging-interceptor:${libs.versions.okhttp.get()}",
            "com.squareup.okhttp3:mockwebserver:${libs.versions.mockwebserver.get()}",
            "com.squareup.okhttp3:mockwebserver3:${libs.versions.mockwebserver.get()}",
        )
    }
}
