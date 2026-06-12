import ActivityKit
import SwiftUI
import WidgetKit

// Mirrors WidgetSnapshot in modules/captain-widget: the app writes the latest
// multi-cluster health probe into the shared app group, the widget renders it.

let appGroup = "group.at.pfaffenbauer.captain"
let snapshotKey = "captain.widget.snapshot"

struct ClusterEntryData: Codable {
  let name: String
  /// ok | warn | bad | unknown
  let tone: String
  let summary: String
}

struct SnapshotData: Codable {
  let clusters: [ClusterEntryData]
  /// Unix epoch seconds of the probe.
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

let sampleSnapshot = SnapshotData(
  clusters: [
    ClusterEntryData(name: "production", tone: "ok", summary: "3/3 nodes · 42 pods"),
    ClusterEntryData(name: "staging", tone: "warn", summary: "2/2 nodes · 1 problem"),
  ],
  updatedAt: Date().timeIntervalSince1970
)

func toneColor(_ tone: String) -> Color {
  switch tone {
  case "ok": return Color(red: 0.20, green: 0.83, blue: 0.60) // #34D399
  case "warn": return Color(red: 0.98, green: 0.75, blue: 0.33) // #FBBF55
  case "bad": return Color(red: 0.98, green: 0.44, blue: 0.52) // #FB7185
  default: return Color.white.opacity(0.35)
  }
}

/// Worst state wins for the small widget's overall dot.
func worstTone(_ clusters: [ClusterEntryData]) -> String {
  if clusters.contains(where: { $0.tone == "bad" }) { return "bad" }
  if clusters.contains(where: { $0.tone == "unknown" }) { return "unknown" }
  if clusters.contains(where: { $0.tone == "warn" }) { return "warn" }
  return clusters.isEmpty ? "unknown" : "ok"
}

struct HealthEntry: TimelineEntry {
  let date: Date
  let snapshot: SnapshotData?
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> HealthEntry {
    HealthEntry(date: Date(), snapshot: sampleSnapshot)
  }

  func getSnapshot(in context: Context, completion: @escaping (HealthEntry) -> Void) {
    completion(HealthEntry(date: Date(), snapshot: loadSnapshot() ?? sampleSnapshot))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<HealthEntry>) -> Void) {
    // The app pushes fresh data via WidgetCenter on every probe; the 30 min
    // refresh only re-renders the "x min ago" footer in between.
    let entry = HealthEntry(date: Date(), snapshot: loadSnapshot())
    completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(30 * 60))))
  }
}

struct ClusterRow: View {
  let cluster: ClusterEntryData

  var body: some View {
    HStack(spacing: 7) {
      Circle()
        .fill(toneColor(cluster.tone))
        .frame(width: 8, height: 8)
      VStack(alignment: .leading, spacing: 1) {
        Text(cluster.name)
          .font(.system(size: 12, weight: .semibold))
          .foregroundColor(.white)
          .lineLimit(1)
        Text(cluster.summary)
          .font(.system(size: 9.5))
          .foregroundColor(.white.opacity(0.45))
          .lineLimit(1)
      }
      Spacer(minLength: 0)
    }
  }
}

struct HealthWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: HealthEntry

  var body: some View {
    Group {
      if let snapshot = entry.snapshot, !snapshot.clusters.isEmpty {
        if family == .systemSmall {
          smallView(snapshot)
        } else {
          mediumView(snapshot)
        }
      } else {
        VStack(spacing: 6) {
          Text("⎈").font(.system(size: 28))
          Text("Open Captain to load cluster health")
            .font(.system(size: 11))
            .foregroundColor(.white.opacity(0.5))
            .multilineTextAlignment(.center)
        }
      }
    }
    .containerBackground(Color("$widgetBackground"), for: .widget)
  }

  func smallView(_ snapshot: SnapshotData) -> some View {
    let healthy = snapshot.clusters.filter { $0.tone == "ok" }.count
    return VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("⎈").font(.system(size: 16)).foregroundColor(.white)
        Spacer()
        Circle()
          .fill(toneColor(worstTone(snapshot.clusters)))
          .frame(width: 12, height: 12)
      }
      Spacer()
      Text("\(healthy)/\(snapshot.clusters.count)")
        .font(.system(size: 30, weight: .bold))
        .foregroundColor(.white)
      Text(snapshot.clusters.count == 1 ? "cluster healthy" : "clusters healthy")
        .font(.system(size: 11))
        .foregroundColor(.white.opacity(0.5))
      footer
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  func mediumView(_ snapshot: SnapshotData) -> some View {
    VStack(alignment: .leading, spacing: 7) {
      ForEach(snapshot.clusters.prefix(3), id: \.name) { cluster in
        ClusterRow(cluster: cluster)
      }
      if snapshot.clusters.count > 3 {
        Text("+\(snapshot.clusters.count - 3) more")
          .font(.system(size: 9.5))
          .foregroundColor(.white.opacity(0.35))
      }
      Spacer(minLength: 0)
      footer
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  var footer: some View {
    Group {
      if let snapshot = entry.snapshot {
        Text(Date(timeIntervalSince1970: snapshot.updatedAt), style: .relative)
          .font(.system(size: 9))
          .foregroundColor(.white.opacity(0.3))
        + Text(" ago")
          .font(.system(size: 9))
          .foregroundColor(.white.opacity(0.3))
      }
    }
  }
}

struct ClusterHealthWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "CaptainClusterHealth", provider: Provider()) { entry in
      HealthWidgetView(entry: entry)
    }
    .configurationDisplayName("Cluster Health")
    .description("Node readiness and problem pods of your stored clusters.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

// MARK: - Port forward Live Activity

/// Mirror of the type in modules/captain-widget — ActivityKit matches the
/// app's activity to this UI by type name + shape.
struct PortForwardAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var status: String
  }

  var pod: String
  var localPort: Int
  var remotePort: Int
}

struct PortForwardActivityView: View {
  let context: ActivityViewContext<PortForwardAttributes>

  var body: some View {
    HStack(spacing: 10) {
      Text("⇄")
        .font(.system(size: 18, weight: .bold))
        .foregroundColor(Color(red: 0.36, green: 0.49, blue: 1.0))
      VStack(alignment: .leading, spacing: 2) {
        Text(context.attributes.pod)
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(.white)
          .lineLimit(1)
        Text("localhost:\(context.attributes.localPort) → :\(context.attributes.remotePort)")
          .font(.system(size: 11, design: .monospaced))
          .foregroundColor(.white.opacity(0.55))
      }
      Spacer()
      Circle()
        .fill(context.state.status == "active" ? Color(red: 0.20, green: 0.83, blue: 0.60) : Color.white.opacity(0.35))
        .frame(width: 9, height: 9)
    }
    .padding(14)
    .activityBackgroundTint(Color(red: 0.06, green: 0.08, blue: 0.13))
  }
}

struct PortForwardLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PortForwardAttributes.self) { context in
      PortForwardActivityView(context: context)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text("⇄ \(context.attributes.pod)")
            .font(.system(size: 13, weight: .semibold))
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(":\(context.attributes.localPort)")
            .font(.system(size: 13, design: .monospaced))
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text("localhost:\(context.attributes.localPort) → \(context.attributes.pod):\(context.attributes.remotePort)")
            .font(.system(size: 11, design: .monospaced))
            .foregroundColor(.secondary)
        }
      } compactLeading: {
        Text("⇄")
      } compactTrailing: {
        Text(":\(context.attributes.localPort)")
          .font(.system(size: 12, design: .monospaced))
      } minimal: {
        Text("⇄")
      }
    }
  }
}

@main
struct CaptainWidgets: WidgetBundle {
  var body: some Widget {
    ClusterHealthWidget()
    PortForwardLiveActivity()
  }
}
