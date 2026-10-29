import SwiftUI

struct BillRow: View {
    let bill: Bill
    var showsPoster = false

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(bill.title).font(.headline)
                if showsPoster {
                    Text("Posted by \(bill.postedBy.displayName)").font(.subheadline).foregroundStyle(.secondary)
                } else if let merchant = bill.merchant {
                    Text(merchant).font(.subheadline).foregroundStyle(.secondary)
                }
                Text("\(bill.itemCount) item\(bill.itemCount == 1 ? "" : "s") · \(bill.createdAt.formatted(date: .abbreviated, time: .omitted))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(bill.total.decimal.currency(bill.currency)).font(.headline.monospacedDigit())
                StatusBadge(status: bill.status)
            }
        }
        .padding(.vertical, 4)
    }
}

struct StatusBadge: View {
    let status: Bill.Status

    var body: some View {
        Text(status.rawValue.capitalized)
            .font(.caption2.bold())
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }

    private var color: Color {
        switch status {
        case .open: .orange
        case .blessed: .green
        case .closed, .removed: .gray
        }
    }
}
