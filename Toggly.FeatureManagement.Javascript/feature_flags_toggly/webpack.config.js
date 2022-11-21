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