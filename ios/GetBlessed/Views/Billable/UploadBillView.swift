import BillParser
import PhotosUI
import SwiftUI

/// Lets a Billable member import a picture of a bill. The picture is read on
/// device, its items, prices and complete total are filled in automatically,
/// and the member can correct anything before posting.
struct UploadBillView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    let onUploaded: (Bill) -> Void

    @State private var photoItem: PhotosPickerItem?
    @State private var image: UIImage?
    @State private var showsCamera = false
    @State private var isScanning = false
    @State private var isUploading = false
    @State private var errorMessage: String?

    @State private var title = ""
    @State private var merchant = ""
    @State private var note = ""
    @State private var items: [DraftItem] = []
    @State private var tax: Decimal = 0
    @State private var total: Decimal = 0
    @State private var rawText: String?

    private var subtotal: Decimal { items.reduce(0) { $0 + $1.lineTotal } }
    private var addsUp: Bool { abs(NSDecimalNumber(decimal: subtotal + tax - total).doubleValue) < 0.015 }

    var body: some View {
        NavigationStack {
            Form {
                photoSection

                if isScanning {
                    Section {
                        HStack {
                            ProgressView()
                            Text("Reading the items on your bill…").padding(.leading, 8)
                        }
                    }
                } else if image != nil {
                    detailsSection
                    itemsSection
                    totalSection
                }

                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Post a bill")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isUploading {
                        ProgressView()
                    } else {
                        Button("Post") { Task { await upload() } }
                            .disabled(image == nil || isScanning || title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .fullScreenCover(isPresented: $showsCamera) {
                CameraPicker { picked in Task { await use(picked) } }
                    .ignoresSafeArea()
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let picked = UIImage(data: data) {
                        await use(picked)
                    } else {
                        errorMessage = "That picture couldn't be opened."
                    }
                }
            }
        }
        .interactiveDismissDisabled(isUploading)
    }

    // MARK: Sections

    private var photoSection: some View {
        Section {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 220)
                    .frame(maxWidth: .infinity)
            }
            PhotosPicker(selection: $photoItem, matching: .images) {
                Label(image == nil ? "Choose a picture of your bill" : "Choose a different picture", systemImage: "photo.on.rectangle")
            }
            if CameraPicker.isAvailable {
                Button {
                    showsCamera = true
                } label: {
                    Label("Take a picture", systemImage: "camera")
                }
            }
        } header: {
            Text("Bill picture")
        } footer: {
            if image == nil {
                Text("Lay the bill flat in good light and fit the whole bill in the picture.")
            }
        }
    }

    private var detailsSection: some View {
        Section("Details") {
            TextField("Title (e.g. Electric bill)", text: $title)
            TextField("Store or company", text: $merchant)
            TextField("Anything Blessings members should know? (optional)", text: $note, axis: .vertical)
                .lineLimit(2...5)
        }
    }

    private var itemsSection: some View {
        Section {
            ForEach($items) { $item in
                DraftItemRow(item: $item)
            }
            .onDelete { items.remove(atOffsets: $0) }

            Button {
                items.append(DraftItem(name: "", quantity: 1, lineTotal: 0))
            } label: {
                Label("Add item", systemImage: "plus")
            }
        } header: {
            Text(items.count == 1 ? "1 item" : "\(items.count) items")
        } footer: {
            Text("Check each name, quantity and price. Swipe left to remove a line.")
        }
    }

    private var totalSection: some View {
        Section {
            LabeledContent("Items subtotal", value: subtotal.currency())
            LabeledContent("Tax") {
                TextField("Tax", value: $tax, format: .currency(code: "USD"))
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
            }
            LabeledContent {
                TextField("Total", value: $total, format: .currency(code: "USD"))
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .bold()
            } label: {
                Text("Complete total").bold()
            }
        } footer: {
            if !addsUp {
                Label(
                    "Items plus tax come to \((subtotal + tax).currency()), but the total is \(total.currency()). Fees or discounts can cause this — please double check.",
                    systemImage: "exclamationmark.triangle"
                )
                .foregroundStyle(.orange)
            }
        }
    }

    // MARK: Actions

    private func use(_ picked: UIImage) async {
        image = picked
        errorMessage = nil
        isScanning = true
        defer { isScanning = false }
        do {
            let result = try await BillScanner.scan(picked)
            let bill = result.bill
            rawText = result.rawText
            items = bill.items.map { DraftItem(name: $0.name, quantity: $0.quantity, lineTotal: $0.lineTotal) }
            tax = bill.tax
            total = bill.total
            if merchant.isEmpty { merchant = bill.merchant ?? "" }
            if title.isEmpty { title = bill.merchant.map { "\($0) bill" } ?? "My bill" }
            if bill.items.isEmpty {
                errorMessage = "We couldn't find individual items on this bill. Add them below or just enter the total."
            }
        } catch {
            items = []
            errorMessage = error.localizedDescription
        }
    }

    private func upload() async {
        guard let image else { return }
        let cleaned = items.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty || $0.lineTotal != 0 }
        if let bad = cleaned.first(where: { $0.name.trimmingCharacters(in: .whitespaces).isEmpty || $0.quantity <= 0 || $0.lineTotal < 0 }) {
            errorMessage = bad.name.isEmpty ? "Every item needs a name." : "Check the quantity and price for \(bad.name)."
            return
        }
        guard total > 0 || !cleaned.isEmpty else {
            errorMessage = "Please enter the bill's total."
            return
        }

        let upload = BillUpload(
            title: title.trimmingCharacters(in: .whitespaces),
            merchant: merchant.isEmpty ? nil : merchant,
            description: note.isEmpty ? nil : note,
            items: cleaned.map {
                .init(name: $0.name.trimmingCharacters(in: .whitespaces), quantity: $0.quantity.roundedTo(3).apiString, lineTotal: $0.lineTotal.roundedTo().apiString)
            },
            tax: tax.roundedTo().apiString,
            total: total.roundedTo().apiString,
            ocrRawText: rawText
        )

        isUploading = true
        defer { isUploading = false }
        do {
            let bill = try await session.api.uploadBill(upload, image: image)
            onUploaded(bill)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct DraftItem: Identifiable {
    let id = UUID()
    var name: String
    var quantity: Decimal
    var lineTotal: Decimal
}

private struct DraftItemRow: View {
    @Binding var item: DraftItem

    var body: some View {
        HStack {
            TextField("Item", text: $item.name)
            TextField("Qty", value: $item.quantity, format: .number)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.center)
                .frame(width: 44)
                .padding(4)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
            TextField("Price", value: $item.lineTotal, format: .currency(code: "USD"))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 96)
        }
    }
}
