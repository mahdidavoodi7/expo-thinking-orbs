// The library is resolved to its TypeScript source by metro.config.js (the
// `expo-thinking-orbs-source` export condition), so Babel just needs the
// Expo preset — which compiles that source and, because
// react-native-worklets is installed, automatically appends the
// react-native-worklets/plugin that transforms every `'worklet'` function
// (the app's and the library's alike).
//
// We intentionally avoid react-native-builder-bob's `getConfig`: its
// path-based `overrides` entry can't be evaluated during Metro's
// filename-less cache-key step, which breaks `expo export`.
module.exports = function (api) {
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],
  };
};
