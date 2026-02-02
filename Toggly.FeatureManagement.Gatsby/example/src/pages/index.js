import * as React from 'react';
import { Feature, useFeatureFlag } from '@ops-ai/gatsby-feature-flags-toggly';

const IndexPage = () => {
  const { isEnabled, isReady, error } = useFeatureFlag('new-dashboard');

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Toggly Gatsby Example</h1>

      <section style={styles.section}>
        <h2>1. Using Hooks</h2>
        <div style={styles.card}>
          <h3>useFeatureFlag Hook</h3>
          {!isReady ? (
            <p>Loading flags...</p>
          ) : error ? (
            <p style={styles.error}>Error: {error.message}</p>
          ) : (
            <p>
              Feature "new-dashboard" is:{' '}
              <strong style={{ color: isEnabled ? 'green' : 'red' }}>
                {isEnabled ? 'ENABLED' : 'DISABLED'}
              </strong>
            </p>
          )}
        </div>
      </section>

      <section style={styles.section}>
        <h2>2. Using Components</h2>
        <div style={styles.card}>
          <h3>Feature Component</h3>
          <Feature flag="beta-feature" fallback={<BetaDisabled />}>
            <BetaEnabled />
          </Feature>
        </div>
      </section>

      <section style={styles.section}>
        <h2>3. Navigation</h2>
        <nav style={styles.nav}>
          <a href="/features" style={styles.link}>
            Features Demo →
          </a>
          <a href="/beta" style={styles.link}>
            Beta Page (gated) →
          </a>
        </nav>
      </section>
    </main>
  );
};

const BetaEnabled = () => (
  <div style={{ padding: '1rem', background: '#d4edda', borderRadius: '4px' }}>
    <p style={{ margin: 0 }}>🎉 Beta feature is enabled!</p>
  </div>
);

const BetaDisabled = () => (
  <div style={{ padding: '1rem', background: '#f8d7da', borderRadius: '4px' }}>
    <p style={{ margin: 0 }}>❌ Beta feature is disabled</p>
  </div>
);

const styles = {
  main: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    maxWidth: '800px',
    margin: '0 auto',
    padding: '2rem',
  },
  title: {
    color: '#333',
    marginBottom: '2rem',
  },
  section: {
    marginBottom: '3rem',
  },
  card: {
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '1.5rem',
    backgroundColor: '#f9f9f9',
  },
  error: {
    color: 'red',
  },
  nav: {
    display: 'flex',
    gap: '1rem',
    flexDirection: 'column',
  },
  link: {
    display: 'inline-block',
    padding: '0.75rem 1.5rem',
    background: '#007bff',
    color: 'white',
    textDecoration: 'none',
    borderRadius: '4px',
    textAlign: 'center',
  },
};

export default IndexPage;

export const Head = () => <title>Home - Toggly Gatsby Example</title>;
