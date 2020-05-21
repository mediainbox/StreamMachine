export class Collection<T> {
  map: Record<string, T> = {};

  constructor() {}

  toArray() {
    return Object.values(this.map);
  }

  get(key: string): T | null {
    return this.map[key];
  }

  keys(): readonly string[] {
    return Object.keys(this.map);
  }

  add(key: string, element: T) {
    this.map[key] = element;
  }

  remove(key: string): T {
    const element = this.map[key];
    delete this.map[key];
    return element;
  }

  count(): number {
    return this.keys().length;
  }

  first(): T | null {
    if (!this.count()) {
      return null;
    }

    return this.map[this.keys()[0]];
  }
}
