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
    /// Blessings only: passed to StoreKit so purchases are tied to this member.
    let appAccountToken: String?
    /// Blessings only: the active plan, or nil when they need to choose one.
    let subscription: Subscription?

    var needsPlan: Bool { role == .blessings && subscription == nil }
}

struct Subscription: Codable, Equatable {
    let plan: String
    let expiresAt: Date
}

struct Pricing: Decodable {
    struct Plan: Decodable, Identifiable {
        let plan: String
        let productId: String
        let name: String
        let period: String
        let autoRenews: Bool
        let price: String
        var id: String { plan }
    }

    struct TipServiceFee: Decodable {
        let fee: String
        let per: String

        /// $1.99 for every started $800 of the blessing.
        func feeAmount(for amount: Decimal) -> Decimal {
            guard amount > 0, per.decimal > 0 else { return 0 }
            var blocks = amount / per.decimal
            var rounded = Decimal()
            NSDecimalRound(&rounded, &blocks, 0, .up)
            return rounded * fee.decimal
        }
    }

    let plans: [Plan]
    let tipServiceFee: TipServiceFee
}

struct Blessing: Decodable, Identifiable {
    let id: String
    let billId: String
    let billTitle: String
    let amount: String
    let tipServiceFee: String
    let chargeTotal: String
    let currency: String
    let status: String
    let createdAt: Date
}

struct BlessingCheckout: Decodable {
    struct Payment: Decodable {
        let clientSecret: String
        let publishableKey: String
    }

    let blessing: Blessing
    let payment: Payment
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
    let amountBlessed: String
    let amountRemaining: String
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
