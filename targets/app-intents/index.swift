import AppIntents
import Foundation

// Siri / Shortcuts integration. The health intent answers headlessly from the
// app-group snapshot the app (and the background task) keep fresh; the open
// intent deep-links into a stored cluster.

let appGroup = "group.at.pfaffenbauer.captain"
let snapshotKey = "captain.widget.snapshot"

struct ClusterEntryData: Codable {
  let name: String
  let tone: String
  let summary: String
}

struct SnapshotData: Codable {
  let clusters: [ClusterEntryData]
  let updatedAt: Double
}

func loadSnapshot() -> SnapshotData? {
  guard
    let defaults = UserDefaults(suiteName: appGroup),
    let json = defaults.string(forKey: snapshotKey),
    let data = json.data(using: .utf8)
  else { return nil }
  return try? JSONDecoder().decode(SnapshotData.self, from: data)
}

struct ClusterHealthIntent: AppIntent {
  static let title: LocalizedStringResource = "Check Cluster Health"
  static let description = IntentDescription(
    "Summarizes the last known health of your stored Kubernetes clusters."
  )

  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard let snapshot = loadSnapshot(), !snapshot.clusters.isEmpty else {
      return .result(dialog: "No cluster data yet — open Captain once to load it.")
    }
    let problems = snapshot.clusters.filter { $0.tone != "ok" }
    if problems.isEmpty {
      let count = snapshot.clusters.count
      return .result(
        dialog: "All \(count) \(count == 1 ? "cluster is" : "clusters are") healthy."
      )
    }
    let detail = problems
      .map { "\($0.name): \($0.summary)" }
      .joined(separator: ". ")
    return .result(
      dialog: "\(problems.count) of \(snapshot.clusters.count) clusters need attention. \(detail)"
    )
  }
}

@available(iOS 18.0, *)
struct OpenClusterIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Cluster"
  static let description = IntentDescription("Opens a stored cluster in Captain.")
  static let openAppWhenRun = true

  @Parameter(title: "Cluster name")
  var name: String

  func perform() async throws -> some IntentResult & OpensIntent {
    let encoded =
      name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? name
    guard let url = URL(string: "captain://open?cluster=\(encoded)") else {
      throw AppIntentError.Unrecoverable.entityNotFound
    }
    return .result(opensIntent: OpenURLIntent(url))
  }
}

struct CaptainShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: ClusterHealthIntent(),
      phrases: [
        "Check cluster health in \(.applicationName)",
        "How are my clusters in \(.applicationName)",
      ],
      shortTitle: "Cluster Health",
      systemImageName: "checkmark.seal"
    )
  }
}
