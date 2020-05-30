import {baseProperties} from "../indexes/common";

export const listensTemplate = (prefix: string) => ({
  index_patterns: [
    `${prefix}_listens-*`
  ],
  aliases: {
    [`${prefix}_listens`]: {}
  },
  settings: {
    number_of_shards: 3,
    number_of_replicas: 1,
    index: {
      lifecycle: {
        "name": "timeseries_default",
        "rollover_alias": `${prefix}-listens`
      }
    }
  },
  mappings: {
    properties: {
      ...baseProperties,
      session: {
        type: "object",
        properties: {
          start: {
            type: "date",
            format: "date_time"
          },
          duration: {
            type: "float"
          },
          kbytes: {
            type: "long"
          },
        }
      }
    }
  }
});
