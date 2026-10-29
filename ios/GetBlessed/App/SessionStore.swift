import Foundation
import Observation

/// Holds the signed-in member and their API token.
@MainActor
@Observable
final class SessionStore {
    enum State: Equatable {
        case loading
        case signedOut
        case signedIn(User)
    }

    private(set) var state: State = .loading
    let api: APIClient

    private static let tokenKey = "auth.token"

    init(api: APIClient = APIClient()) {
        self.api = api
    }

    var currentUser: User? {
        if case .signedIn(let user) = state { return user }
        return nil
    }

    func restore() async {
        guard let token = Keychain.read(Self.tokenKey) else {
            state = .signedOut
            return
        }
        api.token = token
        do {
            state = .signedIn(try await api.me())
        } catch APIError.unauthorized {
            signOut()
        } catch {
            // Server unreachable: the token stays in the Keychain for the next launch.
            state = .signedOut
        }
    }

    func signUpBillable(_ form: BillableSignUp) async throws {
        apply(try await api.signUpBillable(form))
    }

    func signUpBlessings(_ form: BlessingsSignUp) async throws {
        apply(try await api.signUpBlessings(form))
    }

    func logIn(email: String, password: String) async throws {
        apply(try await api.logIn(email: email, password: password))
    }

    /// Reloads the member (e.g. after a plan was purchased).
    func refreshUser() async {
        guard currentUser != nil, let user = try? await api.me() else { return }
        state = .signedIn(user)
    }

    func signOut() {
        Keychain.delete(Self.tokenKey)
        api.token = nil
        state = .signedOut
    }

    private func apply(_ response: AuthResponse) {
        Keychain.save(response.token, for: Self.tokenKey)
        api.token = response.token
        state = .signedIn(response.user)
    }
}
