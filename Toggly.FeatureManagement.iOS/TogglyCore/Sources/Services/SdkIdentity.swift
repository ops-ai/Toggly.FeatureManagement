import Foundation

enum SdkIdentity {
    static let sdkId = "ios"

    static var sdkVersion: String {
        togglyVersion
    }

    static var userAgent: String {
        "toggly-\(sdkId)/\(sdkVersion)"
    }

    static func appendSdkQueryParams(to wsUrl: String, cachedRevision: String?) -> String {
        var components = URLComponents(string: wsUrl)
        var queryItems = components?.queryItems ?? []

        if let cachedRevision, !cachedRevision.isEmpty {
            queryItems.append(URLQueryItem(name: "rev", value: cachedRevision))
        }
        queryItems.append(URLQueryItem(name: "sdk", value: sdkId))
        queryItems.append(URLQueryItem(name: "sdkVersion", value: sdkVersion))

        components?.queryItems = queryItems
        return components?.string ?? wsUrl
    }
}
