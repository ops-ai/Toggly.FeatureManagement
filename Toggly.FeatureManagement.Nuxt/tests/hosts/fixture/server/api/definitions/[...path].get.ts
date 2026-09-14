export default defineEventHandler(event => ({
  Enabled: getQuery(event).u !== 'bob',
  Disabled: false,
  Targeted: getQuery(event).u === 'alice',
}))
