/**
 * =============================================================================
 * PDF GENERATOR UTILITY
 * =============================================================================
 * 
 * Client-side PDF generation for Grade Reports using jsPDF.
 * Creates clean, styled PDFs without relying on external APIs.
 * =============================================================================
 */

import jsPDF from 'jspdf';

export interface GradeReportPdfData {
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

interface TextBlock {
  text: string;
  y: number;
  height: number;
}

export function generateGradeReportPdf(data: GradeReportPdfData): Blob {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let yPos = margin;

  const colors = {
    primary: [30, 64, 175] as [number, number, number],      // #1e40af
    secondary: [107, 114, 128] as [number, number, number],  // #6b7280
    text: [26, 26, 26] as [number, number, number],          // #1a1a1a
    lightText: [55, 65, 81] as [number, number, number],     // #374151
    border: [226, 232, 240] as [number, number, number],     // #e2e8f0
    bgLight: [248, 250, 252] as [number, number, number],    // #f8fafc
    scoreBg: [219, 234, 254] as [number, number, number],    // #dbeafe
    feedbackBg: [240, 253, 244] as [number, number, number], // #f0fdf4
    feedbackBorder: [134, 239, 172] as [number, number, number], // #86efac
    green: [22, 101, 52] as [number, number, number],        // #166534
  };

  const date = data.generatedAt || new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Helper to add new page if needed
  const checkPageBreak = (requiredHeight: number): void => {
    if (yPos + requiredHeight > pageHeight - margin) {
      doc.addPage();
      yPos = margin;
    }
  };

  // Helper to wrap text and return lines
  const wrapText = (text: string, maxWidth: number, fontSize: number): string[] => {
    doc.setFontSize(fontSize);
    return doc.splitTextToSize(text, maxWidth);
  };

  // ===== HEADER =====
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...colors.primary);
  doc.text('Grade Report', pageWidth / 2, yPos, { align: 'center' });
  yPos += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...colors.secondary);
  doc.text(`Generated on ${date}`, pageWidth / 2, yPos, { align: 'center' });
  yPos += 4;

  // Header underline
  doc.setDrawColor(...colors.primary);
  doc.setLineWidth(0.5);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 10;

  // ===== META INFO BOX =====
  const metaItems: { label: string; value: string }[] = [
    { label: 'Student', value: data.studentName || 'Not specified' },
    { label: 'Assignment', value: data.assignmentName || 'Not specified' },
  ];
  if (data.subject) metaItems.push({ label: 'Subject', value: data.subject });
  if (data.gradeLevel) metaItems.push({ label: 'Grade Level', value: data.gradeLevel });

  const metaBoxHeight = 18;
  doc.setFillColor(...colors.bgLight);
  doc.setDrawColor(...colors.border);
  doc.roundedRect(margin, yPos, contentWidth, metaBoxHeight, 2, 2, 'FD');

  const itemWidth = contentWidth / metaItems.length;
  metaItems.forEach((item, index) => {
    const x = margin + itemWidth * index + 5;
    
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colors.secondary);
    doc.text(item.label.toUpperCase(), x, yPos + 6);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...colors.text);
    const valueLines = wrapText(item.value, itemWidth - 10, 10);
    doc.text(valueLines[0] || '', x, yPos + 12);
  });

  yPos += metaBoxHeight + 10;

  // ===== SCORE BOX (if scoring mode) =====
  const showScore = data.gradingMode === 'scoring' && data.score && data.score !== 'N/A';
  if (showScore) {
    const scoreBoxHeight = 24;
    checkPageBreak(scoreBoxHeight + 10);

    doc.setFillColor(...colors.scoreBg);
    doc.setDrawColor(59, 130, 246); // #3b82f6
    doc.setLineWidth(0.5);
    doc.roundedRect(margin, yPos, contentWidth, scoreBoxHeight, 3, 3, 'FD');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colors.primary);
    doc.text('SUGGESTED SCORE', pageWidth / 2, yPos + 8, { align: 'center' });

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(data.score, pageWidth / 2, yPos + 18, { align: 'center' });

    yPos += scoreBoxHeight + 10;
  }

  // ===== SECTION HELPER =====
  const addSection = (title: string, content: string, isGreen = false): void => {
    const lines = wrapText(content || 'Not provided', contentWidth - 8, 10);
    const textHeight = lines.length * 5;
    const sectionHeight = 12 + textHeight + 8;

    checkPageBreak(sectionHeight);

    // Section title
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    const titleColor = isGreen ? colors.green : colors.primary;
    doc.setTextColor(titleColor[0], titleColor[1], titleColor[2]);
    doc.text(title, margin, yPos + 5);

    // Title underline
    const underlineColor = isGreen ? colors.feedbackBorder : colors.border;
    doc.setDrawColor(underlineColor[0], underlineColor[1], underlineColor[2]);
    doc.setLineWidth(0.3);
    doc.line(margin, yPos + 8, pageWidth - margin, yPos + 8);
    yPos += 12;

    // Content
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colors.lightText);
    
    lines.forEach((line: string) => {
      checkPageBreak(6);
      doc.text(line, margin + 2, yPos);
      yPos += 5;
    });

    yPos += 6;
  };

  // ===== SECTIONS =====
  addSection('Strengths', data.strengths);
  addSection('Areas for Improvement', data.areasForImprovement);

  // ===== FEEDBACK BOX =====
  const feedbackLines = wrapText(data.feedback || 'Not provided', contentWidth - 16, 10);
  const feedbackTextHeight = feedbackLines.length * 5;
  const feedbackBoxHeight = 20 + feedbackTextHeight + 10;

  checkPageBreak(feedbackBoxHeight);

  doc.setFillColor(...colors.feedbackBg);
  doc.setDrawColor(...colors.feedbackBorder);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, yPos, contentWidth, feedbackBoxHeight, 2, 2, 'FD');

  // Feedback title
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...colors.green);
  doc.text('Draft Feedback', margin + 8, yPos + 8);

  doc.setDrawColor(...colors.feedbackBorder);
  doc.line(margin + 8, yPos + 11, pageWidth - margin - 8, yPos + 11);

  // Feedback content
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...colors.lightText);
  let feedbackY = yPos + 18;
  feedbackLines.forEach((line: string) => {
    doc.text(line, margin + 10, feedbackY);
    feedbackY += 5;
  });

  yPos += feedbackBoxHeight + 10;

  // ===== FOOTER =====
  checkPageBreak(20);
  doc.setDrawColor(...colors.border);
  doc.setLineWidth(0.3);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 8;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(156, 163, 175); // #9ca3af
  doc.text(
    'This report was generated using AI assistance. Please review before sharing.',
    pageWidth / 2,
    yPos,
    { align: 'center' }
  );

  // Generate blob
  return doc.output('blob');
}

export function generatePdfFilename(
  studentName: string,
  assignmentName: string
): string {
  const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const student = sanitize(studentName || 'Student');
  const assignment = sanitize(assignmentName || 'Assignment');
  return `GradeReport_${student}_${assignment}_${date}.pdf`;
}
