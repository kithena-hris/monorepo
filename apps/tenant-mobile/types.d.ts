/** Metro resolves CSS imports; TypeScript needs telling that they exist. */
declare module '*.css';

/** Metro bundles a font as an asset and hands back its id, for `expo-font`. */
declare module '*.ttf' {
  const asset: number;
  export default asset;
}
