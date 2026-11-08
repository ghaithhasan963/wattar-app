const { withAppBuildGradle, withMainApplication } = require('expo/config-plugins');

const withLiveKitAndroidSetup = (config) => {
  config = withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    const architectureFilters =
      'if (project.findProperty("reactNativeArchitectures")) {\n' +
      '            ndk {\n' +
      '                abiFilters(*project.property("reactNativeArchitectures").split(","))\n' +
      '            }\n' +
      '        }';

    if (!contents.includes('abiFilters(*project.property("reactNativeArchitectures").split(","))')) {
      const defaultConfig = /(\s+defaultConfig\s*\{\r?\n)/;
      if (!defaultConfig.test(contents)) {
        throw new Error('Could not find defaultConfig in android/app/build.gradle.');
      }
      contents = contents.replace(defaultConfig, `$1        ${architectureFilters}\n`);
    }

    config.modResults.contents = contents;
    return config;
  });

  return withMainApplication(config, (config) => {
    if (config.modResults.language !== 'kt') {
      throw new Error('LiveKit Android setup expects MainApplication.kt.');
    }

    let contents = config.modResults.contents;

    if (!contents.includes('import com.livekit.reactnative.LiveKitReactNative')) {
      contents = contents.replace(
        /^(package [^\r\n]+\r?\n)/,
        '$1\nimport com.livekit.reactnative.LiveKitReactNative\nimport com.livekit.reactnative.audio.AudioType\n',
      );
    }

    if (!contents.includes('LiveKitReactNative.setup(this')) {
      const onCreate = /(\s+super\.onCreate\(\)\r?\n)/;
      if (!onCreate.test(contents)) {
        throw new Error('Could not find Application.onCreate() in MainApplication.kt.');
      }
      contents = contents.replace(
        onCreate,
        '$1    LiveKitReactNative.setup(this, AudioType.CommunicationAudioType())\n',
      );
    }

    config.modResults.contents = contents;
    return config;
  });
};

module.exports = withLiveKitAndroidSetup;
