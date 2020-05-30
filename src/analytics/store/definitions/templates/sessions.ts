import {baseProperties} from "../indexes/common";

export const sessionsTemplate = (prefix: string) => ({
  index_patterns: [
    `${prefix}_sessions-*`
  ],
  aliases: {
    [`${prefix}_sessions`]: {}
  },
  settings: {
    number_of_shards: 3,
    number_of_replicas: 1,
    index: {
      lifecycle: {
        "name": "timeseries_default",
        "rollover_alias": `${prefix}-sessions`
      }
    }
  },
  mappings: {
    properties: {
      ...baseProperties,
      finished: {
        type: "boolean"
      }
    }
  }
});
