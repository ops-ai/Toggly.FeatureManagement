import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'public-client-core-host-ownership',
    configureServer(server) {
      server.middlewares.use((_request, response, next) => {
        const token = process.env.TOGGLY_FIXTURE_HOST_TOKEN;
        if (token) response.setHeader('x-toggly-host-token', token);
        next();
      });
    },
  }],
});
