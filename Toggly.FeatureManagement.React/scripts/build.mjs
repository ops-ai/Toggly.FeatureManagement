import { rollup } from 'rollup'
import configurations from '../rollup.config.js'

try {
  for (const configuration of configurations) {
    const bundle = await rollup(configuration)
    try {
      for (const output of configuration.output) {
        await bundle.write(output)
      }
    } finally {
      await bundle.close()
    }
  }

  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
