import SwiftUI

@main
struct GetBlessedApp: App {
    @State private var session: SessionStore
    @State private var subscriptions: SubscriptionStore

    init() {
        let session = SessionStore()
        _session = State(initialValue: session)
        _subscriptions = State(initialValue: SubscriptionStore(session: session))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(subscriptions)
                .task {
                    await session.restore()
                    await subscriptions.start()
                }
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
            case .blessings:
                if user.needsPlan { PaywallView() } else { BlessingsFeedView() }
            }
        }
    }
}
