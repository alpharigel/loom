import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {
    enum Phase {
        case onboarding
        case discovering
        case picker
        case connected(LoomServer)
    }

    @Published var phase: Phase = .onboarding
    @Published var servers: [LoomServer] = []
    @Published var manualServers: [LoomServer] = []
    @Published var discoveryError: String?
    @Published var activeProfile: String = "default"
    @Published var profiles: [Profile] = []

    var apiKey: String? {
        get { Keychain.get("tailscale_api_key") }
    }

    init() {
        if Keychain.get("tailscale_api_key") != nil {
            phase = .discovering
        }
        if let saved = UserDefaults.standard.string(forKey: "active_profile") {
            activeProfile = saved
        }
        loadManualServers()
    }

    func saveAPIKey(_ key: String) {
        Keychain.set(key, for: "tailscale_api_key")
        phase = .discovering
    }

    func clearAPIKey() {
        Keychain.delete("tailscale_api_key")
        phase = .onboarding
        servers = []
    }

    func setActiveProfile(_ name: String) {
        activeProfile = name
        UserDefaults.standard.set(name, forKey: "active_profile")
    }

    // MARK: Discovery

    func discover() async {
        discoveryError = nil
        guard let key = apiKey else {
            phase = .onboarding
            return
        }
        let client = TailscaleClient(apiKey: key)
        do {
            let found = try await client.discoverLoomServers()
            self.servers = found + manualServers
            self.phase = .picker
        } catch {
            self.discoveryError = (error as? LocalizedError)?.errorDescription ?? "\(error)"
            self.servers = manualServers
            self.phase = .picker
        }
    }

    // MARK: Manual entries

    func addManualServer(host: String, port: Int) async {
        let url = URL(string: "http://\(host):\(port)")!
        let client = LoomClient(baseURL: url)
        do {
            let identity = try await client.identity()
            let server = LoomServer(
                id: "manual:\(host):\(port)",
                name: identity.hostname,
                host: host,
                port: port,
                os: identity.os,
                isOnline: true,
                identity: identity
            )
            manualServers.append(server)
            servers.append(server)
            saveManualServers()
        } catch {
            discoveryError = "Couldn't reach \(host):\(port) — \((error as? LocalizedError)?.errorDescription ?? "\(error)")"
        }
    }

    private func saveManualServers() {
        let entries = manualServers.map { ["host": $0.host, "port": $0.port, "name": $0.name] as [String: Any] }
        if let data = try? JSONSerialization.data(withJSONObject: entries) {
            UserDefaults.standard.set(data, forKey: "manual_servers")
        }
    }

    private func loadManualServers() {
        guard let data = UserDefaults.standard.data(forKey: "manual_servers"),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
        manualServers = arr.compactMap { dict in
            guard let host = dict["host"] as? String,
                  let port = dict["port"] as? Int else { return nil }
            let name = (dict["name"] as? String) ?? host
            return LoomServer(id: "manual:\(host):\(port)", name: name, host: host, port: port, os: nil, isOnline: true, identity: nil)
        }
    }

    func connect(to server: LoomServer) {
        phase = .connected(server)
    }

    func disconnect() {
        phase = .picker
    }
}
