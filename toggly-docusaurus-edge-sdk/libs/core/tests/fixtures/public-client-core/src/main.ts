import { createTogglyClient } from '@ops-ai/toggly-client-core';

const mode = new URLSearchParams(location.search).get('mode');
const appKey = import.meta.env.VITE_TOGGLY_APP_KEY?.trim();
const client = createTogglyClient({
  ...(mode === 'keyless' || !appKey ? {} : { appKey }),
  environment: 'Production',
  baseURI: 'https://definitions.toggly.io',
  flagDefaults: { On: true, Off: false },
  enableTelemetry: mode !== 'optout',
  ...(mode === 'context' ? { identity: 'alice' } : {}),
});

client.registerContext('Order', (order: { Id: string; Vip: boolean }) => ({
  kind: 'Order', key: order.Id, attributes: { Vip: order.Vip },
}));

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <h1>Generic client-core browser consumer</h1>
  <p id="status">ready</p><output id="result"></output>
  <button id="direct">Direct flag</button>
  <button id="gate">Short-circuit gate</button>
  <button id="gate-off">Local gate off</button>
  <button id="negate">Negated gate</button>
  <button id="entity">Entity gate</button>
  <button id="events">Explicit telemetry</button>
  <button id="variant">Variant usage and view</button>
  <button id="flush">Flush telemetry</button>
  <button id="dispose">Dispose client</button>
  <button id="switch">Switch identity</button>
  <button id="second">Second client</button>
`;
const result = app.querySelector<HTMLOutputElement>('#result')!;
app.querySelector<HTMLButtonElement>('#direct')!.onclick = async () => {
  result.value = `On=${await client.getFlag('On')}`;
};
app.querySelector<HTMLButtonElement>('#gate')!.onclick = async () => {
  // `getFlag` is the authoritative evaluation boundary. Keep the local
  // precondition and flag short circuit visible rather than prefetching flags.
  const localGate = true;
  const enabled = localGate && (await client.getFlag('On') || await client.getFlag('Off'));
  result.value = `gate=${enabled}`;
};
app.querySelector<HTMLButtonElement>('#gate-off')!.onclick = async () => {
  const localGate = false;
  const enabled = localGate && await client.getFlag('On');
  result.value = `gate-off=${enabled}`;
};
app.querySelector<HTMLButtonElement>('#negate')!.onclick = async () => {
  const enabled = await client.getFlag('On');
  result.value = `negate=${!enabled}`;
};
app.querySelector<HTMLButtonElement>('#entity')!.onclick = async () => {
  const vip = await client.getFlag('Entity', false, { Id: 'vip', Vip: true }, 'Order');
  const standard = await client.getFlag('Entity', false, { Id: 'standard', Vip: false }, 'Order');
  result.value = `entity=${vip}/${standard}`;
};
app.querySelector<HTMLButtonElement>('#events')!.onclick = () => {
  client.recordUsage('On');
  client.recordView('On');
  client.incrementCounter('orders', 2);
  client.setGauge('cart', 9);
};
app.querySelector<HTMLButtonElement>('#variant')!.onclick = () => {
  client.recordUsage('On', 'treatment');
  client.recordView('On', 'treatment');
};
app.querySelector<HTMLButtonElement>('#flush')!.onclick = () => { void client.flushTelemetry(); };
app.querySelector<HTMLButtonElement>('#dispose')!.onclick = () => { client.dispose(); };
app.querySelector<HTMLButtonElement>('#switch')!.onclick = async () => {
  await client.setContext({ identity: 'bob' });
  app.querySelector('#status')!.textContent = 'bob';
};
app.querySelector<HTMLButtonElement>('#second')!.onclick = async () => {
  const secondKey = import.meta.env.VITE_TOGGLY_SECOND_APP_KEY?.trim();
  if (!secondKey) return;
  const second = createTogglyClient({
    appKey: secondKey,
    environment: 'Production',
    baseURI: 'https://definitions.toggly.io',
  });
  second.recordUsage('On');
  await second.flushTelemetry();
  second.dispose({ flush: false });
};
