import Foundation
import UIKit

enum APIError: LocalizedError {
    case unauthorized
    case server(status: Int, message: String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .unauthorized: "Your session has expired. Please log in again."
        case .server(_, let message): message
        case .invalidResponse: "The server sent an unexpected response."
        }
    }
}

/// Talks to the GetBlessed REST API (see backend/README).
final class APIClient: @unchecked Sendable {
    let baseURL: URL
    var token: String?
    private let session: URLSession

    init(baseURL: URL = APIClient.configuredBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    static var configuredBaseURL: URL {
        let value = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String
        return URL(string: value ?? "") ?? URL(string: "http://localhost:3000")!
    }

    // MARK: Auth

    func signUpBillable(_ form: BillableSignUp) async throws -> AuthResponse {
        try await send(jsonRequest("POST", "/api/auth/signup/billable", body: form))
    }

    func signUpBlessings(_ form: BlessingsSignUp) async throws -> AuthResponse {
        try await send(jsonRequest("POST", "/api/auth/signup/blessings", body: form))
    }

    func logIn(email: String, password: String) async throws -> AuthResponse {
        try await send(jsonRequest("POST", "/api/auth/login", body: ["email": email, "password": password]))
    }

    func me() async throws -> User {
        struct Response: Decodable { let user: User }
        let response: Response = try await send(request("GET", "/api/auth/me"))
        return response.user
    }

    // MARK: Bills

    func uploadBill(_ bill: BillUpload, image: UIImage) async throws -> Bill {
        let boundary = "GetBlessed-\(UUID().uuidString)"
        var body = Data()
        func append(_ string: String) { body.append(Data(string.utf8)) }

        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"bill\"\r\n\r\n")
        body.append(try JSONEncoder().encode(bill))
        append("\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"image\"; filename=\"bill.jpg\"\r\n")
        append("Content-Type: image/jpeg\r\n\r\n")
        body.append(image.uploadJPEG())
        append("\r\n--\(boundary)--\r\n")

        var req = request("POST", "/api/bills")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body

        struct Response: Decodable { let bill: Bill }
        let response: Response = try await send(req)
        return response.bill
    }

    func myBills(cursor: String? = nil) async throws -> BillPage {
        try await send(request("GET", "/api/bills/mine", query: ["cursor": cursor]))
    }

    func feed(status: Bill.Status? = nil, cursor: String? = nil) async throws -> BillPage {
        try await send(request("GET", "/api/bills/feed", query: ["status": status?.rawValue, "cursor": cursor]))
    }

    func bill(id: String) async throws -> Bill {
        struct Response: Decodable { let bill: Bill }
        let response: Response = try await send(request("GET", "/api/bills/\(id)"))
        return response.bill
    }

    func imageData(path: String) async throws -> Data {
        try await data(for: request("GET", path))
    }

    // MARK: Blessings membership & blessing

    func pricing() async throws -> Pricing {
        try await send(request("GET", "/api/pricing"))
    }

    /// Sends a StoreKit 2 transaction (its signed JWS) to the server for verification.
    func verifyAppleTransaction(_ signedTransaction: String) async throws {
        struct Ignored: Decodable {}
        let _: Ignored = try await send(jsonRequest("POST", "/api/subscriptions/apple", body: ["signedTransaction": signedTransaction]))
    }

    func startBlessing(billID: String, amount: Decimal) async throws -> BlessingCheckout {
        try await send(jsonRequest("POST", "/api/bills/\(billID)/blessings", body: ["amount": amount.roundedTo().apiString]))
    }

    func myBlessings() async throws -> [Blessing] {
        struct Response: Decodable { let blessings: [Blessing] }
        let response: Response = try await send(request("GET", "/api/blessings/mine"))
        return response.blessings
    }

    // MARK: Plumbing

    private func request(_ method: String, _ path: String, query: [String: String?] = [:]) -> URLRequest {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        let items = query.compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }
        if !items.isEmpty { components.queryItems = items }
        var req = URLRequest(url: components.url!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return req
    }

    private func jsonRequest(_ method: String, _ path: String, body: some Encodable) throws -> URLRequest {
        var req = request(method, path)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(body)
        return req
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data = try await data(for: request)
        return try Self.decoder.decode(T.self, from: data)
    }

    private func data(for request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        switch http.statusCode {
        case 200..<300:
            return data
        case 401 where request.value(forHTTPHeaderField: "Authorization") != nil:
            throw APIError.unauthorized
        default:
            struct ErrorBody: Decodable { struct Inner: Decodable { let message: String }; let error: Inner }
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error.message
            throw APIError.server(status: http.statusCode, message: message ?? "Request failed (\(http.statusCode)).")
        }
    }

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        decoder.dateDecodingStrategy = .custom { decoder in
            let string = try decoder.singleValueContainer().decode(String.self)
            if let date = withFraction.date(from: string) ?? plain.date(from: string) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date \(string)"))
        }
        return decoder
    }()
}

private extension UIImage {
    /// Downscales very large photos so uploads stay fast and under the size limit.
    func uploadJPEG(maxDimension: CGFloat = 2400) -> Data {
        let longest = max(size.width, size.height)
        guard longest > maxDimension else { return jpegData(compressionQuality: 0.8) ?? Data() }
        let scale = maxDimension / longest
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
        return resized.jpegData(compressionQuality: 0.8) ?? Data()
    }
}
