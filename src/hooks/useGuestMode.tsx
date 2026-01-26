/**
 * =============================================================================
 * GUEST MODE HOOK
 * =============================================================================
 * 
 * Manages guest session state for pilot testing.
 * - Guest sessions are temporary (memory only)
 * - No persistence to database
 * - Can be upgraded to authenticated session
 * =============================================================================
 */

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface GuestSession {
  id: string;
  createdAt: Date;
  gradingResults: GuestGradingResult[];
}

interface GuestGradingResult {
  id: string;
  studentName: string;
  score: string;
  strengths: string;
  areasForImprovement: string;
  feedback: string;
  createdAt: Date;
}

interface GuestModeContextType {
  isGuest: boolean;
  guestSession: GuestSession | null;
  enterGuestMode: () => void;
  exitGuestMode: () => void;
  addGradingResult: (result: Omit<GuestGradingResult, 'id' | 'createdAt'>) => void;
  clearGuestSession: () => void;
}

const GuestModeContext = createContext<GuestModeContextType | undefined>(undefined);

export function GuestModeProvider({ children }: { children: ReactNode }) {
  const [isGuest, setIsGuest] = useState(false);
  const [guestSession, setGuestSession] = useState<GuestSession | null>(null);

  const enterGuestMode = useCallback(() => {
    setIsGuest(true);
    setGuestSession({
      id: crypto.randomUUID(),
      createdAt: new Date(),
      gradingResults: [],
    });
  }, []);

  const exitGuestMode = useCallback(() => {
    setIsGuest(false);
    setGuestSession(null);
  }, []);

  const addGradingResult = useCallback((result: Omit<GuestGradingResult, 'id' | 'createdAt'>) => {
    setGuestSession(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        gradingResults: [
          ...prev.gradingResults,
          {
            ...result,
            id: crypto.randomUUID(),
            createdAt: new Date(),
          },
        ],
      };
    });
  }, []);

  const clearGuestSession = useCallback(() => {
    setGuestSession(prev => prev ? { ...prev, gradingResults: [] } : null);
  }, []);

  return (
    <GuestModeContext.Provider
      value={{
        isGuest,
        guestSession,
        enterGuestMode,
        exitGuestMode,
        addGradingResult,
        clearGuestSession,
      }}
    >
      {children}
    </GuestModeContext.Provider>
  );
}

export function useGuestMode() {
  const context = useContext(GuestModeContext);
  if (context === undefined) {
    throw new Error('useGuestMode must be used within a GuestModeProvider');
  }
  return context;
}
