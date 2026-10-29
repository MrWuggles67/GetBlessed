import Foundation

enum Role: String, Codable {
    /// Default member: can upload bills.
    case billable
    /// Members who bless bills: can see every Billable member's postings.
    case blessings
}

struct User: Codable, Equatable, Identifiable {
    let id: String
    let email: String
    let displayName: String
    let role: Role
    let createdAt: Date
    /// Only present for Blessings members, and only on their own profile.
    let annualIncome: String?
}

struct AuthResponse: Decodable {
    let token: String
    let user: User
}

struct BillableSignUp: Encodable {
    var displayName = ""
    var email = ""
    var password = ""
}

struct BlessingsSignUp: Encodable {
    var displayName = ""
    var email = ""
    var password = ""
    /// Yearly income, sent as a plain decimal string ("85000.00").
    var annualIncome = ""
}

struct Bill: Decodable, Identifiable, Hashable {
    struct Poster: Decodable, Hashable {
        let id: String
        let displayName: String
    }

    struct Item: Decodable, Hashable, Identifiable {
        let lineNo: Int
        let name: String
        let quantity: Double
        let unitPrice: String
        let lineTotal: String
        var id: Int { lineNo }
    }

    enum Status: String, Decodable {
        case open, blessed, closed, removed
    }

    let id: String
    let title: String
    let merchant: String?
    let description: String?
    let itemCount: Int
    let subtotal: String
    let tax: String
    let total: String
    let currency: String
    let status: Status
    let createdAt: Date
    let imageUrl: String
    let postedBy: Poster
    let items: [Item]?
}

struct BillPage: Decodable {
    let bills: [Bill]
    let nextCursor: String?
}

/// The bill the member reviewed after scanning, ready to upload.
struct BillUpload: Encodable {
    struct Item: Encodable {
        let name: String
        let quantity: String
        let lineTotal: String
    }

    let title: String
    let merchant: String?
    let description: String?
    let items: [Item]
    let tax: String
    let total: String
    let ocrRawText: String?
}
