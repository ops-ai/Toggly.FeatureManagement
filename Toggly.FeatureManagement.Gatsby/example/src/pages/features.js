import * as React from 'react';
import {
  useFeatureFlag,
  useFeatureGate,
  useToggly,
  FeatureGate,
} from '@ops-ai/gatsby-feature-flags-toggly';

const FeaturesPage = () => {
  const { flags, isReady, refreshFlags } = useToggly();
  const { isEnabled: premiumEnabled } = useFeatureFlag('premium-content');
  const { isEnabled: gateEnabled } = useFeatureGate(
    ['beta-feature', 'experimental-ui'],
    'any'
  );

  const handleRefresh = async () => {
    await refreshFlags();
    alert('Flags refreshed!');
  };

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Features Demo</h1>

      <nav style={styles.breadcrumb}>
        <a href="/" style={styles.breadcrumbLink}>
          ← Back to Home
        </a>
      </nav>

      <section style={styles.section}>
        <h2>useFeatureFlag Hook</h2>
        <div style={styles.card}>
          <p>
            Premium Content:{' '}
            <strong style={{ color: premiumEnabled ? 'green' : 'red' }}>
              {premiumEnabled ? 'ENABLED' : 'DISABLED'}
            </strong>
          </p>
        </div>
      </section>

      <section style={styles.section}>
        <h2>useFeatureGate Hook</h2>
        <div style={styles.card}>
          <p>Gate: beta-feature OR experimental-ui</p>
          <p>
            Result:{' '}
            <strong style={{ color: gateEnabled ? 'green' : 'red' }}>
              {gateEnabled ? 'ENABLED' : 'DISABLED'}
            </strong>
          </p>
        </div>
      </section>

      <section style={styles.section}>
        <h2>FeatureGate Component</h2>
        <FeatureGate
          flags={['premium-content']}
          fallback={<div style={styles.fallback}>Premium content not available</div>}
        >
          <div style={styles.premium}>
            <h3>🌟 Premium Content</h3>
            <p>This is exclusive premium content!</p>
          </div>
        </FeatureGate>
      </section>

      <section style={styles.section}>
        <h2>useToggly Hook - All Flags</h2>
        <div style={styles.card}>
          {!isReady ? (
            <p>Loading...</p>
          ) : (
            <>
              <pre style={styles.pre}>{JSON.stringify(flags, null, 2)}</pre>
              <button onClick={handleRefresh} style={styles.button}>
                Refresh Flags
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  );
};

const styles = {
  main: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    maxWidth: '800px',
    margin: '0 auto',
    padding: '2rem',
  },
  title: {
    color: '#333',
    marginBottom: '1rem',
  },
  breadcrumb: {
    marginBottom: '2rem',
  },
  breadcrumbLink: {
    color: '#007bff',
    textDecoration: 'none',
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
  premium: {
    border: '2px solid gold',
    borderRadius: '8px',
    padding: '1.5rem',
    backgroundColor: '#fff8dc',
  },
  fallback: {
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '1.5rem',
    backgroundColor: '#f8f9fa',
    color: '#666',
  },
  pre: {
    background: '#282c34',
    color: '#abb2bf',
    padding: '1rem',
    borderRadius: '4px',
    overflow: 'auto',
    fontSize: '0.9rem',
  },
  button: {
    marginTop: '1rem',
    padding: '0.5rem 1rem',
    background: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
  },
};

export default FeaturesPage;

export const Head = () => <title>Features - Toggly Gatsby Example</title>;
