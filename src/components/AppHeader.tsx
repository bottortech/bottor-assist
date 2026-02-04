import { BottorLogo } from "./BottorLogo";
import { useAuth } from "@/hooks/useAuth";
import { useGuestMode } from "@/hooks/useGuestMode";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface AppHeaderProps {
  showUserMenu?: boolean;
  onSignOut?: () => void;
}

export function AppHeader({ showUserMenu = true, onSignOut }: AppHeaderProps) {
  const { user, signOut } = useAuth();
  const { isGuest, exitGuestMode } = useGuestMode();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    if (onSignOut) {
      onSignOut();
    } else {
      if (isGuest) {
        exitGuestMode();
      } else {
        await signOut();
      }
      navigate('/auth');
    }
  };

  const hasAccess = user || isGuest;

  return (
    <div className="w-full">
      {/* Main Header */}
      <header className="px-6 py-4 flex justify-between items-center bg-background">
        <div className="flex items-center gap-3">
          <BottorLogo size={36} />
          <span className="text-lg font-bold text-foreground">Bottor Assist</span>
        </div>
        
        {showUserMenu && hasAccess && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="w-4 h-4 mr-2" />
            {isGuest ? 'Exit' : 'Sign Out'}
          </Button>
        )}
      </header>
      
      {/* Status Banner */}
      <div className="w-full bg-background border-b border-border py-2.5 px-4 text-center">
        <p className="text-[13px] text-muted-foreground">
          Early access version — features may evolve based on educator feedback
        </p>
      </div>
    </div>
  );
}
