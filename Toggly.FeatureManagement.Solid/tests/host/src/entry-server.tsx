import { createHandler, StartServer } from '@solidjs/start/server';
export default createHandler(() => (
  <StartServer
    document={(props) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>Toggly SolidStart packed host</title>
          {props.assets}
        </head>
        <body>
          <div id="app">{props.children}</div>
          {props.scripts}
        </body>
      </html>
    )}
  />
));
