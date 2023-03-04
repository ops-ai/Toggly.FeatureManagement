import React from 'react'
import logo from './logo.svg'
import './App.css'
import { Feature } from '@ops-ai/react-feature-flags-toggly'

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <Feature featureKey={'firstFeature'} requirement={'all'} negate={false}>
          <img src={logo} className="App-logo" alt="logo" />
        </Feature>
        <p>
          Edit <code>src/App.tsx</code> and save to reload.
        </p>
        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn React
        </a>
      </header>
    </div>
  )
}

export default App
