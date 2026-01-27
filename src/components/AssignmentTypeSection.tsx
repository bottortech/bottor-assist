/**
 * =============================================================================
 * ASSIGNMENT TYPE SECTION
 * =============================================================================
 * 
 * Required dropdown for selecting assignment type. Determines which scoring 
 * UI mode to display (question-based vs rubric-based).
 * 
 * ASSIGNMENT CATEGORIES:
 * - Question-based: Math/Worksheet, Quiz/Test, Short Answer, Reading Comp
 * - Rubric-based: Essay/Writing, Project/Presentation
 * - Other: User chooses which mode
 * =============================================================================
 */

import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, ListChecks, PenTool, Info } from "lucide-react";

export type AssignmentType = 
  | 'math-worksheet'
  | 'quiz-test'
  | 'short-answer'
  | 'reading-comprehension'
  | 'essay-writing'
  | 'project-presentation'
  | 'other';

export type ScoringCategory = 'question-based' | 'rubric-based';

export interface AssignmentTypeConfig {
  value: AssignmentType;
  label: string;
  category: ScoringCategory;
  description?: string;
}

export const ASSIGNMENT_TYPES: AssignmentTypeConfig[] = [
  { 
    value: 'math-worksheet', 
    label: 'Math / Worksheet', 
    category: 'question-based',
    description: 'Question-based assignments with clear right/wrong answers'
  },
  { 
    value: 'quiz-test', 
    label: 'Quiz / Test', 
    category: 'question-based',
    description: 'Assessments with multiple questions'
  },
  { 
    value: 'short-answer', 
    label: 'Short Answer', 
    category: 'question-based',
    description: 'Brief written responses to questions'
  },
  { 
    value: 'reading-comprehension', 
    label: 'Reading Comprehension', 
    category: 'question-based',
    description: 'Questions based on a reading passage'
  },
  { 
    value: 'essay-writing', 
    label: 'Essay / Writing', 
    category: 'rubric-based',
    description: 'Extended writing assignments'
  },
  { 
    value: 'project-presentation', 
    label: 'Project / Presentation', 
    category: 'rubric-based',
    description: 'Creative or research-based projects'
  },
  { 
    value: 'other', 
    label: 'Other', 
    category: 'question-based', // Default, but user can choose
    description: 'Custom assignment type'
  },
];

export function getAssignmentConfig(type: AssignmentType): AssignmentTypeConfig {
  return ASSIGNMENT_TYPES.find(t => t.value === type) || ASSIGNMENT_TYPES[0];
}

export function getScoringCategory(type: AssignmentType): ScoringCategory {
  return getAssignmentConfig(type).category;
}

interface AssignmentTypeSectionProps {
  assignmentType: AssignmentType;
  onAssignmentTypeChange: (type: AssignmentType) => void;
  scoringCategory: ScoringCategory;
  onScoringCategoryChange: (category: ScoringCategory) => void;
  disabled?: boolean;
}

export function AssignmentTypeSection({
  assignmentType,
  onAssignmentTypeChange,
  scoringCategory,
  onScoringCategoryChange,
  disabled = false,
}: AssignmentTypeSectionProps) {
  const isOther = assignmentType === 'other';

  const handleTypeChange = (value: string) => {
    const newType = value as AssignmentType;
    onAssignmentTypeChange(newType);
    
    // Auto-set scoring category based on assignment type (except "Other")
    if (newType !== 'other') {
      onScoringCategoryChange(getScoringCategory(newType));
    }
  };

  return (
    <Card className="border-2 border-primary/30 shadow-lg bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          Assignment Type
          <span className="text-xs font-normal text-destructive ml-1">Required</span>
        </CardTitle>
        <CardDescription>
          Bottor uses your assignment type to pick the best scoring method.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Assignment Type Dropdown */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">What are you grading?</Label>
          <Select
            value={assignmentType}
            onValueChange={handleTypeChange}
            disabled={disabled}
          >
            <SelectTrigger className="w-full bg-background">
              <SelectValue placeholder="Select assignment type..." />
            </SelectTrigger>
            <SelectContent className="bg-popover border shadow-lg z-50">
              {ASSIGNMENT_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  <div className="flex items-center gap-2">
                    {type.category === 'question-based' ? (
                      <ListChecks className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <PenTool className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span>{type.label}</span>
                    <span className="text-xs text-muted-foreground">
                      ({type.category === 'question-based' ? 'question-based' : 'rubric-based'})
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* "Other" type: show category choice */}
        {isOther && (
          <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-muted">
            <Label className="text-sm font-medium">Is this question-based or rubric-based?</Label>
            <div className="flex gap-3">
              <Button
                type="button"
                variant={scoringCategory === 'question-based' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onScoringCategoryChange('question-based')}
                className="flex-1"
              >
                <ListChecks className="w-4 h-4 mr-2" />
                Question-based
              </Button>
              <Button
                type="button"
                variant={scoringCategory === 'rubric-based' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onScoringCategoryChange('rubric-based')}
                className="flex-1"
              >
                <PenTool className="w-4 h-4 mr-2" />
                Rubric-based
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {scoringCategory === 'question-based' 
                ? 'Uses points per question for scoring.' 
                : 'Uses total points or rubric categories for scoring.'}
            </p>
          </div>
        )}

        {/* Info note about selected type */}
        {!isOther && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-muted">
            <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              {getAssignmentConfig(assignmentType).description}
              {scoringCategory === 'question-based' 
                ? ' — Best for assignments with clear question counts.' 
                : ' — Best for writing and projects with multiple criteria.'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
