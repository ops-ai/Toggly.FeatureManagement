# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in the Android SDK tools.

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase

# Kotlin Serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt

# Toggly models
-keepclassmembers class io.toggly.core.models.** { *; }
