// Keep shared-page browser cases sequential while giving each case its own local scope.
export async function forEachCase(values, visit) {
  for (const value of values) await visit(value);
}
