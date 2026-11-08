const { withAppBuildGradle, withProjectBuildGradle } = require('expo/config-plugins');

const GOOGLE_SERVICES_CLASSPATH = 'com.google.gms:google-services:4.4.2';
const GOOGLE_SERVICES_PLUGIN = 'com.google.gms.google-services';

const withFirebaseAndroidSetup = (config) => {
  if (!config.android?.googleServicesFile) return config;

  config = withProjectBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes(GOOGLE_SERVICES_CLASSPATH)) {
      const dependenciesBlock = contents.match(/buildscript\s*\{[\s\S]*?^\s*dependencies\s*\{/m);
      if (!dependenciesBlock) {
        throw new Error('Could not find buildscript dependencies in android/build.gradle.');
      }

      contents = contents.replace(
        dependenciesBlock[0],
        `${dependenciesBlock[0]}\n        classpath("${GOOGLE_SERVICES_CLASSPATH}")`,
      );
    }

    config.modResults.contents = contents;
    return config;
  });

  config = withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes(GOOGLE_SERVICES_PLUGIN)) {
      const reactPlugin = /^apply plugin: ["']com\.facebook\.react["']\s*$/m;
      if (!reactPlugin.test(contents)) {
        throw new Error('Could not find the React Native plugin in android/app/build.gradle.');
      }

      contents = contents.replace(
        reactPlugin,
        `$&\napply plugin: "${GOOGLE_SERVICES_PLUGIN}"`,
      );
    }

    config.modResults.contents = contents;
    return config;
  });

  return config;
};

module.exports = withFirebaseAndroidSetup;
