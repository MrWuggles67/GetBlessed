import SwiftUI

/// The three Blessings membership plans: Monthly, 1-Year and 2-Year.
struct PlanPicker: View {
    @Environment(SubscriptionStore.self) private var subscriptions
    @Binding var selection: String?

    var body: some View {
        if subscriptions.offers.isEmpty {
            HStack {
                ProgressView()
                Text("Loading plans…").foregroundStyle(.secondary).padding(.leading, 8)
            }
            .task { await subscriptions.loadOffers() }
        } else {
            ForEach(subscriptions.offers) { offer in
                Button {
                    selection = offer.id
                } label: {
                    HStack {
                        Image(systemName: selection == offer.id ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selection == offer.id ? Color.accentColor : Color.secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(offer.plan.name).font(.headline)
                            Text(offer.plan.autoRenews ? "Renews every \(offer.plan.period)" : "One payment for \(offer.plan.period), doesn't renew")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(offer.displayPrice).font(.headline.monospacedDigit())
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .onAppear {
                if selection == nil { selection = subscriptions.offers.first?.id }
            }
        }
    }
}

struct PlanFooter: View {
    @Environment(SubscriptionStore.self) private var subscriptions

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Paid through your Apple ID. Monthly and 1-Year plans renew automatically unless cancelled at least 24 hours before the end of the period; manage them in Settings › Apple ID › Subscriptions.")
            if let fee = subscriptions.pricing?.tipServiceFee {
                Text("Each time you bless a bill, a Tip Service Fee of \(fee.fee.decimal.currency()) for every \(fee.per.decimal.currency()) blessed is added.")
            }
        }
    }
}
