/**
 * Lightweight feedback modal for guest users after grading completes.
 * Collects quick rating and optional comment to improve Bottor Assist.
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Star, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface GuestFeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

export function GuestFeedbackModal({ open, onClose }: GuestFeedbackModalProps) {
  const [rating, setRating] = useState<number | null>(null);
  const [hoveredRating, setHoveredRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const handleSubmit = () => {
    // For pilot, just log feedback (could be sent to analytics later)
    console.log('[Pilot Feedback]', { rating, comment, timestamp: new Date().toISOString() });
    setSubmitted(true);
    toast({ title: 'Thank you for your feedback!' });
    setTimeout(() => {
      onClose();
      // Reset state for next time
      setRating(null);
      setComment('');
      setSubmitted(false);
    }, 1500);
  };

  const handleSkip = () => {
    onClose();
    setRating(null);
    setComment('');
    setSubmitted(false);
  };

  const displayRating = hoveredRating ?? rating;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleSkip()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">How was your experience?</DialogTitle>
          <DialogDescription className="text-sm">
            Quick feedback helps us improve Bottor Assist.
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="py-8 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Star className="w-6 h-6 text-primary fill-primary" />
            </div>
            <p className="text-foreground font-medium">Thanks for the feedback!</p>
          </div>
        ) : (
          <>
            {/* Star Rating */}
            <div className="flex items-center justify-center gap-1 py-4">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(null)}
                  className="p-1 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary rounded"
                  aria-label={`Rate ${star} stars`}
                >
                  <Star
                    className={`w-8 h-8 transition-colors ${
                      displayRating && star <= displayRating
                        ? 'text-primary fill-primary'
                        : 'text-muted-foreground/30'
                    }`}
                  />
                </button>
              ))}
            </div>

            {/* Optional Comment */}
            <div className="space-y-2">
              <Textarea
                placeholder="Any suggestions? (optional)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="resize-none h-20"
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground text-right">
                {comment.length}/500
              </p>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkip}
                className="text-muted-foreground"
              >
                Skip
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!rating}
                size="sm"
              >
                Send Feedback
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
