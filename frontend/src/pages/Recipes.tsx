import { Route, Routes } from 'react-router-dom'
import RecipeLibrary from './recipes/RecipeLibrary'
import RecipeDetail from './recipes/RecipeDetail'
import RecipeEditor from './recipes/RecipeEditor'
import RecipeTrash from './recipes/RecipeTrash'

export default function Recipes() {
  return (
    <Routes>
      <Route index element={<RecipeLibrary />} />
      <Route path="new" element={<RecipeEditor />} />
      <Route path="trash" element={<RecipeTrash />} />
      <Route path=":id" element={<RecipeDetail />} />
      <Route path=":id/edit" element={<RecipeEditor />} />
    </Routes>
  )
}
