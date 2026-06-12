/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'app-intent',
  name: 'CaptainIntents',
  deploymentTarget: '17.0',
  entitlements: {
    'com.apple.security.application-groups': ['group.at.pfaffenbauer.captain'],
  },
});
