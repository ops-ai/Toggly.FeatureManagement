import { Feature, useFeatureFlag } from '@ops-ai/react-feature-flags-toggly'

export function ConsumerApp() {
  const { isEnabled } = useFeatureFlag('release', { defaultValue: false })

  return (
    <Feature featureKey="release">
      <span>{isEnabled ? 'release-on' : 'release-off'}</span>
    </Feature>
  )
}
