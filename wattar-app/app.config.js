module.exports = ({ config }) => ({
  ...config,
  plugins: [...(config.plugins ?? []), 'expo-video', 'expo-audio', 'expo-font', './plugins/withLiveKitAndroidSetup'],
});
