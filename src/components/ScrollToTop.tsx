import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Scrolls to the top of the page on every route change.
 * React Router v6 does NOT reset scroll position on client-side navigation,
 * so without this the user can land mid-page (e.g. on the product grid)
 * instead of seeing the top of the new page.
 */
export const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
};
