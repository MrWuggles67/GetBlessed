import SwiftUI

struct LoginView: View {
    @Environment(SessionStore.self) private var session
    @State private var email = ""
    @State private var password = ""
    @State private var errorMessage: String?
    @State private var isSubmitting = false

    var body: some View {
        Form {
            Section {
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Password", text: $password)
                    .textContentType(.password)
            }
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }
            Section {
                Button {
                    Task {
                        isSubmitting = true
                        defer { isSubmitting = false }
                        do {
                            try await session.logIn(email: email, password: password)
                        } catch {
                            errorMessage = error.localizedDescription
                        }
                    }
                } label: {
                    HStack {
                        Spacer()
                        if isSubmitting { ProgressView() } else { Text("Log in").bold() }
                        Spacer()
                    }
                }
                .disabled(isSubmitting || email.isEmpty || password.isEmpty)
            }
        }
        .navigationTitle("Log in")
    }
}
