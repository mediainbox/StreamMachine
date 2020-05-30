import {ISource} from "../../sources/base/ISource";

export function pickSource(sources: ISource[]): ISource | null {
  if (!sources.length) {
    return null;
  }

  const sorted = sources
    .filter(source => source.isConnected())
    .sort((sA, sB) => {
      return sA.getPriority() >= sB.getPriority() ? -1 : 1;
    });

  return sorted.length ? sorted[0] : null;
}
