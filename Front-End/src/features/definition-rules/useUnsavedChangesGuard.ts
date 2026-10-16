import { useEffect } from 'react';

const DEFAULT_MESSAGE = 'You have unsaved changes to this definition. Leave without saving?';

/**
 * Warn before unsaved work is lost: when the tab is closed or reloaded, and when a link leaving `keepPathPrefix`
 * is clicked (the app uses a component router, which cannot block navigation on its own).
 */
export function useUnsavedChangesGuard(
  dirty: boolean,
  { keepPathPrefix, message = DEFAULT_MESSAGE }: { keepPathPrefix?: string; message?: string } = {},
) {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (keepPathPrefix && url.pathname.startsWith(keepPathPrefix)) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, keepPathPrefix, message]);
}
