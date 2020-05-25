export class Collection<T> {
  private _map: Record<string, T> = {};

  constructor() {}

  get(key: string): T | null {
    return this._map[key];
  }

  keys(): readonly string[] {
    return Object.keys(this._map);
  }

  add(key: string, element: T) {
    if (this._map[key]) {
      throw new Error(`Key ${key} already exists`);
    }

    this._map[key] = element;
  }

  remove(key: string): T {
    const element = this._map[key];
    delete this._map[key];
    return element;
  }

  count(): number {
    return this.keys().length;
  }

  first(): T | null {
    if (!this.count()) {
      return null;
    }

    return this._map[this.keys()[0]];
  }

  toArray() {
    return Object.values(this._map);
  }

  map(mapFn: (value: T, index: number) => void) {
    return this.toArray().map(mapFn);
  }
}
