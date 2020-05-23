import {CombinedSource} from "../output/CombinedSource";
import {IPreroller} from "../preroll/IPreroller";
import {IListener} from "../listeners/IListener";
import {ISource} from "../output/ISource";
import {Rewinder} from "../../rewind/Rewinder";

export async function createListenerSource(args: {
  listener: IListener,
  preroller: IPreroller,
  rewindBuffer: any,
}): Promise<ISource> {
  const {listener, preroller, rewindBuffer} = args;

  const adOperator = preroller.getAdOperator(listener);
  listener.once('disconnect', () => {
    adOperator.abort();
  });

  const rewinder = new Rewinder(
    rewindBuffer,
    listener.options,
  );

  const [preroll] = await Promise.all([
    adOperator.build(),
    rewinder.pump(),
  ]);

  return new CombinedSource(preroll, rewinder);
}
