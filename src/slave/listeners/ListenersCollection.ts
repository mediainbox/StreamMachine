import {Collection} from "../../util/Collection";
import {IListener} from "./IListener";
import {IChunkStore} from "../../rewind/store/IChunkStore";

export class ListenersCollection extends Collection<IListener> {
  pushLatest(buffer: IChunkStore) {
    this.toArray().map(listener => {
      // we'll give them whatever is at length - offset
      // FIXME: This lookup strategy is horribly inefficient
      const latestForListener = buffer.at(listener.options.offset);

      if (latestForListener) {
        listener.getSource().addChunk(latestForListener);
      }
    });
  }

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
