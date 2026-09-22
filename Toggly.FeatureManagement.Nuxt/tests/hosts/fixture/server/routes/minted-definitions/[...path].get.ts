export default defineEventHandler(event => {
  const token = getQuery(event).i
  const local = event.path.includes('/definitions-signed')
  const revision = `${local ? 'local' : 'remote'}-${token}`
  setHeader(event, 'etag', revision)
  if (getHeader(event, 'if-none-match') === revision) {
    setResponseStatus(event, 304)
    return null
  }
  return local
    ? [{featureKey:'Raw',filters:[{name:'AlwaysOn',parameters:{}}]}]
    : {Flag:token==='token-a'}
})
