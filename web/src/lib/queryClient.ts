import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query'
import { globalToast } from './globalEvents'

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error: any) => {
      console.error('Query Error:', error)
      globalToast.emit(error.message || 'حدث خطأ في تحميل البيانات', 'error')
    }
  }),
  mutationCache: new MutationCache({
    onError: (error: any) => {
      console.error('Mutation Error:', error)
      globalToast.emit(error.message || 'حدث خطأ أثناء حفظ البيانات', 'error')
    }
  }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
