/**
 * =============================================================================
 * GENERATE PDF REPORT EDGE FUNCTION
 * =============================================================================
 * 
 * Server-side PDF generation for Grade Reports.
 * - Generates PDF with only Grade Report content (score, strengths, improvements, feedback)
 * - Uploads to Supabase Storage bucket 'grade-reports'
 * - Returns signed download URL
 * =============================================================================
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GradeReportData {
  studentName: string;
  assignmentName: string;
  score: string;
  strengths: string;
  areasForImprovement: string;
  feedback: string;
  gradingMode: 'scoring' | 'feedback-only';
  subject?: string;
  gradeLevel?: string;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

function generatePdfHtml(data: GradeReportData): string {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const showScore = data.gradingMode === 'scoring' && data.score && data.score !== 'N/A';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Grade Report - ${escapeHtml(data.studentName)}</title>
  <style>
    @page { size: letter portrait; margin: 0.75in; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; background: white; }
    .header { text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { font-size: 20pt; font-weight: 700; color: #1e40af; margin-bottom: 4px; }
    .header .subtitle { font-size: 10pt; color: #6b7280; }
    .meta-info { display: flex; flex-wrap: wrap; gap: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; }
    .meta-item { flex: 1; min-width: 120px; }
    .meta-label { font-size: 9pt; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .meta-value { font-size: 11pt; font-weight: 600; color: #1a1a1a; }
    .section { margin-bottom: 20px; page-break-inside: avoid; }
    .section-title { font-size: 12pt; font-weight: 600; color: #1e40af; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 10px; }
    .section-content { font-size: 11pt; line-height: 1.6; color: #374151; white-space: pre-wrap; }
    .score-box { background: linear-gradient(135deg, #dbeafe 0%, #eff6ff 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 16px 24px; text-align: center; margin-bottom: 24px; }
    .score-label { font-size: 10pt; color: #1e40af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
    .score-value { font-size: 28pt; font-weight: 700; color: #1e40af; }
    .feedback-box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin-top: 20px; }
    .feedback-box .section-title { color: #166534; border-bottom-color: #86efac; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 9pt; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Grade Report</h1>
    <div class="subtitle">Generated on ${escapeHtml(date)}</div>
  </div>
  
  <div class="meta-info">
    <div class="meta-item">
      <div class="meta-label">Student</div>
      <div class="meta-value">${escapeHtml(data.studentName || 'Not specified')}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Assignment</div>
      <div class="meta-value">${escapeHtml(data.assignmentName || 'Not specified')}</div>
    </div>
    ${data.subject ? `
    <div class="meta-item">
      <div class="meta-label">Subject</div>
      <div class="meta-value">${escapeHtml(data.subject)}</div>
    </div>
    ` : ''}
    ${data.gradeLevel ? `
    <div class="meta-item">
      <div class="meta-label">Grade Level</div>
      <div class="meta-value">${escapeHtml(data.gradeLevel)}</div>
    </div>
    ` : ''}
  </div>
  
  ${showScore ? `
  <div class="score-box">
    <div class="score-label">Suggested Score</div>
    <div class="score-value">${escapeHtml(data.score)}</div>
  </div>
  ` : ''}
  
  <div class="section">
    <div class="section-title">Strengths</div>
    <div class="section-content">${escapeHtml(data.strengths || 'Not provided')}</div>
  </div>
  
  <div class="section">
    <div class="section-title">Areas for Improvement</div>
    <div class="section-content">${escapeHtml(data.areasForImprovement || 'Not provided')}</div>
  </div>
  
  <div class="feedback-box">
    <div class="section">
      <div class="section-title">Draft Feedback</div>
      <div class="section-content">${escapeHtml(data.feedback || 'Not provided')}</div>
    </div>
  </div>
  
  <div class="footer">
    This report was generated using AI assistance. Please review before sharing.
  </div>
</body>
</html>`;
}

function generateFilename(studentName: string, assignmentName: string): string {
  const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  const date = new Date().toISOString().split('T')[0];
  return `GradeReport_${sanitize(studentName || 'Student')}_${sanitize(assignmentName || 'Assignment')}_${date}.pdf`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Create client with user's auth for claims verification
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getUser(token);
    
    if (claimsError || !claimsData?.user) {
      console.error('Auth error:', claimsError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    
    const userId = claimsData.user.id;
    const data: GradeReportData = await req.json();

    console.log('Generating PDF for:', data.studentName, data.assignmentName);

    // Generate HTML
    const htmlContent = generatePdfHtml(data);
    const filename = generateFilename(data.studentName, data.assignmentName);
    const reportId = crypto.randomUUID();
    const storagePath = `${userId}/${reportId}.pdf`;

    // Try to use Lovable AI's PDF generation endpoint
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    let pdfBuffer: ArrayBuffer | null = null;

    // Use html-pdf-node style rendering via external service
    // Since Deno doesn't have native PDF libraries, we'll use a lightweight approach
    // by storing the HTML and providing it as a downloadable PDF via browser rendering
    
    // For true server-side PDF, we use the Gotenberg or similar service if available
    // For now, we'll generate a base64-encoded PDF-like document
    
    // Create a simple text-based PDF structure (minimal PDF spec)
    const pdfContentBytes = createSimplePdf(data);
    pdfBuffer = pdfContentBytes.buffer.slice(
      pdfContentBytes.byteOffset,
      pdfContentBytes.byteOffset + pdfContentBytes.byteLength
    ) as ArrayBuffer;

    // Create service client for storage upload
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Upload PDF to storage
    const { error: uploadError } = await supabaseService.storage
      .from('grade-reports')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      throw new Error(`Failed to upload PDF: ${uploadError.message}`);
    }

    // Create signed URL (valid for 7 days)
    const { data: signedUrlData, error: signedUrlError } = await supabaseService.storage
      .from('grade-reports')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7); // 7 days

    if (signedUrlError) {
      console.error('Signed URL error:', signedUrlError);
      throw new Error(`Failed to create signed URL: ${signedUrlError.message}`);
    }

    // Also get public URL for permanent access
    const { data: publicUrlData } = supabaseService.storage
      .from('grade-reports')
      .getPublicUrl(storagePath);

    console.log('PDF generated and uploaded:', storagePath);

    return new Response(JSON.stringify({
      success: true,
      filename,
      storagePath,
      signedUrl: signedUrlData.signedUrl,
      publicUrl: publicUrlData.publicUrl,
      reportId,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('PDF generation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      error: 'Failed to generate PDF',
      details: errorMessage,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Create a simple PDF document
// This creates a valid PDF 1.4 document with basic text content
function createSimplePdf(data: GradeReportData): Uint8Array {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long', 
    day: 'numeric'
  });
  
  const showScore = data.gradingMode === 'scoring' && data.score && data.score !== 'N/A';
  
  // Build content lines
  const lines: string[] = [
    'GRADE REPORT',
    `Generated on ${date}`,
    '',
    `Student: ${data.studentName || 'Not specified'}`,
    `Assignment: ${data.assignmentName || 'Not specified'}`,
  ];
  
  if (data.subject) lines.push(`Subject: ${data.subject}`);
  if (data.gradeLevel) lines.push(`Grade Level: ${data.gradeLevel}`);
  lines.push('');
  
  if (showScore) {
    lines.push('SUGGESTED SCORE');
    lines.push(data.score);
    lines.push('');
  }
  
  lines.push('STRENGTHS');
  lines.push(data.strengths || 'Not provided');
  lines.push('');
  
  lines.push('AREAS FOR IMPROVEMENT');
  lines.push(data.areasForImprovement || 'Not provided');
  lines.push('');
  
  lines.push('DRAFT FEEDBACK');
  lines.push(data.feedback || 'Not provided');
  lines.push('');
  lines.push('This report was generated using AI assistance. Please review before sharing.');
  
  // Create PDF structure
  const textContent = lines.join('\n');
  
  // Escape special PDF characters and convert to PDF text operators
  const escapePdfString = (str: string): string => {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/\r/g, '')
      .replace(/\n/g, ') Tj T* (');
  };
  
  const pdfText = escapePdfString(textContent);
  
  // Build PDF document
  const objects: string[] = [];
  let objectNum = 1;
  
  // Object 1: Catalog
  objects.push(`${objectNum} 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`);
  objectNum++;
  
  // Object 2: Pages
  objects.push(`${objectNum} 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj`);
  objectNum++;
  
  // Object 3: Page
  objects.push(`${objectNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj`);
  objectNum++;
  
  // Object 4: Content stream
  const streamContent = `BT\n/F1 11 Tf\n50 740 Td\n14 TL\n(${pdfText}) Tj\nET`;
  const streamLength = streamContent.length;
  objects.push(`${objectNum} 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream\nendobj`);
  objectNum++;
  
  // Object 5: Font
  objects.push(`${objectNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`);
  
  // Build PDF
  const header = '%PDF-1.4\n%âãÏÓ\n';
  const body = objects.join('\n') + '\n';
  
  // Calculate xref offsets
  let offset = header.length;
  const xrefOffsets: number[] = [];
  
  for (const obj of objects) {
    xrefOffsets.push(offset);
    offset += obj.length + 1; // +1 for newline
  }
  
  const xrefOffset = offset;
  
  // Build xref table
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (const off of xrefOffsets) {
    xref += off.toString().padStart(10, '0') + ' 00000 n \n';
  }
  
  // Trailer
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  
  const pdfString = header + body + xref + trailer;
  
  // Convert to Uint8Array
  const encoder = new TextEncoder();
  return encoder.encode(pdfString);
}
