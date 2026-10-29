import SwiftUI

/// Sign-up page for Billable members (the default account: can post bills).
struct BillableSignUpView: View {
    @Environment(SessionStore.self) private var session
    @State private var form = BillableSignUp()
    @State private var confirmPassword = ""
    @State private var errorMessage: String?
    @State private var isSubmitting = false

    var body: some View {
        Form {
            Section {
                Label("You'll be able to post pictures of your bills so Blessings members can help.", systemImage: "doc.text.viewfinder")
                    .font(.subheadline)
            }

            AccountFields(
                displayName: $form.displayName,
                email: $form.email,
                password: $form.password,
                confirmPassword: $confirmPassword
            )

            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }

            Section {
                Button {
                    Task { await submit() }
                } label: {
                    HStack {
                        Spacer()
                        if isSubmitting { ProgressView() } else { Text("Create Billable account").bold() }
                        Spacer()
                    }
                }
                .disabled(isSubmitting)
            }
        }
        .navigationTitle("Billable sign up")
    }

    private func submit() async {
        if let problem = AccountFields.validate(displayName: form.displayName, email: form.email, password: form.password, confirmPassword: confirmPassword) {
            errorMessage = problem
            return
        }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await session.signUpBillable(form)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
