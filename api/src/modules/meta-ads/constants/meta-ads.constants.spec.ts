import {
  FULL_INSIGHTS_FIELDS,
  CAMPAIGN_INSIGHT_FIELDS,
  ADSET_INSIGHT_FIELDS,
  ADS_ENDPOINT_INSIGHT_FIELDS,
  REALTIME_INSIGHT_FIELDS,
  ESSENTIAL_INSIGHT_FIELDS,
  BREAKDOWN_INSIGHT_FIELDS,
} from './meta-ads.constants'

describe('campos de insights da Meta', () => {
  // A Graph API responde `(#100) reels_activity is not valid for fields param` e o sync inteiro
  // (manual e cron) falha com 500. Um campo invalido em qualquer lista derruba tudo.
  it.each([
    ['FULL_INSIGHTS_FIELDS', FULL_INSIGHTS_FIELDS],
    ['CAMPAIGN_INSIGHT_FIELDS', CAMPAIGN_INSIGHT_FIELDS],
    ['ADSET_INSIGHT_FIELDS', ADSET_INSIGHT_FIELDS],
    ['ADS_ENDPOINT_INSIGHT_FIELDS', ADS_ENDPOINT_INSIGHT_FIELDS],
    ['REALTIME_INSIGHT_FIELDS', REALTIME_INSIGHT_FIELDS],
    ['ESSENTIAL_INSIGHT_FIELDS', ESSENTIAL_INSIGHT_FIELDS],
    ['BREAKDOWN_INSIGHT_FIELDS', BREAKDOWN_INSIGHT_FIELDS],
  ])('%s nao pede reels_activity', (_nome, campos) => {
    expect(campos).not.toContain('reels_activity')
  })
})
