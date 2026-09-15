import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { RouterTogglyProvider } from '@ops-ai/react-router-toggly/client';
import { toggly } from './toggly.server';

export async function loader(args: { request: Request }) {
  return toggly.getLoaderData(args);
}

export default function App() {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <RouterTogglyProvider routeId="root">
          <Outlet />
        </RouterTogglyProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
