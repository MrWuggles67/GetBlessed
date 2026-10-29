import SwiftUI

/// First screen: choose which kind of member to become, or log in.
struct WelcomeView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()
                Image(systemName: "heart.circle.fill")
                    .font(.system(size: 72))
                    .foregroundStyle(.pink)
                Text("GetBlessed")
                    .font(.largeTitle.bold())
                Text("Post your bills, or bless someone by helping pay theirs.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                Spacer()

                NavigationLink {
                    BillableSignUpView()
                } label: {
                    RoleCard(
                        title: "I need a blessing",
                        subtitle: "Sign up as Billable and post pictures of your bills.",
                        systemImage: "doc.text.viewfinder"
                    )
                }

                NavigationLink {
                    BlessingsSignUpView()
                } label: {
                    RoleCard(
                        title: "I want to bless others",
                        subtitle: "Sign up as Blessings and see bills members have posted.",
                        systemImage: "gift.fill"
                    )
                }

                NavigationLink("I already have an account") {
                    LoginView()
                }
                .padding(.top, 8)
            }
            .padding()
        }
    }
}

private struct RoleCard: View {
    let title: String
    let subtitle: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: systemImage)
                .font(.title)
                .frame(width: 44)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
        }
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .foregroundStyle(.primary)
    }
}
