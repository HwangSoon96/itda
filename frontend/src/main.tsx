import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import './index.css'
import './app/styles/shell.css'

// 해시 없이 열린 첫 주소(http://127.0.0.1:8000)도 기록 화면으로 시작한다.
if (!location.hash) history.replaceState(null, '', `${location.pathname}${location.search}#record`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
