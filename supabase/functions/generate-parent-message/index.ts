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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { sessionId } = await req.json();
    
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: 'Session ID required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Generating parent message for session: ${sessionId}`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify user and fetch session
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: authError } = await supabase.auth.getClaims(token);
    
    if (authError || !claims?.claims) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('summary_json, teacher_notes, title')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      console.error('Session fetch error:', sessionError);
      return new Response(
        JSON.stringify({ error: 'Session not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const summary = session.summary_json;
    const teacherNotes = session.teacher_notes || '';

    // Generate parent message
    const messagePrompt = `You are helping a teacher write a message to send to parents about today's lesson.

LESSON SUMMARY:
${JSON.stringify(summary, null, 2)}

TEACHER'S NOTES:
${teacherNotes || 'None provided'}

Write a warm, supportive 4-6 sentence message for parents that:
- Summarizes what students learned today
- Highlights positive aspects of the class
- Mentions any suggested at-home activities
- Uses friendly, jargon-free language
- Does NOT diagnose or label any student behaviors
- Sounds natural and caring

Just write the message text, no subject line or signature.`;

    const aiResponse = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'user', content: messagePrompt }
        ],
        temperature: 0.8,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', errorText);
      throw new Error('AI processing failed');
    }

    const aiData = await aiResponse.json();
    const parentMessage = aiData.choices?.[0]?.message?.content?.trim() || 
      'We had a wonderful class today! Your child participated in our lesson and showed great engagement. Please ask them about what they learned - I think you\'ll be impressed with their knowledge!';

    console.log('Parent message generated');

    // Save the message
    await supabase
      .from('sessions')
      .update({ parent_message_draft: parentMessage })
      .eq('id', sessionId);

    return new Response(
      JSON.stringify({ message: parentMessage }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating parent message:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to generate message' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
