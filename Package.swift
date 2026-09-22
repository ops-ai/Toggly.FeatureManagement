// swift-tools-version:5.5
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "Toggly",
    platforms: [
        .iOS(.v14),
        .macOS(.v11),
        .tvOS(.v14),
        .watchOS(.v7)
    ],
    products: [
        .library(
            name: "TogglyCore",
            targets: ["TogglyCore"]),
        .library(
            name: "TogglySwiftUI",
            targets: ["TogglySwiftUI"]),
        .library(
            name: "TogglyUIKit",
            targets: ["TogglyUIKit"]),
        .library(
            name: "TogglyCombine",
            targets: ["TogglyCombine"]),
    ],
    dependencies: [],
    targets: [
        // Core package - pure Swift, Foundation only
        .target(
            name: "TogglyCore",
            dependencies: [],
            path: "Toggly.FeatureManagement.iOS/TogglyCore/Sources",
            linkerSettings: [.linkedLibrary("z")]),
        .testTarget(
            name: "TogglyCoreTests",
            dependencies: ["TogglyCore"],
            path: "Toggly.FeatureManagement.iOS/TogglyCore/Tests"),

        // SwiftUI package
        .target(
            name: "TogglySwiftUI",
            dependencies: ["TogglyCore"],
            path: "Toggly.FeatureManagement.iOS/TogglySwiftUI/Sources"),
        .testTarget(
            name: "TogglySwiftUITests",
            dependencies: ["TogglySwiftUI"],
            path: "Toggly.FeatureManagement.iOS/TogglySwiftUI/Tests"),

        // UIKit package
        .target(
            name: "TogglyUIKit",
            dependencies: ["TogglyCore"],
            path: "Toggly.FeatureManagement.iOS/TogglyUIKit/Sources"),
        .testTarget(
            name: "TogglyUIKitTests",
            dependencies: ["TogglyUIKit"],
            path: "Toggly.FeatureManagement.iOS/TogglyUIKit/Tests"),

        // Combine package
        .target(
            name: "TogglyCombine",
            dependencies: ["TogglyCore"],
            path: "Toggly.FeatureManagement.iOS/TogglyCombine/Sources"),
        .testTarget(
            name: "TogglyCombineTests",
            dependencies: ["TogglyCombine"],
            path: "Toggly.FeatureManagement.iOS/TogglyCombine/Tests"),
    ]
)
