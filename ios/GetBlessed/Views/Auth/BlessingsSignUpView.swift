import SwiftUI

/// Sign-up page for Blessings members (can see every Billable member's bills).
/// Includes the member's yearly income and their membership plan.
struct BlessingsSignUpView: View {
    @Environment(SessionStore.self) private var session
    @Environment(SubscriptionStore.self) private var subscriptions
    @State private var plan: String?
    @State private var form = BlessingsSignUp()
    @State private var confirmPassword = ""
    @State private var annualIncome: Decimal?
    @State private var errorMessage: String?
    @State private var isSubmitting = false

    var body: some View {
        Form {
            Section {
                Label("You'll be able to see every bill Billable members post and choose who to bless.", systemImage: "gift.fill")
                    .font(.subheadline)
            }

            AccountFields(
                displayName: $form.displayName,
                email: $form.email,
                password: $form.password,
                confirmPassword: $confirmPassword
            )

            Section {
                TextField("Yearly income", value: $annualIncome, format: .currency(code: "USD").precision(.fractionLength(0...2)))
                    .keyboardType(.decimalPad)
            } header: {
                Text("Income")
            } footer: {
                Text("How much you make on a yearly basis. This stays private and is never shown to other members.")
            }

            Section {
                PlanPicker(selection: $plan)
            } header: {
                Text("Membership plan")
            } footer: {
                PlanFooter()
            }

            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }

            Section {
                Button {
                    Task { await submit() }
                } label: {
                    HStack {
                        Spacer()
                        if isSubmitting { ProgressView() } else { Text("Create account & subscribe").bold() }
                        Spacer()
                    }
                }
                .disabled(isSubmitting)
            }
        }
        .navigationTitle("Blessings sign up")
    }

    private func submit() async {
        if let problem = AccountFields.validate(displayName: form.displayName, email: form.email, password: form.password, confirmPassword: confirmPassword) {
            errorMessage = problem
            return
        }
        guard let annualIncome, annualIncome >= 0 else {
            errorMessage = "Please enter your yearly income."
            return
        }
        guard let offer = subscriptions.offers.first(where: { $0.id == plan }) else {
            errorMessage = "Please choose a membership plan."
            return
        }
        form.annualIncome = annualIncome.roundedTo().apiString
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            // The account is created first so the App Store purchase can be tied
            // to it. If the purchase is cancelled, the member lands on the plan
            // screen and can subscribe from there.
            try await session.signUpBlessings(form)
            try await subscriptions.purchase(offer)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
