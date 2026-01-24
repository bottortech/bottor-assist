/**
 * =============================================================================
 * GENERATE PDF REPORT EDGE FUNCTION
 * =============================================================================
 * 
 * PURPOSE: Generate a clean PDF containing only the Grade Report section
 * (score, strengths, areas for improvement, feedback).
 * 
 * Uses HTML-to-PDF generation with a print-safe layout.
 * =============================================================================
 */

import "https://deno.land/x/xhr@0.3.0/mod.ts";

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
  generatedAt?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

function generatePdfHtml(data: GradeReportData): string {
  const date = data.generatedAt || new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const showScore = data.gradingMode === 'scoring' && data.score && data.score !== 'N/A';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Grade Report - ${escapeHtml(data.studentName)}</title>
  <style>
    @page {
      size: letter portrait;
      margin: 0.75in;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11pt;
      line-height: 1.5;
      color: #1a1a1a;
      background: white;
    }
    
    .header {
      text-align: center;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    
    .header h1 {
      font-size: 20pt;
      font-weight: 700;
      color: #1e40af;
      margin-bottom: 4px;
    }
    
    .header .subtitle {
      font-size: 10pt;
      color: #6b7280;
    }
    
    .meta-info {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 24px;
    }
    
    .meta-item {
      flex: 1;
      min-width: 120px;
    }
    
    .meta-label {
      font-size: 9pt;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    
    .meta-value {
      font-size: 11pt;
      font-weight: 600;
      color: #1a1a1a;
    }
    
    .section {
      margin-bottom: 20px;
      page-break-inside: avoid;
    }
    
    .section-title {
      font-size: 12pt;
      font-weight: 600;
      color: #1e40af;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 6px;
      margin-bottom: 10px;
    }
    
    .section-content {
      font-size: 11pt;
      line-height: 1.6;
      color: #374151;
    }
    
    .score-box {
      background: linear-gradient(135deg, #dbeafe 0%, #eff6ff 100%);
      border: 2px solid #3b82f6;
      border-radius: 12px;
      padding: 16px 24px;
      text-align: center;
      margin-bottom: 24px;
    }
    
    .score-label {
      font-size: 10pt;
      color: #1e40af;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }
    
    .score-value {
      font-size: 28pt;
      font-weight: 700;
      color: #1e40af;
    }
    
    .feedback-box {
      background: #f0fdf4;
      border: 1px solid #86efac;
      border-radius: 8px;
      padding: 16px;
      margin-top: 20px;
    }
    
    .feedback-box .section-title {
      color: #166534;
      border-bottom-color: #86efac;
    }
    
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      font-size: 9pt;
      color: #9ca3af;
    }
    
    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
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

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: GradeReportData = await req.json();

    console.log('Generating PDF for:', data.studentName, data.assignmentName);

    // Generate HTML for the PDF
    const htmlContent = generatePdfHtml(data);

    // Use a PDF generation service or return HTML for client-side conversion
    // For now, we'll use a simple approach with html2pdf.app API
    const pdfResponse = await fetch('https://api.html2pdf.app/v1/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html: htmlContent,
        apiKey: Deno.env.get('HTML2PDF_API_KEY') || 'demo',
        marginTop: 20,
        marginBottom: 20,
        marginLeft: 20,
        marginRight: 20,
        format: 'Letter',
        orientation: 'portrait',
      }),
    });

    if (!pdfResponse.ok) {
      // Fallback: Return HTML that client can use with browser's print-to-PDF
      console.log('HTML2PDF API failed, returning HTML fallback');
      return new Response(JSON.stringify({
        success: true,
        fallback: true,
        html: htmlContent,
        message: 'PDF service unavailable, using HTML fallback'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pdfBuffer = await pdfResponse.arrayBuffer();
    
    // Generate filename
    const sanitizedStudent = (data.studentName || 'Student').replace(/[^a-zA-Z0-9]/g, '_');
    const sanitizedAssignment = (data.assignmentName || 'Assignment').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${sanitizedStudent}_${sanitizedAssignment}_GradeReport.pdf`;

    return new Response(pdfBuffer, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
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
