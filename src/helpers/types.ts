import _ from 'lodash';

/** Used by Flavor to mark a type in a readable way. */

interface Flavoring<FlavorT> {
  _type?: FlavorT;
}

interface Branding<BrandT> {
  _type: BrandT;
}

/** Create a "flavored" version of a type. TypeScript will disallow mixing flavors, but will allow unflavored values of that type to be passed in where a flavored version is expected. This is a less restrictive form of branding. */
export type Flavor<T, FlavorT> = T & Flavoring<FlavorT>;

/** Create a "branded" version of a type. TypeScript will disallow mixing brands, and disallow unbranded values of that type to be passed in where a branded version is expected. This is a less restrictive form of branding. */
// cast or create a function to boostrap a brand
export type Brand<T, BrandingT> = T & Branding<BrandingT>;

export type PickPartial<T, K extends keyof T> = Partial<T> & Pick<T, K>;

export type Description<T> = Record<keyof T, string>;

export type Mutable<T> = { -readonly [P in keyof T]: T[P] };

export type Require<T, K extends keyof T> = T &
  { [P in K]-?: NonNullable<T[P]> };

export type Full<T> = {
  [P in keyof T]-?: T[P];
};

export type Maybe<T> = T | null | undefined;

type Function1<T1, R> = (t1: T1) => R;
type Function2<T1, T2, R> = (t1: T1, t2: T2) => R;
type Function3<T1, T2, T3, R> = (t1: T1, t2: T2, t3: T3) => R;
type Function4<T1, T2, T3, T4, R> = (t1: T1, t2: T2, t3: T3, t4: T4) => R;
type Function5<T1, T2, T3, T4, T5, R> = (
  t1: T1,
  t2: T2,
  t3: T3,
  t4: T4,
  t5: T5
) => R;

/* tslint:disable:no-shadowed-variable */
export type Apply<F, E> = F extends Function1<E, infer R>
  ? () => R
  : F extends Function2<E, infer A1, infer R>
    ? Function1<A1, R>
    : F extends Function3<E, infer A1, infer A2, infer R>
      ? Function2<A1, A2, R>
      : F extends Function4<E, infer A1, infer A2, infer A3, infer R>
        ? Function3<A1, A2, A3, R>
        : F extends Function5<E, infer A1, infer A2, infer A3, infer A4, infer R>
          ? Function4<A1, A2, A3, A4, R>
          : F;
/* tslint:enable:no-shadowed-variable */

export type AppliedEnvironment<T, E> = {
  [K in FunctionKeys<T>]: Apply<T[K], E>;
};

export type FunctionKeys<T> = {
  [K in keyof T]: T[K] extends Function ? K : never;
}[keyof T];

export type FunctionsOnly<T> = Pick<T, FunctionKeys<T>>;

export type Environmentable<T, E> = {
  [K in keyof T]:
  | Function1<E, any>
  | Function2<E, any, any>
  | Function3<E, any, any, any>
  | Function4<E, any, any, any, any>
  | Function5<E, any, any, any, any, any>
  | unknown;
};

export interface Cancelable<T> {
  promise: Promise<T>;

  cancel(): void;
}

export type OptionalPropertyNames<T> = {
  [K in keyof T]-?: undefined extends T[K] ? K : never;
}[keyof T];
export type RequiredPropertyNames<T> = {
  [K in keyof T]-?: undefined extends T[K] ? never : K;
}[keyof T];
export type OptionalProperties<T> = Pick<T, OptionalPropertyNames<T>>;
export type RequiredProperties<T> = Pick<T, RequiredPropertyNames<T>>;

export type ReturnTypes<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => infer R ? R : never;
};

export type Depromise<T> = {
  [K in keyof T]: T[K] extends Promise<infer R> ? R : T[K];
};

export type ToRecord<T, U> = Record<keyof T, U>;

/**
 * Exclude undefined from T
 */
export type NonUndefined<T> = T extends undefined ? never : T;

export type NullableKeys<T> = {
  [K in keyof T]-?: undefined | null extends T[K] ? K : never;
}[keyof T];

export interface SafeDictionary<T> {
  [index: string]: T | undefined;
}

/**
 * An attempt to make declaration of (discriminated) union types simpler
 * and more consistent.
 */
export type Case<
  T extends string | number,
  U extends {} | undefined = undefined
  > = U extends undefined ? { type: T } : { type: T } & U;

export function Case<T extends string | number>(t: T): Case<T, undefined>;
export function Case<T extends string | number, U extends {}>(
  t: T,
  u: U
): Case<T, U>;
export function Case(t: string, u?: any): any {
  return { ...(u as any), type: t };
}

export type Scalar = boolean | number | string | null | undefined;

export type MaybeArray<T> = T | T[];

export type NotType<T, N> = T extends N ? never : T;

export type Or<A, B> = A | B;

export const keyByNullValue = '__null__';

/* tslint:disable */
export interface AssertAssignable<T, _U extends T> {}
/* tslint:enable */

export function swallowPromise(_maybePromise: Promise<any> | void): void {}

export function sleep(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * Perform a map with asynchronous callbacks, but ensure mapping is done in serial
 * order (i.e. wait for async iteration on element 1 before beginning async iteration
 * on element 2)
 * @param coll collection to map over
 * @param mapFn map function - must return a promise
 * @returns a promise of an array of the mapped type
 */
export async function serialAsyncMap<T, U>(
  coll: readonly T[],
  mapFn: (t: T, idx: number) => Promise<U>
): Promise<readonly U[]> {
  let idx = 0;
  const output: U[] = [];
  for (const elem of coll) {
    output.push(await mapFn(elem, idx));
    idx++;
  }
  return output;
}

export function pluck<T extends object, U extends keyof T>(
  array: ArrayLike<T>,
  ...keys: U[]
): Pick<T, U>[] {
  return _.map(array, elem => _.pick<T, U>(elem, keys));
}

export function prune<T extends {}>(t: T): T {
  return _.omitBy(t, _.isUndefined) as any;
}

export function toImmutable<T>(t: T): Readonly<T> {
  return t;
}

export function toMutable<T>(a: ReadonlyArray<T>): T[] {
  return a.map(i => i);
}

export function typedKeys<T>(t: T): ReadonlyArray<keyof T> {
  return Object.keys(t) as any;
}

export function compose<T, U, V>(f: (t: T) => U, g: (u: U) => V): (t: T) => V {
  return x => g(f(x));
}

export function as<T>(t: T): T {
  return t;
}

export function zip2<T, U, V = [T, U]>(
  tValues: ReadonlyArray<T>,
  uValues: ReadonlyArray<U>,
  f?: (t: T, u: U) => V
): ReadonlyArray<V> {
  let ts = tValues;
  let us = uValues;
  if (ts.length > us.length) {
    ts = _.take(ts, us.length);
  } else if (ts.length < us.length) {
    us = _.take(us, ts.length);
  }
  const fn = f || ((t: T, u: U) => ([t, u] as any) as V);
  return ts.map((t, i) => {
    const u = us[i];
    return fn(t, u);
  });
}

type NN<T> = NonNullable<T>;

/**
 * Create a function that traverses up to four properties. Useful in map() scenarios
 * @param k a property of type T to index into using the generated function
 * @param k2 a property of type T[k] to index into using the generated function
 * @return a function which can traverse properties.
 *
 * @remarks Example
 * instead of
 * ```
 * x = arr.map(v => v.propA.propB.propC)
 * ```
 * you can do
 * ```
 * x = arr.map(prop('propA', 'propB', 'propC'));
 * ```
 * And of course it's all type safe.
 */
export function prop<T, K extends keyof T>(k: K): (t: T) => T[K];
export function prop<T, K extends keyof T, K2 extends keyof T[K]>(
  k: K,
  k2: K2
): (t: T) => T[K][K2];
export function prop<
  T,
  K extends keyof T,
  K2 extends keyof T[K],
  K3 extends keyof T[K][K2]
  >(k: K, k2: K2, k3: K3): (t: T) => T[K][K2][K3];
export function prop<
  T,
  K extends keyof T,
  K2 extends keyof T[K],
  K3 extends keyof T[K][K2],
  K4 extends keyof T[K][K2][K3]
  >(k: K, k2: K2, k3: K3, k4: K4): (t: T) => T[K][K2][K3][K4];
export function prop(...keys: string[]): (t: any) => any {
  return t => {
    let v = t;
    for (const k of keys) {
      v = v[k];
    }
    return v;
  };
}

/**
 * Create a function that traverses up to four properties, terminating on null or undefined values.
 * Useful in map() scenarios. Think of it like Maybe.bind().
 * @param k a property of type T to index into using the generated function
 * @param k2 a property of type T[k] to index into using the generated function
 * @return a function which can traverse properties.
 *
 * @remarks Example
 * instead of
 * ```
 * x = arr.map(v => v.propA && v.propA.propB ? v.propA.propB.propC : null)
 * ```
 * you can do
 * ```
 * x = arr.map(tryProp('propA', 'propB', 'propC'));
 * ```
 * And of course it's all type safe.
 */
export function tryProp<T extends Object, K extends keyof T>(
  k: K
): (t: T) => NN<T[K]> | null;
export function tryProp<
  T extends Object,
  K extends keyof T,
  K2 extends keyof NN<T[K]>
  >(k: K, k2: K2): (t: T) => NN<T[K]>[K2] | null;
export function tryProp<
  T extends Object,
  K extends keyof T,
  K2 extends keyof NN<T[K]>,
  K3 extends keyof NN<NN<T[K]>[K2]>
  >(k: K, k2: K2, k3: K3): (t: T) => NN<NN<T[K]>[K2]>[K3] | null;
export function tryProp<
  T extends Object,
  K extends keyof T,
  K2 extends keyof NN<T[K]>,
  K3 extends keyof NN<NN<T[K]>[K2]>,
  K4 extends keyof NN<NN<NN<T[K]>[K2]>[K3]>
  >(
  k: K,
  k2: K2,
  k3: K3,
  k4: K4
): (t: T) => NN<NN<NN<NN<T[K]>[K2]>[K3]>[K4]> | null;
export function tryProp(...keys: string[]): (t: any) => any {
  return (t: any) => {
    let v = t || null;
    for (const k of keys) {
      if (v === null) return v;
      v = v[k] || null;
    }
    return v;
  };
}

export function maybeMap<T, U>(t: Maybe<T>, f: (t: T) => U): Maybe<U> {
  return t ? f(t) : null;
}

/**
 * Return a function bound to a particular object. Useful in cases where you can't do
 * ```
 * memberFunc = (args) => {
 * ```
 * @param t the object to bind function k to
 * @param k the name of property which is a function to bind to t
 * @returns a function which can be passed around and won't lose the 'this' you want
 */
export function bind<T, K extends keyof T>(t: T, k: K): T[K] {
  return (t[k] as any).bind(t);
}

export function makeEnvironment<T, E>(
  environmentable: Environmentable<T, E>,
  environment: E
): AppliedEnvironment<FunctionsOnly<T>, E> {
  return _.mapValues(environmentable, (v: any) => {
    if (typeof v === 'function') {
      return _.partial(v, environment);
    } else return v;
  }) as any;
}

/**
 * Make switch statements work more like pattern matching. That is,
 * make a context wherein you can use `return` in a switch statement and
 * not exit the calling function.
 */

export function wrap<T>(fn: () => T): T {
  return fn();
}

export function enumToDict<T>(
  enumType: T
): { [k in Extract<keyof T, string>]: T[k] } {
  return enumType;
}

export function tuple<T, U>(t: T, u: U): [T, U] {
  return [t, u];
}

export function fromPairs<K extends string | symbol | number, T>(
  array: ReadonlyArray<[K, T]> | null | undefined
): Record<K, T> {
  return _.fromPairs(array) as any;
}

export function makeCancelable<T>(promise: Promise<T>): Cancelable<T> {
  let hasCanceled_ = false;

  const wrappedPromise = new Promise<T>((resolve, reject) => {
    promise
      .then(val => (hasCanceled_ ? reject({ isCanceled: true }) : resolve(val)))
      .catch(error =>
        hasCanceled_ ? reject({ isCanceled: true }) : reject(error)
      );
  });

  return {
    promise: wrappedPromise,
    cancel() {
      hasCanceled_ = true;
    },
  };
}

/**
 * Takes in an object with null properties and returns a new object with
 * undefined set instead of null and adjusts the type accordingly. Does not
 * work with nested properties.
 * @param t The object to be converted
 * @returns A new object with no nulls
 */
export function nullPropsToUndefined<T extends { [key: string]: any }>(
  t: T
): { [Key in keyof T]?: NonNullable<T[Key]> | undefined } {
  return typedKeys(t).reduce((accumulator, key) => {
    const value = t[key];
    accumulator[key] = value === null ? undefined : value;
    return accumulator;
  }, {} as Partial<T>);
}

export function headAndTail<T>(array: readonly T[]): [T | undefined, T[]] {
  const [head, ...tail] = array;
  return [head, tail];
}

export function determineCaseByHasProp<T, U>(
  v: T | U,
  k: Extract<Exclude<keyof U, keyof T>, string>
): v is U {
  return Object.keys(v).includes(k);
}

export function PartialCtor<T, K extends keyof T>(
  base: Pick<T, K>
): (data: Pick<T, Exclude<keyof T, K>>) => T {
  return data => ({ ...base, ...data } as T);
}

export function Ctor<T>(): (data: T) => T {
  return data => data;
}

export type GqlInputWannabeUnion<T> = T & {
  unionCase: Exclude<keyof T, 'unionCase'>;
};

export type UnionFromGqlInput<Input extends { unionCase: string }> = {
  [K in Exclude<keyof Input, 'unionCase'>]: { unionCase: K } & {
  [P in K]: NonNullable<Input[P]>;
};
}[Exclude<keyof Input, 'unionCase'>];

export function gqlInputToUnion<T extends { unionCase: string }>(
  t: GqlInputWannabeUnion<T>
): UnionFromGqlInput<T> {
  return t as any;
}

export function isNotNullOrUndefined<T extends Object>(
  elem: null | undefined | T
): elem is T {
  return elem !== null && elem !== undefined;
}

export function assertPresent<T>(t: T | null | undefined): asserts t is T {
  if (!t) throw new Error('Expected value not present');
}

export type NonFunctionPropertyNames<T> = {
  [K in keyof T]: T[K] extends Function ? never : K;
}[keyof T];

export type NonFunctionProperties<T> = Pick<T, NonFunctionPropertyNames<T>>;

export type IfEquals<X, Y, A = X, B = never> = (<T>() => T extends X
  ? 1
  : 2) extends <T>() => T extends Y ? 1 : 2
  ? A
  : B;

export type WritableKeys<T> = {
  [P in keyof T]-?: IfEquals<
    { [Q in P]: T[P] },
    { -readonly [Q in P]: T[P] },
    P
    >;
}[keyof T];

export type ReadonlyKeys<T> = {
  [P in keyof T]-?: IfEquals<
    { [Q in P]: T[P] },
    { -readonly [Q in P]: T[P] },
    never,
    P
    >;
}[keyof T];

export type Arguments<T> = [T] extends [(...args: infer U) => any]
  ? U
  : [T] extends [void] ? [] : [T]
