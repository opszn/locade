import AppKit
import SwiftUI
import ServiceManagement

struct Project: Decodable, Identifiable {
    let id: String
    let name: String
    let url: String
    let online: Bool
    let favorite: Bool
    let hidden: Bool?
    let lastOpened: String?
    let addressReused: Bool?
}
struct Library: Decodable {
    let application: String
    let instance: String
    let token: String
    let projects: [Project]
    let autoRefresh: Bool?
}
struct Runtime: Codable {
    let pid: Int32
    let port: Int
    let instance: String
}
struct Health: Decodable {
    let application: String
    let instance: String
}

@MainActor final class Model: ObservableObject {
    @Published var projects: [Project] = []
    @Published var query = ""
    @Published var message = "正在启动本地项目库…"
    @Published var error = ""
    @Published var busy = true
    @Published var loginEnabled = SMAppService.mainApp.status == .enabled
    @Published var lastRefresh: Date?
    var port: Int?
    var token = ""
    var instance = ""
    var autoRefresh = true
    var child: Process?
    var log: FileHandle?
    var ownsService = false
    var isVisible = false
    private var operation = false
    let dataDirectory: URL
    let smokeTest = CommandLine.arguments.contains("--smoke-test")
    let noDiscovery = CommandLine.arguments.contains("--no-discovery")

    init() {
        dataDirectory = ProcessInfo.processInfo.environment["LOCADE_DATA_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) } ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".locade", isDirectory: true)
    }
    var visibleProjects: [Project] {
        projects.filter { $0.hidden != true && (query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) || $0.url.localizedCaseInsensitiveContains(query)) }
            .sorted {
                if $0.favorite != $1.favorite { return $0.favorite }
                if $0.lastOpened != $1.lastOpened { return ($0.lastOpened ?? "") > ($1.lastOpened ?? "") }
                return $0.name.localizedStandardCompare($1.name) == .orderedAscending
            }
    }
    func endpoint(_ path: String) throws -> URL {
        guard let port, (1...65535).contains(port), let url = URL(string: "http://127.0.0.1:\(port)/api/\(path)") else { throw NSError(domain: "Locade", code: 1, userInfo: [NSLocalizedDescriptionKey: "后台服务尚未就绪"]) }
        return url
    }
    func fetchLibrary(scan: Bool = false) async throws {
        var request = URLRequest(url: try endpoint(scan ? "scan" : "library"))
        request.timeoutInterval = scan ? 90 : 5
        if scan { request.httpMethod = "POST"; request.setValue(token, forHTTPHeaderField: "X-Locade-Token") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain: "Locade", code: 2, userInfo: [NSLocalizedDescriptionKey: "本地服务请求失败，请打开项目库检查或重新启动 Locade"]) }
        let library = try JSONDecoder().decode(Library.self, from: data)
        guard library.application == "locade", library.instance == instance else { throw NSError(domain: "Locade", code: 3, userInfo: [NSLocalizedDescriptionKey: "端口已不属于此 Locade 实例；为安全起见已断开"]) }
        projects = library.projects; token = library.token; autoRefresh = library.autoRefresh != false
        lastRefresh = Date(); error = ""
        message = ownsService ? "本机运行 · 退出将关闭自身后台" : "已连接现有服务 · 退出不会停止它"
    }
    func attach() async -> Bool {
        do {
            let record = try JSONDecoder().decode(Runtime.self, from: Data(contentsOf: dataDirectory.appendingPathComponent("runtime.json")))
            guard (1...65535).contains(record.port), record.pid > 1 else { return false }
            let url = URL(string: "http://127.0.0.1:\(record.port)/api/health")!
            var request = URLRequest(url: url); request.timeoutInterval = 2
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return false }
            let health = try JSONDecoder().decode(Health.self, from: data)
            guard health.application == "locade", health.instance == record.instance else { return false }
            port = record.port; instance = record.instance
            try await fetchLibrary(); return true
        } catch { return false }
    }
    func start() async {
        busy = true
        if await attach() { busy = false; if smokeTest { finishSmoke() }; return }
        do {
            guard let resources = Bundle.main.resourceURL else { throw CocoaError(.fileNoSuchFile) }
            let runtime = resources.appendingPathComponent("Runtime", isDirectory: true)
            let process = Process()
            process.executableURL = runtime.appendingPathComponent("node")
            process.arguments = [runtime.appendingPathComponent("server/index.js").path]
            process.currentDirectoryURL = runtime
            var environment = ProcessInfo.processInfo.environment
            environment["PORT"] = "0"
            environment["LOCADE_DATA_DIR"] = dataDirectory.path
            environment["LOCADE_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
            environment["LOCADE_BROWSER_EXECUTABLE"] = runtime.appendingPathComponent("browser/chrome-headless-shell").path
            environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
            // Never inherit Node preload flags from a shell into the bundled runtime.
            environment.removeValue(forKey: "NODE_OPTIONS"); environment.removeValue(forKey: "NODE_PATH")
            process.environment = environment
            try FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let logURL = dataDirectory.appendingPathComponent("desktop.log")
            if FileManager.default.fileExists(atPath: logURL.path) {
                let size = (try? FileManager.default.attributesOfItem(atPath: logURL.path)[.size] as? NSNumber)?.intValue ?? 0
                if size > 1024 * 1024 { try Data().write(to: logURL) }
            } else { FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
            log = try FileHandle(forWritingTo: logURL); try log?.seekToEnd()
            process.standardOutput = log; process.standardError = log
            try process.run(); child = process; ownsService = true
            for _ in 0..<80 {
                if !process.isRunning { break }
                if await attach() {
                    busy = false
                    if smokeTest { finishSmoke(); return }
                    if !noDiscovery { await refresh(scan: true) }
                    return
                }
                try await Task.sleep(nanoseconds: 150_000_000)
            }
            throw NSError(domain: "Locade", code: 4, userInfo: [NSLocalizedDescriptionKey: "后台启动失败。请查看 ~/.locade/desktop.log；可能已有实例或资料库损坏。"])
        } catch { self.error = error.localizedDescription; message = "服务未就绪"; busy = false; if smokeTest { print("LOCADE_SMOKE_FAILED \(error)"); NSApp.terminate(nil) } }
    }
    func refresh(scan: Bool) async {
        guard !operation else { return }
        operation = true; if scan { busy = true }
        defer { operation = false; busy = false }
        do { try await fetchLibrary(scan: scan) } catch { self.error = error.localizedDescription }
    }
    func openLibrary() {
        guard let port, let url = URL(string: "http://127.0.0.1:\(port)/") else { return }
        NSWorkspace.shared.open(url)
    }
    func openProject(_ project: Project) {
        guard project.addressReused != true, UUID(uuidString: project.id) != nil,
              let port, (1...65535).contains(port),
              let url = URL(string: "http://127.0.0.1:\(port)/open/\(project.id)")
        else { error = "项目地址无效或已被复用，请在项目库检查"; return }
        if !NSWorkspace.shared.open(url) { error = "无法打开浏览器，请在项目库重试" }
    }
    func setLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginEnabled = SMAppService.mainApp.status == .enabled
            if SMAppService.mainApp.status == .requiresApproval { error = "请到系统设置 → 通用 → 登录项中批准 Locade" }
        } catch { self.error = "无法修改登录项：\(error.localizedDescription)。请将应用放入 Applications，并使用已签名版本。" }
    }
    func stop() {
        // Only this Process object is owned. Never stop an attached server or discovered project.
        if ownsService, let child, child.isRunning { child.terminate() }
        try? log?.close()
    }
    func finishSmoke() {
        print("LOCADE_SMOKE_OK port=\(port ?? 0) owns=\(ownsService) projects=\(projects.count)")
        NSApp.terminate(nil)
    }
}

struct PopoverView: View {
    @ObservedObject var model: Model
    private let accent = Color(red: 0.953, green: 0.357, blue: 0.208)
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                if let url = Bundle.main.url(forResource: "wordmark", withExtension: "png"), let image = NSImage(contentsOf: url) {
                    Image(nsImage: image).resizable().scaledToFit().frame(width: 110, height: 34).accessibilityLabel("Locade")
                } else { Text("Locade").font(.title2) }
                Spacer()
                Text("\(model.projects.filter { $0.online && $0.hidden != true }.count) 个运行中").font(.caption).foregroundColor(.secondary)
            }
            TextField("搜索项目名称或端口…", text: $model.query).textFieldStyle(.roundedBorder).accessibilityLabel("搜索本地项目")
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    if model.visibleProjects.isEmpty { Text(model.busy ? "正在发现…" : "没有匹配项目，打开项目库添加地址。").font(.caption).foregroundColor(.secondary).padding(.vertical, 24) }
                    ForEach(model.visibleProjects.prefix(40)) { project in
                        Button { model.openProject(project) } label: {
                            HStack(spacing: 9) {
                                Circle().fill(project.online ? Color.green : Color.gray).frame(width: 6, height: 6)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(project.name).font(.system(size: 12, weight: .medium)).lineLimit(1)
                                    Text(project.addressReused == true ? "旧地址已被其他项目复用" : project.url).font(.system(size: 9, design: .monospaced)).foregroundColor(.secondary).lineLimit(1)
                                }
                                Spacer()
                                Image(systemName: project.favorite ? "star.fill" : "arrow.up.right").font(.caption).foregroundColor(project.favorite ? accent : .secondary)
                            }.padding(9).contentShape(Rectangle())
                        }.buttonStyle(.plain).disabled(project.addressReused == true)
                    }
                }
            }.frame(maxHeight: .infinity)
            if !model.error.isEmpty { Text(model.error).font(.caption).foregroundColor(.red).fixedSize(horizontal: false, vertical: true).textSelection(.enabled) }
            Divider()
            HStack {
                Button("打开项目库 ↗") { model.openLibrary() }.disabled(model.port == nil)
                Spacer()
                Button(model.busy ? "发现中…" : "重新发现") { Task { await model.refresh(scan: true) } }.disabled(model.busy || model.port == nil)
            }.font(.caption)
            Toggle("登录时启动（由你选择）", isOn: Binding(get: { model.loginEnabled }, set: { model.setLogin($0) })).font(.caption)
            HStack {
                Text(model.message).font(.system(size: 9)).foregroundColor(.secondary)
                Spacer()
                Button("退出") { NSApp.terminate(nil) }.font(.caption)
            }
            if let refreshed = model.lastRefresh { Text("最近同步 \(refreshed.formatted(date: .omitted, time: .shortened)) · 不自动截图").font(.system(size: 9)).foregroundColor(.secondary) }
        }
        .padding(20).frame(width: 360, height: 540)
        .background(Color(red: 0.957, green: 0.945, blue: 0.914))
        .preferredColorScheme(.light)
    }
}

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    var item: NSStatusItem!
    let popover = NSPopover()
    let model = Model()
    var timer: Timer?
    var shutdownTimer: Timer?
    var shutdownDeadline: Date?
    var ticks = 0
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "local.locade.prototype")
        if running.contains(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) && !model.smokeTest {
            NSApp.terminate(nil); return
        }
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let icon = Bundle.main.url(forResource: "menubar", withExtension: "png"), let image = NSImage(contentsOf: icon) {
            image.size = NSSize(width: 19, height: 19); image.isTemplate = true; item.button?.image = image
        } else { item.button?.image = NSImage(systemSymbolName: "circle.circle", accessibilityDescription: "Locade") }
        item.button?.toolTip = "Locade · 本地项目游乐场"
        item.button?.target = self; item.button?.action = #selector(toggle)
        popover.behavior = .transient; popover.delegate = self
        popover.contentViewController = NSHostingController(rootView: PopoverView(model: model))
        Task { await model.start(); if CommandLine.arguments.contains("--show") { toggle() } }
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.model.isVisible, !self.model.busy else { return }
                self.ticks += 1
                await self.model.refresh(scan: self.ticks % 4 == 0 && self.model.autoRefresh && !self.model.noDiscovery)
            }
        }
    }
    @objc func toggle() {
        if popover.isShown { popover.performClose(nil); return }
        guard let button = item.button else { return }
        model.isVisible = true; NSApp.activate(ignoringOtherApps: true)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        if model.port != nil { Task { await model.refresh(scan: false) } }
    }
    func popoverDidClose(_ notification: Notification) { model.isVisible = false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        timer?.invalidate()
        guard model.ownsService, let child = model.child, child.isRunning else { return .terminateNow }
        model.stop()
        // AppKit can enter a nested termination loop inside a Swift task. A new
        // MainActor task may then be starved; observe the owned child via RunLoop.
        shutdownDeadline = Date().addingTimeInterval(32)
        let poll = Timer(timeInterval: 0.1, target: self, selector: #selector(finishTermination), userInfo: nil, repeats: true)
        shutdownTimer = poll
        RunLoop.main.add(poll, forMode: .common)
        RunLoop.main.add(poll, forMode: .modalPanel)
        return .terminateLater
    }
    @objc func finishTermination() {
        guard model.child?.isRunning == true, let deadline = shutdownDeadline, Date() < deadline else {
            shutdownTimer?.invalidate(); shutdownTimer = nil
            // No escalation to arbitrary PIDs; the core has its own shutdown deadline.
            NSApp.reply(toApplicationShouldTerminate: true)
            return
        }
    }
}

@main struct LocadeMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
