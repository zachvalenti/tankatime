// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TankaTimeCore",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .library(name: "TankaTimeCore", targets: ["TankaTimeCore"])
    ],
    targets: [
        .target(name: "TankaTimeCore"),
        .testTarget(name: "TankaTimeCoreTests", dependencies: ["TankaTimeCore"])
    ]
)
