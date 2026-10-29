import Foundation
import Observation

/// Cursor-paginated list of bills (used for "my bills" and the Blessings feed).
@MainActor
@Observable
final class BillListModel {
    private(set) var bills: [Bill] = []
    private(set) var isLoading = false
    var errorMessage: String?
    private var nextCursor: String?
    private var reachedEnd = false
    private let fetch: (String?) async throws -> BillPage

    init(fetch: @escaping (String?) async throws -> BillPage) {
        self.fetch = fetch
    }

    func refresh() async {
        nextCursor = nil
        reachedEnd = false
        await load(replacing: true)
    }

    func loadMoreIfNeeded(after bill: Bill) async {
        guard bill.id == bills.last?.id, !reachedEnd, !isLoading else { return }
        await load(replacing: false)
    }

    func insert(_ bill: Bill) {
        bills.insert(bill, at: 0)
    }

    private func load(replacing: Bool) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let page = try await fetch(replacing ? nil : nextCursor)
            bills = replacing ? page.bills : bills + page.bills
            nextCursor = page.nextCursor
            reachedEnd = page.nextCursor == nil
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
