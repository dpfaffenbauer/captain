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
  // base64-encoded PKCS#12 bundle for client certificate auth
  @Field var pkcs12: String? = nil
  @Field var pkcs12Password: String? = nil
  @Field var timeoutMs: Double = 30000
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
      if let p12b64 = options.pkcs12, !p12b64.isEmpty {
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

      let delegate = KubeTrustDelegate(anchors: anchors, insecure: options.insecure, identity: identity)
      let configuration = URLSessionConfiguration.ephemeral
      configuration.timeoutIntervalForRequest = options.timeoutMs / 1000.0
      let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)

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
