/** esbuild inlines PNGs as data URLs (see esbuild.config.mjs). */
declare module "*.png" {
  const src: string;
  export default src;
}
