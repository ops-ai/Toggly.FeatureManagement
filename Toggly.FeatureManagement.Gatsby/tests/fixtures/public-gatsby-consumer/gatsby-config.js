const appKey = process.env.TOGGLY_APP_KEY ?? 'sample-browser-key';
const localApi = process.env.TOGGLY_LOCAL_API ?? 'http://127.0.0.1:8838';

module.exports = {
  siteMetadata: { title: 'Toggly Gatsby telemetry sample' },
  plugins: [
    {
      resolve: '@ops-ai/gatsby-feature-flags-toggly',
      options: {
        appKey,
        environment: process.env.TOGGLY_ENVIRONMENT || 'Production',
        identity: 'sample-user-42',
        baseURI: `${localApi}/definitions`,
        metricsBaseUrl: `${localApi}/metrics`,
        enableLiveUpdates: false,
        enableTelemetry: process.env.TOGGLY_ENABLE_TELEMETRY !== 'false',
        allFeaturesEnabledDuringBuild: true,
        flagDefaults: { Visible: true, Hidden: false, Skipped: true, Local: true },
      },
    },
  ],
};
