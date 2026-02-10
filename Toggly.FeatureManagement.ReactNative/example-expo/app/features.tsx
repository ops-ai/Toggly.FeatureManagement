import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import { useFeatureFlag, useFeatureGate, useToggly } from '@ops-ai/react-native-toggly';

// List of all features to display
const FEATURE_KEYS = [
  'welcome-banner',
  'new-checkout',
  'dark-mode',
  'premium-features',
  'experimental-ui',
];

export default function FeaturesScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Individual Feature Flags</Text>
        <Text style={styles.sectionDescription}>
          Each feature flag is evaluated independently
        </Text>
        {FEATURE_KEYS.map((key) => (
          <FeatureFlagItem key={key} featureKey={key} />
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Feature Gates (Multiple Flags)</Text>
        <Text style={styles.sectionDescription}>
          Combine multiple flags with AND/OR logic
        </Text>
        <FeatureGateDemo />
      </View>
    </ScrollView>
  );
}

function FeatureFlagItem({ featureKey }: { featureKey: string }) {
  const { isEnabled, isLoading, error } = useFeatureFlag(featureKey);

  return (
    <View style={styles.featureItem}>
      <View style={styles.featureInfo}>
        <Text style={styles.featureKey}>{featureKey}</Text>
        {error && <Text style={styles.errorText}>Error: {error.message}</Text>}
      </View>
      <View style={styles.featureStatus}>
        {isLoading ? (
          <Text style={styles.loadingText}>Loading...</Text>
        ) : (
          <>
            <Text style={[styles.statusText, isEnabled ? styles.enabledText : styles.disabledText]}>
              {isEnabled ? 'ON' : 'OFF'}
            </Text>
            <Switch
              value={isEnabled}
              disabled={true}
              trackColor={{ false: '#d1d5db', true: '#a5b4fc' }}
              thumbColor={isEnabled ? '#6366f1' : '#f4f3f4'}
            />
          </>
        )}
      </View>
    </View>
  );
}

function FeatureGateDemo() {
  // All flags must be true
  const { isEnabled: allEnabled, isLoading: allLoading } = useFeatureGate(
    ['welcome-banner', 'dark-mode'],
    { requirement: 'all' }
  );

  // At least one flag must be true
  const { isEnabled: anyEnabled, isLoading: anyLoading } = useFeatureGate(
    ['new-checkout', 'premium-features'],
    { requirement: 'any' }
  );

  // None of the flags should be true (negate)
  const { isEnabled: noneEnabled, isLoading: noneLoading } = useFeatureGate(
    ['experimental-ui'],
    { requirement: 'all', negate: true }
  );

  return (
    <View>
      <View style={styles.gateItem}>
        <View style={styles.gateInfo}>
          <Text style={styles.gateName}>All Required</Text>
          <Text style={styles.gateDescription}>
            welcome-banner AND dark-mode
          </Text>
        </View>
        <View style={styles.gateStatus}>
          {allLoading ? (
            <Text style={styles.loadingText}>...</Text>
          ) : (
            <Text style={[styles.gateResult, allEnabled ? styles.enabledText : styles.disabledText]}>
              {allEnabled ? 'PASS' : 'FAIL'}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.gateItem}>
        <View style={styles.gateInfo}>
          <Text style={styles.gateName}>Any Required</Text>
          <Text style={styles.gateDescription}>
            new-checkout OR premium-features
          </Text>
        </View>
        <View style={styles.gateStatus}>
          {anyLoading ? (
            <Text style={styles.loadingText}>...</Text>
          ) : (
            <Text style={[styles.gateResult, anyEnabled ? styles.enabledText : styles.disabledText]}>
              {anyEnabled ? 'PASS' : 'FAIL'}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.gateItem}>
        <View style={styles.gateInfo}>
          <Text style={styles.gateName}>Negated</Text>
          <Text style={styles.gateDescription}>
            NOT experimental-ui
          </Text>
        </View>
        <View style={styles.gateStatus}>
          {noneLoading ? (
            <Text style={styles.loadingText}>...</Text>
          ) : (
            <Text style={[styles.gateResult, noneEnabled ? styles.enabledText : styles.disabledText]}>
              {noneEnabled ? 'PASS' : 'FAIL'}
            </Text>
          )}
        </View>
      </View>
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
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 4,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
  },
  featureItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  featureInfo: {
    flex: 1,
  },
  featureKey: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    fontFamily: 'monospace',
  },
  featureStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  enabledText: {
    color: '#22c55e',
  },
  disabledText: {
    color: '#ef4444',
  },
  loadingText: {
    fontSize: 12,
    color: '#6b7280',
  },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    marginTop: 2,
  },
  gateItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  gateInfo: {
    flex: 1,
  },
  gateName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  gateDescription: {
    fontSize: 12,
    color: '#6b7280',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  gateStatus: {
    marginLeft: 16,
  },
  gateResult: {
    fontSize: 14,
    fontWeight: 'bold',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
