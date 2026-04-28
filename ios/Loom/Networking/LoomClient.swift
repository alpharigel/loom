import Foundation

/// REST client for a single Loom server.
actor LoomClient {
    let baseURL: URL
    var profile: String?

    private let session: URLSession

    init(baseURL: URL, profile: String? = nil) {
        self.baseURL = baseURL
        self.profile = profile
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 10
        cfg.timeoutIntervalForResource = 30
        cfg.waitsForConnectivity = false
        self.session = URLSession(configuration: cfg)
    }

    // MARK: Identity

    func identity() async throws -> ServerIdentity {
        try await get("/api/identity")
    }

    // MARK: Projects

    func projects() async throws -> ProjectsResponse {
        try await get("/api/projects")
    }

    func createWorktree(project: String, section: ProjectSection, branch: String) async throws -> Worktree {
        struct Req: Codable { let branch: String; let section: String }
        return try await post("/api/projects/\(project)/worktrees",
                              body: Req(branch: branch, section: section.rawValue))
    }

    func deleteWorktree(project: String, section: ProjectSection, branch: String) async throws {
        try await delete("/api/projects/\(project)/worktrees/\(branch)?section=\(section.rawValue)")
    }

    // MARK: Files

    func listFiles(path: String) async throws -> FileListing {
        try await get("/api/files?path=\(path.urlEncoded)")
    }

    func readFile(path: String) async throws -> FileContent {
        try await get("/api/file?path=\(path.urlEncoded)")
    }

    func writeFile(path: String, content: String) async throws {
        struct Req: Codable { let path: String; let content: String }
        let _: EmptyResponse = try await put("/api/file", body: Req(path: path, content: content))
    }

    // MARK: Profiles

    func profiles() async throws -> [Profile] {
        try await get("/api/profiles")
    }

    // MARK: HTTP plumbing

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await request(method: "GET", path: path, body: Optional<EmptyBody>.none)
    }

    private func post<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await request(method: "POST", path: path, body: body)
    }

    private func put<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await request(method: "PUT", path: path, body: body)
    }

    private func delete(_ path: String) async throws {
        let _: EmptyResponse = try await request(method: "DELETE", path: path, body: Optional<EmptyBody>.none)
    }

    private func request<B: Encodable, T: Decodable>(method: String,
                                                     path: String,
                                                     body: B?) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw LoomError.badURL(path)
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let profile { req.setValue(profile, forHTTPHeaderField: "X-Loom-Profile") }
        if let body, !(body is EmptyBody) {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        let (data, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            let msg = String(data: data, encoding: .utf8) ?? ""
            throw LoomError.http(code, msg)
        }
        if T.self == EmptyResponse.self { return EmptyResponse() as! T }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

struct EmptyBody: Codable {}
struct EmptyResponse: Codable {}

enum LoomError: LocalizedError {
    case badURL(String)
    case http(Int, String)
    case decoding(String)
    var errorDescription: String? {
        switch self {
        case .badURL(let s): return "Invalid URL: \(s)"
        case .http(let c, let m): return "HTTP \(c): \(m)"
        case .decoding(let m): return "Decode error: \(m)"
        }
    }
}

extension String {
    var urlEncoded: String {
        addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? self
    }
}
