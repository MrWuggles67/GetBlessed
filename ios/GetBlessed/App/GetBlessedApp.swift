import SwiftUI

@main
struct GetBlessedApp: App {
    @State private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .task { await session.restore() }
        }
    }
}

struct RootView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        switch session.state {
        case .loading:
            ProgressView()
        case .signedOut:
            WelcomeView()
        case .signedIn(let user):
            switch user.role {
            case .billable: MyBillsView()
            case .blessings: BlessingsFeedView()
            }
        }
    }
}
