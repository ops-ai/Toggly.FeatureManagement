import { Link } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Feature, useToggly, useFeatureFlag } from '@ops-ai/react-native-toggly';
import { useState, useCallback } from 'react';

export default function HomeScreen() {
  const { isReady, refresh, setIdentity } = useToggly();
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const handleLogin = useCallback(async () => {
    const newUserId = `user-${Date.now()}`;
    await setIdentity(newUserId);
    setUserId(newUserId);
  }, [setIdentity]);

  const handleLogout = useCallback(async () => {
    await setIdentity(null);
    setUserId(null);
  }, [setIdentity]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Welcome Banner - Feature Flag */}
      <Feature featureKey="welcome-banner">
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Welcome to Toggly React Native SDK!
          </Text>
          <Text style={styles.bannerSubtext}>
            Pull down to refresh feature flags
          </Text>
        </View>
      </Feature>

      {/* Status Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>SDK Status</Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Ready:</Text>
          <Text style={[styles.statusValue, { color: isReady ? '#22c55e' : '#ef4444' }]}>
            {isReady ? 'Yes' : 'No'}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>User ID:</Text>
          <Text style={styles.statusValue}>
            {userId || 'Anonymous'}
          </Text>
        </View>
      </View>

      {/* Identity Controls */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>User Identity</Text>
        <Text style={styles.cardDescription}>
          Set a user identity to enable targeted feature rollouts
        </Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleLogin}
          >
            <Text style={styles.buttonText}>Login</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={handleLogout}
          >
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>
              Logout
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Feature Flag Demo */}
      <FeatureFlagDemo />

      {/* Navigation Links */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Explore More</Text>
        <Link href="/features" asChild>
          <TouchableOpacity style={styles.navLink}>
            <Text style={styles.navLinkText}>View All Features</Text>
            <Text style={styles.navLinkArrow}>→</Text>
          </TouchableOpacity>
        </Link>
        <Link href="/hooks" asChild>
          <TouchableOpacity style={styles.navLink}>
            <Text style={styles.navLinkText}>Hooks Demo</Text>
            <Text style={styles.navLinkArrow}>→</Text>
          </TouchableOpacity>
        </Link>
      </View>
    </ScrollView>
  );
}

function FeatureFlagDemo() {
  const { isEnabled: hasNewCheckout, isLoading: checkoutLoading } =
    useFeatureFlag('new-checkout');
  const { isEnabled: hasPremium } = useFeatureFlag('premium-features');

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Feature Flag Demo</Text>

      {/* Checkout Feature */}
      <View style={styles.featureDemo}>
        <Text style={styles.featureLabel}>Checkout Experience:</Text>
        {checkoutLoading ? (
          <Text style={styles.featureValue}>Loading...</Text>
        ) : hasNewCheckout ? (
          <View style={styles.featureTag}>
            <Text style={styles.featureTagText}>New Checkout</Text>
          </View>
        ) : (
          <View style={[styles.featureTag, styles.featureTagOld]}>
            <Text style={styles.featureTagText}>Classic Checkout</Text>
          </View>
        )}
      </View>

      {/* Premium Features */}
      <View style={styles.featureDemo}>
        <Text style={styles.featureLabel}>Premium Status:</Text>
        {hasPremium ? (
          <View style={[styles.featureTag, styles.featureTagPremium]}>
            <Text style={styles.featureTagText}>Premium</Text>
          </View>
        ) : (
          <View style={[styles.featureTag, styles.featureTagFree]}>
            <Text style={styles.featureTagText}>Free</Text>
          </View>
        )}
      </View>

      {/* Experimental UI - using Feature component */}
      <Feature
        featureKey="experimental-ui"
        fallback={
          <View style={styles.featureDemo}>
            <Text style={styles.featureLabel}>Experimental UI:</Text>
            <Text style={styles.featureValue}>Disabled</Text>
          </View>
        }
      >
        <View style={styles.featureDemo}>
          <Text style={styles.featureLabel}>Experimental UI:</Text>
          <View style={[styles.featureTag, styles.featureTagExperimental]}>
            <Text style={styles.featureTagText}>Enabled!</Text>
          </View>
        </View>
      </Feature>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  banner: {
    backgroundColor: '#6366f1',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
  },
  bannerText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  bannerSubtext: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 12,
  },
  cardDescription: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  statusLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#6366f1',
  },
  secondaryButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryButtonText: {
    color: '#374151',
  },
  featureDemo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  featureLabel: {
    fontSize: 14,
    color: '#374151',
  },
  featureValue: {
    fontSize: 14,
    color: '#6b7280',
  },
  featureTag: {
    backgroundColor: '#22c55e',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  featureTagOld: {
    backgroundColor: '#6b7280',
  },
  featureTagPremium: {
    backgroundColor: '#f59e0b',
  },
  featureTagFree: {
    backgroundColor: '#3b82f6',
  },
  featureTagExperimental: {
    backgroundColor: '#8b5cf6',
  },
  featureTagText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  navLink: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  navLinkText: {
    fontSize: 16,
    color: '#6366f1',
  },
  navLinkArrow: {
    fontSize: 18,
    color: '#6366f1',
  },
});
