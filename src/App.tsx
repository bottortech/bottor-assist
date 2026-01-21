/**
 * =============================================================================
 * APPLICATION ROUTER
 * =============================================================================
 * 
 * NEXT.JS MIGRATION NOTE:
 * Routes are defined here and map to Next.js file-based routing:
 * - / → app/page.tsx
 * - /auth → app/auth/page.tsx
 * - /quick-notes → app/quick-notes/page.tsx
 * - /listen → app/listen/page.tsx
 * - /processing/:sessionId → app/processing/[sessionId]/page.tsx
 * - /session/:sessionId → app/session/[sessionId]/page.tsx
 * - /history → app/history/page.tsx
 * 
 * ROUTE STRUCTURE (STABLE):
 * - / (Home) - Entry point with navigation
 * - /quick-notes - Manual lesson notes entry
 * - /listen - Audio recording (beta)
 * - /processing/:sessionId - Audio processing status
 * - /session/:sessionId - View session details
 * - /history - Session list/search
 * =============================================================================
 */

import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";

// [ROUTE: /] Home page with navigation options
import Index from "./pages/Index";

// [ROUTE: /auth] Authentication page
import Auth from "./pages/Auth";

// [ROUTE: /quick-notes] Manual lesson notes entry
import QuickNotes from "./pages/QuickNotes";

// [ROUTE: /listen] Audio recording (beta feature)
import Listen from "./pages/Listen";

// [ROUTE: /processing/:sessionId] Audio processing status
import Processing from "./pages/Processing";

// [ROUTE: /session/:sessionId] Session detail view
import Session from "./pages/Session";

// [ROUTE: /history] Session list and search
import History from "./pages/History";

// [ROUTE: *] 404 fallback
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Primary Routes */}
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/quick-notes" element={<QuickNotes />} />
            <Route path="/history" element={<History />} />
            <Route path="/session/:sessionId" element={<Session />} />
            
            {/* Audio Flow Routes (Beta) */}
            <Route path="/listen" element={<Listen />} />
            <Route path="/processing/:sessionId" element={<Processing />} />
            
            {/* Legacy Route Redirects - maintain backward compatibility */}
            {/* NEXT.JS MIGRATION: Handle these in middleware.ts */}
            <Route path="/summaries" element={<History />} />
            <Route path="/summary/:sessionId" element={<Session />} />
            
            {/* 404 Fallback */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
