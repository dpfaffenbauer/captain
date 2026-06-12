import CryptoKit
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
  // PEM-encoded client certificate (may include intermediates)
  @Field var clientCertPem: String? = nil
  // PEM-encoded private key (PKCS#1, SEC1, or unencrypted PKCS#8)
  @Field var clientKeyPem: String? = nil
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
  @Field var clientCertPem: String? = nil
  @Field var clientKeyPem: String? = nil
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
  @Field var clientCertPem: String? = nil
  @Field var clientKeyPem: String? = nil
  @Field var pkcs12: String? = nil
  @Field var pkcs12Password: String? = nil
  // 0 = pick a free port automatically
  @Field var localPort: Int = 0
}

// MARK: - TLS helpers

enum ClientCertError: Error, LocalizedError {
  case noCertificate
  case encryptedKey
  case missingPublicKey
  case unsupportedKey(String)
  case keychain(OSStatus)

  var errorDescription: String? {
    switch self {
    case .noCertificate:
      return "Could not parse a certificate from the client certificate PEM data"
    case .encryptedKey:
      return "Encrypted private keys are not supported; provide an unencrypted key"
    case .missingPublicKey:
      return "The EC private key does not embed its public key; re-export it including the public key"
    case .unsupportedKey(let detail):
      return "Unsupported private key: \(detail)"
    case .keychain(let status):
      return "Could not build a client identity from certificate and key (status \(status))"
    }
  }
}

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

// MARK: - Client identity from PEM certificate + key

/// Extracts the DER payload of the first PEM block with one of the given labels.
private func kubePemBlock(_ pem: String, labels: [String]) -> Data? {
  for label in labels {
    guard let beginRange = pem.range(of: "-----BEGIN \(label)-----") else { continue }
    guard let endRange = pem.range(of: "-----END \(label)-----", range: beginRange.upperBound..<pem.endIndex) else {
      continue
    }
    let body = pem[beginRange.upperBound..<endRange.lowerBound]
      .components(separatedBy: .whitespacesAndNewlines)
      .joined()
    if let der = Data(base64Encoded: body) { return der }
  }
  return nil
}

/// Minimal DER tag-length-value reader; enough for the key structures below.
private struct DerReader {
  private let bytes: [UInt8]
  private var offset = 0

  init(_ data: Data) {
    self.bytes = [UInt8](data)
  }

  mutating func readTLV() -> (tag: UInt8, value: Data)? {
    guard offset + 2 <= bytes.count else { return nil }
    let tag = bytes[offset]
    offset += 1
    var length = Int(bytes[offset])
    offset += 1
    if length & 0x80 != 0 {
      let lengthOctets = length & 0x7F
      guard lengthOctets >= 1, lengthOctets <= 4, offset + lengthOctets <= bytes.count else { return nil }
      length = 0
      for _ in 0..<lengthOctets {
        length = (length << 8) | Int(bytes[offset])
        offset += 1
      }
    }
    guard length >= 0, offset + length <= bytes.count else { return nil }
    let value = Data(bytes[offset..<(offset + length)])
    offset += length
    return (tag, value)
  }
}

private let kubeRsaOid: [UInt8] = [0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01]
private let kubeEcOid: [UInt8] = [0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01]

private func kubeCreateKey(_ keyData: Data, type: CFString) throws -> SecKey {
  let attributes: [String: Any] = [
    kSecAttrKeyType as String: type,
    kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
  ]
  var error: Unmanaged<CFError>?
  guard let key = SecKeyCreateWithData(keyData as CFData, attributes as CFDictionary, &error) else {
    let detail = (error?.takeRetainedValue()).map { CFErrorCopyDescription($0) as String } ?? "invalid key data"
    throw ClientCertError.unsupportedKey(detail)
  }
  return key
}

/// Converts a SEC1 ECPrivateKey (RFC 5915) into the X9.63 representation
/// (04 || X || Y || K) that SecKeyCreateWithData expects for EC keys.
private func kubeX963FromSec1(_ der: Data) throws -> Data {
  var outer = DerReader(der)
  guard let sequence = outer.readTLV(), sequence.tag == 0x30 else {
    throw ClientCertError.unsupportedKey("malformed EC private key")
  }
  var reader = DerReader(sequence.value)
  guard let version = reader.readTLV(), version.tag == 0x02,
        let scalar = reader.readTLV(), scalar.tag == 0x04 else {
    throw ClientCertError.unsupportedKey("malformed EC private key")
  }
  var publicPoint: Data?
  while let field = reader.readTLV() {
    // [1] EXPLICIT BIT STRING holding the uncompressed public point
    if field.tag == 0xA1 {
      var inner = DerReader(field.value)
      if let bitString = inner.readTLV(), bitString.tag == 0x03, bitString.value.count > 1 {
        publicPoint = bitString.value.dropFirst() // skip unused-bits octet
      }
    }
  }
  guard let point = publicPoint, point.first == 0x04, point.count > 2 else {
    throw ClientCertError.missingPublicKey
  }
  let elementSize = (point.count - 1) / 2
  var paddedScalar = Data(repeating: 0, count: max(0, elementSize - scalar.value.count))
  paddedScalar.append(scalar.value.suffix(elementSize))
  return point + paddedScalar
}

/// PKCS#8 PrivateKeyInfo ::= SEQUENCE { version, AlgorithmIdentifier, privateKey OCTET STRING }
private func kubeParsePkcs8(_ der: Data) throws -> SecKey {
  var outer = DerReader(der)
  guard let info = outer.readTLV(), info.tag == 0x30 else {
    throw ClientCertError.unsupportedKey("malformed PKCS#8 structure")
  }
  var reader = DerReader(info.value)
  guard let version = reader.readTLV(), version.tag == 0x02,
        let algorithm = reader.readTLV(), algorithm.tag == 0x30,
        let keyOctets = reader.readTLV(), keyOctets.tag == 0x04 else {
    throw ClientCertError.unsupportedKey("malformed PKCS#8 structure")
  }
  var algorithmReader = DerReader(algorithm.value)
  guard let oid = algorithmReader.readTLV(), oid.tag == 0x06 else {
    throw ClientCertError.unsupportedKey("missing key algorithm identifier")
  }
  if [UInt8](oid.value) == kubeRsaOid {
    return try kubeCreateKey(keyOctets.value, type: kSecAttrKeyTypeRSA)
  }
  if [UInt8](oid.value) == kubeEcOid {
    return try kubeCreateKey(kubeX963FromSec1(keyOctets.value), type: kSecAttrKeyTypeECSECPrimeRandom)
  }
  throw ClientCertError.unsupportedKey("unsupported key algorithm (only RSA and EC are supported)")
}

/// Parses a PEM private key (PKCS#1 RSA, SEC1 EC, or unencrypted PKCS#8) into a SecKey.
func kubeParsePrivateKey(_ pem: String) throws -> SecKey {
  if pem.contains("ENCRYPTED") {
    throw ClientCertError.encryptedKey
  }
  if let der = kubePemBlock(pem, labels: ["RSA PRIVATE KEY"]) {
    return try kubeCreateKey(der, type: kSecAttrKeyTypeRSA)
  }
  if let der = kubePemBlock(pem, labels: ["EC PRIVATE KEY"]) {
    return try kubeCreateKey(kubeX963FromSec1(der), type: kSecAttrKeyTypeECSECPrimeRandom)
  }
  if let der = kubePemBlock(pem, labels: ["PRIVATE KEY"]) {
    return try kubeParsePkcs8(der)
  }
  throw ClientCertError.unsupportedKey("no PEM private key block found")
}

/// Pairs the certificate and key in the keychain to obtain a SecIdentity —
/// the only public way to build one without going through PKCS#12.
func kubeMakeIdentity(certificate: SecCertificate, key: SecKey) throws -> SecIdentity {
  let certDer = SecCertificateCopyData(certificate) as Data
  let digest = SHA256.hash(data: certDer).map { String(format: "%02x", $0) }.joined()
  let label = "captain.kubehttp.client.\(digest)"

  let keyAttributes: [String: Any] = [
    kSecClass as String: kSecClassKey,
    kSecValueRef as String: key,
    kSecAttrLabel as String: label,
  ]
  var status = SecItemAdd(keyAttributes as CFDictionary, nil)
  guard status == errSecSuccess || status == errSecDuplicateItem else {
    throw ClientCertError.keychain(status)
  }

  let certAttributes: [String: Any] = [
    kSecClass as String: kSecClassCertificate,
    kSecValueRef as String: certificate,
    kSecAttrLabel as String: label,
  ]
  status = SecItemAdd(certAttributes as CFDictionary, nil)
  guard status == errSecSuccess || status == errSecDuplicateItem else {
    throw ClientCertError.keychain(status)
  }

  let query: [String: Any] = [
    kSecClass as String: kSecClassIdentity,
    kSecAttrLabel as String: label,
    kSecReturnRef as String: true,
  ]
  var result: CFTypeRef?
  status = SecItemCopyMatching(query as CFDictionary, &result)
  guard status == errSecSuccess, let identity = result else {
    throw ClientCertError.keychain(status)
  }
  return (identity as! SecIdentity)
}

final class KubeTrustDelegate: NSObject, URLSessionDelegate {
  private let anchors: [SecCertificate]
  private let insecure: Bool
  private let identity: SecIdentity?
  private let clientChain: [SecCertificate]
  /// Set when the server certificate failed validation against the provided CA.
  private(set) var trustFailureReason: String?
  /// Set when the server asked for a client certificate but none was configured.
  private(set) var clientCertHint: String?

  init(anchors: [SecCertificate], insecure: Bool, identity: SecIdentity?, clientChain: [SecCertificate] = []) {
    self.anchors = anchors
    self.insecure = insecure
    self.identity = identity
    self.clientChain = clientChain
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
          trustFailureReason = error.map { CFErrorCopyDescription($0) as String }
            ?? "The server certificate could not be validated against the provided cluster CA"
          completionHandler(.cancelAuthenticationChallenge, nil)
        }
        return
      }
      completionHandler(.performDefaultHandling, nil)

    case NSURLAuthenticationMethodClientCertificate:
      if let identity = identity {
        let credential = URLCredential(
          identity: identity,
          certificates: clientChain.isEmpty ? nil : clientChain,
          persistence: .forSession
        )
        completionHandler(.useCredential, credential)
      } else {
        clientCertHint = "the server requested a client certificate, but none was configured"
        completionHandler(.performDefaultHandling, nil)
      }

    default:
      completionHandler(.performDefaultHandling, nil)
    }
  }
}

struct KubeTlsOptions {
  let caPem: String?
  let insecure: Bool
  let clientCertPem: String?
  let clientKeyPem: String?
  let pkcs12: String?
  let pkcs12Password: String?
}

func kubeMakeSession(tls: KubeTlsOptions, timeout: Double) throws -> URLSession {
  var identity: SecIdentity?
  var clientChain: [SecCertificate] = []
  if let certPem = tls.clientCertPem, !certPem.isEmpty,
     let keyPem = tls.clientKeyPem, !keyPem.isEmpty {
    let certificates = kubeParsePemCertificates(certPem)
    guard let leaf = certificates.first else { throw ClientCertError.noCertificate }
    clientChain = Array(certificates.dropFirst())
    let key = try kubeParsePrivateKey(keyPem)
    identity = try kubeMakeIdentity(certificate: leaf, key: key)
  } else {
    identity = try kubeImportIdentity(pkcs12: tls.pkcs12, password: tls.pkcs12Password)
  }

  var anchors: [SecCertificate] = []
  if let pem = tls.caPem, !pem.isEmpty {
    anchors = kubeParsePemCertificates(pem)
    if anchors.isEmpty {
      throw NSError(domain: "KubeHttp", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not parse any certificate from the provided CA PEM data"])
    }
  }
  let delegate = KubeTrustDelegate(anchors: anchors, insecure: tls.insecure, identity: identity, clientChain: clientChain)
  let configuration = URLSessionConfiguration.ephemeral
  configuration.timeoutIntervalForRequest = timeout
  return URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
}

/// Builds a descriptive error message for a failed request, preferring the
/// TLS-level reason captured by the trust delegate over URLSession's generic
/// description (e.g. "cancelled" after a rejected server certificate).
func kubeDescribeFailure(_ error: Error, session: URLSession) -> String {
  guard let delegate = session.delegate as? KubeTrustDelegate else {
    return error.localizedDescription
  }
  if let reason = delegate.trustFailureReason {
    return reason
  }
  if let hint = delegate.clientCertHint {
    return "\(error.localizedDescription) (\(hint))"
  }
  return error.localizedDescription
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
          tls: KubeTlsOptions(
            caPem: options.caPem, insecure: options.insecure,
            clientCertPem: options.clientCertPem, clientKeyPem: options.clientKeyPem,
            pkcs12: options.pkcs12, pkcs12Password: options.pkcs12Password
          ),
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
          promise.reject("ERR_KUBE_NETWORK", kubeDescribeFailure(error, session: session))
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
          tls: KubeTlsOptions(
            caPem: options.caPem, insecure: options.insecure,
            clientCertPem: options.clientCertPem, clientKeyPem: options.clientKeyPem,
            pkcs12: options.pkcs12, pkcs12Password: options.pkcs12Password
          ),
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
          tls: KubeTlsOptions(
            caPem: options.caPem, insecure: options.insecure,
            clientCertPem: options.clientCertPem, clientKeyPem: options.clientKeyPem,
            pkcs12: options.pkcs12, pkcs12Password: options.pkcs12Password
          ),
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
