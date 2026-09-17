import type { DependencyList, Dispatch, SetStateAction } from "react";
import { useCallback, useRef } from "react";
import {
	useCopyToClipboard as useReactUseCopyToClipboard,
	useDebounce as useReactUseDebounce,
	useEvent as useReactUseEvent,
	useInterval as useReactUseInterval,
	useLocalStorage as useReactUseLocalStorage,
	useMeasure as useReactUseMeasure,
	useMedia as useReactUseMedia,
	useTitle as useReactUseTitle,
	useUnmount as useReactUseUnmount,
} from "react-use";

type DomEventOptions = boolean | AddEventListenerOptions;
type StateSetter<T> = Dispatch<SetStateAction<T>>;

function getWindowTarget(): Window | null {
	if (typeof window === "undefined") {
		return null;
	}
	return window;
}

function getDocumentTarget(): Document | null {
	if (typeof document === "undefined") {
		return null;
	}
	return document;
}

export function useWindowEvent<K extends keyof WindowEventMap>(
	name: K,
	handler: ((event: WindowEventMap[K]) => void) | null,
	options?: DomEventOptions,
): void {
	useReactUseEvent(name, handler as ((event?: Event) => void) | null, getWindowTarget(), options);
}

export function useDocumentEvent<K extends keyof DocumentEventMap>(
	name: K,
	handler: ((event: DocumentEventMap[K]) => void) | null,
	options?: DomEventOptions,
): void {
	useReactUseEvent(name, handler as ((event?: Event) => void) | null, getDocumentTarget(), options);
}

export function useInterval(callback: () => void, delayMs: number | null): void {
	useReactUseInterval(callback, delayMs);
}

export function useDebouncedEffect(effect: () => void, delayMs: number, deps: DependencyList): void {
	useReactUseDebounce(effect, delayMs, deps);
}

export function useCopyToClipboard() {
	return useReactUseCopyToClipboard();
}

function resolveNextValue<T>(nextValue: SetStateAction<T>, currentValue: T): T {
	if (typeof nextValue === "function") {
		return (nextValue as (previousValue: T) => T)(currentValue);
	}
	return nextValue;
}

/**
 * react-use's `useLocalStorage` memoizes its setter on `[key, setState]` while reading `state`
 * from the enclosing closure, so the functional-updater form always sees the value from the
 * render in which the key last changed. Passing `(current) => !current` to it therefore only
 * ever works once per mount — a toggle turns on and then refuses to turn off, which strands
 * whatever it was hiding.
 *
 * These wrappers resolve updates against a ref that tracks the live value and always hand
 * react-use a plain value, never a function, so its stale closure is never consulted.
 */
function useLocalStorageValueSetter<T>(value: T, setStoredValue: (nextValue: T) => void): Dispatch<SetStateAction<T>> {
	const valueRef = useRef(value);
	valueRef.current = value;
	return useCallback(
		(nextValue: SetStateAction<T>) => {
			const resolved = resolveNextValue(nextValue, valueRef.current);
			// Advance the ref now so two updates in the same tick do not both read the old value.
			valueRef.current = resolved;
			setStoredValue(resolved);
		},
		[setStoredValue],
	);
}

export function useBooleanLocalStorageValue(key: string, initialValue: boolean): [boolean, StateSetter<boolean>] {
	const [storedValue, setStoredValue] = useReactUseLocalStorage<boolean>(key, initialValue, {
		raw: false,
		serializer: (value: boolean) => String(value),
		deserializer: (value: string) => value === "true",
	});
	const value = storedValue ?? initialValue;
	const setValue = useLocalStorageValueSetter<boolean>(value, setStoredValue);
	return [value, setValue];
}

export function useRawLocalStorageValue<T extends string>(
	key: string,
	initialValue: T,
	normalize: (value: string) => T | null,
): [T, StateSetter<T>] {
	const [storedValue, setStoredValue] = useReactUseLocalStorage<string>(key, initialValue, {
		raw: true,
	});
	const value = storedValue ? (normalize(storedValue) ?? initialValue) : initialValue;
	const setValue = useLocalStorageValueSetter<T>(value, setStoredValue);
	return [value, setValue];
}

export function useDocumentTitle(title: string): void {
	useReactUseTitle(title);
}

export function useMeasure<T extends Element = Element>() {
	return useReactUseMeasure<T>();
}

export function useUnmount(fn: () => void): void {
	useReactUseUnmount(fn);
}

export function useMedia(query: string, defaultState?: boolean): boolean {
	return useReactUseMedia(query, defaultState);
}
