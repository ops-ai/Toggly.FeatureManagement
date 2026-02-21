plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.maven.publish)
    alias(libs.plugins.kover)
}

android {
    namespace = "io.toggly.datastore"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        minSdk = libs.versions.minSdk.get().toInt()

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }
}

dependencies {
    // Core module
    api(project(":toggly-android-core"))

    // AndroidX
    implementation(libs.androidx.core.ktx)

    // DataStore
    implementation(libs.bundles.datastore)

    // Coroutines
    implementation(libs.bundles.coroutines)

    // Testing
    testImplementation(libs.bundles.testing)
    testImplementation(libs.bundles.testing.android)
    androidTestImplementation(libs.bundles.testing.android)
}

mavenPublishing {
    publishToMavenCentral(com.vanniktech.maven.publish.SonatypeHost.CENTRAL_PORTAL)
    signAllPublications()

    coordinates("io.toggly", "toggly-datastore", version.toString())

    pom {
        name.set("Toggly DataStore")
        description.set("DataStore storage adapter for Toggly feature flags")
        inceptionYear.set("2024")
        url.set("https://github.com/ops-ai/Toggly.FeatureManagement")

        licenses {
            license {
                name.set("MIT License")
                url.set("https://opensource.org/licenses/MIT")
            }
        }

        developers {
            developer {
                id.set("toggly")
                name.set("Toggly")
                email.set("hello@toggly.io")
            }
        }

        scm {
            url.set("https://github.com/ops-ai/Toggly.FeatureManagement")
            connection.set("scm:git:git://github.com/ops-ai/Toggly.FeatureManagement.git")
            developerConnection.set("scm:git:ssh://github.com/ops-ai/Toggly.FeatureManagement.git")
        }
    }
}
