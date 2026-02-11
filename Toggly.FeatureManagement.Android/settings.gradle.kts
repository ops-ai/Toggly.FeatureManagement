pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "toggly-android"

include(":toggly-android-core")
include(":toggly-compose")
include(":toggly-views")
include(":toggly-room")
include(":toggly-datastore")
