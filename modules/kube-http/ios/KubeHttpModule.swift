import CryptoKit
import ExpoModulesCore
import Foundation
import Security

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

public class KubeHttpModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KubeHttp")

    AsyncFunction("request") { (options: KubeRequestOptions, promise: Promise) in
      guard let url = URL(string: options.url) else {
        promise.reject("ERR_KUBE_URL", "Invalid URL: \(options.url)")
        return
      }

      var identity: SecIdentity? = nil
      var clientChain: [SecCertificate] = []
      if let certPem = options.clientCertPem, !certPem.isEmpty,
         let keyPem = options.clientKeyPem, !keyPem.isEmpty {
        do {
          let certificates = KubeHttpModule.parsePemCertificates(certPem)
          guard let leaf = certificates.first else { throw ClientCertError.noCertificate }
          clientChain = Array(certificates.dropFirst())
          let key = try KubeHttpModule.parsePrivateKey(keyPem)
          identity = try KubeHttpModule.makeIdentity(certificate: leaf, key: key)
        } catch {
          promise.reject("ERR_KUBE_CLIENT_CERT", error.localizedDescription)
          return
        }
      } else if let p12b64 = options.pkcs12, !p12b64.isEmpty {
        guard let p12data = Data(base64Encoded: p12b64, options: .ignoreUnknownCharacters) else {
          promise.reject("ERR_KUBE_P12", "Client certificate is not valid base64-encoded PKCS#12 data")
          return
        }
        let importOptions: [String: Any] = [kSecImportExportPassphrase as String: options.pkcs12Password ?? ""]
        var items: CFArray?
        let status = SecPKCS12Import(p12data as CFData, importOptions as CFDictionary, &items)
        guard status == errSecSuccess,
              let first = (items as? [[String: Any]])?.first,
              let rawIdentity = first[kSecImportItemIdentity as String] else {
          promise.reject("ERR_KUBE_P12", "Could not import PKCS#12 client certificate (status \(status)). Check the password.")
          return
        }
        identity = (rawIdentity as! SecIdentity)
      }

      var anchors: [SecCertificate] = []
      if let pem = options.caPem, !pem.isEmpty {
        anchors = KubeHttpModule.parsePemCertificates(pem)
        if anchors.isEmpty {
          promise.reject("ERR_KUBE_CA", "Could not parse any certificate from the provided CA PEM data")
          return
        }
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

      let delegate = KubeTrustDelegate(
        anchors: anchors,
        insecure: options.insecure,
        identity: identity,
        clientChain: clientChain
      )
      let configuration = URLSessionConfiguration.ephemeral
      configuration.timeoutIntervalForRequest = options.timeoutMs / 1000.0
      let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)

      let task = session.dataTask(with: request) { data, response, error in
        defer { session.finishTasksAndInvalidate() }
        if let error = error {
          if let reason = delegate.trustFailureReason {
            promise.reject("ERR_KUBE_TLS", reason)
          } else if let hint = delegate.clientCertHint {
            promise.reject("ERR_KUBE_NETWORK", "\(error.localizedDescription) (\(hint))")
          } else {
            promise.reject("ERR_KUBE_NETWORK", error.localizedDescription)
          }
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
  }

  static func parsePemCertificates(_ pem: String) -> [SecCertificate] {
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

  // MARK: - Client identity from PEM certificate + key

  /// Extracts the DER payload of the first PEM block with one of the given labels.
  static func pemBlock(_ pem: String, labels: [String]) -> Data? {
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

  /// Parses a PEM private key (PKCS#1 RSA, SEC1 EC, or unencrypted PKCS#8) into a SecKey.
  static func parsePrivateKey(_ pem: String) throws -> SecKey {
    if pem.contains("ENCRYPTED") {
      throw ClientCertError.encryptedKey
    }
    if let der = pemBlock(pem, labels: ["RSA PRIVATE KEY"]) {
      return try createKey(der, type: kSecAttrKeyTypeRSA)
    }
    if let der = pemBlock(pem, labels: ["EC PRIVATE KEY"]) {
      return try createKey(x963FromSec1(der), type: kSecAttrKeyTypeECSECPrimeRandom)
    }
    if let der = pemBlock(pem, labels: ["PRIVATE KEY"]) {
      return try parsePkcs8(der)
    }
    throw ClientCertError.unsupportedKey("no PEM private key block found")
  }

  private static func createKey(_ keyData: Data, type: CFString) throws -> SecKey {
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

  private static let rsaOid: [UInt8] = [0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01]
  private static let ecOid: [UInt8] = [0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01]

  /// PKCS#8 PrivateKeyInfo ::= SEQUENCE { version, AlgorithmIdentifier, privateKey OCTET STRING }
  private static func parsePkcs8(_ der: Data) throws -> SecKey {
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
    if [UInt8](oid.value) == rsaOid {
      return try createKey(keyOctets.value, type: kSecAttrKeyTypeRSA)
    }
    if [UInt8](oid.value) == ecOid {
      return try createKey(x963FromSec1(keyOctets.value), type: kSecAttrKeyTypeECSECPrimeRandom)
    }
    throw ClientCertError.unsupportedKey("unsupported key algorithm (only RSA and EC are supported)")
  }

  /// Converts a SEC1 ECPrivateKey (RFC 5915) into the X9.63 representation
  /// (04 || X || Y || K) that SecKeyCreateWithData expects for EC keys.
  private static func x963FromSec1(_ der: Data) throws -> Data {
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

  /// Pairs the certificate and key in the keychain to obtain a SecIdentity —
  /// the only public way to build one without going through PKCS#12.
  static func makeIdentity(certificate: SecCertificate, key: SecKey) throws -> SecIdentity {
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
}

/// Minimal DER tag-length-value reader; enough for the key structures above.
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
