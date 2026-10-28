import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'potok-sdk') return {
      url: new URL('./fixtures/sdk.mjs', import.meta.url).href,
      format: 'module',
      shortCircuit: true,
    };
    return nextResolve(specifier, context);
  },
});
