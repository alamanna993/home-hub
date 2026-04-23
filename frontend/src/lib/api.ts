import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export interface Location { id: number; name: string; sublocation?: string; item_count: number }
export interface Category { id: number; name: string; icon?: string; color?: string }
export interface Item {
  id: number; name: string; description?: string
  quantity?: number; unit?: string; low_stock_threshold?: number
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

export const createCategory = (data: { name: string; icon?: string; color?: string }) =>
  api.post<Category>('/categories/', data).then(r => r.data)

export default api
