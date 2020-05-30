import {Collection} from "./Collection";
import _ from "lodash";

interface Result<T> {
  created: readonly T[],
  updated: readonly T[],
  deleted: readonly T[],
  unchanged: readonly T[]
}

export class CollectionUpdater<T extends { getId(): string, getConfig(): C }, C extends { id: string; enabled: boolean }> {
  constructor(
    private readonly collection: Collection<T>,
    private readonly handlers: {
      onCreate: (config: C) => T,
      onUpdate: (el: T, config: C) => void,
      onDelete: (el: T) => void,
      onUnchanged: (el: T) => void
    },
    private readonly configValidator: (config: C) => C = c => c,
  ) {
  }

  update(_newConfigs: readonly C[]): Result<T> {
    const newConfigs = _newConfigs.map(this.configValidator);

    function conf(id: string) {
      return newConfigs.find(c => c.id === id);
    }

    const result: Result<T> = {
      created: [],
      updated: [],
      deleted: [],
      unchanged: []
    };

    const toCreate: readonly C[] = newConfigs
      .filter(c => c.enabled && !this.collection.exists(c.id));

    const toUpdate: readonly T[] = this.collection.toArray()
      .filter(el => {
        const c = conf(el.getId());

        return c && c.enabled && !_.isEqual(el.getConfig(), c)
      });

    result.unchanged = this.collection.toArray()
      .filter(el => {
        const c = conf(el.getId());

        return c && c.enabled && _.isEqual(el.getConfig(), c);
      });

    const toDelete: readonly T[] = this.collection.toArray()
      .filter(el => {
        const c = conf(el.getId());

        return !c || !c.enabled;
      });

    result.created = toCreate.map(this.handlers.onCreate);
    result.updated = toUpdate.map((el: T) => {
      const config = conf(el.getId())!;
      this.handlers.onUpdate(el, config);
      return el;
    });
    result.deleted = toDelete.map((el: T) => {
      this.handlers.onDelete(el);
      return el;
    });
    result.unchanged.map(this.handlers.onUnchanged);

    return result;
  }
}
