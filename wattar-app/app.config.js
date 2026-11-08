module.exports = ({ config }) => ({
  ...config,
  plugins: [...(config.plugins ?? []), 'expo-video', './plugins/withLiveKitAndroidSetup'],
});
