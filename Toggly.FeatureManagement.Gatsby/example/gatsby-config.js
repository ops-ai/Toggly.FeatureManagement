module.exports = {
  siteMetadata: {
    title: 'Toggly Gatsby Example',
    description: 'Example site demonstrating Toggly feature flags',
  },
  plugins: [
    {
      resolve: '@ops-ai/gatsby-feature-flags-toggly',
      options: {
        // Replace with your actual app key from toggly.io
        appKey: process.env.TOGGLY_APP_KEY || 'demo-app-key',
        environment: process.env.TOGGLY_ENVIRONMENT || 'Production',
        // Enable all features during build for demonstration
        allFeaturesEnabledDuringBuild: true,
        // Fallback values when API is unavailable
        flagDefaults: {
          'new-dashboard': false,
          'beta-feature': false,
          'premium-content': false,
          'experimental-ui': false,
        },
        // Enable debug logging
        isDebug: true,
      },
    },
  ],
};
