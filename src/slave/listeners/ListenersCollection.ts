import { Collection } from "../../util/Collection";
import {IListener} from "./IListener";

export class ListenersCollection extends Collection<IListener> {
  disconnectAll() {
    this.toArray().map(listener => {
      listener.disconnect();
    });
  }

  disconnect(id: string) {
    const listener = this.get(id);

    if (!listener) {
      console.error(`disconnectListener called for ${id}, but no listener found.`);
      return;
    }

    listener.disconnect();
  }
}
