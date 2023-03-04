import { createContext } from 'react'
import { TogglyService } from '../services'

interface TogglyContext {
  toggly?: TogglyService
}

const context = createContext<TogglyContext>({
  toggly: undefined,
})
const { Provider, Consumer } = context

export { context, Provider, Consumer, TogglyContext }
