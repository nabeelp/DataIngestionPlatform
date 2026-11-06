import { useRef } from 'react';

/** The latest defined value: lets a screen keep showing the last good data while a refresh has failed. */
export function useLastData<T>(data: T | undefined): T | undefined {
  const last = useRef(data);
  if (data !== undefined) last.current = data;
  return last.current;
}
