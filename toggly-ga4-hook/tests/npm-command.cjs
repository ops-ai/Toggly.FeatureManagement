const path = require('node:path');

function npmCommand(npmArguments, {
  platform = process.platform,
  nodeExecutable = process.execPath,
} = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  const nodeDirectory = pathApi.dirname(nodeExecutable);
  const npmCli = platform === 'win32'
    ? pathApi.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : pathApi.resolve(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

  return {
    executable: nodeExecutable,
    args: [npmCli, ...npmArguments],
  };
}

module.exports = { npmCommand };
