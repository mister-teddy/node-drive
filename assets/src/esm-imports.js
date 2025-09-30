/**
 * Central ESM imports file
 * All external ESM dependencies are imported here and re-exported
 * This makes it easier to manage versions and provides a single source of truth
 */

// React exports
/**
 * @typedef {import("https://esm.sh/react@18.3.1").ReactElement} ReactElement
 * @typedef {import("https://esm.sh/react@18.3.1").ReactNode} ReactNode
 * @typedef {import("https://esm.sh/react@18.3.1").ComponentType} ComponentType
 * @typedef {import("https://esm.sh/react@18.3.1").RefObject} RefObject
 * @typedef {import("https://esm.sh/react@18.3.1").MutableRefObject} MutableRefObject
 */

/**
 * @template T
 * @typedef {[T, (value: T | ((prev: T) => T)) => void]} StateHook
 */

/**
 * Create a React element
 * @type {import("https://esm.sh/react@18.3.1").createElement}
 */
export { createElement } from "https://esm.sh/react@18.3.1";

/**
 * React useState hook
 * @template T
 * @type {<T>(initialState: T | (() => T)) => StateHook<T>}
 */
export { useState } from "https://esm.sh/react@18.3.1";

/**
 * React useEffect hook
 * @type {(effect: () => (void | (() => void)), deps?: any[]) => void}
 */
export { useEffect } from "https://esm.sh/react@18.3.1";

/**
 * React useRef hook
 * @template T
 * @type {<T>(initialValue: T) => MutableRefObject<T>}
 */
export { useRef } from "https://esm.sh/react@18.3.1";

/**
 * React useCallback hook
 * @template T
 * @type {<T extends Function>(callback: T, deps: any[]) => T}
 */
export { useCallback } from "https://esm.sh/react@18.3.1";

/**
 * React useMemo hook
 * @template T
 * @type {<T>(factory: () => T, deps: any[]) => T}
 */
export { useMemo } from "https://esm.sh/react@18.3.1";

// React DOM exports
/**
 * Create a React root for rendering
 * @type {import("https://esm.sh/react-dom@18.3.1/client").createRoot}
 */
export { createRoot } from "https://esm.sh/react-dom@18.3.1/client";

// Default React export
import React from "https://esm.sh/react@18.3.1";
export { React };

// MobX exports
/**
 * MobX autorun - automatically re-run when observables change
 * @type {(view: () => any) => () => void}
 */
export { autorun } from "https://esm.sh/mobx@6.15.0";

/**
 * MobX toJS - convert observable to plain JavaScript object
 * @template T
 * @type {<T>(value: T) => T}
 */
export { toJS } from "https://esm.sh/mobx@6.15.0";

/**
 * MobX observable - create observable object
 * @template T
 * @type {<T extends object>(value: T) => T}
 */
export { observable } from "https://esm.sh/mobx@6.15.0";

/**
 * MobX makeObservable - make class properties observable
 * @type {<T extends object>(target: T, annotations?: any, options?: any) => T}
 */
export { makeObservable, makeAutoObservable } from "https://esm.sh/mobx@6.15.0";

/**
 * MobX action - mark method as action that modifies state
 * @type {PropertyDecorator & ((fn: Function) => Function)}
 */
export { action } from "https://esm.sh/mobx@6.15.0";

/**
 * MobX computed - mark getter as computed value
 * @type {PropertyDecorator & (<T>(fn: () => T) => T)}
 */
export { computed } from "https://esm.sh/mobx@6.15.0";