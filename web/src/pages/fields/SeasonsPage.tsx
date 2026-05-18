import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function SeasonsPage() {
  const navigate = useNavigate()
  useEffect(() => { navigate('/fields', { replace: true }) }, [navigate])
  return null
}
