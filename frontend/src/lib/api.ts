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

export interface Location { id: number; name: string; sublocation?: string; description?: string; item_count: number }
export interface Category { id: number; name: string; icon?: string; color?: string }
export interface Item {
  id: number; name: string; description?: string
  quantity?: number; unit?: string; author?: string; low_stock_threshold?: number
  location?: { id: number; name: string; sublocation?: string }
  category?: { id: number; name: string; icon?: string; color?: string }
  notes?: string; is_low_stock: boolean
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

export const deleteItem = (id: number) =>
  api.delete(`/items/${id}`).then(r => r.data)

export const chat = (message: string) =>
  api.post<{ reply: string; action: string }>('/chat/', { message, source: 'dashboard' }).then(r => r.data)

export const createLocation = (data: { name: string; sublocation?: string }) =>
  api.post<Location>('/locations/', data).then(r => r.data)

export const updateLocation = (id: number, data: { name?: string; sublocation?: string; description?: string }) =>
  api.patch<Location>(`/locations/${id}`, data).then(r => r.data)

export const createCategory = (data: { name: string; icon?: string; color?: string }) =>
  api.post<Category>('/categories/', data).then(r => r.data)

// ---- Calendar ----
export interface CalendarEvent {
  id: number; title: string; description?: string
  start: string; end?: string; all_day: boolean; color?: string
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
  id: number; title: string; description?: string
  assigned_to?: string; frequency: 'once' | 'daily' | 'weekly' | 'monthly'
  day_of_week?: number
  done_this_period: boolean
  last_completed_at?: string; last_completed_by?: string
}

export const getChores = () => api.get<Chore[]>('/chores/').then(r => r.data)

export const createChore = (data: { title: string; description?: string; assigned_to?: string; frequency?: string; day_of_week?: number }) =>
  api.post<Chore>('/chores/', data).then(r => r.data)

export const completeChore = (id: number, completed_by?: string) =>
  api.post<Chore>(`/chores/${id}/complete`, { completed_by }).then(r => r.data)

export const uncompleteChore = (id: number) =>
  api.post<Chore>(`/chores/${id}/uncomplete`, {}).then(r => r.data)

export const deleteChore = (id: number) =>
  api.delete(`/chores/${id}`).then(r => r.data)

export default api
