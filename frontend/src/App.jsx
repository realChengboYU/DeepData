import { ConfigProvider } from 'antd'
import { Routes, Route, Navigate } from 'react-router-dom'
import { antdThemeFor } from './theme'
import { useThemeStore } from './store/theme'
import { I18nProvider } from './i18n'
import Login from './pages/Login'
import Chat from './pages/Chat'

export default function App() {
  const theme = useThemeStore((s) => s.theme)
  const antdTheme = antdThemeFor(theme === 'dark')
  return (
    <ConfigProvider theme={antdTheme}>
      <I18nProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </I18nProvider>
    </ConfigProvider>
  )
}
