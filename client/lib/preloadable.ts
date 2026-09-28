/**
 * A lazily loaded component that stops being lazy once its chunk is in.
 *
 * `React.lazy` only asks for its module the first time it renders, so a chunk
 * that finished downloading long ago still suspends once — and React then
 * keeps the Suspense fallback on screen for at least 300 ms before revealing
 * the real screen. Once `preload()` has resolved, the component here renders
 * the loaded module directly and never suspends; before that it is an
 * ordinary `React.lazy`, fallback and all.
 */

import { createElement, lazy, type ComponentType } from 'react';

export function preloadable<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;

  const preload = (): Promise<ComponentType<P>> => {
    pending ??= load().then(
      (component) => {
        loaded = component;
        return component;
      },
      (error: unknown) => {
        // Let a later attempt try the network again.
        pending = null;
        throw error;
      },
    );
    return pending;
  };

  // `loaded` is set before this resolves, so the retry after a suspension
  // already renders the real component rather than the lazy wrapper.
  const Lazy = lazy(() => preload().then((component) => ({ default: component })));

  function Preloadable(props: P) {
    return createElement(loaded ?? Lazy, props);
  }

  return { Component: Preloadable, preload };
}
