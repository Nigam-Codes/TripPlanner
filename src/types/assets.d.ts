// Next compiles global stylesheets itself but only ships type declarations for
// CSS *modules*, so a plain side-effect import trips TS2882 without this.
declare module "*.css";
