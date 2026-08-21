import { Outlet } from '@modern-js/runtime/router';
import type { JSX } from 'react';

import '@reach/ui/styles.css';

/**
 * The shell around every auth screen.
 *
 * Deliberately plain. Tenant branding arrives with `platform.tenant_branding`,
 * and until it does a neutral page is the honest thing to render rather than a
 * placeholder logo somebody has to remember to remove.
 */
export default function Layout(): JSX.Element {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <Outlet />
    </div>
  );
}
