// Expo's default config already detects the pnpm workspace: it watches the
// repository root and resolves through the symlinked `node_modules`.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

/*
 * One copy of each of these in the bundle, this app's.
 *
 * pnpm gives a workspace package its own peer-resolved copy of a dependency,
 * so `@reach/ui-native` can reach a second `react-native-css` whenever any peer
 * differs by a patch version (lightningcss did). That is not a harmless
 * duplicate: react-native-css's resolver only recognises its *own* files as
 * internal, rewrites the other copy's `react-native` import back to itself, and
 * the app dies on start with "Maximum call stack size exceeded" in
 * `get Dimensions`. Resolving these from the app root makes the copy count one.
 */
// The native-module packages are here for a second reason: two copies of one
// register the same native view twice, which fails at start-up.
//
// From every importer, third-party packages included. The repository holds
// two `react-native` copies (one per React the workspace uses: the app's
// 19.2.3 and Storybook's 19.3), and a library such as lucide-react-native or
// @rn-primitives/portal resolved its peer to the other one: the same stack
// overflow, reached through `node_modules` instead of workspace source.
const SINGLETONS =
  /^(react|react-native|react-native-css|nativewind|react-native-reanimated|react-native-worklets|react-native-gesture-handler|react-native-safe-area-context|react-native-svg|expo-clipboard|react-native-webview|@10play\/tentap-editor|@shopify\/flash-list)(\/|$)/;
const appRoot = `${__dirname}/package.json`;
config.resolver.resolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(
    SINGLETONS.test(moduleName) ? { ...context, originModulePath: appRoot } : context,
    moduleName,
    platform,
  );

// `inlineRem: 16`: react-native-css inlines `rem` at 14 by default, which would
// make `px-5` 17.5pt here and 20px on the web. One rem, both platforms.
module.exports = withNativewind(config, { inlineRem: 16 });
