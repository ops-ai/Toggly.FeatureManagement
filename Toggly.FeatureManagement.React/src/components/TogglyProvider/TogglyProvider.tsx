import React, { ReactNode, useEffect, useState } from 'react'
import { Toggly, TogglyOptions } from '../../services'
import { Provider } from '../../contexts/toggly.context'

export default async function createTogglyProvider(config: TogglyOptions) {
  let owner: Toggly | undefined = new Toggly(config)
  let mounts = 0
  let generation = 0

  const TogglyProvider = ({ children }: { children: ReactNode }) => {
    const [toggly, setToggly] = useState(owner)
    useEffect(() => {
      mounts++
      generation++
      owner ??= new Toggly(config)
      setToggly(owner)
      return () => {
        mounts--
        const released = ++generation
        // StrictMode immediately reattaches effects. Keep that owner alive,
        // but dispose after the last actual unmount without adding a timer.
        void Promise.resolve().then(() => {
          if (mounts === 0 && generation === released) {
            owner?.dispose()
            owner = undefined
          }
        })
      }
    }, [])
    return <Provider value={{ toggly }}>{children}</Provider>
  }

  return TogglyProvider
}
