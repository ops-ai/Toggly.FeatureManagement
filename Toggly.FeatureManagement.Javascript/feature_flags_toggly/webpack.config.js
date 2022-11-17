const path = require('path');

module.exports = {
  mode: "production",
  entry: {
    main: "./lib/index.ts",
  },
  output: {
    path: path.resolve(__dirname, './dist'),
    filename: "[name]-bundle.js"
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