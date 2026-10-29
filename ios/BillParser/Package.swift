// swift-tools-version:5.9
import PackageDescription

// Pure-Foundation receipt/bill parsing, kept separate from the app so it can be
// unit tested on any platform (including Linux CI) without Vision or UIKit.
let package = Package(
    name: "BillParser",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "BillParser", targets: ["BillParser"]),
    ],
    targets: [
        .target(name: "BillParser"),
        .testTarget(name: "BillParserTests", dependencies: ["BillParser"]),
    ]
)
