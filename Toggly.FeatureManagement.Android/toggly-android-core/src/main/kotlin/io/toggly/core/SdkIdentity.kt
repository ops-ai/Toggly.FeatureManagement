package io.toggly.core

import java.net.URLEncoder

object SdkIdentity {
    const val SDK_ID = "android"
    const val SDK_VERSION = "1.1.0"

    fun userAgent(): String = "toggly-$SDK_ID/$SDK_VERSION"

    fun appendSdkQueryParams(wsUrl: String, cachedRevision: String?): String {
        val params = linkedMapOf<String, String>()
        if (!cachedRevision.isNullOrEmpty()) {
            params["rev"] = cachedRevision
        }
        params["sdk"] = SDK_ID
        params["sdkVersion"] = SDK_VERSION

        val query = params.entries.joinToString("&") { (key, value) ->
            "${URLEncoder.encode(key, "UTF-8")}=${URLEncoder.encode(value, "UTF-8")}"
        }

        return "$wsUrl?$query"
    }
}
