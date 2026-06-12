/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'CaptainWidget',
  deploymentTarget: '17.0',
  colors: {
    $widgetBackground: '#0F1420',
    $accent: '#5B7CFF',
  },
  entitlements: {
    'com.apple.security.application-groups': ['group.at.pfaffenbauer.captain'],
  },
});
