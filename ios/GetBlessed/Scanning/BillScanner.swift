import BillParser
import UIKit
import Vision

/// Reads the text on a photographed bill with Apple's on-device Vision OCR and
/// turns it into named, priced items plus the complete total.
enum BillScanner {
    struct Result {
        let bill: ParsedBill
        let rawText: String
    }

    enum ScanError: LocalizedError {
        case unreadableImage
        case noTextFound

        var errorDescription: String? {
            switch self {
            case .unreadableImage: "That picture couldn't be opened."
            case .noTextFound: "No text was found. Try a clearer, well-lit picture of the whole bill."
            }
        }
    }

    static func scan(_ image: UIImage) async throws -> Result {
        guard let cgImage = image.cgImage else { throw ScanError.unreadableImage }
        let orientation = CGImagePropertyOrientation(image.imageOrientation)

        let fragments = try await Task.detached(priority: .userInitiated) { () throws -> [TextFragment] in
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            try VNImageRequestHandler(cgImage: cgImage, orientation: orientation).perform([request])

            return (request.results ?? []).compactMap { observation -> TextFragment? in
                guard let text = observation.topCandidates(1).first?.string else { return nil }
                let box = observation.boundingBox // normalised, origin bottom-left
                return TextFragment(text: text, minX: box.minX, minY: 1 - box.maxY, width: box.width, height: box.height)
            }
        }.value

        guard !fragments.isEmpty else { throw ScanError.noTextFound }
        let rows = TextRowAssembler.rows(from: fragments)
        return Result(bill: ReceiptParser.parse(rows: rows), rawText: rows.joined(separator: "\n"))
    }
}

private extension CGImagePropertyOrientation {
    init(_ orientation: UIImage.Orientation) {
        switch orientation {
        case .up: self = .up
        case .upMirrored: self = .upMirrored
        case .down: self = .down
        case .downMirrored: self = .downMirrored
        case .left: self = .left
        case .leftMirrored: self = .leftMirrored
        case .right: self = .right
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
