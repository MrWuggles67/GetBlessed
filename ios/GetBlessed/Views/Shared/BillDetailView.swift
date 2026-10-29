import SwiftUI

/// A bill's photo, every recognised item with its price, and the complete total.
struct BillDetailView: View {
    @Environment(SessionStore.self) private var session
    let billID: String
    @State private var bill: Bill?
    @State private var errorMessage: String?
    @State private var showsFullPhoto = false

    var body: some View {
        Group {
            if let bill {
                List {
                    Section {
                        AuthenticatedImage(path: bill.imageUrl)
                            .frame(maxHeight: 260)
                            .onTapGesture { showsFullPhoto = true }
                    }

                    Section {
                        LabeledContent("Posted by", value: bill.postedBy.displayName)
                        if let merchant = bill.merchant { LabeledContent("From", value: merchant) }
                        LabeledContent("Posted", value: bill.createdAt.formatted(date: .abbreviated, time: .shortened))
                        LabeledContent("Status") { StatusBadge(status: bill.status) }
                        if let description = bill.description { Text(description) }
                    }

                    Section("Items") {
                        if let items = bill.items, !items.isEmpty {
                            ForEach(items) { item in
                                HStack(alignment: .firstTextBaseline) {
                                    VStack(alignment: .leading) {
                                        Text(item.name)
                                        if item.quantity != 1 {
                                            Text("\(item.quantity.formatted()) × \(item.unitPrice.decimal.currency(bill.currency))")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer()
                                    Text(item.lineTotal.decimal.currency(bill.currency)).monospacedDigit()
                                }
                            }
                        } else {
                            Text("No individual items were listed on this bill.").foregroundStyle(.secondary)
                        }
                    }

                    Section {
                        LabeledContent("Items subtotal", value: bill.subtotal.decimal.currency(bill.currency))
                        LabeledContent("Tax", value: bill.tax.decimal.currency(bill.currency))
                        LabeledContent {
                            Text(bill.total.decimal.currency(bill.currency)).bold()
                        } label: {
                            Text("Complete total").bold()
                        }
                    }
                }
                .sheet(isPresented: $showsFullPhoto) {
                    NavigationStack {
                        ScrollView { AuthenticatedImage(path: bill.imageUrl) }
                            .toolbar { Button("Done") { showsFullPhoto = false } }
                    }
                }
            } else if let errorMessage {
                ContentUnavailableView("Couldn't load bill", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
            } else {
                ProgressView()
            }
        }
        .navigationTitle(bill?.title ?? "Bill")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do {
                bill = try await session.api.bill(id: billID)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
