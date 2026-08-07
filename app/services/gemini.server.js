/**
 * Gemini Service (Adapter)
 * ========================
 * This service is designed as a drop-in replacement for the Anthropic/Claude service.
 * It adapts the Gemini API to behave like the Claude API for a seamless integration
 * with an existing chat handler.
 *
 * Key Adaptations:
 * 1.  Translates incoming Claude-formatted message history (including tool results)
 *     into the format required by Gemini.
 * 2.  Receives Gemini's response and translates its `functionCall` objects back into
 *     the `tool_use` objects that the Claude-based chat handler expects.
 * 3.  Simulates the event-driven nature of the Anthropic SDK by calling the stream
 *     handlers (`onText`, `onToolUse`, `onMessage`) manually.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import AppConfig from "./config.server";
import systemPrompts from "../prompts/prompts.json";

// Fix for ReadableStream polyfill conflicts in Node.js environment
// Ensure native Node.js streams are used instead of web-streams-polyfill
/* eslint-disable no-undef */
if (typeof globalThis !== 'undefined' && globalThis.ReadableStream && globalThis.TextDecoderStream) {
  // Node.js 18+ has native support, ensure these are available globally
  if (!global.ReadableStream) {
    global.ReadableStream = globalThis.ReadableStream;
  }
  if (!global.TextDecoderStream) {
    global.TextDecoderStream = globalThis.TextDecoderStream;
  }
}
/* eslint-enable no-undef */


/**
 * Translates the application's message history (which may be in Claude's format)
 * into the format required by the Google Gemini API.
 * @param {Array<Object>} messages - The conversation history from the application.
 * @returns {Array<Object>} The history formatted for Gemini's `contents` array.
 */
function formatHistoryForGemini(messages) {
  return messages.map(msg => {
    if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        return {
          role: 'model',
          parts: msg.tool_calls.map(tool_call => ({
            functionCall: {
              name: tool_call.function.name,
              args: tool_call.function.arguments
            }
          }))
        };
      }
      // FIX: unwrap Claude's [{ type: 'text', text: '...' }] format into plain string
      let textContent = '';
      if (Array.isArray(msg.content)) {
        textContent = msg.content
          .filter(c => c.type === 'text' && typeof c.text === 'string')
          .map(c => c.text)
          .join('\n');
      } else if (typeof msg.content === 'string') {
        textContent = msg.content;
      }
      return { role: 'model', parts: [{ text: textContent }] };
    }

    if (msg.role === 'user') {
      // Tool result case
      if (Array.isArray(msg.content) && msg.content[0]?.type === 'tool_result') {
        const toolResult = msg.content[0];
        return {
          role: 'function',
          parts: [{
            functionResponse: {
              name: toolResult.tool_use_id,
              response: JSON.parse(toolResult.content[0].text),
            },
          }],
        };
      }
      // Normal user text
      let textContent = '';
      if (Array.isArray(msg.content)) {
        textContent = msg.content
          .filter(c => c.type === 'text' && typeof c.text === 'string')
          .map(c => c.text)
          .join('\n');
      } else if (typeof msg.content === 'string') {
        textContent = msg.content;
      }
      return { role: 'user', parts: [{ text: textContent }] };
    }

    if (msg.role === 'tool') {
      return {
        role: 'function',
        parts: [{
          functionResponse: {
            name: msg.name,
            response: typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content,
          },
        }],
      };
    }

    return null;
  }).filter(Boolean);
}


/**
 * Creates a Gemini service instance that mimics the Claude service.
 * @param {string} apiKey - Gemini API key.
 * @returns {Object} A service object with a `streamConversation` method.
 */
export function createGeminiService(apiKey = process.env.GEMINI_API_KEY) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
  const genAI = new GoogleGenerativeAI(apiKey);

  const streamConversation = async ({
    messages,
    promptType = AppConfig.api.defaultPromptType,
    tools
  }, streamHandlers) => {
    const systemInstruction = getSystemPrompt(promptType);
    const model = genAI.getGenerativeModel({
      model: AppConfig.api.gemini.defaultModel,
      systemInstruction,
      tools: tools && tools.length > 0 ? [{ functionDeclarations: transformToolsForGemini(tools) }] : undefined,
    });

    const geminiHistory = formatHistoryForGemini(messages);

    // Call generateContentStream with error handling for ReadableStream polyfill conflicts
    let result;
    try {
      result = await model.generateContentStream({ contents: geminiHistory });
    } catch (error) {
      // If this is a ReadableStream compatibility issue, gracefully fall back to non-streaming
      const isReadableStreamCompatIssue = Boolean(
        error?.message && /ReadableStream|First parameter has member 'readable'/i.test(error.message)
      );

      if (isReadableStreamCompatIssue) {
        console.warn("Gemini Service: ReadableStream compatibility issue detected. Falling back to non-streaming mode.");

        // Non-streaming fallback: get the full response and simulate streaming chunks
        const nonStream = await model.generateContent({ contents: geminiHistory });
        const aggregatedResponse = await nonStream.response;

        // Extract text and simulate chunked streaming
        const fullText = typeof aggregatedResponse.text === 'function' ? aggregatedResponse.text() : '';
        if (fullText && streamHandlers.onText) {
          const chunkSize = 200; // small chunks to mimic streaming
          for (let i = 0; i < fullText.length; i += chunkSize) {
            const chunk = fullText.slice(i, i + chunkSize);
            streamHandlers.onText(chunk);
          }
        }

        // Handle tool calls if present
        const responseCandidate = aggregatedResponse.candidates?.[0];
        const geminiToolCalls = responseCandidate?.content?.parts
          ?.filter(part => !!part.functionCall)
          ?.map(part => part.functionCall) || [];

        if (streamHandlers.onToolUse && geminiToolCalls.length > 0) {
          for (const geminiCall of geminiToolCalls) {
            const claudeToolUseObject = {
              type: 'tool_use', id: geminiCall.name, name: geminiCall.name, input: geminiCall.args,
            };
            await streamHandlers.onToolUse(claudeToolUseObject);
          }
        }

        // Final message
        const finalMessage = {
          role: 'assistant',
          content: geminiToolCalls.length > 0
            ? geminiToolCalls.map(tc => ({ type: 'tool_use', id: tc.name, name: tc.name, input: tc.args }))
            : [{ type: 'text', text: fullText }],
          model: AppConfig.api.gemini.defaultModel,
          stop_reason: mapFinishReason(responseCandidate?.finishReason),
        };

        if (streamHandlers.onMessage) {
          streamHandlers.onMessage(finalMessage);
        }

        return finalMessage;
      }

      // Re-throw other errors as-is
      throw error;
    }

    // Create a new ReadableStream to adapt Gemini's output
    const customReadableStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for await (const chunk of result.stream) {
          const chunkText = chunk.text();
          if (chunkText) {
            // Pass only the text content to the stream handler
            controller.enqueue(encoder.encode(chunkText));
          }
        }
        controller.close();
      }
    });

    // Process the adapted stream with existing handlers
    const reader = customReadableStream.getReader();
    const decoder = new TextDecoder();
    let fullResponseText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkText = decoder.decode(value);
      if (streamHandlers.onText) {
        streamHandlers.onText(chunkText);
      }
      fullResponseText += chunkText;
    }

    const aggregatedResponse = await result.response;
    const responseCandidate = aggregatedResponse.candidates?.[0];
    if (!responseCandidate) throw new Error("No response candidate found from Gemini.");

    const geminiToolCalls = responseCandidate.content?.parts
      .filter(part => !!part.functionCall)
      .map(part => part.functionCall) || [];

    if (streamHandlers.onToolUse && geminiToolCalls.length > 0) {
      for (const geminiCall of geminiToolCalls) {
        const claudeToolUseObject = {
          type: 'tool_use', id: geminiCall.name, name: geminiCall.name, input: geminiCall.args,
        };
        await streamHandlers.onToolUse(claudeToolUseObject);
      }
    }

    // Construct the final message object to return, perfectly matching Claude's format.
    const finalMessage = {
      role: 'assistant',
      content: geminiToolCalls.length > 0
        ? geminiToolCalls.map(tc => ({ type: 'tool_use', id: tc.name, name: tc.name, input: tc.args }))
        : [{ type: 'text', text: fullResponseText }], // This is the format your app expects.
      model: AppConfig.api.gemini.defaultModel,
      stop_reason: mapFinishReason(responseCandidate.finishReason),
    };
    
    if (streamHandlers.onMessage) {
        streamHandlers.onMessage(finalMessage);
    }

    return finalMessage;
  };

  const getSystemPrompt = (promptType) => {
    return systemPrompts.systemPrompts[promptType]?.content ||
      systemPrompts.systemPrompts[AppConfig.api.defaultPromptType].content;
  };

  return { streamConversation, getSystemPrompt };
}

// Helper functions (no changes needed from your original code)
function mapFinishReason(reason) {
  switch (reason) {
    case 'STOP': return 'end_turn';
    case 'TOOL_USE': return 'tool_use';
    case 'MAX_TOKENS': return 'max_tokens';
    default: return 'end_turn';
  }
}

function transformToolsForGemini(tools) {
  return tools.map(tool => {
    const newTool = { ...tool };
    if (newTool.input_schema) {
      newTool.parameters = cleanParameters(newTool.input_schema);
      delete newTool.input_schema;
    }
    return newTool;
  });
}

function cleanParameters(params) {
  if (typeof params !== 'object' || params === null) return params;
  const cleanedParams = Array.isArray(params) ? [] : {};
  for (const key in params) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      if (key === 'format' && params.type === 'string' && !['enum', 'date-time'].includes(params[key])) continue;
      if (key !== 'additional_properties') {
        cleanedParams[key] = cleanParameters(params[key]);
      }
    }
  }
  return cleanedParams;
}

export default {
  createGeminiService
};
