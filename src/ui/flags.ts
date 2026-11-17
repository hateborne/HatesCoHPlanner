// written in by vite.config.ts's define (HCP_SET_FINDER=1 at build time); missing where Vite doesn't
// compile the code, hence the typeof check
declare const __HCP_SET_FINDER__: boolean | undefined;

// Whether the set finder's button shows. It is still being built: on in a dev server (`npm run
// dev`, the browser tests), off in a production build unless the build asks for it, so a deploy
// never shows it by accident.
export const SET_FINDER: boolean = import.meta.env.DEV || (typeof __HCP_SET_FINDER__ === 'boolean' && __HCP_SET_FINDER__);
