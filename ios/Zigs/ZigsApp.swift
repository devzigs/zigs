import SwiftUI

extension Color {
    static let night = Color(red: 0.05, green: 0.047, blue: 0.078)
    static let room = Color(red: 0.086, green: 0.082, blue: 0.122)
    static let signal = Color(red: 0.957, green: 0.718, blue: 0.157)
    static let mist = Color(red: 0.62, green: 0.6, blue: 0.68)
}

@main
struct ZigsApp: App {
    @State private var model = GroupModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(.signal)
                .preferredColorScheme(.dark)
                .onOpenURL { model.join($0.absoluteString) }
        }
    }
}

struct RootView: View {
    @Environment(GroupModel.self) private var model
    @State private var showJoin = false
    @State private var showSettings = false

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.path) {
            List {
                Section {
                    if model.groups.isEmpty {
                        Text("No groups yet. Ask a member for an invite link, then tap Join.")
                            .foregroundStyle(Color.mist)
                    }
                    ForEach(model.groups, id: \.id) { g in
                        NavigationLink(value: g.id) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(g.name).font(.headline)
                                Text("\(g.t) of \(g.n)").font(.caption.monospaced()).foregroundStyle(Color.mist)
                            }
                        }
                    }
                } header: {
                    Text("Your groups")
                } footer: {
                    ConnectionLine(connected: model.connected)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.night)
            .navigationTitle("Zigs")
            .navigationDestination(for: String.self) { id in
                GroupView().onAppear { model.select(id) }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Settings", systemImage: "gearshape") { showSettings = true }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Join") { showJoin = true }
                }
            }
            .sheet(isPresented: $showJoin) { JoinSheet() }
            .sheet(isPresented: $showSettings) { SettingsSheet() }
            .alert("Something went wrong", isPresented: Binding(get: { model.banner != nil },
                                                                set: { if !$0 { model.banner = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.banner ?? "")
            }
        }
    }
}

struct ConnectionLine: View {
    let connected: Bool
    var body: some View {
        Label(connected ? "Connected to the group server" : "Connecting to the group server…",
              systemImage: connected ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath")
            .font(.caption)
            .foregroundStyle(connected ? Color.mist : Color.signal)
    }
}

struct JoinSheet: View {
    @Environment(GroupModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://…/#group.key", text: $link, axis: .vertical)
                        .font(.body.monospaced())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Paste from clipboard") { link = UIPasteboard.general.string ?? "" }
                } header: {
                    Text("Invite link")
                } footer: {
                    Text("The key after # stays on this iPhone. The server never sees it.")
                }
            }
            .navigationTitle("Join a group")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Join") { model.join(link); dismiss() }.disabled(link.isEmpty)
                }
            }
        }
    }
}

struct SettingsSheet: View {
    @Environment(GroupModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Form {
                Section("Your name") {
                    TextField("Name", text: $model.name)
                }
                Section {
                    TextField("Server", text: $model.server)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    SecureField("Password (if the server has one)", text: $model.password)
                } header: {
                    Text("Group server")
                } footer: {
                    Text("The server relays sealed messages only. It cannot read your groups.")
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { model.reconnect(); dismiss() }
                }
            }
        }
    }
}
