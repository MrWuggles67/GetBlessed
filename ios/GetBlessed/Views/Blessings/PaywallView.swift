import SwiftUI

/// Shown to Blessings members without an active plan (for example if they
/// skipped the purchase while signing up, or their plan ended).
struct PaywallView: View {
    @Environment(SessionStore.self) private var session
    @Environment(SubscriptionStore.self) private var subscriptions
    @State private var selection: String?
    @State private var isWorking = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("Choose a plan to see every bill Billable members post and bless them.", systemImage: "gift.fill")
                }
                Section {
                    PlanPicker(selection: $selection)
                } header: {
                    Text("Blessings membership")
                } footer: {
                    PlanFooter()
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
                Section {
                    Button {
                        Task { await run { try await purchaseSelected() } }
                    } label: {
                        HStack {
                            Spacer()
                            if isWorking { ProgressView() } else { Text("Subscribe").bold() }
                            Spacer()
                        }
                    }
                    .disabled(isWorking || selection == nil)
                    Button("Restore purchases") {
                        Task { await run { try await subscriptions.restore() } }
                    }
                    .disabled(isWorking)
                }
            }
            .navigationTitle("Become a Blessing")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { AccountMenu() }
            }
        }
    }

    private func purchaseSelected() async throws {
        guard let offer = subscriptions.offers.first(where: { $0.id == selection }) else { return }
        try await subscriptions.purchase(offer)
    }

    private func run(_ action: () async throws -> Void) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            try await action()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
