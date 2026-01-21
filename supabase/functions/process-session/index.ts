import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sessionId } = await req.json();
    
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: 'Session ID required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing session: ${sessionId}`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fetch session data
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      console.error('Session fetch error:', sessionError);
      return new Response(
        JSON.stringify({ error: 'Session not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Download audio file
    const { data: audioData, error: downloadError } = await supabase.storage
      .from('bottor-audio')
      .download(session.audio_path);

    if (downloadError || !audioData) {
      console.error('Audio download error:', downloadError);
      await supabase
        .from('sessions')
        .update({ status: 'failed', error_message: 'Failed to download audio file' })
        .eq('id', sessionId);
      return new Response(
        JSON.stringify({ error: 'Failed to download audio' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get file size for debugging
    const audioArrayBuffer = await audioData.arrayBuffer();
    const fileSizeKB = Math.round(audioArrayBuffer.byteLength / 1024);
    console.log(`Audio downloaded: ${fileSizeKB}KB, transcribing...`);

    // Check minimum file size (very small files are likely silent/corrupted)
    if (audioArrayBuffer.byteLength < 1000) {
      console.error('Audio file too small:', audioArrayBuffer.byteLength, 'bytes');
      await supabase
        .from('sessions')
        .update({ 
          status: 'failed', 
          error_message: 'Audio file is too small or empty. Please record again with a working microphone.',
        })
        .eq('id', sessionId);
      return new Response(
        JSON.stringify({ error: 'Audio file too small' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Convert audio to base64 for transcription
    const audioBase64 = btoa(
      new Uint8Array(audioArrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    // Determine audio mime type from path
    const audioExtension = session.audio_path.split('.').pop()?.toLowerCase() || 'webm';
    console.log(`Audio format: ${audioExtension}, base64 length: ${audioBase64.length}`);

    // Transcribe audio using Lovable AI with audio input
    const transcribeResponse = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Please transcribe this audio recording. Provide a verbatim transcription of all spoken words. If parts are unclear, indicate with [inaudible]. If there is no speech or only silence/noise, respond with exactly: NO_SPEECH_DETECTED'
              },
              {
                type: 'input_audio',
                input_audio: {
                  data: audioBase64,
                  format: audioExtension === 'wav' ? 'wav' : 'webm'
                }
              }
            ]
          }
        ],
        temperature: 0.1,
      }),
    });

    if (!transcribeResponse.ok) {
      const errorText = await transcribeResponse.text();
      console.error('Transcription API error:', transcribeResponse.status, errorText);
      await supabase
        .from('sessions')
        .update({ 
          status: 'failed', 
          error_message: 'Audio transcription service error. Please try again.',
        })
        .eq('id', sessionId);
      return new Response(
        JSON.stringify({ error: 'Transcription failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const transcribeData = await transcribeResponse.json();
    const transcript = transcribeData.choices?.[0]?.message?.content?.trim() || '';
    
    console.log('Transcription result:', transcript.substring(0, 100) + (transcript.length > 100 ? '...' : ''));

    // Check for no speech - be more lenient with the check
    if (!transcript || transcript === 'NO_SPEECH_DETECTED' || transcript.toLowerCase().includes('no speech') || transcript.toLowerCase().includes('no audio')) {
      console.log('No speech detected in audio');
      await supabase
        .from('sessions')
        .update({ 
          status: 'failed', 
          error_message: 'No speech was detected in the recording. Please ensure your microphone is working and speak clearly.',
          transcript: transcript || null
        })
        .eq('id', sessionId);
      return new Response(
        JSON.stringify({ error: 'No speech detected' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Count words in transcript
    const wordCount = transcript.split(/\s+/).filter((word: string) => word.length > 0).length;
    const durationSeconds = session.duration_seconds || 0;
    
    console.log(`Recording stats: duration=${durationSeconds}s, words=${wordCount}`);

    // Check for brief recordings (< 5 seconds OR < 5 words)
    const isBriefRecording = durationSeconds < 5 || wordCount < 5;

    if (isBriefRecording) {
      console.log('Brief recording detected, using minimal summary');
      
      const minimalSummary = {
        lesson_summary: ["Brief audio captured."],
        student_understanding: {
          strengths: ["Not enough content to assess"],
          challenges: ["Not enough content to assess"]
        },
        attention_flags: ["Recording was too short for detailed analysis"],
        next_steps: ["Try recording for at least 30 seconds with clear speech for richer summaries"],
        brief_recording: true,
        recording_tip: "For best results, record lessons that are at least 30 seconds long with clear, continuous speech."
      };

      const { error: updateError } = await supabase
        .from('sessions')
        .update({
          status: 'completed',
          transcript,
          summary_json: minimalSummary,
          title: 'Brief Recording',
          snippet: 'Recording was too short for a detailed summary. Try recording longer for richer insights.',
        })
        .eq('id', sessionId);

      if (updateError) {
        console.error('Session update error:', updateError);
        throw new Error('Failed to save summary');
      }

      return new Response(
        JSON.stringify({ success: true, sessionId, brief: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Transcription complete, generating summary...');

    // Generate summary using AI
    const summaryPrompt = `You are an educational AI assistant helping teachers create lesson summaries.

STRICT GROUNDING RULES - YOU MUST FOLLOW THESE:
1. ONLY summarize information that is EXPLICITLY present in the transcript below.
2. DO NOT invent, assume, or hallucinate any topics, activities, experiments, or student names.
3. DO NOT assume subject matter beyond what is explicitly spoken in the transcript.
4. If information is missing, unclear, or not mentioned, respond with "Not observed" or "Not mentioned."
5. If the transcript is very short or lacks detail, produce a minimal summary reflecting ONLY what was actually said.
6. If a topic is mentioned (e.g., "fractions") but not elaborated on, state only that the topic was mentioned without inventing details.
7. Never add educational context, examples, or elaborations that are not in the transcript.

TRANSCRIPT:
${transcript}

Generate a JSON response with exactly this structure (no markdown, just pure JSON):
{
  "lesson_summary": ["bullet point 1", "bullet point 2"],
  "student_understanding": {
    "strengths": ["strength 1"],
    "challenges": ["challenge 1"]
  },
  "attention_flags": ["any student behaviors explicitly mentioned that require follow-up, or 'None observed' if not mentioned"],
  "next_steps": ["suggested next step based on what was discussed, or 'Not enough information' if transcript is too brief"]
}

IMPORTANT:
- Be concise and professional.
- Every item in your response MUST be directly traceable to something said in the transcript.
- If the transcript does not provide enough information for a section, use phrases like "Not mentioned", "Not observed", or "Insufficient information".
- Prefer fewer accurate bullet points over more fabricated ones.`;

    const aiResponse = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'user', content: summaryPrompt }
        ],
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', errorText);
      throw new Error('AI processing failed');
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || '';
    
    console.log('AI response received, parsing...');

    // Parse JSON from AI response
    let summaryJson;
    try {
      // Clean up the response - remove any markdown code blocks
      const cleanedContent = aiContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      summaryJson = JSON.parse(cleanedContent);
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Content:', aiContent);
      // Fallback summary if parsing fails
      summaryJson = {
        lesson_summary: ["Lesson summary was generated but couldn't be parsed. Please check the recording."],
        student_understanding: {
          strengths: ["Unable to determine"],
          challenges: ["Unable to determine"]
        },
        attention_flags: [],
        next_steps: ["Review the recording manually"]
      };
    }

    // Extract title and snippet from summary
    const title = summaryJson.lesson_summary?.[0]?.substring(0, 60) || 'Lesson Summary';
    const snippet = summaryJson.lesson_summary?.slice(0, 2).join(' ').substring(0, 150) || '';

    // Update session with results
    const { error: updateError } = await supabase
      .from('sessions')
      .update({
        status: 'completed',
        transcript,
        summary_json: summaryJson,
        title,
        snippet,
      })
      .eq('id', sessionId);

    if (updateError) {
      console.error('Session update error:', updateError);
      throw new Error('Failed to save summary');
    }

    console.log('Session processing complete');

    return new Response(
      JSON.stringify({ success: true, sessionId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Processing error:', error);
    
    // Try to update session status to failed
    try {
      const { sessionId } = await req.json().catch(() => ({}));
      if (sessionId) {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );
        await supabase
          .from('sessions')
          .update({ status: 'failed', error_message: String(error) })
          .eq('id', sessionId);
      }
    } catch {}

    return new Response(
      JSON.stringify({ error: 'Processing failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
