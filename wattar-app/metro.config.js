const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.alias = {
  ...config.resolver.alias,
  '@': path.resolve(__dirname, './src'),
  '@wattar/shared': path.resolve(__dirname, '../wattar-shared/src'),
};

// دعم WebRTC (مطلوب لـ LiveKit)
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'react-native-webrtc': require.resolve('@livekit/react-native-webrtc'),
};

module.exports = config;
