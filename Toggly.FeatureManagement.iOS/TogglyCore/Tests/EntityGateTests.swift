import XCTest
@testable import TogglyCore

final class EntityGateTests: XCTestCase {
    private let datetimeGate = EntityGate(
        requirement: "all",
        rules: [EntityGateRule(property: "BirthDate", op: "gt", value: "2026-01-01", type: "datetime")]
    )

    override func tearDown() {
        clearRegisteredContexts()
        super.tearDown()
    }

    func testDetectsAndFailsClosed() {
        XCTAssertFalse(isEntityGate(true))
        XCTAssertTrue(isEntityGate(datetimeGate))
        XCTAssertFalse(resolveEvaluatedDefinition(.gate(datetimeGate)))
        XCTAssertTrue(resolveEvaluatedDefinition(nil, defaultValue: true))
        XCTAssertFalse(resolveEvaluatedDefinition(.boolean(false), defaultValue: true))
    }

    func testEvaluatesDatetimeAndFlattens() {
        XCTAssertTrue(resolveEvaluatedDefinition(
            .gate(datetimeGate),
            context: TogglyEntityContext(kind: "Order", key: "1", attributes: ["BirthDate": "2026-06-15T00:00:00Z"])
        ))
        let flattened = toBooleanDefinitions([
            "On": .boolean(true),
            "Off": .boolean(false),
            "Gated": .gate(datetimeGate)
        ])
        XCTAssertEqual(flattened["On"], true)
        XCTAssertEqual(flattened["Off"], false)
        XCTAssertEqual(flattened["Gated"], false)
    }

    func testOperatorsFailClosed() {
        let anyGate = EntityGate(
            requirement: "any",
            rules: [
                EntityGateRule(property: "Color", op: "eq", value: "red"),
                EntityGateRule(property: "Color", op: "eq", value: "blue")
            ]
        )
        XCTAssertTrue(applyEntityGate(anyGate, attributes: ["Color": "blue"]))
        XCTAssertFalse(applyEntityGate(
            EntityGate(requirement: "all", rules: anyGate.rules),
            attributes: ["Color": "blue"]
        ))
        XCTAssertFalse(applyEntityGate(
            EntityGate(requirement: "all", rules: [EntityGateRule(property: "Color", op: "neq", value: "red")]),
            attributes: [:]
        ))
        XCTAssertFalse(applyEntityGate(
            EntityGate(requirement: "all", rules: [EntityGateRule(property: "Code", op: "gt", value: "9")]),
            attributes: ["Code": "10"]
        ))
        XCTAssertTrue(applyEntityGate(
            EntityGate(requirement: "all", rules: [EntityGateRule(property: "color", op: "eq", value: "RED")]),
            attributes: ["Color": "red"]
        ))
        XCTAssertFalse(applyEntityGate(EntityGate(requirement: "all", rules: []), attributes: ["Color": "red"]))
        XCTAssertTrue(applyEntityGate(
            EntityGate(requirement: "all", rules: [EntityGateRule(property: "Age", op: "gte", value: "2", type: "number")]),
            attributes: ["Age": 2]
        ))
        XCTAssertTrue(applyEntityGate(
            EntityGate(requirement: "all", rules: [EntityGateRule(property: "Color", op: "in", value: "red, blue")]),
            attributes: ["Color": "BLUE"]
        ))
        XCTAssertTrue(applyEntityGate(
            EntityGate(requirement: "all", rules: [EntityGateRule(property: "Name", op: "contains", value: "pup")]),
            attributes: ["Name": "Order"]
        ))
        XCTAssertTrue(applyEntityGate(
            EntityGate(requirement: "all", rules: [EntityGateRule(property: "Tags", op: "contains", value: "beta", type: "string[]")]),
            attributes: ["Tags": ["GA", "Beta"]]
        ))
        XCTAssertFalse(applyEntityGate(
            EntityGate(requirement: "all", rules: [EntityGateRule(property: "Color", op: "matches", value: "red")]),
            attributes: ["Color": "red"]
        ))
        XCTAssertFalse(applyEntityGate(
            EntityGate(requirement: "all", rules: [EntityGateRule(property: "Born", op: "gt", value: "not-a-date", type: "datetime")]),
            attributes: ["Born": "2026-06-01T00:00:00Z"]
        ))
    }

    func testParsesMixedDefinitions() throws {
        let raw = "{\"On\":true,\"Gated\":{\"requirement\":\"all\",\"rules\":[{\"property\":\"Color\",\"op\":\"eq\",\"value\":\"red\"}]}}"
        let parsed = try parseEvaluatedDefinitions(from: raw)
        XCTAssertEqual(toBooleanDefinitions(parsed)["Gated"], false)
        XCTAssertTrue(resolveEvaluatedDefinition(
            parsed["Gated"],
            context: TogglyEntityContext(kind: "Order", key: "1", attributes: ["Color": "red"])
        ))
        XCTAssertEqual(try SignedDefsVerify.parseDefinitions(raw)["On"], true)
    }

    func testRegisterContextIsLocalOnly() {
        registerContext("Order") { entity in
            let order = entity as! [String: String]
            return TogglyEntityContext(kind: "Order", key: order["id"] ?? "", attributes: ["Color": order["color"] as Any])
        }
        XCTAssertEqual(mapEntityContext(kind: "Order", entity: ["id": "1", "color": "red"])?.key, "1")
        XCTAssertNil(resolveEntityContext(kind: "Kitten", entity: ["id": "1"]))
    }
}
