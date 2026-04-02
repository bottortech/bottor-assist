/**
 * =============================================================================
 * APPLICATION ROUTER
 * =============================================================================
 * 
 * ROUTE STRUCTURE:
 * - / (Home) - Entry point with navigation
 * - /grade - Grade papers with AI feedback
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
import { GuestModeProvider } from "@/hooks/useGuestMode";

// [ROUTE: /] Home page with navigation options
import Index from "./pages/Index";

// [ROUTE: /auth] Authentication page
import Auth from "./pages/Auth";

// [ROUTE: /grade] Grade papers with AI feedback
import GradePapers from "./pages/GradePapers";

// [ROUTE: /samples] Sample grading library
import SampleGrading from "./pages/SampleGrading";

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
      <GuestModeProvider>
        <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Primary Routes */}
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/grade" element={<GradePapers />} />
            <Route path="/history" element={<History />} />
            <Route path="/session/:sessionId" element={<Session />} />
            
            {/* Audio Flow Routes (Beta) */}
            <Route path="/listen" element={<Listen />} />
            <Route path="/processing/:sessionId" element={<Processing />} />
            
            {/* Legacy Route Redirects */}
            <Route path="/summaries" element={<History />} />
            <Route path="/summary/:sessionId" element={<Session />} />
            
            {/* 404 Fallback */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        </TooltipProvider>
      </GuestModeProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
