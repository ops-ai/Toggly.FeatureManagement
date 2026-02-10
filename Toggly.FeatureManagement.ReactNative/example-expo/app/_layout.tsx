import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { TogglyProvider } from '@ops-ai/react-native-toggly';
import { createAsyncStorageAdapter } from '@ops-ai/react-native-toggly-storage-async';
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';

// Create storage adapter for persistent caching
const storage = createAsyncStorageAdapter();

// Default feature flags (used when offline or before Toggly loads)
const featureDefaults = {
  'welcome-banner': true,
  'new-checkout': false,
  'dark-mode': true,
  'premium-features': false,
  'experimental-ui': false,
};

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const handleReady = useCallback(() => {
    console.log('Toggly is ready!');
    setIsReady(true);
  }, []);

  const handleError = useCallback((err: Error) => {
    console.error('Toggly error:', err);
    setError(err);
    // Still mark as ready so the app can use defaults
    setIsReady(true);
  }, []);

  const handleFlagsChanged = useCallback((flags: Record<string, boolean>) => {
    console.log('Feature flags updated:', flags);
  }, []);

  return (
    <TogglyProvider
      // Replace with your Toggly.io credentials
      // appKey="your-app-key"
      // environment="production"
      featureDefaults={featureDefaults}
      storage={storage}
      refreshInterval={60000} // Refresh every 60 seconds
      onReady={handleReady}
      onError={handleError}
      onFlagsChanged={handleFlagsChanged}
    >
      <StatusBar style="auto" />
      {!isReady ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading feature flags...</Text>
        </View>
      ) : (
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#6366f1' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: 'bold' },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Toggly Demo' }} />
          <Stack.Screen name="features" options={{ title: 'Feature Flags' }} />
          <Stack.Screen name="hooks" options={{ title: 'Hooks Demo' }} />
        </Stack>
      )}
    </TogglyProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
});
