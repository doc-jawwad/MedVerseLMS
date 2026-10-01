/**
 * Unit-test resolve hooks:
 * - no-op `server-only` (Next still enforces at bundle time)
 * - extensionless relative imports → `.ts` (Node ESM + strip-types)
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      shortCircuit: true,
      url: new URL("./server-only.mjs", import.meta.url).href,
    };
  }

  const isRelative =
    specifier.startsWith("./") || specifier.startsWith("../");
  const hasExt = /\.[a-zA-Z0-9]+$/.test(specifier);
  if (isRelative && !hasExt) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // fall through to default resolution
    }
  }

  return nextResolve(specifier, context);
}
