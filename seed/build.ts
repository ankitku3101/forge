/** `pnpm seed [--scenario <id>]`: rebuilds the sandbox in the shared data directory. */
import { parseArgs } from 'node:util'
import { SCENARIOS, isScenario } from '../src/shared/scenarios'
import { openDatabase } from '../src/main/db/client'
import { dataPaths } from '../src/main/paths'
import { buildSandbox } from '../src/main/sandbox/seed'

const { values } = parseArgs({ options: { scenario: { type: 'string', default: 'happy_path' } } })
const scenario = values.scenario
if (!isScenario(scenario)) {
  console.error(`Unknown scenario "${scenario}". Choose one of: ${SCENARIOS.join(', ')}`)
  process.exit(1)
}

const paths = dataPaths()
const database = await openDatabase(paths.dbDir)
try {
  await buildSandbox({ pg: database.pg, db: database.db, filesDir: paths.filesDir }, scenario)
  console.log(`Seeded "${scenario}" sandbox at ${paths.root}`)
} finally {
  await database.close()
}
