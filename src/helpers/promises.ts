export function promiseTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // Create a promise that rejects in <ms> milliseconds
  let timeout = new Promise<T>((resolve, reject) => {
    let id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error('Timeout'))
    }, ms)
  });

  // Returns a race between our timeout and the passed in promise
  return Promise.race([
    promise,
    timeout
  ])
}


export async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}
