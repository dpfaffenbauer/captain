import ExpoModulesCore
import WidgetKit

/// App group shared with the widget extension (targets/widget).
let kCaptainAppGroup = "group.at.pfaffenbauer.captain"
let kCaptainSnapshotKey = "captain.widget.snapshot"

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
  }
}
