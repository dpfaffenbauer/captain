Pod::Spec.new do |s|
  s.name           = 'CaptainWidget'
  s.version        = '1.0.0'
  s.summary        = 'Bridge that shares cluster health snapshots with the home-screen widget'
  s.description    = 'Writes the multi-cluster health snapshot into the shared app group container and reloads the WidgetKit timelines.'
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
