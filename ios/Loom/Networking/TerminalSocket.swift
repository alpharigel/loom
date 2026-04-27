import Foundation

/// WebSocket client that speaks Loom's terminal protocol.
///
/// Holds one or more terminal sessions on a single connection. The server
/// kills any pre-existing terminals on a fresh WebSocket connection, so
/// each instance of this class owns its own short-lived connection.
final class TerminalSocket: NSObject, ObservableObject {
    enum State { case idle, connecting, connected, closed(Error?) }

    @Published private(set) var state: State = .idle

    /// Per-terminal output stream. The view layer subscribes by id.
    private var outputHandlers: [String: (Data) -> Void] = [:]
    private var exitHandlers:   [String: (Int) -> Void]  = [:]
    private var errorHandlers:  [String: (String) -> Void] = [:]

    /// Filesystem change subscribers (path, kind).
    var onFsChange: ((String, String) -> Void)?
    /// Agent status broadcasts (path, status).
    var onAgentStatus: ((String, String) -> Void)?

    private var task: URLSessionWebSocketTask?
    private let baseURL: URL
    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 10
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    // MARK: Connection

    func connect() {
        guard case .idle = state else { return }
        state = .connecting
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.scheme = (components.scheme == "https") ? "wss" : "ws"
        components.path = "/"
        let url = components.url!
        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()
        state = .connected
        readLoop()
    }

    func close() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        state = .closed(nil)
    }

    private func readLoop() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                self.state = .closed(error)
            case .success(let message):
                self.handle(message)
                self.readLoop()
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case .data(let d): data = d
        case .string(let s): data = Data(s.utf8)
        @unknown default: return
        }
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return }

        switch type {
        case "terminal:data":
            if let id = obj["id"] as? String,
               let payload = obj["data"] as? String,
               let bytes = payload.data(using: .utf8) {
                outputHandlers[id]?(bytes)
            }
        case "terminal:exit":
            if let id = obj["id"] as? String {
                let code = (obj["exitCode"] as? Int) ?? 0
                exitHandlers[id]?(code)
            }
        case "terminal:error":
            if let id = obj["id"] as? String {
                let msg = (obj["error"] as? String) ?? "unknown"
                errorHandlers[id]?(msg)
            }
        case "fs:changed":
            if let path = obj["path"] as? String {
                onFsChange?(path, (obj["detail"] as? String) ?? "change")
            }
        case "agent:status":
            if let path = obj["path"] as? String,
               let status = obj["status"] as? String {
                onAgentStatus?(path, status)
            }
        default: break
        }
    }

    // MARK: Send helpers

    private func send(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        guard let str = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(str)) { _ in }
    }

    func createTerminal(id: String,
                        cwd: String,
                        cmd: String? = nil,
                        cols: Int = 80,
                        rows: Int = 24,
                        sticky: Bool = false,
                        docker: Bool = false,
                        projectName: String? = nil,
                        onData: @escaping (Data) -> Void,
                        onExit: ((Int) -> Void)? = nil,
                        onError: ((String) -> Void)? = nil) {
        outputHandlers[id] = onData
        if let onExit  { exitHandlers[id]  = onExit }
        if let onError { errorHandlers[id] = onError }
        var msg: [String: Any] = [
            "type": "terminal:create",
            "id": id,
            "cwd": cwd,
            "cols": cols,
            "rows": rows,
            "sticky": sticky,
            "docker": docker
        ]
        if let cmd { msg["cmd"] = cmd }
        if let projectName { msg["projectName"] = projectName }
        send(msg)
    }

    func sendInput(id: String, _ text: String) {
        send(["type": "terminal:data", "id": id, "data": text])
    }

    func resize(id: String, cols: Int, rows: Int) {
        send(["type": "terminal:resize", "id": id, "cols": cols, "rows": rows])
    }

    func closeTerminal(id: String) {
        send(["type": "terminal:close", "id": id])
        outputHandlers.removeValue(forKey: id)
        exitHandlers.removeValue(forKey: id)
        errorHandlers.removeValue(forKey: id)
    }
}

extension TerminalSocket: URLSessionDelegate, URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        DispatchQueue.main.async { self.state = .closed(nil) }
    }
}
