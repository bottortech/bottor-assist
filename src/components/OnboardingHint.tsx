import { useEffect, useState } from "react";
import { X, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "bottor.onboardingHint.gradePapers.dismissed";

/**
 * Light, one-time onboarding hint for first-time users on /grade.
 * Dismissible and persists via localStorage. No popups or modals.
 */
export function OnboardingHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY);
      if (!dismissed) setVisible(true);
    } catch {
      // ignore (private mode, etc.)
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
  };

  if (!visible) return null;

  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg border border-primary/30 bg-primary/5 animate-fade-in"
      role="status"
    >
      <Lightbulb className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
      <div className="flex-1 text-xs text-foreground/80 space-y-0.5">
        <p className="font-medium text-foreground">New here? Three quick steps:</p>
        <p className="text-muted-foreground">
          Upload student work → click Generate → review and edit before sharing. Everything stays editable.
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={dismiss}
        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss tip"
      >
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
