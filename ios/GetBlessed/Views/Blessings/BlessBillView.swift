import StripePaymentSheet
import SwiftUI

/// A Blessings member chooses how much to bless a bill with. The Tip Service
/// Fee ($1.99 for every started $800) is added and the card payment is taken
/// with Stripe.
struct BlessBillView: View {
    @Environment(SessionStore.self) private var session
    @Environment(SubscriptionStore.self) private var subscriptions
    @Environment(\.dismiss) private var dismiss
    let bill: Bill
    let onBlessed: () -> Void

    @State private var amount: Decimal?
    @State private var paymentSheet: PaymentSheet?
    @State private var showsPaymentSheet = false
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var thankYou = false

    private var remaining: Decimal { bill.amountRemaining.decimal }
    private var blessing: Decimal { amount ?? 0 }
    private var fee: Decimal { subscriptions.pricing?.tipServiceFee.feeAmount(for: blessing) ?? 0 }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent(bill.title, value: bill.postedBy.displayName)
                    LabeledContent("Still needed", value: remaining.currency(bill.currency))
                }

                Section {
                    TextField("Amount", value: $amount, format: .currency(code: bill.currency))
                        .keyboardType(.decimalPad)
                        .font(.title2.monospacedDigit())
                    Button("Bless the full \(remaining.currency(bill.currency))") { amount = remaining }
                } header: {
                    Text("How much would you like to bless?")
                }

                Section {
                    LabeledContent("Blessing", value: blessing.currency(bill.currency))
                    LabeledContent("Tip Service Fee", value: fee.currency(bill.currency))
                    LabeledContent {
                        Text((blessing + fee).currency(bill.currency)).bold()
                    } label: {
                        Text("You pay").bold()
                    }
                } footer: {
                    if let rule = subscriptions.pricing?.tipServiceFee {
                        Text("The Tip Service Fee is \(rule.fee.decimal.currency()) for every \(rule.per.decimal.currency()) blessed.")
                    }
                }

                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }

                Section {
                    Button {
                        Task { await checkout() }
                    } label: {
                        HStack {
                            Spacer()
                            if isWorking { ProgressView() } else { Text("Continue to payment").bold() }
                            Spacer()
                        }
                    }
                    .disabled(isWorking || blessing <= 0 || blessing > remaining)
                }
            }
            .navigationTitle("Bless this bill")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .background {
                if let paymentSheet {
                    Color.clear.paymentSheet(isPresented: $showsPaymentSheet, paymentSheet: paymentSheet, onCompletion: finished)
                }
            }
            .alert("Thank you for the blessing!", isPresented: $thankYou) {
                Button("Done") { dismiss() }
            } message: {
                Text("\(bill.postedBy.displayName) has been blessed with \(blessing.currency(bill.currency)).")
            }
            .task {
                if subscriptions.pricing == nil { await subscriptions.loadOffers() }
            }
        }
        .interactiveDismissDisabled(isWorking)
    }

    private func checkout() async {
        if blessing > remaining {
            errorMessage = "You can bless up to \(remaining.currency(bill.currency))."
            return
        }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let checkout = try await session.api.startBlessing(billID: bill.id, amount: blessing)
            STPAPIClient.shared.publishableKey = checkout.payment.publishableKey
            var configuration = PaymentSheet.Configuration()
            configuration.merchantDisplayName = "GetBlessed"
            paymentSheet = PaymentSheet(paymentIntentClientSecret: checkout.payment.clientSecret, configuration: configuration)
            showsPaymentSheet = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func finished(_ result: PaymentSheetResult) {
        switch result {
        case .completed:
            onBlessed()
            thankYou = true
        case .canceled:
            break
        case .failed(let error):
            errorMessage = error.localizedDescription
        }
    }
}
