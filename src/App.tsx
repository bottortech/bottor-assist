import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Listen from "./pages/Listen";
import Processing from "./pages/Processing";
import Summary from "./pages/Summary";
import Summaries from "./pages/Summaries";
import QuickNotes from "./pages/QuickNotes";
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
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/listen" element={<Listen />} />
            <Route path="/quick-notes" element={<QuickNotes />} />
            <Route path="/processing/:sessionId" element={<Processing />} />
            <Route path="/summary/:sessionId" element={<Summary />} />
            <Route path="/summaries" element={<Summaries />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
