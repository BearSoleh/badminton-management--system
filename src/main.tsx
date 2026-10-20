import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import '@fontsource-variable/manrope'
import './styles.css'
import { AppRouter } from './app/router'

createRoot(document.getElementById('root')!).render(<StrictMode><AppRouter /></StrictMode>)
