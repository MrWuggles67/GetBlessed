import SwiftUI

/// A Blessings member's history: each blessing, its Tip Service Fee and total charged.
struct MyBlessingsView: View {
    @Environment(SessionStore.self) private var session
    @State private var blessings: [Blessing]?
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }
            ForEach(blessings ?? []) { blessing in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(blessing.billTitle).font(.headline)
                        Spacer()
                        Text(blessing.amount.decimal.currency(blessing.currency)).font(.headline.monospacedDigit())
                    }
                    Text("Tip Service Fee \(blessing.tipServiceFee.decimal.currency(blessing.currency)) · charged \(blessing.chargeTotal.decimal.currency(blessing.currency))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("\(blessing.status.capitalized) · \(blessing.createdAt.formatted(date: .abbreviated, time: .omitted))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .overlay {
            if blessings == nil && errorMessage == nil {
                ProgressView()
            } else if blessings?.isEmpty == true {
                ContentUnavailableView("No blessings yet", systemImage: "gift", description: Text("Bills you bless will show up here."))
            }
        }
        .navigationTitle("My blessings")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            blessings = try await session.api.myBlessings()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
