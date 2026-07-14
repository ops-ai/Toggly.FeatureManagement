const path = require('path');

module.exports = {
  mode: "production",
  entry: {
    main: "./lib/toggly.ts",
  },
  output: {
    path: path.resolve(__dirname, './dist'),
    filename: "feature-flags-toggly.bundle.js"
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
    // Browser bundle must not pull Node built-ins; signed-defs verify uses
    // require('crypto') only when running under Node/Jest.
    fallback: {
      crypto: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: "ts-loader"
      }
    ]
  }
};