export type MonotonicClock = () => bigint;

export interface MeasuredValue<T> {
  readonly value: T;
  readonly durationNs: bigint;
}

export async function measureDuration<T>(
  clock: MonotonicClock,
  operation: () => Promise<T>,
): Promise<MeasuredValue<T>> {
  const startedAt = clock();
  const value = await operation();
  return { value, durationNs: clock() - startedAt };
}
