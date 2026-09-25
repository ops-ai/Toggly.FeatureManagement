import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TogglyProvider, useToggly, useTogglyService} from '@ops-ai/react-native-toggly';
import {createMMKV4StorageAdapter} from '@ops-ai/react-native-toggly-storage-mmkv4';

// Android emulators use `adb reverse tcp:8765 tcp:8765` for this loopback URL.
const collector = 'http://127.0.0.1:8765';
const storage = createMMKV4StorageAdapter({id: 'toggly-public-acceptance'});
type Mode = 'enabled' | 'optout' | 'keyless';

function Controls({write}: {write: React.Dispatch<React.SetStateAction<string>>}) {
  const service = useTogglyService();
  const {isReady, recordUsage, recordView, incrementCounter, setGauge, flushTelemetry, setContext} = useToggly();
  const ran = useRef(false);
  const run = useCallback(async () => {
    const results = {
      direct: await service.isFeatureOn('DirectOn'),
      negatedAll: await service.evaluateFeatureGate(['DirectOn', 'DirectOff'], 'all', true),
      shortCircuit: await service.evaluateFeatureGate(['DirectOff', 'SkippedOn'], 'all'),
      local: await service.isFeatureOn('LocalOn'),
      entity: await service.isFeatureOn('OrderGate', {
        kind: 'Order', key: 'sample-order', attributes: {Total: 20},
      }),
    };
    recordUsage('DirectOn', 'sample');
    recordView('DirectOn', 'sample');
    incrementCounter('orders', 2);
    setGauge('cart', 3.5);
    await flushTelemetry();
    write(JSON.stringify(results));
  }, [service, recordUsage, recordView, incrementCounter, setGauge, flushTelemetry, write]);
  const updateContext = async () => {
    await setContext({identity: 'sample-user-b', instanceId: 'sample-instance-b', groups: ['beta'], claims: {plan: 'pro'}});
    await service.isFeatureOn('DirectOn');
    await flushTelemetry();
    write('context changed and flushed');
  };
  const clearToken = useCallback(async () => {
    await setContext({identity: 'sample-user-c', instanceId: ''});
    await service.isFeatureOn('DirectOn');
    await flushTelemetry();
    write(previous => `${previous} | identity batch flushed`);
  }, [setContext, service, flushTelemetry, write]);
  useEffect(() => {
    if (isReady && !ran.current) {
      ran.current = true;
      run().then(clearToken).catch(error => write(String(error)));
    }
  }, [isReady, run, clearToken, write]);
  return <View>
    <Button label="Run evaluations and flush" onPress={() => {run().catch(error => write(String(error)));}} />
    <Button label="Rotate context and flush" onPress={() => {updateContext().catch(error => write(String(error)));}} />
    <Button label="Clear token and flush" onPress={() => {clearToken().catch(error => write(String(error)));}} />
    <Text>AppState: {String(AppState.currentState)}</Text>
  </View>;
}

function Button({label, onPress}: {label: string; onPress: () => void}) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.button}><Text>{label}</Text></Pressable>;
}

export default function App() {
  const [mode, setMode] = useState<Mode>('enabled');
  const [owner, setOwner] = useState('sample-key-a');
  const [line, setLine] = useState('Tap Run; inspect the local collector output.');
  const appKey = mode === 'keyless' ? undefined : owner;
  return <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.title}>Public React Native telemetry acceptance</Text>
    <Text>Platform: {Platform.OS}; mode: {mode}; owner: {owner}</Text>
    <Button label="Enabled" onPress={() => setMode('enabled')} />
    <Button label="Opt out" onPress={() => setMode('optout')} />
    <Button label="Keyless" onPress={() => setMode('keyless')} />
    <Button label="Replace owner" onPress={() => setOwner(value => value === 'sample-key-a' ? 'sample-key-b' : 'sample-key-a')} />
    <TogglyProvider
      appKey={appKey}
      environment="Acceptance"
      baseURI={collector}
      metricsBaseUrl={collector}
      enableTelemetry={mode !== 'optout'}
      identity="sample-user-a"
      instanceId="sample-instance-a"
      featureDefaults={{DirectOn: true, DirectOff: false, SkippedOn: true, LocalOn: true,
        OrderGate: {requirement: 'all', rules: [{property: 'Total', op: 'gt', value: '10', type: 'number'}]}}}
      localGates={[{id: 'native-local', flagKeys: ['LocalOn'], isEnabled: () => false}]}
      storage={storage}
      refreshInterval={0}
      enableLiveUpdates={false}
      waitForInit={false}>
      <Controls write={setLine} />
    </TogglyProvider>
    <Text accessibilityLabel="Acceptance result">{line}</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  button: {padding: 12},
  page: {padding: 24, paddingTop: 56},
  title: {fontSize: 22},
});
