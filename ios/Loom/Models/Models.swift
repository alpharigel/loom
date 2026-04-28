import Foundation

// MARK: - Server identity

struct ServerIdentity: Codable, Hashable, Identifiable {
    let hostname: String
    let port: Int
    let os: String
    let user: String
    let version: String
    var id: String { "\(hostname):\(port)" }
}

// MARK: - Discovered Loom server (the unit shown in the picker)

struct LoomServer: Identifiable, Hashable {
    let id: String          // tailscale device ID, or hostname for manual entries
    let name: String        // friendly display name
    let host: String        // tailnet IP or hostname (for URL building)
    let port: Int
    let os: String?
    let isOnline: Bool
    let identity: ServerIdentity?

    var baseURL: URL { URL(string: "http://\(host):\(port)")! }
}

// MARK: - Projects / sections

enum ProjectSection: String, Codable, CaseIterable, Identifiable {
    case projects, scratch, agents, skills, archived
    var id: String { rawValue }
    var title: String {
        switch self {
        case .projects: return "Projects"
        case .scratch:  return "Scratch"
        case .agents:   return "Agents"
        case .skills:   return "Skills"
        case .archived: return "Archived"
        }
    }
}

struct Worktree: Codable, Hashable, Identifiable {
    let branch: String
    let path: String
    var id: String { path }
}

struct ProjectItem: Codable, Hashable, Identifiable {
    let name: String
    let path: String
    var section: ProjectSection?
    var worktrees: [Worktree]?
    var hasIcon: Bool?
    var id: String { path }
}

struct ProjectsResponse: Codable {
    let home: HomeInfo?
    let projects: [ProjectItem]?
    let scratch: [ProjectItem]?
    let agents: [ProjectItem]?
    let skills: [ProjectItem]?
    let archived: [ProjectItem]?

    struct HomeInfo: Codable, Hashable {
        let name: String
        let path: String
    }
}

// MARK: - Files

struct FileEntry: Codable, Hashable, Identifiable {
    let name: String
    let path: String
    let isDirectory: Bool
    let isHidden: Bool?
    let size: Int?
    var id: String { path }
}

struct FileListing: Codable {
    let path: String
    let files: [FileEntry]
}

struct FileContent: Codable {
    let path: String
    let name: String
    let content: String
    let ext: String?
}

// MARK: - Profiles

struct Profile: Codable, Hashable, Identifiable {
    let name: String
    let avatar: String?
    var id: String { name }
}

// MARK: - Tailscale

struct TailscaleDevice: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let hostname: String
    let addresses: [String]
    let os: String?
    let online: Bool?

    enum CodingKeys: String, CodingKey {
        case id, name, hostname, addresses, os
        case online = "lastSeen" // placeholder; real key is computed below
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: DynamicKey.self)
        self.id        = (try? c.decode(String.self, forKey: .init("id"))) ?? UUID().uuidString
        self.name      = (try? c.decode(String.self, forKey: .init("name"))) ?? ""
        self.hostname  = (try? c.decode(String.self, forKey: .init("hostname"))) ?? self.name
        self.addresses = (try? c.decode([String].self, forKey: .init("addresses"))) ?? []
        self.os        = try? c.decode(String.self, forKey: .init("os"))
        // Tailscale API returns "lastSeen" as ISO string; treat presence within 5 min as online.
        if let lastSeen = try? c.decode(String.self, forKey: .init("lastSeen")) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let date = formatter.date(from: lastSeen) ?? ISO8601DateFormatter().date(from: lastSeen)
            if let date {
                self.online = Date().timeIntervalSince(date) < 300
            } else {
                self.online = nil
            }
        } else {
            self.online = nil
        }
    }

    var primaryIP: String? { addresses.first(where: { $0.hasPrefix("100.") }) ?? addresses.first }
}

struct TailscaleDevicesResponse: Codable {
    let devices: [TailscaleDevice]
}

private struct DynamicKey: CodingKey {
    var stringValue: String
    var intValue: Int?
    init(_ s: String) { self.stringValue = s }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { self.intValue = intValue; self.stringValue = String(intValue) }
}
