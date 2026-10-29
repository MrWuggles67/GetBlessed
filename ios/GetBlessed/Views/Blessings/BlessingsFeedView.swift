import SwiftUI

/// Home screen for Blessings members: every bill Billable members have posted.
struct BlessingsFeedView: View {
    @Environment(SessionStore.self) private var session
    @State private var filter: Bill.Status? = nil
    @State private var model: BillListModel?

    var body: some View {
        NavigationStack {
            Group {
                if let model {
                    list(model)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Bills to bless")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { AccountMenu() }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        MyBlessingsView()
                    } label: {
                        Label("My blessings", systemImage: "gift")
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Picker("Show", selection: $filter) {
                            Text("All bills").tag(Bill.Status?.none)
                            Text("Open").tag(Bill.Status?.some(.open))
                            Text("Blessed").tag(Bill.Status?.some(.blessed))
                            Text("Closed").tag(Bill.Status?.some(.closed))
                        }
                    } label: {
                        Label("Filter", systemImage: "line.3.horizontal.decrease.circle")
                    }
                }
            }
            .navigationDestination(for: Bill.self) { bill in
                BillDetailView(billID: bill.id)
            }
        }
        .task(id: filter) {
            let api = session.api
            let status = filter
            let newModel = BillListModel { cursor in try await api.feed(status: status, cursor: cursor) }
            model = newModel
            await newModel.refresh()
        }
    }

    @ViewBuilder
    private func list(_ model: BillListModel) -> some View {
        List {
            if let error = model.errorMessage {
                Text(error).foregroundStyle(.red)
            }
            ForEach(model.bills) { bill in
                NavigationLink(value: bill) { BillRow(bill: bill, showsPoster: true) }
                    .task { await model.loadMoreIfNeeded(after: bill) }
            }
            if model.isLoading && !model.bills.isEmpty {
                HStack { Spacer(); ProgressView(); Spacer() }
            }
        }
        .overlay {
            if model.bills.isEmpty && !model.isLoading {
                ContentUnavailableView("No bills yet", systemImage: "tray", description: Text("Bills posted by Billable members will show up here."))
            }
        }
        .refreshable { await model.refresh() }
    }
}
