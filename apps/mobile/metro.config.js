// Expo's default config already detects the pnpm workspace: it watches the
// repository root and resolves through the symlinked `node_modules`.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');

// `inlineRem: 16`: react-native-css inlines `rem` at 14 by default, which would
// make `px-5` 17.5pt here and 20px on the web. One rem, both platforms.
module.exports = withNativewind(getDefaultConfig(__dirname), { inlineRem: 16 });
