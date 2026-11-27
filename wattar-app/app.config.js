module.exports = ({ config }) => ({
  ...config,
  plugins: [...(config.plugins ?? []), 'expo-video', 'expo-audio', './plugins/withLiveKitAndroidSetup'],
});
