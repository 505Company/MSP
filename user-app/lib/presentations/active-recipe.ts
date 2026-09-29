export type GenerationRecipe = 'layout-engine-v1' | 'accepted-10-v1'

// Rollback changes this selection only; both engines keep their own saved runs.
export function activeRecipe(): GenerationRecipe {
  return 'layout-engine-v1'
}
