import SwiftUI

/// Home screen for Billable members: their posted bills and a button to post a new one.
struct MyBillsView: View {
    @Environment(SessionStore.self) private var session
    @State private var model: BillListModel?
    @State private var showsUpload = false

    var body: some View {
        NavigationStack {
            Group {
                if let model {
                    list(model)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("My bills")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    AccountMenu()
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showsUpload = true
                    } label: {
                        Label("Post a bill", systemImage: "plus.circle.fill")
                    }
                }
            }
            .sheet(isPresented: $showsUpload) {
                UploadBillView { bill in model?.insert(bill) }
            }
            .navigationDestination(for: Bill.self) { bill in
                BillDetailView(billID: bill.id)
            }
        }
        .task {
            if model == nil {
                let api = session.api
                model = BillListModel { cursor in try await api.myBills(cursor: cursor) }
                await model?.refresh()
            }
        }
    }

    @ViewBuilder
    private func list(_ model: BillListModel) -> some View {
        List {
            if let error = model.errorMessage {
                Text(error).foregroundStyle(.red)
            }
            ForEach(model.bills) { bill in
                NavigationLink(value: bill) { BillRow(bill: bill) }
                    .task { await model.loadMoreIfNeeded(after: bill) }
            }
        }
        .overlay {
            if model.bills.isEmpty && !model.isLoading {
                ContentUnavailableView {
                    Label("No bills yet", systemImage: "doc.text.viewfinder")
                } description: {
                    Text("Take or choose a picture of a bill. We'll read the items and total for you.")
                } actions: {
                    Button("Post a bill") { showsUpload = true }.buttonStyle(.borderedProminent)
                }
            }
        }
        .refreshable { await model.refresh() }
    }
}

struct AccountMenu: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        Menu {
            if let user = session.currentUser {
                Text(user.displayName)
                Text(user.role == .billable ? "Billable member" : "Blessings member")
            }
            Button("Log out", role: .destructive) { session.signOut() }
        } label: {
            Image(systemName: "person.crop.circle")
        }
    }
}
