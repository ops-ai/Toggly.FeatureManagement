exports.onCreateWebpackConfig = ({ actions }) => {
  actions.setWebpackConfig({ resolve: { fallback: { crypto: false } } });
};
