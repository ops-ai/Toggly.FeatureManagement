import React, { ReactNode } from 'react'
import { Toggly, TogglyOptions } from '../../services'
import { Provider } from '../../contexts/toggly.context'

export default async function createTogglyProvider(config: TogglyOptions) {
  const toggly = new Toggly(config)

  const TogglyProvider = ({ children }: { children: ReactNode }) => {
    return <Provider value={{ toggly }}>{children}</Provider>
  }

  return TogglyProvider
}
