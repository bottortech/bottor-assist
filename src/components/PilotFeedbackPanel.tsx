/**
 * Non-blocking slide-in feedback panel for pilot users.
 * Appears from bottom-right after grading, triggered by:
 * - User scrolling through results, OR
 * - 45 seconds after grading completes (whichever first)
 */

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Star, X, CheckCircle2, ThumbsUp, ThumbsDown, Minus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type QuickAnswer = 'yes' | 'somewhat' | 'no' | null;

interface PilotFeedbackPanelProps {
  show: boolean;
  onDismiss: () => void;
  onSkip: () => void;
}

// Session storage key to track if feedback was dismissed/submitted
const FEEDBACK_DISMISSED_KEY = 'bottor_pilot_feedback_dismissed';

export function PilotFeedbackPanel({ show, onDismiss, onSkip }: PilotFeedbackPanelProps) {
  const [rating, setRating] = useState<number | null>(null);
  const [hoveredRating, setHoveredRating] = useState<number | null>(null);
  const [accuracyAnswer, setAccuracyAnswer] = useState<QuickAnswer>(null);
  const [timeSavedAnswer, setTimeSavedAnswer] = useState<QuickAnswer>(null);
  const [issuesAnswer, setIssuesAnswer] = useState<QuickAnswer>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const { toast } = useToast();

  // Animate in when show becomes true
  useEffect(() => {
    if (show) {
      // Small delay for smoother animation
      const timer = setTimeout(() => setIsVisible(true), 100);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [show]);

  const handleSubmit = () => {
    // Log feedback for pilot (could be sent to analytics later)
    console.log('[Pilot Feedback]', {
      rating,
      accuracyAnswer,
      timeSavedAnswer,
      issuesAnswer,
      comment,
      timestamp: new Date().toISOString(),
    });

    setSubmitted(true);
    
    // Mark as dismissed in session storage
    sessionStorage.setItem(FEEDBACK_DISMISSED_KEY, 'true');

    toast({ title: 'Thank you for your feedback!' });

    setTimeout(() => {
      onDismiss();
      // Reset state
      setRating(null);
      setAccuracyAnswer(null);
      setTimeSavedAnswer(null);
      setIssuesAnswer(null);
      setComment('');
      setSubmitted(false);
    }, 1500);
  };

  const handleSkip = () => {
    // Mark as skipped in session storage
    sessionStorage.setItem(FEEDBACK_DISMISSED_KEY, 'skipped');
    console.log('[Pilot Feedback] Skipped', { timestamp: new Date().toISOString() });
    onSkip();
  };

  const handleDismiss = () => {
    // Mark as dismissed in session storage
    sessionStorage.setItem(FEEDBACK_DISMISSED_KEY, 'dismissed');
    onDismiss();
  };

  const displayRating = hoveredRating ?? rating;

  // Quick answer button component
  const QuickAnswerButton = ({
    value,
    selected,
    onClick,
    icon: Icon,
    label,
    variant = 'default',
  }: {
    value: QuickAnswer;
    selected: boolean;
    onClick: () => void;
    icon: React.ElementType;
    label: string;
    variant?: 'positive' | 'neutral' | 'negative' | 'default';
  }) => {
    const variantClasses = {
      positive: selected ? 'bg-green-100 border-green-500 text-green-700' : 'hover:bg-green-50',
      neutral: selected ? 'bg-amber-100 border-amber-500 text-amber-700' : 'hover:bg-amber-50',
      negative: selected ? 'bg-red-100 border-red-500 text-red-700' : 'hover:bg-red-50',
      default: selected ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-muted',
    };

    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors',
          variantClasses[variant]
        )}
      >
        <Icon className="w-3.5 h-3.5" />
        {label}
      </button>
    );
  };

  if (!show) return null;

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50 w-[340px] max-w-[calc(100vw-2rem)] transition-all duration-300 ease-out',
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      )}
    >
      <Card className="shadow-xl border-primary/20 bg-background/95 backdrop-blur-sm">
        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 p-1 rounded-full hover:bg-muted transition-colors"
          aria-label="Dismiss feedback"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>

        <CardHeader className="pb-3 pr-10">
          <CardTitle className="text-base">How was your experience?</CardTitle>
          <CardDescription className="text-xs">
            Quick feedback helps us improve Bottor Assist.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {submitted ? (
            <div className="py-6 text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-6 h-6 text-primary" />
              </div>
              <p className="text-foreground font-medium text-sm">Thanks for the feedback!</p>
            </div>
          ) : (
            <>
              {/* Star Rating */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Overall rating</p>
                <div className="flex items-center justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      onMouseEnter={() => setHoveredRating(star)}
                      onMouseLeave={() => setHoveredRating(null)}
                      className="p-0.5 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary rounded"
                      aria-label={`Rate ${star} stars`}
                    >
                      <Star
                        className={cn(
                          'w-7 h-7 transition-colors',
                          displayRating && star <= displayRating
                            ? 'text-primary fill-primary'
                            : 'text-muted-foreground/30'
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Questions */}
              <div className="space-y-3 pt-2">
                {/* Accuracy Question */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Was the grading accurate?</p>
                  <div className="flex gap-2 flex-wrap">
                    <QuickAnswerButton
                      value="yes"
                      selected={accuracyAnswer === 'yes'}
                      onClick={() => setAccuracyAnswer('yes')}
                      icon={ThumbsUp}
                      label="Yes"
                      variant="positive"
                    />
                    <QuickAnswerButton
                      value="somewhat"
                      selected={accuracyAnswer === 'somewhat'}
                      onClick={() => setAccuracyAnswer('somewhat')}
                      icon={Minus}
                      label="Somewhat"
                      variant="neutral"
                    />
                    <QuickAnswerButton
                      value="no"
                      selected={accuracyAnswer === 'no'}
                      onClick={() => setAccuracyAnswer('no')}
                      icon={ThumbsDown}
                      label="No"
                      variant="negative"
                    />
                  </div>
                </div>

                {/* Time Saved Question */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Did feedback save you time?</p>
                  <div className="flex gap-2 flex-wrap">
                    <QuickAnswerButton
                      value="yes"
                      selected={timeSavedAnswer === 'yes'}
                      onClick={() => setTimeSavedAnswer('yes')}
                      icon={ThumbsUp}
                      label="Yes"
                      variant="positive"
                    />
                    <QuickAnswerButton
                      value="somewhat"
                      selected={timeSavedAnswer === 'somewhat'}
                      onClick={() => setTimeSavedAnswer('somewhat')}
                      icon={Minus}
                      label="Somewhat"
                      variant="neutral"
                    />
                    <QuickAnswerButton
                      value="no"
                      selected={timeSavedAnswer === 'no'}
                      onClick={() => setTimeSavedAnswer('no')}
                      icon={ThumbsDown}
                      label="No"
                      variant="negative"
                    />
                  </div>
                </div>

                {/* Issues Question */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Any issues with name detection or scoring?</p>
                  <div className="flex gap-2 flex-wrap">
                    <QuickAnswerButton
                      value="no"
                      selected={issuesAnswer === 'no'}
                      onClick={() => setIssuesAnswer('no')}
                      icon={ThumbsUp}
                      label="No issues"
                      variant="positive"
                    />
                    <QuickAnswerButton
                      value="somewhat"
                      selected={issuesAnswer === 'somewhat'}
                      onClick={() => setIssuesAnswer('somewhat')}
                      icon={Minus}
                      label="Minor"
                      variant="neutral"
                    />
                    <QuickAnswerButton
                      value="yes"
                      selected={issuesAnswer === 'yes'}
                      onClick={() => setIssuesAnswer('yes')}
                      icon={ThumbsDown}
                      label="Yes"
                      variant="negative"
                    />
                  </div>
                </div>
              </div>

              {/* Optional Comment */}
              <div className="space-y-1.5">
                <Textarea
                  placeholder="Any other thoughts? (optional)"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="resize-none h-16 text-sm"
                  maxLength={300}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  className="text-muted-foreground text-xs"
                >
                  Skip
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!rating}
                  size="sm"
                  className="flex-1 text-xs"
                >
                  Send Feedback
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Hook to manage feedback panel timing and visibility
 */
export function usePilotFeedback(isGuest: boolean, gradingComplete: boolean) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollListenerRef = useRef<(() => void) | null>(null);

  // Check if feedback was already dismissed/skipped this session
  const wasDismissed = () => {
    return sessionStorage.getItem(FEEDBACK_DISMISSED_KEY) !== null;
  };

  // Trigger feedback when conditions are met
  const triggerFeedback = () => {
    if (!wasDismissed() && isGuest) {
      setShowFeedback(true);
    }
  };

  // Set up scroll listener and timeout when grading completes
  useEffect(() => {
    if (gradingComplete && isGuest && !wasDismissed()) {
      // Set up timeout (45 seconds)
      timeoutRef.current = setTimeout(() => {
        triggerFeedback();
      }, 45000);

      // Set up scroll listener
      const handleScroll = () => {
        if (!hasScrolled) {
          setHasScrolled(true);
          // Wait a moment after scroll to show feedback
          setTimeout(() => {
            triggerFeedback();
          }, 2000);
        }
      };

      scrollListenerRef.current = handleScroll;
      window.addEventListener('scroll', handleScroll, { passive: true });

      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        if (scrollListenerRef.current) {
          window.removeEventListener('scroll', scrollListenerRef.current);
        }
      };
    }
  }, [gradingComplete, isGuest, hasScrolled]);

  // Reset when grading starts again
  useEffect(() => {
    if (!gradingComplete) {
      setShowFeedback(false);
      setHasScrolled(false);
    }
  }, [gradingComplete]);

  const dismissFeedback = () => {
    setShowFeedback(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  };

  const skipFeedback = () => {
    setShowFeedback(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  };

  return {
    showFeedback,
    dismissFeedback,
    skipFeedback,
  };
}
