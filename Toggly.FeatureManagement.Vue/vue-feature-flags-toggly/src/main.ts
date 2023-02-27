import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import toggly from './toggly'

const app = createApp(App)

app.config.globalProperties.$toggly = toggly
app.config.globalProperties.$toggly.init(
  'your-app-key', // You can find this in Toggly.io
  'your-environment-name', // You can find this in Toggly.io
  'unique-user-identifier', // Use this in case you want to support custom feature rollouts 
  {
    firstFeature: true,
    secondFeature: false,
  },
)

app.mount('#app')
