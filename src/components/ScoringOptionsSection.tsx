/**
 * =============================================================================
 * SCORING OPTIONS SECTION
 * =============================================================================
 * 
 * Flexible scoring configuration for the Grade Papers workflow.
 * Adapts UI based on assignment type (question-based vs rubric-based).
 * 
 * QUESTION-BASED MODES:
 * - Feedback-only (no score)
 * - Auto-score with Points per Question or Total Points
 * 
 * RUBRIC-BASED MODES:
 * - Feedback-only (no score)
 * - Total points only
 * - Quick Rubric (editable categories)
 * =============================================================================
 */

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Info, Calculator, FileText, MessageSquare, Plus, Trash2, AlertTriangle } from "lucide-react";
import type { ScoringCategory } from "./AssignmentTypeSection";

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
  scoringCategory: ScoringCategory;
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
  scoringCategory,
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

  // Check if rubric-based settings are valid
  const rubricScoreValid = quickRubricSettings.enabled 
    ? quickRubricSettings.categories.length > 0 && quickRubricTotal > 0
    : quickRubricSettings.totalPoints !== null;

  // Determine if scoring is properly configured
  const isScoringConfigured = scoringMode === 'feedback-only' 
    || (scoringMode === 'auto-score' && autoScoreValid)
    || (scoringMode === 'rubric-based' && (rubricScoreValid || hasRubric));

  // Show warning if in scoring mode but settings are incomplete
  const showScoringWarning = scoringMode !== 'feedback-only' && !isScoringConfigured;

  return (
    <Card className="border border-muted">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Calculator className="w-4 h-4" />
          Scoring Options
          <span className="text-xs font-normal">(Optional)</span>
        </CardTitle>
        <CardDescription className="text-xs">
          {scoringCategory === 'question-based' 
            ? 'Configure how question-based assignments should be scored.'
            : 'Configure how writing or project-based work should be scored.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        
        {/* ===== QUESTION-BASED SCORING UI ===== */}
        {scoringCategory === 'question-based' && (
          <>
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
                onCheckedChange={(checked) => onScoringModeChange(checked ? 'auto-score' : 'feedback-only')}
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

                {/* Note for question-based */}
                <div className="flex items-start gap-2 p-2 rounded bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                  <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Best for assignments with clear question counts.
                  </p>
                </div>
              </div>
            )}

            {/* Feedback-only note */}
            {scoringMode === 'feedback-only' && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-muted">
                <MessageSquare className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  No numeric score will be generated. Best when no point values are established.
                </p>
              </div>
            )}
          </>
        )}

        {/* ===== RUBRIC-BASED SCORING UI ===== */}
        {scoringCategory === 'rubric-based' && (
          <>
            {/* Rubric / Writing Score section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <Label className="text-sm font-medium">Rubric / Writing Score</Label>
              </div>

              {/* Option 1: Total points only (default) */}
              <div className="space-y-3 p-4 rounded-lg bg-muted/20 border border-muted">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium cursor-pointer">
                      Total points only
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Single overall score for the assignment
                    </p>
                  </div>
                  <Switch
                    checked={!quickRubricSettings.enabled}
                    onCheckedChange={(checked) => {
                      updateQuickRubric({ enabled: !checked });
                      onScoringModeChange(checked ? 'auto-score' : (quickRubricSettings.enabled ? 'rubric-based' : 'auto-score'));
                    }}
                    disabled={disabled}
                  />
                </div>

                {!quickRubricSettings.enabled && (
                  <div className="space-y-1 pt-2">
                    <Label className="text-xs">
                      Total points possible <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="e.g., 20"
                      value={quickRubricSettings.totalPoints ?? ''}
                      onChange={(e) => {
                        updateQuickRubric({ 
                          totalPoints: e.target.value ? parseFloat(e.target.value) : null 
                        });
                        if (e.target.value) {
                          onScoringModeChange('auto-score');
                          updateAutoScore({ totalPoints: parseFloat(e.target.value), usePointsPerQuestion: false });
                        }
                      }}
                      className={`h-9 w-32 ${quickRubricSettings.totalPoints === null ? 'border-amber-400 focus-visible:ring-amber-400' : ''}`}
                    />
                  </div>
                )}
              </div>

              {/* Option 2: Quick Rubric (optional) */}
              <div className="space-y-3 p-4 rounded-lg bg-muted/20 border border-muted">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium cursor-pointer flex items-center gap-2">
                      Quick Rubric
                      <span className="text-xs font-normal text-muted-foreground">(optional)</span>
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
                            onChange={(e) => updateCategory(category.id, { points: parseInt(e.target.value) || 0 })}
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
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addRubricCategory}
                      className="w-full"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Category
                    </Button>

                    {/* Total display */}
                    <div className="flex items-center justify-between pt-2 border-t border-muted">
                      <Label className="text-sm font-medium">Total Points</Label>
                      <span className="text-lg font-bold text-primary">{quickRubricTotal}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Helper text for rubric-based */}
              <div className="flex items-start gap-2 p-2 rounded bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  Use Total Points for fast scoring. Use Quick Rubric for consistent writing/project grading.
                </p>
              </div>
            </div>

            {/* Feedback-only fallback */}
            {scoringMode === 'feedback-only' && !quickRubricSettings.enabled && quickRubricSettings.totalPoints === null && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-muted">
                <MessageSquare className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  No scoring configured. Set total points or use Quick Rubric to enable scoring.
                </p>
              </div>
            )}
          </>
        )}

        {/* ===== SCORING WARNING ===== */}
        {showScoringWarning && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Add scoring settings (total points or question count) to generate a score. Feedback will still be generated.
            </p>
          </div>
        )}

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
  totalPoints: 10,
  pointsPerQuestion: 1,
  questionCount: null,
  partialCreditAllowed: true,
  usePointsPerQuestion: true,
};

export const DEFAULT_QUICK_RUBRIC_SETTINGS: QuickRubricSettings = {
  enabled: false,
  categories: [],
  totalPoints: 20,
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

/**
 * Get max score from quick rubric settings
 */
export function getMaxScoreFromQuickRubric(settings: QuickRubricSettings): number | null {
  if (settings.enabled) {
    const total = settings.categories.reduce((sum, c) => sum + (c.points || 0), 0);
    return total > 0 ? total : null;
  }
  return settings.totalPoints;
}
