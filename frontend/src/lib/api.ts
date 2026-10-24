import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// The instance snapshots global defaults at creation, so the login token set on
// axios.defaults never reaches these requests — attach it per-request instead.
function attachToken(config: any) {
  const token = localStorage.getItem('hh_token')
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`
  return config
}

function onUnauthorized(error: any) {
  if (error.response?.status === 401 && !window.location.pathname.startsWith('/login')) {
    localStorage.removeItem('hh_token')
    localStorage.removeItem('hh_user')
    window.location.href = '/login'
  }
  return Promise.reject(error)
}

api.interceptors.request.use(attachToken)
api.interceptors.response.use(r => r, onUnauthorized)
// Some pages call the bare global axios — give it the same behavior.
axios.interceptors.request.use(attachToken)
axios.interceptors.response.use(r => r, onUnauthorized)

/** One level of the location tree: a room (depth 0) or a spot inside one, to any depth.
 *  GET /locations/ returns them in tree order: each room followed by what's inside it. */
export interface Location {
  id: number; name: string; parent_id: number | null; icon?: string | null; description?: string | null
  depth: number
  /** Names from the room down: ['Office', 'Bookshelf', 'Right side'] */
  path: string[]; path_label: string
  /** Items stored at exactly this level / here plus everything inside it */
  item_count: number; total_count: number; child_count: number
}
export interface Category { id: number; name: string; icon?: string; color?: string }
export interface Item {
  id: number; name: string; description?: string
  quantity?: number; unit?: string; author?: string
  track_stock?: boolean; low_stock_threshold?: number
  /** name is the full path ('Office › Bookshelf › Right side'); leaf is this level only */
  location?: { id: number; name: string; leaf?: string; room?: string; room_id?: number; path?: string[] }
  category?: { id: number; name: string; icon?: string; color?: string }
  notes?: string; is_low_stock: boolean
  expiration_date?: string | null; is_expired?: boolean; expires_soon?: boolean
  /** The opened package: with pack_unit, open_amount counts pieces ("1 bagel");
   *  without it, open_amount is a fraction of the package (0.25). null = nothing open. */
  pack_size?: number | null; pack_unit?: string | null; open_amount?: number | null
  open_fraction?: number | null; open_label?: string | null; effective_quantity?: number | null
  created_at: string; updated_at?: string
}
export interface Stats {
  total_items: number; low_stock_count: number
  by_category: { name: string; color?: string; icon?: string; count: number }[]
  recent_activity: { action: string; item: string; by: string; details: string; at: string }[]
}

export const getItems = (params?: Record<string, unknown>) =>
  api.get<Item[]>('/items/', { params }).then(r => r.data)

export const getStats = () => api.get<Stats>('/items/stats').then(r => r.data)
export const getLocations = () => api.get<Location[]>('/locations/').then(r => r.data)
export const getCategories = () => api.get<Category[]>('/categories/').then(r => r.data)

export const createItem = (data: Partial<Item>) =>
  api.post<Item>('/items/', data).then(r => r.data)

export const updateItem = (id: number, data: Partial<Item>) =>
  api.patch<Item>(`/items/${id}`, data).then(r => r.data)

export const deleteLocation = (id: number) =>
  api.delete<{ ok: boolean; moved_items: number; moved_spots: number }>(`/locations/${id}`).then(r => r.data)

/** Native-select label for a location: indented under its parent */
export const locationOptionLabel = (l: Location) => '\u00A0\u00A0\u00A0'.repeat(l.depth) + (l.depth ? '\u2514 ' : '') + l.name

export const deleteItem = (id: number) =>
  api.delete(`/items/${id}`).then(r => r.data)

/** 'one' = take one piece from the open package; 'opened' = the open package is finished */
export const useItem = (id: number, what: 'one' | 'opened') =>
  api.post<Item>(`/items/${id}/use`, { what }).then(r => r.data)

/** Which of Emerald's brains answered; `fallback` means the backup did */
export interface ChatBrain { provider: string; label?: string; model?: string | null; fallback?: boolean }
/** An open "where should this go?" question; answer it with clarifyChat */
export interface ChatPending {
  id: string; type: 'location' | 'confirm'; question: string; items: string[]; options: string[]
  placements?: { item: string; location: string | null }[]
}
export interface ChatResponse { reply: string; action: string; brain?: ChatBrain | null; pending?: ChatPending | null }

const CHAT_SOURCE = 'dashboard'

export const chat = (message: string) =>
  api.post<ChatResponse>('/chat/', { message, source: CHAT_SOURCE }).then(r => r.data)

export const clarifyChat = (pendingId: string, choice: string) =>
  api.post<ChatResponse>('/chat/clarify', { source: CHAT_SOURCE, pending_id: pendingId, choice }).then(r => r.data)

/** One of Emerald's brains, as GET /settings/brain-status reports it */
export interface Brain {
  provider: string; label: string; model: string | null
  /** Codex: signed in. Others: reachable / key saved */
  ready: boolean; detail: string
  /** Epoch seconds: skipped after a failure until then */
  paused_until: number | null
  last_error: string | null
}
export interface BrainStatus { primary: Brain | null; backup: Brain | null; active: 'primary' | 'backup' | null }

export const getBrainStatus = () => api.get<BrainStatus>('/settings/brain-status').then(r => r.data)

export interface CodexLogin {
  status: 'idle' | 'starting' | 'pending' | 'signed_in' | 'error'
  url: string | null; code: string | null; expires_at: number | null; error: string | null
  signed_in?: boolean; detail?: string
}
export const startCodexLogin = () => api.post<CodexLogin>('/settings/codex/login').then(r => r.data)
export const getCodexLogin = () => api.get<CodexLogin>('/settings/codex/login').then(r => r.data)
export const codexLogout = () => api.post('/settings/codex/logout').then(r => r.data)
export const testBrain = (target: 'primary' | 'backup') =>
  api.post<{ ok: boolean; provider?: string; label?: string; reply?: string; error?: string }>(
    `/settings/test-llm?target=${target}`).then(r => r.data)

export const createLocation = (data: { name: string; parent_id?: number | null; icon?: string }) =>
  api.post<Location>('/locations/', data).then(r => r.data)

/** Set move: true to apply parent_id (null makes it a room) */
export const updateLocation = (id: number, data: { name?: string; parent_id?: number | null; move?: boolean; icon?: string; description?: string }) =>
  api.patch<Location>(`/locations/${id}`, data).then(r => r.data)

export const updateCategory = (id: number, data: { name?: string; icon?: string; color?: string }) =>
  api.patch<Category>(`/categories/${id}`, data).then(r => r.data)

export const createCategory = (data: { name: string; icon?: string; color?: string }) =>
  api.post<Category>('/categories/', data).then(r => r.data)

// ---- Calendar ----
export interface CalendarEvent {
  id: number; title: string; description?: string
  start: string; end?: string; all_day: boolean; color?: string
  read_only?: boolean
}

export const getEvents = (start?: string, end?: string) =>
  api.get<CalendarEvent[]>('/calendar/', { params: { start, end } }).then(r => r.data)

export const createEvent = (data: Omit<CalendarEvent, 'id'>) =>
  api.post<CalendarEvent>('/calendar/', data).then(r => r.data)

export const updateEvent = (id: number, data: Partial<CalendarEvent>) =>
  api.patch<CalendarEvent>(`/calendar/${id}`, data).then(r => r.data)

export const deleteEvent = (id: number) =>
  api.delete(`/calendar/${id}`).then(r => r.data)

// ---- Meals ----
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export interface Meal {
  id: number; date: string; meal_type: MealType; title: string; notes?: string
  recipe_id?: number | null
}

export const getMeals = (start?: string, end?: string) =>
  api.get<Meal[]>('/meals/', { params: { start, end } }).then(r => r.data)

export const createMeal = (data: Omit<Meal, 'id'>) =>
  api.post<Meal>('/meals/', data).then(r => r.data)

export const updateMeal = (id: number, data: Partial<Meal>) =>
  api.patch<Meal>(`/meals/${id}`, data).then(r => r.data)

export const deleteMeal = (id: number) =>
  api.delete(`/meals/${id}`).then(r => r.data)

// ---- Chores ----
export interface Chore {
  id: number; title: string; description?: string; icon?: string
  assigned_to?: string; frequency: 'once' | 'daily' | 'weekly' | 'biweekly' | 'monthly'
  day_of_week?: number
  override_active?: boolean; original_assigned_to?: string
  done_this_period: boolean
  last_completed_at?: string; last_completed_by?: string
}

export interface PastChore {
  id: number; chore_id: number; title: string; icon?: string
  frequency: string; completed_at: string; completed_by?: string
}

export const getChores = () => api.get<Chore[]>('/chores/').then(r => r.data)

export const getPastChores = () => api.get<PastChore[]>('/chores/past').then(r => r.data)

export const clearPastChores = () => api.delete('/chores/past').then(r => r.data)

export const updateChore = (id: number, data: { title?: string; icon?: string; assigned_to?: string; frequency?: string; day_of_week?: number }) =>
  api.patch<Chore>(`/chores/${id}`, data).then(r => r.data)

export const deleteChoreCompletion = (completionId: number) =>
  api.delete(`/chores/completions/${completionId}`).then(r => r.data)

export const reassignChore = (id: number, person: string | null, permanent: boolean) =>
  api.post<Chore>(`/chores/${id}/reassign`, { person, permanent }).then(r => r.data)

export const createChore = (data: { title: string; description?: string; icon?: string; assigned_to?: string; frequency?: string; day_of_week?: number }) =>
  api.post<Chore>('/chores/', data).then(r => r.data)

export const completeChore = (id: number, completed_by?: string) =>
  api.post<Chore>(`/chores/${id}/complete`, { completed_by }).then(r => r.data)

export const uncompleteChore = (id: number) =>
  api.post<Chore>(`/chores/${id}/uncomplete`, {}).then(r => r.data)

export const deleteChore = (id: number) =>
  api.delete(`/chores/${id}`).then(r => r.data)

// ---- Family ----
export interface FamilyMember { id: number; name: string; icon?: string; color?: string }

export const getFamily = () => api.get<FamilyMember[]>('/family/').then(r => r.data)

export const createFamilyMember = (data: { name: string; icon?: string; color?: string }) =>
  api.post<FamilyMember>('/family/', data).then(r => r.data)

export const updateFamilyMember = (id: number, data: { name?: string; icon?: string; color?: string }) =>
  api.patch<FamilyMember>(`/family/${id}`, data).then(r => r.data)

export const deleteFamilyMember = (id: number) =>
  api.delete(`/family/${id}`).then(r => r.data)

// ---- Users (admin) ----
export interface AppUser { id: number; username: string; role: 'admin' | 'member' }

export const getUsers = () => api.get<AppUser[]>('/auth/users').then(r => r.data)

export const createUser = (data: { username: string; password: string; role: string }) =>
  api.post<AppUser>('/auth/users', data).then(r => r.data)

export const deleteUser = (id: number) =>
  api.delete(`/auth/users/${id}`).then(r => r.data)

// ---- Recipes ----
export interface PantrySummary { have: number; total: number; missing: string[] }
export interface PantryLine {
  text: string; status: 'have' | 'missing' | 'staple' | 'heading'
  item?: string; location?: string | null
}
export interface RecipeDraft {
  title: string; description?: string | null; servings?: string | null
  prep_minutes?: number | null; cook_minutes?: number | null
  ingredients: string[]; steps: string[]; tags: string[]
  cuisine?: string | null; source_url?: string | null; image_url?: string | null
  notes?: string | null; favorite?: boolean
  /** Import only: 'page' = read from the site's recipe data, 'emerald' = Emerald structured it */
  imported_by?: 'page' | 'emerald'
}
export interface Recipe extends RecipeDraft {
  id: number; total_minutes: number | null; favorite: boolean
  created_by?: string; created_at?: string; updated_at?: string
  deleted_at?: string | null; days_left?: number
  pantry?: PantrySummary
  pantry_lines?: PantryLine[]
  planned?: { id: number; date: string; meal_type: MealType }[]
}
export type RecipeSort = 'recent' | 'title' | 'cookable' | 'quick'

export const getRecipes = (params: { q?: string; tag?: string; sort?: RecipeSort } = {}) =>
  api.get<Recipe[]>('/recipes/', { params }).then(r => r.data)
export const getRecipe = (id: number) => api.get<Recipe>(`/recipes/${id}`).then(r => r.data)
export const createRecipe = (data: RecipeDraft) => api.post<Recipe>('/recipes/', data).then(r => r.data)
export const updateRecipe = (id: number, data: Partial<RecipeDraft>) =>
  api.patch<Recipe>(`/recipes/${id}`, data).then(r => r.data)
export const deleteRecipe = (id: number) => api.delete(`/recipes/${id}`).then(r => r.data)
export const restoreRecipe = (id: number) => api.post<Recipe>(`/recipes/${id}/restore`).then(r => r.data)
export const getRecipeTrash = () => api.get<Recipe[]>('/recipes/trash').then(r => r.data)
export const importRecipe = (data: { url?: string; text?: string }) =>
  api.post<RecipeDraft>('/recipes/import', data).then(r => r.data)
export const planRecipe = (id: number, date: string, meal_type: MealType) =>
  api.post<Meal>(`/recipes/${id}/plan`, { date, meal_type }).then(r => r.data)

/** The server's error message, for toasts */
export const errorText = (e: unknown, fallback = 'Something went wrong') => {
  const err = e as { response?: { data?: { detail?: unknown } }; message?: string }
  const detail = err?.response?.data?.detail
  return typeof detail === 'string' ? detail : err?.message || fallback
}

export default api
