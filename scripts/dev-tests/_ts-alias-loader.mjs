// Minimal Node module-resolution hook so a dev-test can `import` real "@/..." TypeScript source under Node's
// native type stripping, the same way Next.js's tsconfig path alias does at build time. Only rewrites the "@/"
// prefix to this repo's src/ directory and appends ".ts"; everything else resolves normally.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = new URL("../../src/" + specifier.slice(2) + ".ts", import.meta.url);
    return { url: target.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
