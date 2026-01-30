/**
 * =============================================================================
 * GRADE PAPERS PAGE (/grade) - Multi-Step Workflow v3
 * =============================================================================
 *
 * A streamlined multi-step grading workflow:
 * Step 1: Upload Student Work (required)
 * Step 2: Rubric Input (optional - collapsed accordion)
 * Step 3: Subject Selection (conditional - when auto-detection fails)
 * Step 4: Packet Review (conditional - when grouping confidence is low)
 * Step 5: Results Display
 * =============================================================================
 */

import { useState, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useGuestMode } from "@/hooks/useGuestMode";
import { useFileUpload, UploadedFileItem } from "@/hooks/useFileUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ArrowLeft,
  Upload,
  File,
  Check,
  AlertCircle,
  Info,
  ChevronDown,
  X,
  Download,
  Loader2,
  FileText,
  Image,
  Sparkles,
  Copy,
  RefreshCw,
  User,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { FileUploadList } from "@/components/FileUploadList";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// =============================================================================
// TYPES
// =============================================================================

type WorkflowStep = 
  | "upload" 
  | "rubric" 
  | "subject-select" 
  | "packet-review" 
  | "processing" 
  | "results";

type Subject = "ela" | "math" | "unknown";
type GradingMode = "full" | "feedback-only";

interface SubjectDetectionResult {
  subject: Subject;
  confidence: number;
  reasoning: string;
}

interface PacketMapResult {
  studentName: string;
  imageCount: number;
  confidence: number;
  thumbnailUrl?: string;
  flagged?: boolean;
  issue?: string;
  possibleNames?: string[];
}

interface RubricCriterion {
  name: string;
  earnedPoints: number;
  possiblePoints: number;
}

interface StudentFeedback {
  studentName: string;
  score?: {
    earned: number;
    total: number;
    percent: number;
    letterGrade: string;
  };
  criteria?: RubricCriterion[];
  strengths: string[];
  areasForImprovement: string[];
  nextStep: string;
  confidence: number;
  flags?: string[];
  evidenceSnippets?: string[];
  criterionNotes?: Record<string, string>;
}

interface StudentGroup {
  studentName: string;
  detectedName: string;
  nameSource: "document" | "filename" | "unknown";
  nameConfidence: "high" | "low";
  files: UploadedFileItem[];
  extractedText: string;
  feedback: StudentFeedback | null;
  processing: boolean;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function detectSubjectFromText(text: string): SubjectDetectionResult {
  const lowerText = text.toLowerCase();
  
  // Math indicators
  const mathKeywords = ["equation", "solve", "calculate", "x =", "y =", "graph", "polynomial", "fraction", "multiply", "divide", "sum", "product", "integer", "decimal", "percentage", "area", "volume", "perimeter"];
  const mathPatterns = [/\d+\s*[\+\-\*\/\=]\s*\d+/, /\d+x/, /x\s*=\s*\d+/];
  
  // ELA indicators
  const elaKeywords = ["essay", "paragraph", "thesis", "author", "character", "plot", "theme", "metaphor", "simile", "narrative", "persuasive", "argument", "evidence", "quote", "source", "citation"];
  
  let mathScore = 0;
  let elaScore = 0;
  
  mathKeywords.forEach(kw => { if (lowerText.includes(kw)) mathScore++; });
  mathPatterns.forEach(p => { if (p.test(lowerText)) mathScore += 2; });
  elaKeywords.forEach(kw => { if (lowerText.includes(kw)) elaScore++; });
  
  const totalScore = mathScore + elaScore;
  if (totalScore === 0) {
    return { subject: "unknown", confidence: 0, reasoning: "No subject indicators found in the text." };
  }
  
  if (mathScore > elaScore) {
    const confidence = Math.min(100, Math.round((mathScore / totalScore) * 100));
    return { 
      subject: "math", 
      confidence, 
      reasoning: `Detected ${mathScore} math indicators (equations, calculations, math terms).` 
    };
  } else if (elaScore > mathScore) {
    const confidence = Math.min(100, Math.round((elaScore / totalScore) * 100));
    return { 
      subject: "ela", 
      confidence, 
      reasoning: `Detected ${elaScore} ELA indicators (writing terms, literary devices).` 
    };
  }
  
  return { subject: "unknown", confidence: 50, reasoning: "Mixed subject indicators detected." };
}

function detectStudentNameFromText(text: string): { name: string; source: "document" | "unknown"; confidence: "high" | "low" } {
  if (!text?.trim()) return { name: "", source: "unknown", confidence: "low" };
  
  const lines = text.split("\n").slice(0, 25);
  
  // Look for explicit name patterns
  for (const line of lines) {
    const nameMatch = line.match(/(?:student\s*)?name\s*[:=]\s*([A-Za-z][a-z'-]*(?:\s+[A-Za-z][a-z'-]*)+)/i);
    if (nameMatch?.[1]) {
      const name = nameMatch[1].trim();
      const words = name.split(/\s+/);
      if (words.length >= 2 && words.length <= 4) {
        return { name, source: "document", confidence: "high" };
      }
    }
  }
  
  // Look for name at start of first line
  const firstLine = lines.find(l => l.trim());
  if (firstLine) {
    const startMatch = firstLine.match(/^([A-Z][a-z'-]*\s+[A-Z][a-z'-]*)/);
    if (startMatch?.[1]) {
      return { name: startMatch[1], source: "document", confidence: "low" };
    }
  }
  
  return { name: "", source: "unknown", confidence: "low" };
}

function groupFilesByStudent(files: UploadedFileItem[]): StudentGroup[] {
  const groups: StudentGroup[] = [];
  
  for (const file of files) {
    const detection = detectStudentNameFromText(file.extractedText);
    let studentName = detection.name || "Unknown Student";
    
    // Find existing group or create new
    const existing = groups.find(g => g.studentName === studentName);
    if (existing) {
      existing.files.push(file);
      existing.extractedText = existing.files.map(f => f.extractedText).join("\n\n--- PAGE BREAK ---\n\n");
    } else {
      groups.push({
        studentName,
        detectedName: studentName,
        nameSource: detection.source,
        nameConfidence: detection.confidence,
        files: [file],
        extractedText: file.extractedText,
        feedback: null,
        processing: false,
      });
    }
  }
  
  return groups;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function GradePapers() {
  const { user, loading: authLoading } = useAuth();
  const { isGuest } = useGuestMode();
  const navigate = useNavigate();
  const { toast } = useToast();

  // File input refs
  const studentFileInputRef = useRef<HTMLInputElement>(null);
  const rubricFileInputRef = useRef<HTMLInputElement>(null);

  // File upload hooks
  const studentUpload = useFileUpload({ maxConcurrentExtractions: 3, maxDimension: 1600 });
  const rubricUpload = useFileUpload({ maxConcurrentExtractions: 2, maxDimension: 1600 });

  // ==========================================================================
  // STATE
  // ==========================================================================
  
  // Workflow state
  const [currentStep, setCurrentStep] = useState<WorkflowStep>("upload");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Rubric state
  const [rubricTab, setRubricTab] = useState<"upload" | "paste">("upload");
  const [rubricText, setRubricText] = useState("");
  const [rubricFileName, setRubricFileName] = useState<string | undefined>();
  
  // Subject detection
  const [subject, setSubject] = useState<Subject>("unknown");
  const [subjectDetection, setSubjectDetection] = useState<SubjectDetectionResult | undefined>();
  
  // Grading
  const [gradingMode, setGradingMode] = useState<GradingMode>("feedback-only");
  const [studentGroups, setStudentGroups] = useState<StudentGroup[]>([]);
  const [requiresReview, setRequiresReview] = useState(false);
  
  // Results
  const [feedback, setFeedback] = useState<StudentFeedback[]>([]);
  const [expandedFeedback, setExpandedFeedback] = useState<Set<number>>(new Set());
  
  // Grading criteria accordion (collapsed by default)
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  
  // Copied state for feedback
  const [copied, setCopied] = useState<string | null>(null);

  // ==========================================================================
  // DERIVED STATE
  // ==========================================================================
  
  const hasUploadedImages = studentUpload.files.length > 0;
  const hasReadyImages = studentUpload.files.some(f => f.status === "ready");
  const totalFileSize = studentUpload.files.reduce((sum, f) => sum + f.size, 0);
  
  const hasRubric = useMemo(() => {
    const hasRubricFile = rubricUpload.files.some(f => f.status === "ready");
    const hasRubricText = rubricText.trim().length > 0;
    return hasRubricFile || hasRubricText;
  }, [rubricUpload.files, rubricText]);
  
  const rubricCombinedText = useMemo(() => {
    const extractedText = rubricUpload.files
      .filter(f => f.status === "ready")
      .map(f => f.extractedText?.trim())
      .filter(Boolean)
      .join("\n\n");
    return [extractedText, rubricText.trim()].filter(Boolean).join("\n\n");
  }, [rubricUpload.files, rubricText]);

  const buttonLabel = hasRubric ? "Generate Grade + Feedback" : "Generate Feedback";
  const isProcessing = loading || studentUpload.isExtracting;
  
  // Progress through steps
  const stepProgress = useMemo(() => {
    switch (currentStep) {
      case "upload": return 20;
      case "rubric": return 40;
      case "subject-select": return 50;
      case "packet-review": return 60;
      case "processing": return 80;
      case "results": return 100;
      default: return 0;
    }
  }, [currentStep]);

  // ==========================================================================
  // HANDLERS
  // ==========================================================================

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      studentUpload.addFiles(e.target.files);
    }
    e.target.value = "";
  }, [studentUpload]);

  const handleRubricFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      rubricUpload.addFiles(e.target.files);
      if (e.target.files[0]) {
        setRubricFileName(e.target.files[0].name);
      }
    }
    e.target.value = "";
  }, [rubricUpload]);

  const handleClearAll = useCallback(() => {
    studentUpload.clearAllFiles();
    setStudentGroups([]);
    setFeedback([]);
    setCurrentStep("upload");
    setError(null);
  }, [studentUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files) {
      studentUpload.addFiles(e.dataTransfer.files);
    }
  }, [studentUpload]);

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    toast({ title: `${label} copied!` });
    setTimeout(() => setCopied(null), 2000);
  };

  const toggleFeedbackExpanded = (index: number) => {
    setExpandedFeedback(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // ==========================================================================
  // GRADING LOGIC
  // ==========================================================================

  const handleGenerate = async () => {
    if (!hasReadyImages) {
      toast({ title: "No student work", description: "Upload files first.", variant: "destructive" });
      return;
    }

    setLoading(true);
    setError(null);
    setCurrentStep("processing");

    try {
      // Group files by student
      const readyFiles = studentUpload.files.filter(f => f.status === "ready");
      const groups = groupFilesByStudent(readyFiles);
      setStudentGroups(groups);

      // Detect subject if not already set
      if (subject === "unknown") {
        const combinedText = groups.map(g => g.extractedText).join("\n\n");
        const detection = detectSubjectFromText(combinedText);
        setSubjectDetection(detection);
        
        if (detection.confidence < 60) {
          // Need manual subject selection
          setLoading(false);
          setCurrentStep("subject-select");
          return;
        }
        setSubject(detection.subject);
      }

      // Set grading mode based on rubric presence
      const mode = hasRubric ? "full" : "feedback-only";
      setGradingMode(mode);

      // Grade each student
      const results: StudentFeedback[] = [];
      
      for (const group of groups) {
        try {
          const { data, error: apiError } = await supabase.functions.invoke("grade-paper", {
            body: {
              student_work: group.extractedText,
              rubric: rubricCombinedText || null,
              grading_mode: mode,
              subject: subject !== "unknown" ? subject : undefined,
            },
          });

          if (apiError) throw apiError;

          const result: StudentFeedback = {
            studentName: group.studentName,
            score: mode === "full" && data.score_suggestion ? {
              earned: data.total_score || 0,
              total: data.total_points || 20,
              percent: data.score_percent || 0,
              letterGrade: data.letter_grade || "N/A",
            } : undefined,
            criteria: data.rubric_breakdown?.map((c: any) => ({
              name: c.criterion || c.name,
              earnedPoints: c.earned_points || 0,
              possiblePoints: c.possible_points || 0,
            })),
            strengths: data.strengths?.split("\n").filter(Boolean) || [],
            areasForImprovement: data.areas_for_improvement?.split("\n").filter(Boolean) || [],
            nextStep: data.feedback_paragraph || "",
            confidence: data.confidence === "high" ? 90 : data.confidence === "medium" ? 70 : 50,
            flags: data.scoring_warning ? [data.scoring_warning] : undefined,
          };

          results.push(result);
        } catch (err) {
          console.error(`Grading error for ${group.studentName}:`, err);
          results.push({
            studentName: group.studentName,
            strengths: ["Grading failed"],
            areasForImprovement: ["Please try again"],
            nextStep: err instanceof Error ? err.message : "Unknown error occurred",
            confidence: 0,
            flags: ["error"],
          });
        }
      }

      setFeedback(results);
      setCurrentStep("results");
      toast({ title: `Graded ${results.length} student(s)!` });

    } catch (err) {
      console.error("Grading error:", err);
      setError(err instanceof Error ? err.message : "An error occurred during grading");
      setCurrentStep("upload");
    } finally {
      setLoading(false);
    }
  };

  const handleSubjectSelected = (selectedSubject: Subject) => {
    setSubject(selectedSubject);
    if (selectedSubject === "unknown") {
      setGradingMode("feedback-only");
    }
    // Continue with grading
    handleGenerate();
  };

  const handleRetry = () => {
    setError(null);
    handleGenerate();
  };

  const handleExportCSV = () => {
    if (feedback.length === 0) return;
    
    const headers = ["Student Name", "Score", "Percent", "Letter Grade", "Strengths", "Areas for Improvement", "Next Step"];
    const rows = feedback.map(f => [
      f.studentName,
      f.score ? `${f.score.earned}/${f.score.total}` : "N/A",
      f.score ? `${f.score.percent}%` : "N/A",
      f.score?.letterGrade || "N/A",
      f.strengths.join("; "),
      f.areasForImprovement.join("; "),
      f.nextStep,
    ]);
    
    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grading-results-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast({ title: "CSV exported!" });
  };

  // ==========================================================================
  // LOADING STATE
  // ==========================================================================

  if (authLoading) {
    return (
      <div className="min-h-screen bg-bottor-gradient flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <div className="min-h-screen bg-bottor-gradient">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="text-muted-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Home
            </Button>
            <h1 className="text-xl font-bold text-foreground">Grade Papers</h1>
          </div>
          
          {/* Progress Indicator */}
          <div className="hidden sm:flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Progress</span>
            <Progress value={stepProgress} className="w-24 h-2" />
          </div>
          
          {isGuest && (
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
              Pilot Mode
            </Badge>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 pb-32 md:pb-6">
        {/* Step Progress on Mobile */}
        <div className="sm:hidden mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">
              Step {currentStep === "upload" ? 1 : currentStep === "rubric" ? 2 : currentStep === "results" ? 3 : 2} of 3
            </span>
            <span className="text-xs font-medium text-primary">{stepProgress}%</span>
          </div>
          <Progress value={stepProgress} className="h-2" />
        </div>

        {/* Error Alert */}
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>{error}</span>
              <Button size="sm" variant="outline" onClick={handleRetry}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-6">
          {/* ================================================================
              STEP 1: UPLOAD STUDENT WORK
          ================================================================ */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">1</span>
                </div>
                <div>
                  <CardTitle className="text-lg">Upload Student Work</CardTitle>
                  <CardDescription>
                    Drag and drop or click to upload images of student work
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            
            <CardContent className="space-y-4">
              {/* Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => studentFileInputRef.current?.click()}
                className="relative flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-muted-foreground/30 rounded-lg cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
              >
                <input
                  ref={studentFileInputRef}
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.heic"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Upload className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  JPG, PNG, or HEIC (max 10MB each)
                </p>
              </div>

              {/* Uploaded Files */}
              {hasUploadedImages && (
                <div className="space-y-3">
                  {/* Stats Bar */}
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground">
                        <Image className="w-4 h-4 inline mr-1" />
                        {studentUpload.files.length} image{studentUpload.files.length !== 1 ? "s" : ""}
                      </span>
                      <span className="text-muted-foreground">
                        {formatFileSize(totalFileSize)}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearAll}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-4 h-4 mr-1" />
                      Clear All
                    </Button>
                  </div>

                  {/* File Grid */}
                  <FileUploadList
                    files={studentUpload.files}
                    onRemove={studentUpload.removeFile}
                    onRetry={studentUpload.retryExtraction}
                    label="Uploaded Images"
                    totalFiles={studentUpload.totalFiles}
                    completedFiles={studentUpload.completedFiles}
                    failedFiles={studentUpload.failedFiles}
                    progress={studentUpload.progress}
                    isExtracting={studentUpload.isExtracting}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* ================================================================
              STEP 2: RUBRIC INPUT (Optional - Collapsible)
          ================================================================ */}
          <Collapsible open={criteriaOpen} onOpenChange={setCriteriaOpen}>
            <Card className={`border shadow-sm transition-colors ${
              hasRubric ? "border-primary/30 bg-primary/5" : "border-muted"
            }`}>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <span className="text-sm font-bold text-muted-foreground">2</span>
                      </div>
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          Grading Criteria
                          <Badge variant="outline" className="text-xs font-normal">Optional</Badge>
                        </CardTitle>
                        <CardDescription>
                          {hasRubric 
                            ? "Rubric detected — numeric scoring enabled"
                            : "Add a rubric to enable numeric scoring"
                          }
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasRubric && (
                        <Badge className="bg-primary/20 text-primary border-0">
                          <Check className="w-3 h-3 mr-1" />
                          Ready
                        </Badge>
                      )}
                      <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform ${
                        criteriaOpen ? "rotate-180" : ""
                      }`} />
                    </div>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <CardContent className="pt-0">
                  <Tabs value={rubricTab} onValueChange={(v) => setRubricTab(v as "upload" | "paste")}>
                    <TabsList className="w-full grid grid-cols-2 mb-4">
                      <TabsTrigger value="upload" className="gap-2">
                        <Upload className="w-4 h-4" />
                        Upload File
                      </TabsTrigger>
                      <TabsTrigger value="paste" className="gap-2">
                        <FileText className="w-4 h-4" />
                        Paste Text
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="upload" className="space-y-3">
                      <input
                        ref={rubricFileInputRef}
                        type="file"
                        accept=".txt,.doc,.docx,.pdf,.jpg,.jpeg,.png"
                        onChange={handleRubricFileSelect}
                        className="hidden"
                      />
                      <div
                        onClick={() => rubricFileInputRef.current?.click()}
                        className="flex items-center justify-center w-full h-20 border-2 border-dashed border-muted-foreground/30 rounded-lg cursor-pointer hover:border-primary/50 transition-colors"
                      >
                        <div className="text-center">
                          <File className="w-6 h-6 text-muted-foreground mx-auto mb-1" />
                          <p className="text-sm text-muted-foreground">
                            Upload rubric (PDF, DOC, TXT, or image)
                          </p>
                        </div>
                      </div>

                      {rubricUpload.files.length > 0 && (
                        <div className="space-y-2">
                          {rubricUpload.files.map(file => (
                            <div key={file.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-md">
                              <div className="flex items-center gap-2">
                                <FileText className="w-4 h-4 text-muted-foreground" />
                                <span className="text-sm truncate">{file.fileName}</span>
                                <Badge variant="outline" className="text-xs">
                                  {file.status === "ready" ? "Ready" : file.status}
                                </Badge>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => rubricUpload.removeFile(file.id)}
                                className="h-6 w-6 p-0"
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="paste" className="space-y-3">
                      <Textarea
                        placeholder="Paste your rubric or grading criteria here..."
                        value={rubricText}
                        onChange={(e) => setRubricText(e.target.value)}
                        rows={6}
                        className="resize-none"
                      />
                      <div className="flex justify-end">
                        <span className="text-xs text-muted-foreground">
                          {rubricText.length} characters
                        </span>
                      </div>
                    </TabsContent>
                  </Tabs>

                  {/* Subject Detection Info */}
                  {subjectDetection && subjectDetection.confidence > 0 && (
                    <Alert className="mt-4">
                      <Info className="h-4 w-4" />
                      <AlertTitle className="flex items-center gap-2">
                        Subject Detected
                        <Badge variant={subjectDetection.subject === "math" ? "default" : "secondary"}>
                          {subjectDetection.subject === "math" ? "Math" : subjectDetection.subject === "ela" ? "ELA" : "Unknown"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          ({subjectDetection.confidence}% confidence)
                        </span>
                      </AlertTitle>
                      <AlertDescription className="text-xs mt-1">
                        {subjectDetection.reasoning}
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* ================================================================
              STEP 3: SUBJECT SELECTION (Conditional)
          ================================================================ */}
          {currentStep === "subject-select" && (
            <Card className="border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  <div>
                    <CardTitle className="text-lg">Select Subject</CardTitle>
                    <CardDescription>
                      We couldn't automatically detect the subject. Please select one to continue.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <RadioGroup
                  value={subject}
                  onValueChange={(v) => setSubject(v as Subject)}
                  className="space-y-3"
                >
                  <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                    <RadioGroupItem value="ela" id="ela" />
                    <Label htmlFor="ela" className="cursor-pointer flex-1">
                      <span className="font-medium">ELA / Writing</span>
                      <p className="text-xs text-muted-foreground">Essays, paragraphs, reading responses</p>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                    <RadioGroupItem value="math" id="math" />
                    <Label htmlFor="math" className="cursor-pointer flex-1">
                      <span className="font-medium">Math</span>
                      <p className="text-xs text-muted-foreground">Calculations, equations, problem-solving</p>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                    <RadioGroupItem value="unknown" id="feedback-only" />
                    <Label htmlFor="feedback-only" className="cursor-pointer flex-1">
                      <span className="font-medium">Continue with Feedback-Only Mode</span>
                      <p className="text-xs text-muted-foreground">Skip subject detection and provide general feedback</p>
                    </Label>
                  </div>
                </RadioGroup>

                <Button onClick={() => handleSubjectSelected(subject)} className="w-full">
                  Continue
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ================================================================
              STEP 4: PROCESSING STATE
          ================================================================ */}
          {currentStep === "processing" && (
            <Card className="border shadow-sm">
              <CardContent className="py-12">
                <div className="flex flex-col items-center justify-center text-center">
                  <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Generating Feedback...</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Analyzing {studentGroups.length} student{studentGroups.length !== 1 ? "s" : ""}' work
                  </p>
                  <Progress value={50} className="w-64 h-2" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* ================================================================
              STEP 5: RESULTS DISPLAY
          ================================================================ */}
          {currentStep === "results" && feedback.length > 0 && (
            <Card className="border shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5 text-primary-foreground" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Results</CardTitle>
                      <CardDescription className="flex items-center gap-2">
                        <Badge variant={gradingMode === "full" ? "default" : "secondary"}>
                          {subject === "ela" ? "ELA" : subject === "math" ? "Math" : "General"}
                        </Badge>
                        <Badge variant="outline">
                          {gradingMode === "full" ? "Full Grading" : "Feedback Only"}
                        </Badge>
                      </CardDescription>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleExportCSV}>
                      <Download className="w-4 h-4 mr-2" />
                      CSV
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {feedback.map((student, index) => (
                  <Card key={index} className="border shadow-sm overflow-hidden">
                    {/* Student Header */}
                    <CardHeader className="pb-3 bg-muted/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <User className="w-5 h-5 text-muted-foreground" />
                          <CardTitle className="text-base">{student.studentName}</CardTitle>
                        </div>
                        
                        {/* Score Display */}
                        {student.score && (
                          <div className="text-right">
                            <p className="text-2xl font-bold text-primary">
                              {student.score.earned}/{student.score.total}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {student.score.percent}% • {student.score.letterGrade}
                            </p>
                          </div>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="pt-4 space-y-4">
                      {/* Criterion Breakdown (if full grading) */}
                      {student.criteria && student.criteria.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium text-muted-foreground">Criterion Breakdown</h4>
                          <div className="space-y-2">
                            {student.criteria.map((criterion, cidx) => (
                              <div key={cidx} className="space-y-1">
                                <div className="flex items-center justify-between text-sm">
                                  <span>{criterion.name}</span>
                                  <span className="font-medium">
                                    {criterion.earnedPoints}/{criterion.possiblePoints}
                                  </span>
                                </div>
                                <Progress 
                                  value={(criterion.earnedPoints / criterion.possiblePoints) * 100} 
                                  className="h-2"
                                />
                              </div>
                            ))}
                          </div>
                          <Separator className="my-4" />
                        </div>
                      )}

                      {/* Feedback Sections */}
                      <div className="space-y-4">
                        {/* Strengths */}
                        <div>
                          <h4 className="text-sm font-medium text-emerald-600 flex items-center gap-2 mb-2">
                            <Check className="w-4 h-4" />
                            Strengths
                          </h4>
                          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                            {student.strengths.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>

                        {/* Areas for Improvement */}
                        <div>
                          <h4 className="text-sm font-medium text-amber-600 flex items-center gap-2 mb-2">
                            <ArrowLeft className="w-4 h-4 rotate-[135deg]" />
                            Areas for Improvement
                          </h4>
                          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                            {student.areasForImprovement.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        </div>

                        {/* Next Step */}
                        <div>
                          <h4 className="text-sm font-medium text-blue-600 flex items-center gap-2 mb-2">
                            <Sparkles className="w-4 h-4" />
                            Next Step
                          </h4>
                          <p className="text-sm text-muted-foreground">{student.nextStep}</p>
                        </div>
                      </div>

                      {/* Collapsible Notes & Details */}
                      <Collapsible open={expandedFeedback.has(index)} onOpenChange={() => toggleFeedbackExpanded(index)}>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground">
                            Notes & Details
                            <ChevronDown className={`w-4 h-4 transition-transform ${expandedFeedback.has(index) ? "rotate-180" : ""}`} />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-3 space-y-3">
                          {/* Confidence Score */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Confidence:</span>
                            <Progress value={student.confidence} className="w-20 h-2" />
                            <span className={`text-xs font-medium ${
                              student.confidence >= 80 ? "text-emerald-600" :
                              student.confidence >= 70 ? "text-amber-600" : "text-destructive"
                            }`}>
                              {student.confidence}%
                            </span>
                          </div>

                          {/* Flags */}
                          {student.flags && student.flags.length > 0 && (
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-muted-foreground">Flags:</span>
                              {student.flags.map((flag, i) => (
                                <Badge key={i} variant="outline" className="text-xs">
                                  {flag}
                                </Badge>
                              ))}
                            </div>
                          )}

                          {/* Copy Feedback */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopy(
                              `Strengths:\n${student.strengths.join("\n")}\n\nAreas for Improvement:\n${student.areasForImprovement.join("\n")}\n\nNext Step:\n${student.nextStep}`,
                              student.studentName
                            )}
                          >
                            <Copy className="w-4 h-4 mr-2" />
                            {copied === student.studentName ? "Copied!" : "Copy Feedback"}
                          </Button>
                        </CollapsibleContent>
                      </Collapsible>
                    </CardContent>
                  </Card>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      {/* ================================================================
          MAIN ACTION BUTTON
      ================================================================ */}
      {currentStep !== "results" && currentStep !== "processing" && currentStep !== "subject-select" && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur-sm border-t border-border md:relative md:border-0 md:bg-transparent md:backdrop-blur-none">
          <div className="max-w-7xl mx-auto">
            <Button
              onClick={handleGenerate}
              disabled={!hasReadyImages || isProcessing}
              className="w-full md:w-auto md:min-w-[240px] h-12 text-base font-semibold"
              size="lg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 mr-2" />
                  {buttonLabel}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
