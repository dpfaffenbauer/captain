import ActivityKit
import ExpoModulesCore
import WidgetKit

/// App group shared with the widget extension (targets/widget).
let kCaptainAppGroup = "group.at.pfaffenbauer.captain"
let kCaptainSnapshotKey = "captain.widget.snapshot"

/// Live Activity payload for an active port forward. The widget extension
/// declares an identical type — ActivityKit matches them by name + shape.
struct PortForwardAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var status: String
  }

  var pod: String
  var localPort: Int
  var remotePort: Int
}

public class CaptainWidgetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CaptainWidget")

    /// Stores the health snapshot (JSON) in the shared container and asks
    /// WidgetKit to re-render the timelines.
    Function("setSnapshot") { (json: String) in
      guard let defaults = UserDefaults(suiteName: kCaptainAppGroup) else { return }
      defaults.set(json, forKey: kCaptainSnapshotKey)
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }

    /// Starts a Live Activity for a port forward; resolves the activity id
    /// ('' when Live Activities are unavailable or disabled).
    AsyncFunction("startPortForwardActivity") { (pod: String, localPort: Int, remotePort: Int, promise: Promise) in
      guard #available(iOS 16.2, *) else {
        promise.resolve("")
        return
      }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        promise.resolve("")
        return
      }
      do {
        let activity = try Activity.request(
          attributes: PortForwardAttributes(pod: pod, localPort: localPort, remotePort: remotePort),
          content: .init(state: PortForwardAttributes.ContentState(status: "active"), staleDate: nil)
        )
        promise.resolve(activity.id)
      } catch {
        // Live Activities are cosmetic; never fail the forward over them.
        promise.resolve("")
      }
    }

    AsyncFunction("endPortForwardActivity") { (activityId: String, promise: Promise) in
      guard #available(iOS 16.2, *), !activityId.isEmpty else {
        promise.resolve(nil)
        return
      }
      Task {
        for activity in Activity<PortForwardAttributes>.activities where activity.id == activityId {
          await activity.end(
            .init(state: PortForwardAttributes.ContentState(status: "stopped"), staleDate: nil),
            dismissalPolicy: .immediate
          )
        }
        promise.resolve(nil)
      }
    }
  }
}
