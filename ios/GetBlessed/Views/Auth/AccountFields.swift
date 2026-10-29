import SwiftUI

/// Name / email / password fields shared by both sign-up pages.
struct AccountFields: View {
    @Binding var displayName: String
    @Binding var email: String
    @Binding var password: String
    @Binding var confirmPassword: String

    var body: some View {
        Section("Your account") {
            TextField("Name", text: $displayName)
                .textContentType(.name)
            TextField("Email", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("Password (8+ characters)", text: $password)
                .textContentType(.newPassword)
            SecureField("Confirm password", text: $confirmPassword)
                .textContentType(.newPassword)
        }
    }

    /// Returns a message describing the first problem, or nil when valid.
    static func validate(displayName: String, email: String, password: String, confirmPassword: String) -> String? {
        if displayName.trimmingCharacters(in: .whitespaces).isEmpty { return "Please enter your name." }
        if !email.contains("@") || !email.contains(".") { return "Please enter a valid email address." }
        if password.count < 8 { return "Your password needs at least 8 characters." }
        if password != confirmPassword { return "Passwords don't match." }
        return nil
    }
}
