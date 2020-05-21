import {IListener} from "../types";
import { Collection } from "../../util/Collection";

export class ListenersCollection extends Collection<IListener> {
  disconnectAll() {
    this.toArray().map(listener => {
      listener.disconnect();
    });
  }

  disconnectListener(id: string) {
    const listener = this.get(id);

    if (!listener) {
      console.error(`disconnectListener called for ${id}, but no listener found.`);
      return;
    }

    listener.disconnect();
  }
}
