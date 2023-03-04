import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import reportWebVitals from './reportWebVitals'
import { createTogglyProvider } from '@ops-ai/react-feature-flags-toggly'

;(async () => {
  const featureDefaults = {
    mainDescription: true,
    documentationItem: true,
    toolingItem: true,
  }

  const TogglyProvider = await createTogglyProvider({
    appKey: 'your-app-key', // You can find this in Toggly.io
    environment: 'your-environment-name', // You can find this in Toggly.io
    identity: 'unique-user-identifier', // Use this in case you want to support custom feature rollouts
    featureDefaults: featureDefaults,
  })

  const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement,
  )
  root.render(
    <React.StrictMode>
      <TogglyProvider>
        <App />
      </TogglyProvider>
    </React.StrictMode>,
  )
})()

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()
