Pod::Spec.new do |s|
  s.name           = 'KubeHttp'
  s.version        = '1.0.0'
  s.summary        = 'HTTP client with custom CA trust and mTLS for Kubernetes API servers'
  s.description    = 'Performs HTTPS requests against Kubernetes API servers whose certificates are signed by a cluster-specific CA, with optional PKCS#12 client certificate authentication.'
  s.author         = 'Captain'
  s.homepage       = 'https://github.com/dpfaffenbauer/captain'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/dpfaffenbauer/captain.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
end
