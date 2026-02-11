# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in the Android SDK tools.

# DataStore
-keepclassmembers class * extends androidx.datastore.preferences.protobuf.GeneratedMessageLite {
    <fields>;
}
