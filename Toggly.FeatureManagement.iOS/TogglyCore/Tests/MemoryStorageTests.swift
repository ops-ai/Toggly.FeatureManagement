import XCTest
@testable import TogglyCore

final class MemoryStorageTests: XCTestCase {
    var storage: MemoryStorage!

    override func setUp() async throws {
        storage = MemoryStorage()
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

    func testDeleteNonExistentKey() async {
        // Should not throw
        await storage.delete("nonexistent")
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

    func testMultipleKeys() async {
        await storage.set("key1", value: "value1")
        await storage.set("key2", value: "value2")
        await storage.set("key3", value: "value3")

        let value1 = await storage.get("key1")
        let value2 = await storage.get("key2")
        let value3 = await storage.get("key3")

        XCTAssertEqual(value1, "value1")
        XCTAssertEqual(value2, "value2")
        XCTAssertEqual(value3, "value3")
    }
}
