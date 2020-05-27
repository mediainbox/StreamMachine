import {CombinedSource} from "../output/CombinedSource";
import {IPreroller} from "../preroll/IPreroller";
import {IListener} from "../listeners/IListener";
import {ISource} from "../output/ISource";
import {Rewinder} from "../../rewind/Rewinder";
import {RewindBuffer} from "../../rewind/RewindBuffer";
import {componentLogger} from "../../logger";

export async function createListenerSource(args: {
  streamId: string,
  listener: IListener,
  preroller: IPreroller,
  rewindBuffer: RewindBuffer,
}): Promise<ISource> {
  const { streamId, listener, preroller, rewindBuffer} = args;

  const adOperator = preroller.getAdOperator(listener);
  listener.once('disconnect', () => {
    adOperator.abort();
  });

  const rewinder = new Rewinder(
    rewindBuffer,
    listener.options,
    componentLogger(`stream[${streamId}]:listener[#${listener.id}]:rewinder`),
  );

  const [preroll] = await Promise.all([
    adOperator.build(),
    rewinder.pump(),
  ]);

  return new CombinedSource(preroll, rewinder);
}
