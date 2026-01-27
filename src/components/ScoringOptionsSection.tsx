/**
 * =============================================================================
 * SCORING OPTIONS SECTION
 * =============================================================================
 * 
 * Flexible scoring configuration for the Grade Papers workflow.
 * 
 * MODES:
 * 1. Feedback-only (default) - No numeric score
 * 2. Auto-score with simple rules - Points per question + partial credit
 * 3. Rubric-based scoring - Uses uploaded rubric criteria
 * =============================================================================
 */

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Info, Calculator, FileText, MessageSquare } from "lucide-react";

export type ScoringMode = 'feedback-only' | 'auto-score' | 'rubric-based';

export interface AutoScoreSettings {
  totalPoints: number | null;
  pointsPerQuestion: number | null;
  questionCount: number | null;
  partialCreditAllowed: boolean;
  usePointsPerQuestion: boolean; // true = points per question, false = total points
}

interface ScoringOptionsSectionProps {
  scoringMode: ScoringMode;
  onScoringModeChange: (mode: ScoringMode) => void;
  autoScoreSettings: AutoScoreSettings;
  onAutoScoreSettingsChange: (settings: AutoScoreSettings) => void;
  hasRubric: boolean;
  disabled?: boolean;
}

export function ScoringOptionsSection({
  scoringMode,
  onScoringModeChange,
  autoScoreSettings,
  onAutoScoreSettingsChange,
  hasRubric,
  disabled = false,
}: ScoringOptionsSectionProps) {
  const updateAutoScore = (updates: Partial<AutoScoreSettings>) => {
    onAutoScoreSettingsChange({ ...autoScoreSettings, ...updates });
  };

  return (
    <Card className="border border-muted">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Calculator className="w-4 h-4" />
          Scoring Options
          <span className="text-xs font-normal">(Optional)</span>
        </CardTitle>
        <CardDescription className="text-xs">
          Choose how scores should be calculated. Default is feedback-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup
          value={scoringMode}
          onValueChange={(v) => onScoringModeChange(v as ScoringMode)}
          disabled={disabled}
          className="space-y-3"
        >
          {/* Feedback Only */}
          <div className="flex items-start space-x-3">
            <RadioGroupItem value="feedback-only" id="feedback-only" className="mt-1" />
            <div className="flex-1 space-y-1">
              <Label htmlFor="feedback-only" className="text-sm font-medium cursor-pointer flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                Feedback only
                <span className="text-xs font-normal text-muted-foreground">(default)</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                No numeric score generated. Best when no point values are established.
              </p>
            </div>
          </div>

          {/* Auto-Score */}
          <div className="flex items-start space-x-3">
            <RadioGroupItem value="auto-score" id="auto-score" className="mt-1" />
            <div className="flex-1 space-y-3">
              <Label htmlFor="auto-score" className="text-sm font-medium cursor-pointer flex items-center gap-2">
                <Calculator className="w-4 h-4 text-muted-foreground" />
                Auto-score with simple rules
              </Label>
              <p className="text-xs text-muted-foreground">
                Calculate scores based on correct/incorrect answers using point rules you define.
              </p>
              
              {/* Auto-score settings (visible when selected) */}
              {scoringMode === 'auto-score' && (
                <div className="space-y-3 p-3 rounded-lg bg-muted/30 border border-muted">
                  {/* Point method toggle */}
                  <div className="flex items-center gap-4">
                    <Label className="text-xs text-muted-foreground">Calculate by:</Label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => updateAutoScore({ usePointsPerQuestion: false })}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                          !autoScoreSettings.usePointsPerQuestion
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        Total points
                      </button>
                      <button
                        type="button"
                        onClick={() => updateAutoScore({ usePointsPerQuestion: true })}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                          autoScoreSettings.usePointsPerQuestion
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        Points per question
                      </button>
                    </div>
                  </div>

                  {/* Point inputs */}
                  {autoScoreSettings.usePointsPerQuestion ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Points per question <span className="text-destructive">*</span></Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.5"
                          placeholder="e.g., 2"
                          value={autoScoreSettings.pointsPerQuestion ?? ''}
                          onChange={(e) => updateAutoScore({ 
                            pointsPerQuestion: e.target.value ? parseFloat(e.target.value) : null 
                          })}
                          className={`h-8 ${autoScoreSettings.pointsPerQuestion === null ? 'border-amber-400 focus-visible:ring-amber-400' : ''}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Number of questions <span className="text-destructive">*</span></Label>
                        <Input
                          type="number"
                          min="1"
                          placeholder="e.g., 10"
                          value={autoScoreSettings.questionCount ?? ''}
                          onChange={(e) => updateAutoScore({ 
                            questionCount: e.target.value ? parseInt(e.target.value) : null 
                          })}
                          className={`h-8 ${autoScoreSettings.questionCount === null ? 'border-amber-400 focus-visible:ring-amber-400' : ''}`}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Label className="text-xs">Total points possible <span className="text-destructive">*</span></Label>
                      <Input
                        type="number"
                        min="0"
                        placeholder="e.g., 100"
                        value={autoScoreSettings.totalPoints ?? ''}
                        onChange={(e) => updateAutoScore({ 
                          totalPoints: e.target.value ? parseFloat(e.target.value) : null 
                        })}
                        className={`h-8 w-32 ${autoScoreSettings.totalPoints === null ? 'border-amber-400 focus-visible:ring-amber-400' : ''}`}
                      />
                    </div>
                  )}

                  {/* Validation warning */}
                  {(autoScoreSettings.usePointsPerQuestion 
                    ? (autoScoreSettings.pointsPerQuestion === null || autoScoreSettings.questionCount === null)
                    : autoScoreSettings.totalPoints === null
                  ) && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <Info className="w-3 h-3" />
                      Enter point values above to enable numeric scoring
                    </p>
                  )}

                  {/* Partial credit toggle */}
                  <div className="flex items-center justify-between pt-2 border-t border-muted">
                    <div className="space-y-0.5">
                      <Label htmlFor="partial-credit" className="text-xs font-medium cursor-pointer">
                        Allow partial credit
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Award points for partially correct work
                      </p>
                    </div>
                    <Switch
                      id="partial-credit"
                      checked={autoScoreSettings.partialCreditAllowed}
                      onCheckedChange={(checked) => updateAutoScore({ partialCreditAllowed: checked })}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Rubric-based */}
          <div className="flex items-start space-x-3">
            <RadioGroupItem value="rubric-based" id="rubric-based" className="mt-1" disabled={!hasRubric} />
            <div className="flex-1 space-y-1">
              <Label 
                htmlFor="rubric-based" 
                className={`text-sm font-medium cursor-pointer flex items-center gap-2 ${!hasRubric ? 'opacity-50' : ''}`}
              >
                <FileText className="w-4 h-4 text-muted-foreground" />
                Rubric-based scoring
              </Label>
              <p className="text-xs text-muted-foreground">
                {hasRubric 
                  ? 'Use the uploaded rubric or criteria to calculate scores.'
                  : 'Upload a rubric above to enable this option.'}
              </p>
            </div>
          </div>
        </RadioGroup>

        {/* Transparency note */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Bottor never guesses point values. Scores are calculated strictly from the rules you provide, with explanations for how each score was derived.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export const DEFAULT_AUTO_SCORE_SETTINGS: AutoScoreSettings = {
  totalPoints: null,
  pointsPerQuestion: null,
  questionCount: null,
  partialCreditAllowed: true,
  usePointsPerQuestion: false,
};

/**
 * Validate that auto-score settings have required values
 * Returns true if valid, false if missing required fields
 */
export function validateAutoScoreSettings(settings: AutoScoreSettings): boolean {
  if (settings.usePointsPerQuestion) {
    return settings.pointsPerQuestion !== null && settings.questionCount !== null;
  }
  return settings.totalPoints !== null;
}

/**
 * Get the computed max score from auto-score settings
 */
export function getMaxScoreFromSettings(settings: AutoScoreSettings): number | null {
  if (settings.usePointsPerQuestion) {
    if (settings.pointsPerQuestion !== null && settings.questionCount !== null) {
      return settings.pointsPerQuestion * settings.questionCount;
    }
  } else if (settings.totalPoints !== null) {
    return settings.totalPoints;
  }
  return null;
}
