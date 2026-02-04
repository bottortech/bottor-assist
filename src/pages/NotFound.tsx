import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { BottorLogo } from "@/components/BottorLogo";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="text-center">
        <div className="mb-6">
          <BottorLogo size={64} className="mx-auto opacity-50" />
        </div>
        <h1 className="mb-4 text-6xl font-bold text-foreground">404</h1>
        <p className="mb-6 text-xl text-muted-foreground">Oops! Page not found</p>
        <a 
          href="/" 
          className="inline-flex items-center justify-center h-12 px-6 rounded-[10px] bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
        >
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
