import SwiftUI

/// Sign-up page for Blessings members (can see every Billable member's bills).
/// Includes the member's yearly income.
struct BlessingsSignUpView: View {
    @Environment(SessionStore.self) private var session
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

            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }

            Section {
                Button {
                    Task { await submit() }
                } label: {
                    HStack {
                        Spacer()
                        if isSubmitting { ProgressView() } else { Text("Create Blessings account").bold() }
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
        form.annualIncome = annualIncome.roundedTo().apiString
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await session.signUpBlessings(form)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
