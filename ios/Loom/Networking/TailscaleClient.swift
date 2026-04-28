import Foundation

/// Tailscale control plane client.
///
/// iOS apps cannot talk to the local Tailscale daemon, so we use the public
/// admin API. The user provides an API key (stored in Keychain). With key in
/// hand we list devices on the user's tailnet and probe each one for a Loom
/// instance on port 3000.
struct TailscaleClient {
    let apiKey: String
    let tailnet: String          // "-" means "the tailnet of the API key owner"

    init(apiKey: String, tailnet: String = "-") {
        self.apiKey = apiKey
        self.tailnet = tailnet
    }

    func listDevices() async throws -> [TailscaleDevice] {
        let url = URL(string: "https://api.tailscale.com/api/v2/tailnet/\(tailnet)/devices")!
        var req = URLRequest(url: url)
        let token = "\(apiKey):".data(using: .utf8)!.base64EncodedString()
        req.setValue("Basic \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            throw LoomError.http(code, String(data: data, encoding: .utf8) ?? "")
        }
        return try JSONDecoder().decode(TailscaleDevicesResponse.self, from: data).devices
    }

    /// Concurrently probe each device's port 3000 for a Loom server.
    func discoverLoomServers(port: Int = 3000, timeout: TimeInterval = 2.5) async throws -> [LoomServer] {
        let devices = try await listDevices()
        return await withTaskGroup(of: LoomServer?.self) { group in
            for device in devices {
                group.addTask {
                    await Self.probe(device: device, port: port, timeout: timeout)
                }
            }
            var found: [LoomServer] = []
            for await result in group {
                if let result { found.append(result) }
            }
            return found.sorted { $0.name < $1.name }
        }
    }

    static func probe(device: TailscaleDevice, port: Int, timeout: TimeInterval) async -> LoomServer? {
        guard let ip = device.primaryIP,
              let url = URL(string: "http://\(ip):\(port)/api/identity") else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = timeout
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            let identity = try JSONDecoder().decode(ServerIdentity.self, from: data)
            return LoomServer(
                id: device.id,
                name: prettyName(device: device, identity: identity),
                host: ip,
                port: port,
                os: device.os ?? identity.os,
                isOnline: device.online ?? true,
                identity: identity
            )
        } catch {
            return nil
        }
    }

    private static func prettyName(device: TailscaleDevice, identity: ServerIdentity) -> String {
        // Prefer the OS hostname Loom reports; fall back to Tailscale's machine name.
        let stripped = device.name.split(separator: ".").first.map(String.init) ?? device.name
        return identity.hostname.isEmpty ? stripped : identity.hostname
    }
}
