import React, { useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { AppShell } from "../components/Layout/AppShell";
import { FreeCanvasPage } from "../pages/FreeCanvasPage";
import { SimplePage } from "../pages/SimplePage";
import { WorkflowPage } from "../pages/WorkflowPage";
import { GalleryPage } from "../pages/GalleryPage";
import { SettingsPage } from "../pages/SettingsPage";
import { OnboardingPage } from "../pages/OnboardingPage";
import { isSetupRequired, useConfigStore } from "../stores/useConfigStore";

/**
 * Sends a browser that has never seen a provider key to the setup page. It runs
 * once per app load: the guide remembers being skipped or finished, so clearing
 * a key later in Settings does not yank the user back here.
 */
function FirstRunGate() {
  const navigate = useNavigate();

  useEffect(() => {
    if (window.location.pathname === "/onboarding") return;
    if (isSetupRequired(useConfigStore.getState())) {
      navigate("/onboarding", { replace: true });
    }
    // Deliberately mount-only; see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <FirstRunGate />
      <Routes>
        {/* Standalone: a first-run browser should not see the workbench nav
            until it has an endpoint and a model to work with. */}
        <Route path="/onboarding" element={<OnboardingPage />} />

        <Route element={<AppShell />}>
          <Route path="/" element={<FreeCanvasPage />} />
          <Route path="/simple" element={<SimplePage />} />
          <Route path="/workflow" element={<WorkflowPage />} />
          {/* Legacy route: /canvas was the old node canvas path. Keep bookmarks working. */}
          <Route path="/canvas" element={<Navigate to="/workflow" replace />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
