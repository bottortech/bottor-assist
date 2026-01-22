/**
 * =============================================================================
 * ORGANIZER GRADER COMPONENT
 * =============================================================================
 * 
 * PURPOSE: Grade 8th grade Graphic Essay Organizers (15pt rubric)
 * 
 * DATA FLOW:
 * 1. Teacher uploads image OR pastes OCR text
 * 2. If image: run OCR to extract text
 * 3. Send text + prompt to grade-organizer edge function
 * 4. Display per-source scoring grid and feedback
 * 5. Allow editing and regeneration
 * =============================================================================
 */

import { useState, useRef } from 'react';
import type { Json } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Upload,
  FileText,
  Sparkles,
  Loader2,
  X,
  Edit2,
  RefreshCw,
  Check,
  AlertTriangle,
  Save,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  gradeGraphicOrganizer,
  recalculateSourceScore,
  recalculateTotalScore,
  type OrganizerGradeResult,
  type SourceGrade,
  type SourceCategories,
} from '@/lib/organizer-grader';

export default function OrganizerGrader() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Input state
  const [file, setFile] = useState<File | null>(null);
  const [ocrText, setOcrText] = useState('');
  const [promptText, setPromptText] = useState('');
  const [manualText, setManualText] = useState('');

  // Processing state
  const [extractingText, setExtractingText] = useState(false);
  const [grading, setGrading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Results state
  const [result, setResult] = useState<OrganizerGradeResult | null>(null);
  const [editingScore, setEditingScore] = useState(false);
  const [editedSources, setEditedSources] = useState<SourceGrade[]>([]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!validTypes.includes(selectedFile.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a JPG or PNG image.',
        variant: 'destructive',
      });
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please upload an image smaller than 10MB.',
        variant: 'destructive',
      });
      return;
    }

    setFile(selectedFile);
    setOcrText('');
    setManualText('');
    setResult(null);
  };

  const removeFile = () => {
    setFile(null);
    setOcrText('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const extractText = async () => {
    if (!file) return;

    setExtractingText(true);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke('extract-text', {
        body: {
          file_base64: base64,
          file_type: file.type,
          file_name: file.name,
        },
      });

      if (error) throw error;

      setOcrText(data.extracted_text || '');
      toast({ title: 'Text extracted successfully!' });
    } catch (error) {
      console.error('Error extracting text:', error);
      toast({
        title: 'OCR failed',
        description: 'Could not extract text. Try pasting manually.',
        variant: 'destructive',
      });
    } finally {
      setExtractingText(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleGrade = async (strictness?: 'stricter' | 'kinder') => {
    const textToGrade = ocrText || manualText;
    if (!textToGrade.trim()) {
      toast({
        title: 'No text to grade',
        description: 'Please upload an image and extract text, or paste text manually.',
        variant: 'destructive',
      });
      return;
    }

    setGrading(true);
    try {
      const gradeResult = await gradeGraphicOrganizer({
        promptText: promptText || '',
        studentWorkText: textToGrade,
        strictness,
      });

      setResult(gradeResult);
      setEditedSources(JSON.parse(JSON.stringify(gradeResult.per_source || [])));
      setEditingScore(false);
      toast({ title: 'Grading complete!' });
    } catch (error) {
      console.error('Error grading:', error);
      toast({
        title: 'Grading failed',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setGrading(false);
    }
  };

  const updateCategoryScore = (
    sourceIndex: number,
    category: keyof SourceCategories,
    value: number
  ) => {
    setEditedSources((prev) => {
      const updated = [...prev];
      updated[sourceIndex] = {
        ...updated[sourceIndex],
        categories: {
          ...updated[sourceIndex].categories,
          [category]: {
            ...updated[sourceIndex].categories[category],
            score: value,
          },
        },
      };
      // Recalculate source total
      updated[sourceIndex].score = recalculateSourceScore(updated[sourceIndex].categories);
      return updated;
    });
  };

  const getEditedTotal = () => {
    return recalculateTotalScore(editedSources);
  };

  const handleSave = async () => {
    if (!user || !result) return;

    setSaving(true);
    try {
      const finalResult = {
        ...result,
        per_source: editedSources,
        total_score: getEditedTotal(),
      };

      const sessionData = {
        user_id: user.id,
        status: 'completed',
        title: 'Graphic Essay Organizer Grade',
        snippet: `Score: ${finalResult.total_score}/15`,
        summary_json: JSON.parse(JSON.stringify(finalResult)) as Json,
        transcript: ocrText || manualText,
        teacher_notes: promptText || null,
      };

      const { error } = await supabase.from('sessions').insert([sessionData]);
      if (error) throw error;

      toast({ title: 'Grade saved to history!' });
    } catch (error) {
      console.error('Error saving:', error);
      toast({
        title: 'Save failed',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const ScoreCell = ({
    value,
    onChange,
    editable,
    notes,
  }: {
    value: number;
    onChange?: (v: number) => void;
    editable: boolean;
    notes?: string;
  }) => {
    const getBgColor = () => {
      if (value >= 1) return 'bg-primary/20 text-primary';
      if (value >= 0.5) return 'bg-accent text-accent-foreground';
      return 'bg-destructive/20 text-destructive';
    };

    if (editable && onChange) {
      return (
        <select
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className={`w-16 p-1 rounded text-center text-sm font-medium ${getBgColor()}`}
          title={notes}
        >
          <option value={0}>0</option>
          <option value={0.5}>0.5</option>
          <option value={1}>1</option>
        </select>
      );
    }

    return (
      <span
        className={`inline-block w-10 py-1 rounded text-center text-sm font-medium ${getBgColor()}`}
        title={notes}
      >
        {value}
      </span>
    );
  };

  const textToGrade = ocrText || manualText;
  const canGrade = textToGrade.trim().length > 0;

  // Get sources for rendering
  const sourcesToRender = editingScore ? editedSources : (result?.per_source || []);

  return (
    <Card className="border-0 shadow-md bg-card-gradient">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          Grade Graphic Organizer (8th Grade, 15pt)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Input Mode Toggle */}
        <div className="flex gap-2 p-1 bg-muted rounded-lg">
          <Button
            variant={!manualText && !ocrText ? 'default' : file ? 'default' : 'ghost'}
            size="sm"
            className="flex-1"
            onClick={() => {
              if (manualText) {
                setManualText('');
              }
            }}
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload Image
          </Button>
          <Button
            variant={manualText ? 'default' : 'ghost'}
            size="sm"
            className="flex-1"
            onClick={() => {
              if (file) {
                removeFile();
              }
            }}
          >
            <FileText className="w-4 h-4 mr-2" />
            Paste Text Manually
          </Button>
        </div>

        {/* File Upload Section */}
        {!manualText && (
          <div className="space-y-2">
            <Label>Upload Organizer Image (JPG/PNG)</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png"
              onChange={handleFileSelect}
              className="hidden"
            />
            {!file ? (
              <Button
                variant="outline"
                className="w-full h-24 border-dashed"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-5 h-5 mr-2" />
                Click to upload image
              </Button>
            ) : (
              <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                <FileText className="w-5 h-5 text-primary" />
                <span className="flex-1 truncate text-sm">{file.name}</span>
                <Button variant="ghost" size="sm" onClick={removeFile}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}

            {/* Extract Text Button */}
            {file && !ocrText && (
              <Button onClick={extractText} disabled={extractingText} className="w-full">
                {extractingText ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                Extract Text (OCR)
              </Button>
            )}

            {/* OCR Result */}
            {ocrText && (
              <div className="space-y-2">
                <Label>Extracted Text (editable)</Label>
                <Textarea
                  value={ocrText}
                  onChange={(e) => setOcrText(e.target.value)}
                  rows={6}
                  className="font-mono text-sm"
                />
              </div>
            )}

            {/* Fallback hint */}
            {file && !ocrText && !extractingText && (
              <p className="text-xs text-muted-foreground text-center">
                OCR not working? Use "Paste Text Manually" to type what the student wrote.
              </p>
            )}
          </div>
        )}

        {/* Manual Text Entry Section */}
        {(manualText || (!file && !ocrText)) && !file && (
          <div className="space-y-2">
            <Label>Paste Text Manually</Label>
            <Textarea
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder="Type or paste what the student wrote on their organizer...

Example format:
Source 1:
- Title: [title]
- Author: [author]
- Central Idea: [idea]
- Evidence: [quote or detail]
- Analysis: [response to prompt]

Source 2:
..."
              rows={8}
            />
            <p className="text-xs text-muted-foreground">
              Copy-type exactly what the student wrote. Mark unclear handwriting as [illegible].
            </p>
          </div>
        )}

        {/* Teacher Prompt */}
        <div className="space-y-2">
          <Label>Analysis Prompt (optional)</Label>
          <Input
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder='e.g., "According to this source, what was the consequence of fascism?"'
          />
          <p className="text-xs text-muted-foreground">
            If the organizer has a specific analysis question, enter it here for accurate grading.
          </p>
        </div>

        {/* Grade Button */}
        <Button onClick={() => handleGrade()} disabled={!canGrade || grading} className="w-full" size="lg">
          {grading ? (
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          ) : (
            <Sparkles className="w-5 h-5 mr-2" />
          )}
          Grade Organizer
        </Button>

        {/* Results */}
        {result && (
          <div className="space-y-4 pt-4 border-t animate-fade-in">
            {/* Total Score */}
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold">
                Total Score: {editingScore ? getEditedTotal() : result.total_score} / 15
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingScore(!editingScore)}
              >
                {editingScore ? <Check className="w-4 h-4 mr-1" /> : <Edit2 className="w-4 h-4 mr-1" />}
                {editingScore ? 'Done' : 'Edit Scores'}
              </Button>
            </div>

            {/* Per-Source Scoring Grid */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-2">Source</th>
                    <th className="text-center py-2 px-1">Title</th>
                    <th className="text-center py-2 px-1">Author</th>
                    <th className="text-center py-2 px-1">Central Idea</th>
                    <th className="text-center py-2 px-1">Evidence</th>
                    <th className="text-center py-2 px-1">Analysis</th>
                    <th className="text-center py-2 pl-2 font-bold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sourcesToRender.map((source, idx) => (
                    <tr key={idx} className="border-b">
                      <td className="py-2 pr-2 font-medium">{source.source_label}</td>
                      <td className="text-center py-2 px-1">
                        <ScoreCell
                          value={source.categories.source_title.score}
                          editable={editingScore}
                          onChange={(v) => updateCategoryScore(idx, 'source_title', v)}
                          notes={source.categories.source_title.notes}
                        />
                      </td>
                      <td className="text-center py-2 px-1">
                        <ScoreCell
                          value={source.categories.source_author.score}
                          editable={editingScore}
                          onChange={(v) => updateCategoryScore(idx, 'source_author', v)}
                          notes={source.categories.source_author.notes}
                        />
                      </td>
                      <td className="text-center py-2 px-1">
                        <ScoreCell
                          value={source.categories.central_idea.score}
                          editable={editingScore}
                          onChange={(v) => updateCategoryScore(idx, 'central_idea', v)}
                          notes={source.categories.central_idea.notes}
                        />
                      </td>
                      <td className="text-center py-2 px-1">
                        <ScoreCell
                          value={source.categories.evidence_cited.score}
                          editable={editingScore}
                          onChange={(v) => updateCategoryScore(idx, 'evidence_cited', v)}
                          notes={source.categories.evidence_cited.notes}
                        />
                      </td>
                      <td className="text-center py-2 px-1">
                        <ScoreCell
                          value={source.categories.analysis_item.score}
                          editable={editingScore}
                          onChange={(v) => updateCategoryScore(idx, 'analysis_item', v)}
                          notes={source.categories.analysis_item.notes}
                        />
                      </td>
                      <td className="text-center py-2 pl-2 font-bold">{source.score}/5</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Teacher Note (illegible sections) */}
            {result.teacher_note && (
              <div className="flex items-start gap-2 p-3 bg-accent/50 border border-accent rounded-lg">
                <AlertTriangle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Teacher Note</p>
                  <p className="text-sm text-muted-foreground">{result.teacher_note}</p>
                </div>
              </div>
            )}

            {/* Evidence Quality */}
            {result.evidence_quality && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">
                  Evidence Quality: <span className="capitalize">{result.evidence_quality.overall}</span>
                </p>
                {result.evidence_quality.notes?.length > 0 && (
                  <ul className="list-disc list-inside text-sm">
                    {result.evidence_quality.notes.map((note, idx) => (
                      <li key={idx}>{note}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Actionable Feedback */}
            {result.actionable_feedback?.length > 0 && (
              <div className="space-y-2">
                <p className="font-medium">Actionable Feedback</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {result.actionable_feedback.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Feedback Paragraph */}
            {result.feedback_paragraph && (
              <div className="space-y-1 p-3 bg-muted rounded-lg">
                <p className="font-medium text-sm">Feedback for Student</p>
                <p className="text-sm">{result.feedback_paragraph}</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleGrade('stricter')}
                disabled={grading}
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                Regenerate (Stricter)
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleGrade('kinder')}
                disabled={grading}
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                Regenerate (Kinder)
              </Button>
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-1" />
                )}
                Save to History
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
