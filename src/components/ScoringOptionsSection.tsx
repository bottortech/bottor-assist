/**
 * =============================================================================
 * SCORING OPTIONS SECTION
 * =============================================================================
 * 
 * Flexible scoring configuration for the Grade Papers workflow.
 * Simplified for pilot: shows unified scoring UI without assignment type.
 * Bottor infers feedback style automatically from uploaded content.
 * 
 * SCORING MODES:
 * - Feedback-only (default, no score)
 * - Auto-score with Points per Question or Total Points
 * - Rubric-based with Quick Rubric categories
 * =============================================================================
 */

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Info, Calculator, FileText, MessageSquare, Plus, Trash2 } from "lucide-react";

export type ScoringMode = 'feedback-only' | 'auto-score' | 'rubric-based';

export interface AutoScoreSettings {
  totalPoints: number | null;
  pointsPerQuestion: number | null;
  questionCount: number | null;
  partialCreditAllowed: boolean;
  usePointsPerQuestion: boolean; // true = points per question, false = total points
}

export interface RubricCategory {
  id: string;
  name: string;
  points: number;
}

export interface QuickRubricSettings {
  enabled: boolean;
  categories: RubricCategory[];
  totalPoints: number | null; // Used when quick rubric is disabled
}

interface ScoringOptionsSectionProps {
  scoringMode: ScoringMode;
  onScoringModeChange: (mode: ScoringMode) => void;
  autoScoreSettings: AutoScoreSettings;
  onAutoScoreSettingsChange: (settings: AutoScoreSettings) => void;
  quickRubricSettings: QuickRubricSettings;
  onQuickRubricSettingsChange: (settings: QuickRubricSettings) => void;
  hasRubric: boolean;
  disabled?: boolean;
}

const DEFAULT_RUBRIC_CATEGORIES: RubricCategory[] = [
  { id: '1', name: 'Organization', points: 5 },
  { id: '2', name: 'Evidence / Reasoning', points: 5 },
  { id: '3', name: 'Clarity', points: 5 },
  { id: '4', name: 'Conventions (grammar/spelling)', points: 5 },
];

export function ScoringOptionsSection({
  scoringMode,
  onScoringModeChange,
  autoScoreSettings,
  onAutoScoreSettingsChange,
  quickRubricSettings,
  onQuickRubricSettingsChange,
  hasRubric,
  disabled = false,
}: ScoringOptionsSectionProps) {
  
  const updateAutoScore = (updates: Partial<AutoScoreSettings>) => {
    onAutoScoreSettingsChange({ ...autoScoreSettings, ...updates });
  };

  const updateQuickRubric = (updates: Partial<QuickRubricSettings>) => {
    onQuickRubricSettingsChange({ ...quickRubricSettings, ...updates });
  };

  const addRubricCategory = () => {
    const newId = Date.now().toString();
    updateQuickRubric({
      categories: [...quickRubricSettings.categories, { id: newId, name: '', points: 5 }]
    });
  };

  const updateCategory = (id: string, updates: Partial<RubricCategory>) => {
    updateQuickRubric({
      categories: quickRubricSettings.categories.map(c => 
        c.id === id ? { ...c, ...updates } : c
      )
    });
  };

  const removeCategory = (id: string) => {
    updateQuickRubric({
      categories: quickRubricSettings.categories.filter(c => c.id !== id)
    });
  };

  const quickRubricTotal = quickRubricSettings.categories.reduce((sum, c) => sum + (c.points || 0), 0);

  // Check if auto-score settings are valid
  const autoScoreValid = autoScoreSettings.usePointsPerQuestion
    ? (autoScoreSettings.pointsPerQuestion !== null && autoScoreSettings.questionCount !== null)
    : autoScoreSettings.totalPoints !== null;

  return (
    <Card className="border border-muted">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Calculator className="w-4 h-4" />
          Scoring Options
          <span className="text-xs font-normal">(Optional)</span>
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Enable scoring to generate numeric grades. Leave off for feedback-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        
        {/* Feedback-only mode info (default) */}
        {scoringMode === 'feedback-only' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-muted">
            <MessageSquare className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                Feedback-only mode (default)
              </p>
              <p className="text-xs text-muted-foreground">
                Generates Strengths, Areas for Improvement, and Draft Feedback without a numeric score. Enable scoring below to generate grades.
              </p>
            </div>
          </div>
        )}

        {/* Auto-score toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg border border-muted bg-muted/10">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium cursor-pointer flex items-center gap-2">
              <Calculator className="w-4 h-4 text-primary" />
              Auto-score with simple rules
            </Label>
            <p className="text-xs text-muted-foreground">
              Calculate scores based on correct/incorrect answers
            </p>
          </div>
          <Switch
            checked={scoringMode === 'auto-score'}
            onCheckedChange={(checked) => {
              if (checked) {
                onScoringModeChange('auto-score');
                // Disable quick rubric when switching to auto-score
                if (quickRubricSettings.enabled) {
                  updateQuickRubric({ enabled: false });
                }
              } else {
                onScoringModeChange('feedback-only');
              }
            }}
            disabled={disabled}
          />
        </div>

        {/* Auto-score settings (when enabled) */}
        {scoringMode === 'auto-score' && (
          <div className="space-y-4 p-4 rounded-lg bg-muted/20 border border-muted">
            {/* Point calculation method tabs */}
            <Tabs 
              value={autoScoreSettings.usePointsPerQuestion ? 'per-question' : 'total-points'}
              onValueChange={(v) => updateAutoScore({ usePointsPerQuestion: v === 'per-question' })}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2 h-9">
                <TabsTrigger value="per-question" className="text-xs">
                  Points per question
                </TabsTrigger>
                <TabsTrigger value="total-points" className="text-xs">
                  Total points
                </TabsTrigger>
              </TabsList>

              {/* Points per question tab */}
              <TabsContent value="per-question" className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">
                      Points per question <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.5"
                      placeholder="e.g., 1"
                      value={autoScoreSettings.pointsPerQuestion ?? ''}
                      onChange={(e) => updateAutoScore({ 
                        pointsPerQuestion: e.target.value ? parseFloat(e.target.value) : null 
                      })}
                      className={`h-9 ${autoScoreSettings.pointsPerQuestion === null ? 'border-amber-400 focus-visible:ring-amber-400' : ''}`}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">
                      Number of questions <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="number"
                      min="1"
                      placeholder="e.g., 10"
                      value={autoScoreSettings.questionCount ?? ''}
                      onChange={(e) => updateAutoScore({ 
                        questionCount: e.target.value ? parseInt(e.target.value) : null 
                      })}
                      className={`h-9 ${autoScoreSettings.questionCount === null ? 'border-amber-400 focus-visible:ring-amber-400' : ''}`}
                    />
                  </div>
                </div>
                {/* Calculated total */}
                {autoScoreSettings.pointsPerQuestion && autoScoreSettings.questionCount && (
                  <div className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1.5">
                    Total: {autoScoreSettings.pointsPerQuestion * autoScoreSettings.questionCount} points
                  </div>
                )}
              </TabsContent>

              {/* Total points tab */}
              <TabsContent value="total-points" className="mt-4">
                <div className="space-y-1">
                  <Label className="text-xs">
                    Total points possible <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="e.g., 10"
                    value={autoScoreSettings.totalPoints ?? ''}
                    onChange={(e) => updateAutoScore({ 
                      totalPoints: e.target.value ? parseFloat(e.target.value) : null 
                    })}
                    className={`h-9 w-32 ${autoScoreSettings.totalPoints === null ? 'border-amber-400 focus-visible:ring-amber-400' : ''}`}
                  />
                </div>
              </TabsContent>
            </Tabs>

            {/* Partial credit toggle */}
            <div className="flex items-center justify-between pt-3 border-t border-muted">
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

        {/* Quick Rubric option (for writing/projects) */}
        <div className="space-y-3 p-3 rounded-lg border border-muted bg-muted/10">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium cursor-pointer flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                Quick Rubric
                <span className="text-xs font-normal text-muted-foreground">(for essays/projects)</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                Score by category for consistent grading
              </p>
            </div>
            <Button
              type="button"
              variant={quickRubricSettings.enabled ? "default" : "outline"}
              size="sm"
              onClick={() => {
                const enabling = !quickRubricSettings.enabled;
                updateQuickRubric({ 
                  enabled: enabling,
                  categories: enabling && quickRubricSettings.categories.length === 0 
                    ? DEFAULT_RUBRIC_CATEGORIES 
                    : quickRubricSettings.categories
                });
                onScoringModeChange(enabling ? 'rubric-based' : 'feedback-only');
              }}
              disabled={disabled}
            >
              {quickRubricSettings.enabled ? 'Using Quick Rubric' : 'Use Quick Rubric'}
            </Button>
          </div>

          {/* Editable rubric categories */}
          {quickRubricSettings.enabled && (
            <div className="space-y-3 pt-3 border-t border-muted">
              {quickRubricSettings.categories.map((category) => (
                <div key={category.id} className="flex items-center gap-2">
                  <Input
                    placeholder="Category name"
                    value={category.name}
                    onChange={(e) => updateCategory(category.id, { name: e.target.value })}
                    className="flex-1 h-8 text-sm"
                  />
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min="0"
                      value={category.points}
                      onChange={(e) => updateCategory(category.id, { 
                        points: parseInt(e.target.value) || 0 
                      })}
                      className="w-16 h-8 text-sm text-center"
                    />
                    <span className="text-xs text-muted-foreground">pts</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeCategory(category.id)}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
              
              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addRubricCategory}
                  className="h-8 text-xs"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add category
                </Button>
                <div className="text-sm font-medium">
                  Total: <span className="text-primary">{quickRubricTotal} pts</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Helper text */}
        {(scoringMode === 'auto-score' || scoringMode === 'rubric-based') && (
          <div className="flex items-start gap-2 p-2 rounded bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
            <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {scoringMode === 'auto-score' 
                ? 'Bottor will calculate scores based on your point settings and detected correct/incorrect answers.'
                : 'Bottor will score each rubric category and provide a total score.'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const DEFAULT_AUTO_SCORE_SETTINGS: AutoScoreSettings = {
  totalPoints: null,
  pointsPerQuestion: null,
  questionCount: null,
  partialCreditAllowed: true,
  usePointsPerQuestion: true,
};

export const DEFAULT_QUICK_RUBRIC_SETTINGS: QuickRubricSettings = {
  enabled: false,
  categories: [],
  totalPoints: null,
};

/**
 * Validate that auto-score settings have required values
 */
export function validateAutoScoreSettings(settings: AutoScoreSettings): boolean {
  if (settings.usePointsPerQuestion) {
    return settings.pointsPerQuestion !== null && settings.questionCount !== null;
  }
  return settings.totalPoints !== null;
}

/**
 * Get max score from quick rubric settings
 */
export function getMaxScoreFromQuickRubric(settings: QuickRubricSettings): number | null {
  if (settings.enabled && settings.categories.length > 0) {
    return settings.categories.reduce((sum, c) => sum + (c.points || 0), 0);
  }
  return settings.totalPoints;
}
