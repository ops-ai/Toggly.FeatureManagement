// No custom gatsby-node configuration needed for this example
// The plugin handles everything automatically
exports.onCreateWebpackConfig = ({ actions }) => {
  actions.setWebpackConfig({
    resolve: {
      fallback: {
        fs: false,
        path: false,
      },
    },
  });
};
