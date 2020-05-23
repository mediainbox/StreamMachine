export interface AdData {
  readonly creativeUrl: string;
  readonly impressionUrl: string;
}

export class AdInstance {
  constructor(
    public readonly id: string,
    public readonly data: AdData,
  ) {
  }
}
