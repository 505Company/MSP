import { RecipeCatalog } from '@/components/recipe-catalog'
import { studioRecipeCatalog } from '@/lib/presentations/studio/recipe-catalog'

export default function Recipes() {
  return <RecipeCatalog collections={studioRecipeCatalog} />
}
