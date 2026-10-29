import SwiftUI

/// Loads a bill photo through the API (which requires the member's token).
struct AuthenticatedImage: View {
    @Environment(SessionStore.self) private var session
    let path: String
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
            } else if failed {
                Label("Photo unavailable", systemImage: "photo").foregroundStyle(.secondary)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .task(id: path) {
            do {
                image = UIImage(data: try await session.api.imageData(path: path))
                failed = image == nil
            } catch {
                failed = true
            }
        }
    }
}
