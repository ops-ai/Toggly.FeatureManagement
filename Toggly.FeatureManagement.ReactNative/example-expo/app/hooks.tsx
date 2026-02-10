import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useToggly } from '@ops-ai/react-native-toggly';
import type { Hook } from '@ops-ai/toggly-hooks-types';

interface LogEntry {
  id: string;
  timestamp: Date;
  type: 'evaluation' | 'identify' | 'refresh';
  message: string;
}

export default function HooksScreen() {
  const { toggly, isFeatureOn, setIdentity, refresh } = useToggly();
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Register a logging hook
  useEffect(() => {
    const loggingHook: Hook = {
      getMetadata: () => ({
        name: 'LoggingHook',
        version: '1.0.0',
      }),

      afterEvaluation: async (data) => {
        const entry: LogEntry = {
          id: `${Date.now()}-eval`,
          timestamp: new Date(),
          type: 'evaluation',
          message: `Feature "${data.featureKey}" evaluated to ${data.result}`,
        };
        setLogs((prev) => [entry, ...prev].slice(0, 20));
      },

      afterIdentify: async (data) => {
        const entry: LogEntry = {
          id: `${Date.now()}-id`,
          timestamp: new Date(),
          type: 'identify',
          message: data.userId
            ? `User identified as "${data.userId}"`
            : 'User identity cleared',
        };
        setLogs((prev) => [entry, ...prev].slice(0, 20));
      },

      afterRefresh: async () => {
        const entry: LogEntry = {
          id: `${Date.now()}-refresh`,
          timestamp: new Date(),
          type: 'refresh',
          message: 'Feature flags refreshed',
        };
        setLogs((prev) => [entry, ...prev].slice(0, 20));
      },
    };

    toggly.addHook(loggingHook);

    return () => {
      toggly.removeHook(loggingHook);
    };
  }, [toggly]);

  const triggerEvaluation = () => {
    isFeatureOn('welcome-banner');
    isFeatureOn('new-checkout');
    isFeatureOn('premium-features');
  };

  const triggerIdentify = async () => {
    await setIdentity(`user-${Date.now()}`);
  };

  const triggerRefresh = async () => {
    await refresh();
  };

  const clearLogs = () => {
    setLogs([]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Hook System Demo</Text>
        <Text style={styles.sectionDescription}>
          Hooks let you execute custom code at specific points in the feature
          flag lifecycle. This demo shows a logging hook in action.
        </Text>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.evalButton]}
            onPress={triggerEvaluation}
          >
            <Text style={styles.buttonText}>Evaluate</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.identifyButton]}
            onPress={triggerIdentify}
          >
            <Text style={styles.buttonText}>Identify</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.refreshButton]}
            onPress={triggerRefresh}
          >
            <Text style={styles.buttonText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.logHeader}>
          <Text style={styles.sectionTitle}>Event Log</Text>
          <TouchableOpacity onPress={clearLogs}>
            <Text style={styles.clearButton}>Clear</Text>
          </TouchableOpacity>
        </View>

        {logs.length === 0 ? (
          <Text style={styles.emptyText}>
            No events yet. Try the buttons above!
          </Text>
        ) : (
          logs.map((log) => (
            <View key={log.id} style={styles.logEntry}>
              <View style={styles.logMeta}>
                <View
                  style={[
                    styles.logType,
                    log.type === 'evaluation' && styles.logTypeEval,
                    log.type === 'identify' && styles.logTypeIdentify,
                    log.type === 'refresh' && styles.logTypeRefresh,
                  ]}
                >
                  <Text style={styles.logTypeText}>{log.type}</Text>
                </View>
                <Text style={styles.logTime}>
                  {log.timestamp.toLocaleTimeString()}
                </Text>
              </View>
              <Text style={styles.logMessage}>{log.message}</Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Available Hook Points</Text>
        <View style={styles.hookInfo}>
          <Text style={styles.hookName}>beforeEvaluation</Text>
          <Text style={styles.hookDesc}>Called before feature evaluation</Text>
        </View>
        <View style={styles.hookInfo}>
          <Text style={styles.hookName}>afterEvaluation</Text>
          <Text style={styles.hookDesc}>Called after evaluation with result</Text>
        </View>
        <View style={styles.hookInfo}>
          <Text style={styles.hookName}>beforeIdentify</Text>
          <Text style={styles.hookDesc}>Called before identity changes</Text>
        </View>
        <View style={styles.hookInfo}>
          <Text style={styles.hookName}>afterIdentify</Text>
          <Text style={styles.hookDesc}>Called after identity changes</Text>
        </View>
        <View style={styles.hookInfo}>
          <Text style={styles.hookName}>afterRefresh</Text>
          <Text style={styles.hookDesc}>Called after flags are refreshed</Text>
        </View>
      </View>
    </ScrollView>
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
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  evalButton: {
    backgroundColor: '#3b82f6',
  },
  identifyButton: {
    backgroundColor: '#8b5cf6',
  },
  refreshButton: {
    backgroundColor: '#22c55e',
  },
  buttonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  clearButton: {
    color: '#6366f1',
    fontSize: 14,
    fontWeight: '500',
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
  },
  logEntry: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  logMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  logType: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  logTypeEval: {
    backgroundColor: '#dbeafe',
  },
  logTypeIdentify: {
    backgroundColor: '#ede9fe',
  },
  logTypeRefresh: {
    backgroundColor: '#dcfce7',
  },
  logTypeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  logTime: {
    fontSize: 12,
    color: '#9ca3af',
  },
  logMessage: {
    fontSize: 13,
    color: '#374151',
    fontFamily: 'monospace',
  },
  hookInfo: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  hookName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
    fontFamily: 'monospace',
  },
  hookDesc: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
});
