import Foundation
import Observation
import StoreKit

/// Blessings membership plans, sold through the App Store with StoreKit 2:
/// Monthly ($9.99) and 1-Year ($69.99) renew automatically; 2-Year ($104.99)
/// is a single purchase that lasts two years. Every transaction is sent to the
/// server, which verifies it with Apple before unlocking the Blessings feed.
@MainActor
@Observable
final class SubscriptionStore {
    struct Offer: Identifiable {
        let plan: Pricing.Plan
        let product: Product?
        var id: String { plan.plan }
        /// Localised App Store price, falling back to the server's USD price.
        var displayPrice: String { product?.displayPrice ?? plan.price.decimal.currency() }
    }

    enum PurchaseError: LocalizedError {
        case unavailable
        case pending
        case unverified

        var errorDescription: String? {
            switch self {
            case .unavailable: "This plan isn't available from the App Store right now."
            case .pending: "Your purchase is waiting for approval. You'll get access as soon as it's approved."
            case .unverified: "The App Store couldn't verify this purchase."
            }
        }
    }

    private(set) var offers: [Offer] = []
    private(set) var pricing: Pricing?
    private let session: SessionStore
    private var updatesTask: Task<Void, Never>?

    init(session: SessionStore) {
        self.session = session
    }

    /// Loads plans from the server and their products from the App Store, and
    /// starts listening for renewals and purchases made outside the app.
    func start() async {
        if updatesTask == nil {
            updatesTask = Task { [weak self] in
                for await result in Transaction.updates {
                    await self?.handle(result)
                }
            }
        }
        await loadOffers()
        await syncEntitlements()
    }

    func loadOffers() async {
        guard let pricing = try? await session.api.pricing() else { return }
        self.pricing = pricing
        let products = (try? await Product.products(for: pricing.plans.map(\.productId))) ?? []
        offers = pricing.plans.map { plan in
            Offer(plan: plan, product: products.first { $0.id == plan.productId })
        }
    }

    /// Buys a plan for the signed-in Blessings member.
    func purchase(_ offer: Offer) async throws {
        guard let product = offer.product else { throw PurchaseError.unavailable }
        var options: Set<Product.PurchaseOption> = []
        if let token = session.currentUser?.appAccountToken.flatMap(UUID.init(uuidString:)) {
            options.insert(.appAccountToken(token))
        }
        switch try await product.purchase(options: options) {
        case .success(let result):
            try await record(result)
        case .pending:
            throw PurchaseError.pending
        case .userCancelled:
            return
        @unknown default:
            return
        }
    }

    /// "Restore purchases": re-syncs with the App Store and re-sends current plans.
    func restore() async throws {
        try await AppStore.sync()
        await syncEntitlements()
    }

    /// Sends every current plan to the server so renewals made while the app
    /// was closed are picked up.
    func syncEntitlements() async {
        guard session.currentUser?.role == .blessings else { return }
        for await result in Transaction.currentEntitlements {
            try? await record(result, refresh: false)
        }
        await session.refreshUser()
    }

    private func handle(_ result: VerificationResult<Transaction>) async {
        guard session.currentUser?.role == .blessings else { return }
        try? await record(result)
    }

    private func record(_ result: VerificationResult<Transaction>, refresh: Bool = true) async throws {
        guard case .verified(let transaction) = result else { throw PurchaseError.unverified }
        // The server checks Apple's signature itself; only finish once it has
        // recorded the purchase so StoreKit re-delivers it if this fails.
        try await session.api.verifyAppleTransaction(result.jwsRepresentation)
        await transaction.finish()
        if refresh { await session.refreshUser() }
    }
}
