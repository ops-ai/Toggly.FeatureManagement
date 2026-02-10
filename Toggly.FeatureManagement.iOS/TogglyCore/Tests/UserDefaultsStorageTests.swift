import XCTest
@testable import TogglyCore

final class UserDefaultsStorageTests: XCTestCase {
    var storage: UserDefaultsStorage!
    var defaults: UserDefaults!

    override func setUp() async throws {
        defaults = UserDefaults(suiteName: "TogglyTests")!
        defaults.removePersistentDomain(forName: "TogglyTests")
        storage = UserDefaultsStorage(defaults: defaults, keyPrefix: "test_")
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: "TogglyTests")
    }

    func testSetAndGet() async {
        await storage.set("key1", value: "value1")

        let value = await storage.get("key1")
        XCTAssertEqual(value, "value1")
    }

    func testGetNonExistentKey() async {
        let value = await storage.get("nonexistent")
        XCTAssertNil(value)
    }

    func testOverwriteValue() async {
        await storage.set("key", value: "value1")
        await storage.set("key", value: "value2")

        let value = await storage.get("key")
        XCTAssertEqual(value, "value2")
    }

    func testDelete() async {
        await storage.set("key", value: "value")
        await storage.delete("key")

        let value = await storage.get("key")
        XCTAssertNil(value)
    }

    func testClear() async {
        await storage.set("key1", value: "value1")
        await storage.set("key2", value: "value2")
        await storage.clear()

        let value1 = await storage.get("key1")
        let value2 = await storage.get("key2")

        XCTAssertNil(value1)
        XCTAssertNil(value2)
    }

    func testKeyPrefix() async {
        await storage.set("mykey", value: "myvalue")

        // Verify the key is prefixed in UserDefaults
        let rawValue = defaults.string(forKey: "test_mykey")
        XCTAssertEqual(rawValue, "myvalue")

        // Verify unprefixed key doesn't exist
        let unprefixedValue = defaults.string(forKey: "mykey")
        XCTAssertNil(unprefixedValue)
    }
}
