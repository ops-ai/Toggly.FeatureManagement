import { TogglyService, type TogglyConfig } from '@ops-ai/react-native-toggly-core';
import { useToggly, TogglyProvider, type TogglyProviderProps } from '@ops-ai/react-native-toggly';
const config: TogglyConfig = { instanceId: "minted", enableTelemetry: false, metricsBaseUrl: 'https://collector.invalid', onTelemetryDiagnostic: diagnostic => void diagnostic };
const client = new TogglyService(config);
client.recordUsage('checkout'); client.recordView('checkout', 'variant-a');
client.incrementCounter('orders'); client.setGauge('cart', 2);
void client.setContext({instanceId: "next"});
void client.setIdentity("legacy");
void client.flushTelemetry(); client.dispose({flush: false});
const hook: ReturnType<typeof useToggly>['recordUsage'] = (key, variant) => client.recordUsage(key, variant);
const props: TogglyProviderProps = { ...config, children: null };
void hook; void props; void TogglyProvider;

const setContext: ReturnType<typeof useToggly>["setContext"] = async context => { await client.setContext(context); };
void setContext;
