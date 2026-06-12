import ExpoModulesCore
import Foundation
import Network
import Security

// MARK: - Options records

struct KubeRequestOptions: Record {
  @Field var url: String = ""
  @Field var method: String = "GET"
  @Field var headers: [String: String] = [:]
  @Field var body: String? = nil
  // PEM-encoded CA bundle (may contain multiple certificates)
  @Field var caPem: String? = nil
  @Field var insecure: Bool = false
  // base64-encoded PKCS#12 bundle for client certificate auth
  @Field var pkcs12: String? = nil
  @Field var pkcs12Password: String? = nil
  @Field var timeoutMs: Double = 30000
}

struct KubeExecOptions: Record {
  // wss:// URL including command/container/stdout query parameters
  @Field var url: String = ""
  @Field var headers: [String: String] = [:]
  @Field var caPem: String? = nil
  @Field var insecure: Bool = false
  @Field var pkcs12: String? = nil
  @Field var pkcs12Password: String? = nil
  @Field var timeoutMs: Double = 20000
}

struct KubePortForwardOptions: Record {
  // wss:// URL of the portforward endpoint including ?ports=<remote>
  @Field var url: String = ""
  @Field var headers: [String: String] = [:]
  @Field var caPem: String? = nil
  @Field var insecure: Bool = false
  @Field var pkcs12: String? = nil
  @Field var pkcs12Password: String? = nil
  // 0 = pick a free port automatically
  @Field var localPort: Int = 0
}

// MARK: - TLS helpers

func kubeParsePemCertificates(_ pem: String) -> [SecCertificate] {
  var certificates: [SecCertificate] = []
  let scanner = pem as NSString
  var searchRange = NSRange(location: 0, length: scanner.length)
  let beginMarker = "-----BEGIN CERTIFICATE-----"
  let endMarker = "-----END CERTIFICATE-----"

  while true {
    let beginRange = scanner.range(of: beginMarker, options: [], range: searchRange)
    if beginRange.location == NSNotFound { break }
    let afterBegin = beginRange.location + beginRange.length
    let endSearchRange = NSRange(location: afterBegin, length: scanner.length - afterBegin)
    let endRange = scanner.range(of: endMarker, options: [], range: endSearchRange)
    if endRange.location == NSNotFound { break }

    let base64Body = scanner.substring(with: NSRange(location: afterBegin, length: endRange.location - afterBegin))
      .replacingOccurrences(of: "\r", with: "")
      .replacingOccurrences(of: "\n", with: "")
      .replacingOccurrences(of: " ", with: "")
    if let der = Data(base64Encoded: base64Body),
       let certificate = SecCertificateCreateWithData(nil, der as CFData) {
      certificates.append(certificate)
    }

    let afterEnd = endRange.location + endRange.length
    searchRange = NSRange(location: afterEnd, length: scanner.length - afterEnd)
  }
  return certificates
}

func kubeImportIdentity(pkcs12: String?, password: String?) throws -> SecIdentity? {
  guard let p12b64 = pkcs12, !p12b64.isEmpty else { return nil }
  guard let p12data = Data(base64Encoded: p12b64, options: .ignoreUnknownCharacters) else {
    throw NSError(domain: "KubeHttp", code: 1, userInfo: [NSLocalizedDescriptionKey: "Client certificate is not valid base64-encoded PKCS#12 data"])
  }
  let importOptions: [String: Any] = [kSecImportExportPassphrase as String: password ?? ""]
  var items: CFArray?
  let status = SecPKCS12Import(p12data as CFData, importOptions as CFDictionary, &items)
  guard status == errSecSuccess,
        let first = (items as? [[String: Any]])?.first,
        let rawIdentity = first[kSecImportItemIdentity as String] else {
    throw NSError(domain: "KubeHttp", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not import PKCS#12 client certificate (status \(status)). Check the password."])
  }
  return (rawIdentity as! SecIdentity)
}

final class KubeTrustDelegate: NSObject, URLSessionDelegate {
  private let anchors: [SecCertificate]
  private let insecure: Bool
  private let identity: SecIdentity?

  init(anchors: [SecCertificate], insecure: Bool, identity: SecIdentity?) {
    self.anchors = anchors
    self.insecure = insecure
    self.identity = identity
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    switch challenge.protectionSpace.authenticationMethod {
    case NSURLAuthenticationMethodServerTrust:
      guard let trust = challenge.protectionSpace.serverTrust else {
        completionHandler(.performDefaultHandling, nil)
        return
      }
      if insecure {
        completionHandler(.useCredential, URLCredential(trust: trust))
        return
      }
      if !anchors.isEmpty {
        SecTrustSetAnchorCertificates(trust, anchors as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        var error: CFError?
        if SecTrustEvaluateWithError(trust, &error) {
          completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
          completionHandler(.cancelAuthenticationChallenge, nil)
        }
        return
      }
      completionHandler(.performDefaultHandling, nil)

    case NSURLAuthenticationMethodClientCertificate:
      if let identity = identity {
        let credential = URLCredential(identity: identity, certificates: nil, persistence: .forSession)
        completionHandler(.useCredential, credential)
      } else {
        completionHandler(.performDefaultHandling, nil)
      }

    default:
      completionHandler(.performDefaultHandling, nil)
    }
  }
}

func kubeMakeSession(caPem: String?, insecure: Bool, pkcs12: String?, pkcs12Password: String?, timeout: Double) throws -> URLSession {
  let identity = try kubeImportIdentity(pkcs12: pkcs12, password: pkcs12Password)
  var anchors: [SecCertificate] = []
  if let pem = caPem, !pem.isEmpty {
    anchors = kubeParsePemCertificates(pem)
    if anchors.isEmpty {
      throw NSError(domain: "KubeHttp", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not parse any certificate from the provided CA PEM data"])
    }
  }
  let delegate = KubeTrustDelegate(anchors: anchors, insecure: insecure, identity: identity)
  let configuration = URLSessionConfiguration.ephemeral
  configuration.timeoutIntervalForRequest = timeout
  return URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
}

// MARK: - Exec session (one-shot command over the v4 channel protocol)

final class KubeExecRunner {
  private let task: URLSessionWebSocketTask
  private let session: URLSession
  private var stdout = Data()
  private var stderr = Data()
  private var errorJson = Data()
  private var finished = false
  private let promise: Promise
  private let queue = DispatchQueue(label: "kube.exec")

  init(session: URLSession, request: URLRequest, promise: Promise) {
    self.session = session
    self.task = session.webSocketTask(with: request)
    self.promise = promise
  }

  func start(timeoutMs: Double) {
    task.resume()
    receive()
    queue.asyncAfter(deadline: .now() + timeoutMs / 1000.0) { [weak self] in
      self?.finish(timedOut: true)
    }
  }

  private func receive() {
    task.receive { [weak self] result in
      guard let self = self else { return }
      switch result {
      case .failure:
        self.finish(timedOut: false)
      case .success(let message):
        var data: Data
        switch message {
        case .data(let d): data = d
        case .string(let s): data = s.data(using: .utf8) ?? Data()
        @unknown default: data = Data()
        }
        if data.count > 1 {
          let channel = data[data.startIndex]
          let payload = data.dropFirst()
          self.queue.async {
            switch channel {
            case 1: self.stdout.append(payload)
            case 2: self.stderr.append(payload)
            case 3: self.errorJson.append(payload)
            default: break
            }
          }
        }
        self.receive()
      }
    }
  }

  private func finish(timedOut: Bool) {
    queue.async {
      if self.finished { return }
      self.finished = true
      self.task.cancel(with: .normalClosure, reason: nil)
      self.session.finishTasksAndInvalidate()
      self.promise.resolve([
        "stdout": String(data: self.stdout, encoding: .utf8) ?? "",
        "stderr": String(data: self.stderr, encoding: .utf8) ?? "",
        "error": String(data: self.errorJson, encoding: .utf8) ?? "",
        "timedOut": timedOut,
      ])
    }
  }
}

// MARK: - Port forward session

final class KubePortForwardSession {
  let id: String
  private let listener: NWListener
  private let makeWebSocket: () -> URLSessionWebSocketTask
  private let session: URLSession
  private var connections: [ObjectIdentifier: (NWConnection, URLSessionWebSocketTask)] = [:]
  private let queue = DispatchQueue(label: "kube.portforward")
  private(set) var localPort: UInt16 = 0

  init(id: String, localPort: UInt16, session: URLSession, makeWebSocket: @escaping () -> URLSessionWebSocketTask) throws {
    self.id = id
    self.session = session
    self.makeWebSocket = makeWebSocket
    let params = NWParameters.tcp
    params.requiredInterfaceType = .loopback
    if localPort > 0 {
      self.listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: localPort)!)
    } else {
      self.listener = try NWListener(using: params)
    }
  }

  func start(onReady: @escaping (UInt16) -> Void, onError: @escaping (String) -> Void) {
    listener.stateUpdateHandler = { [weak self] state in
      switch state {
      case .ready:
        if let port = self?.listener.port?.rawValue {
          self?.localPort = port
          onReady(port)
        }
      case .failed(let error):
        onError(error.localizedDescription)
      default:
        break
      }
    }
    listener.newConnectionHandler = { [weak self] connection in
      self?.handle(connection: connection)
    }
    listener.start(queue: queue)
  }

  /// Each accepted TCP connection gets its own WebSocket: the websocket
  /// port-forward protocol supports a single stream pair per connection.
  private func handle(connection: NWConnection) {
    let ws = makeWebSocket()
    connections[ObjectIdentifier(connection)] = (connection, ws)
    var seenFramesPerChannel: [UInt8: Bool] = [:]

    func closeBoth() {
      ws.cancel(with: .normalClosure, reason: nil)
      connection.cancel()
      self.queue.async { self.connections.removeValue(forKey: ObjectIdentifier(connection)) }
    }

    func pumpWebSocket() {
      ws.receive { result in
        switch result {
        case .failure:
          closeBoth()
        case .success(let message):
          var data: Data
          switch message {
          case .data(let d): data = d
          case .string(let s): data = s.data(using: .utf8) ?? Data()
          @unknown default: data = Data()
          }
          if data.count >= 1 {
            let channel = data[data.startIndex]
            var payload = data.dropFirst()
            // The first frame on each channel carries the 2-byte port number.
            if seenFramesPerChannel[channel] == nil {
              seenFramesPerChannel[channel] = true
              payload = payload.dropFirst(2)
            }
            if channel == 0, !payload.isEmpty {
              connection.send(content: Data(payload), completion: .contentProcessed { _ in })
            }
          }
          pumpWebSocket()
        }
      }
    }

    func pumpTcp() {
      connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { content, _, isComplete, error in
        if let content = content, !content.isEmpty {
          var framed = Data([0])
          framed.append(content)
          ws.send(.data(framed)) { _ in }
        }
        if isComplete || error != nil {
          closeBoth()
        } else {
          pumpTcp()
        }
      }
    }

    connection.stateUpdateHandler = { state in
      if case .failed = state { closeBoth() }
    }
    ws.resume()
    connection.start(queue: queue)
    pumpWebSocket()
    pumpTcp()
  }

  func stop() {
    listener.cancel()
    for (_, pair) in connections {
      pair.0.cancel()
      pair.1.cancel(with: .normalClosure, reason: nil)
    }
    connections.removeAll()
    session.finishTasksAndInvalidate()
  }
}

// MARK: - Module

public class KubeHttpModule: Module {
  private var forwards: [String: KubePortForwardSession] = [:]

  public func definition() -> ModuleDefinition {
    Name("KubeHttp")

    AsyncFunction("request") { (options: KubeRequestOptions, promise: Promise) in
      guard let url = URL(string: options.url) else {
        promise.reject("ERR_KUBE_URL", "Invalid URL: \(options.url)")
        return
      }
      let session: URLSession
      do {
        session = try kubeMakeSession(
          caPem: options.caPem, insecure: options.insecure,
          pkcs12: options.pkcs12, pkcs12Password: options.pkcs12Password,
          timeout: options.timeoutMs / 1000.0
        )
      } catch {
        promise.reject("ERR_KUBE_TLS", error.localizedDescription)
        return
      }

      var request = URLRequest(url: url)
      request.httpMethod = options.method
      request.timeoutInterval = options.timeoutMs / 1000.0
      for (key, value) in options.headers {
        request.setValue(value, forHTTPHeaderField: key)
      }
      if let body = options.body {
        request.httpBody = body.data(using: .utf8)
      }

      let task = session.dataTask(with: request) { data, response, error in
        defer { session.finishTasksAndInvalidate() }
        if let error = error {
          promise.reject("ERR_KUBE_NETWORK", error.localizedDescription)
          return
        }
        guard let httpResponse = response as? HTTPURLResponse else {
          promise.reject("ERR_KUBE_NETWORK", "No HTTP response received")
          return
        }
        var headers: [String: String] = [:]
        for (key, value) in httpResponse.allHeaderFields {
          if let k = key as? String, let v = value as? String {
            headers[k.lowercased()] = v
          }
        }
        let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        promise.resolve([
          "status": httpResponse.statusCode,
          "headers": headers,
          "body": body,
        ])
      }
      task.resume()
    }

    AsyncFunction("exec") { (options: KubeExecOptions, promise: Promise) in
      guard let url = URL(string: options.url) else {
        promise.reject("ERR_KUBE_URL", "Invalid URL: \(options.url)")
        return
      }
      let session: URLSession
      do {
        session = try kubeMakeSession(
          caPem: options.caPem, insecure: options.insecure,
          pkcs12: options.pkcs12, pkcs12Password: options.pkcs12Password,
          timeout: options.timeoutMs / 1000.0
        )
      } catch {
        promise.reject("ERR_KUBE_TLS", error.localizedDescription)
        return
      }
      var request = URLRequest(url: url)
      request.timeoutInterval = options.timeoutMs / 1000.0
      for (key, value) in options.headers {
        request.setValue(value, forHTTPHeaderField: key)
      }
      request.setValue("v4.channel.k8s.io", forHTTPHeaderField: "Sec-WebSocket-Protocol")

      let runner = KubeExecRunner(session: session, request: request, promise: promise)
      runner.start(timeoutMs: options.timeoutMs)
    }

    AsyncFunction("portForwardStart") { (options: KubePortForwardOptions, promise: Promise) in
      guard let url = URL(string: options.url) else {
        promise.reject("ERR_KUBE_URL", "Invalid URL: \(options.url)")
        return
      }
      let session: URLSession
      do {
        session = try kubeMakeSession(
          caPem: options.caPem, insecure: options.insecure,
          pkcs12: options.pkcs12, pkcs12Password: options.pkcs12Password,
          timeout: 30
        )
      } catch {
        promise.reject("ERR_KUBE_TLS", error.localizedDescription)
        return
      }

      let headers = options.headers
      let makeWebSocket: () -> URLSessionWebSocketTask = {
        var request = URLRequest(url: url)
        for (key, value) in headers {
          request.setValue(value, forHTTPHeaderField: key)
        }
        request.setValue("v4.channel.k8s.io", forHTTPHeaderField: "Sec-WebSocket-Protocol")
        return session.webSocketTask(with: request)
      }

      let id = UUID().uuidString
      do {
        let forward = try KubePortForwardSession(
          id: id,
          localPort: UInt16(options.localPort),
          session: session,
          makeWebSocket: makeWebSocket
        )
        var resolved = false
        forward.start(
          onReady: { port in
            if resolved { return }
            resolved = true
            self.forwards[id] = forward
            promise.resolve(["id": id, "localPort": Int(port)])
          },
          onError: { message in
            if resolved { return }
            resolved = true
            promise.reject("ERR_KUBE_FORWARD", message)
          }
        )
      } catch {
        promise.reject("ERR_KUBE_FORWARD", error.localizedDescription)
      }
    }

    Function("portForwardStop") { (id: String) in
      self.forwards[id]?.stop()
      self.forwards.removeValue(forKey: id)
    }

    OnDestroy {
      for (_, forward) in self.forwards {
        forward.stop()
      }
      self.forwards.removeAll()
    }
  }
}
