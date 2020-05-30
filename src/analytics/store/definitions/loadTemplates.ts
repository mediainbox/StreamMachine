import {Client} from "@elastic/elasticsearch";
import {sessionsTemplate} from "./templates/sessions";
import {listensTemplate} from "./templates/listens";

interface Config {
  readonly indexPrefix: string;
}

export async function loadTemplates(es: Client, config: Config) {
  await es.indices.putTemplate({
    name: `${config.indexPrefix}_sessions`,
    body: sessionsTemplate(config.indexPrefix)
  });

  await es.indices.putTemplate({
    name: `${config.indexPrefix}_listens`,
    body: listensTemplate(config.indexPrefix)
  });
}
