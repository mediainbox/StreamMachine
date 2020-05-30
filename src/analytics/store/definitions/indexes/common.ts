export const baseProperties = {
  datetime: {
    type: "date",
    format: "date_time"
  },
  groupId: {
    type: "keyword",
    index: "true"
  },
  streamId: {
    type: "keyword",
    index: "true"
  },
  sessionId: {
    type: "keyword",
    index: "true"
  },
  listenerId: {
    type: "keyword",
    index: "true"
  },
  duration: {
    type: "float"
  },
  kbytes: {
    type: "long"
  },
  outputType: {
    type: "keyword",
    index: "true"
  },
  client: {
    type: "object",
    properties: {
      ua: {
        type: "keyword",
        index: "true"
      },
      ip: {
        type: "ip",
        index: "true"
      },
      path: {
        type: "keyword",
        index: "true"
      },
      device: {
        type: "object",
        properties: {
          type: {
            type: "keyword",
            index: "true"
          },
          os: {
            type: "keyword",
            index: "true"
          },
          browser: {
            type: "keyword",
            index: "true"
          },
        }
      }
    }
  },
  _createdAt: {
    type: "date",
    format: "date_time"
  },
  _updatedAt: {
    type: "date",
    format: "date_time"
  },
}
