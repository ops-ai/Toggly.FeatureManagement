import Foundation

/// Soft-decode a variant `configurationValue` as `T`.
///
/// Missing / null → nil. Prefer a direct cast when the runtime value already is
/// `T`. Otherwise encode via `JSONSerialization` (including JSON fragments for
/// scalars) and `JSONDecoder`; any failure → nil.
enum VariantValueDecoder {
    static func decode<T: Decodable>(_ value: Any?, as type: T.Type = T.self) -> T? {
        guard let value else { return nil }
        if let typed = value as? T {
            return typed
        }

        do {
            let data: Data
            if JSONSerialization.isValidJSONObject(value) {
                data = try JSONSerialization.data(withJSONObject: value)
            } else {
                data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
            }
            return try JSONDecoder().decode(type, from: data)
        } catch {
            return nil
        }
    }
}
