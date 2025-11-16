# XML Tags vs Direct Commands Analysis for Vector

## Executive Summary

**Recommendation: Keep the current XML tag approach**

After analyzing the Vector codebase architecture, provider implementations, and use case requirements, I recommend **maintaining the current XML-based tool calling system** rather than migrating to native function calling APIs.

---

## Current Architecture

Vector currently uses a **custom XML-like tag format** for tool calls:

```xml
<tool_name>
  <param1>value1</param1>
  <param2>value2</param2>
</tool_name>
```

Key implementation details:
- Custom parser in `parseToolXML()` handles XML tags with nested JSON
- Tolerance for malformed output (code fences, JSON5-like syntax, bare newlines)
- Provider-agnostic text completion interface
- Works across OpenRouter, Gemini, Bedrock, and Nvidia providers
- None of the current providers use native function calling APIs

---

## Option 1: XML Tags (Current Approach)

### ✅ Advantages

#### 1. **Provider Independence**
- Works with ANY text completion model regardless of function calling support
- No dependency on provider-specific features
- Future-proof: new providers can be added with minimal changes

#### 2. **Unified Implementation**
- Single parsing logic (`parseToolXML()`) handles all providers
- Consistent behavior across OpenRouter (100+ models), Gemini, Bedrock, Nvidia
- Reduced maintenance burden (one parser vs. 4+ adapters)

#### 3. **Debugging & Transparency**
- Tool calls visible in raw text output
- `[orch] provider.raw ...` logs show exactly what the model generated
- Easy to diagnose issues in Roblox Studio development workflow
- Users can see what the AI is attempting to do

#### 4. **Flexibility**
- Can mix explanatory text with tool calls (via `VECTOR_ALLOW_TEXT_BEFORE_TOOL`)
- Gradual degradation: partial XML can still be parsed
- More forgiving of model quirks and variations

#### 5. **Proven Approach**
- Anthropic's Claude uses similar XML tool syntax successfully
- System is working in production with robust edge case handling
- Parser already handles: code fences, nested JSON, XML objects, JSON5 syntax

#### 6. **No Vendor Lock-in**
- Not dependent on OpenAI's function calling format
- Can switch providers without rewriting tool call logic
- Important for a multi-provider strategy like Vector's

#### 7. **Current Robustness**
Already handles edge cases:
```typescript
// Code fence unwrapping
coercePrimitive() // Handles ```json blocks
escapeBareNewlinesInJson() // Fixes bare newlines in JSON strings
parseXmlObject() // Accepts <props><Name>Foo</Name></props>
parseLooseEdits() // Tolerates malformed JSON arrays
```

### ❌ Disadvantages

#### 1. **Parsing Complexity**
- Custom parser with ~500 lines of tolerance logic
- Need to handle edge cases: code fences, JSON within XML, nested tags
- Ongoing maintenance as models evolve

#### 2. **Error Prone**
- Models sometimes generate malformed XML
- Requires retry logic and validation feedback
- `VALIDATION_ERROR` handling needed

#### 3. **Token Overhead**
- XML syntax uses more tokens than structured function calls
- Example: `<create_instance>` vs structured JSON
- Higher token costs, especially with verbose parameters

#### 4. **Less Type Safety**
- No provider-level schema validation
- Must validate after parsing (Zod schemas in `tools/schemas.ts`)
- Validation errors only caught after full generation

#### 5. **Non-Standard**
- Industry moving toward native function calling
- Developers expect standard patterns
- Onboarding requires understanding custom format

---

## Option 2: Direct Commands (Native Function Calling)

### ✅ Advantages

#### 1. **Native Provider Support**
- OpenAI: `tools` parameter with structured schemas
- Anthropic: `tools` parameter (similar to OpenAI)
- Gemini: `function_declarations` in `tools`
- Provider validates format before generation

#### 2. **Reliability**
- Provider ensures correct format
- Fewer parsing errors and malformed outputs
- Structured validation at API level

#### 3. **Type Safety**
- Schema defined at provider level
- Compile-time and runtime type checking
- Clearer contracts between AI and tool system

#### 4. **Token Efficiency**
- More compact representation
- No XML tag overhead
- Potentially lower costs at scale

#### 5. **Industry Standard**
- Best practice for production AI systems
- Well-documented patterns
- Developer familiarity

#### 6. **Better Tooling**
- Provider dashboards show function calls
- Built-in debugging in provider interfaces
- Standard monitoring and logging

### ❌ Disadvantages

#### 1. **Provider-Specific Implementations**
Must implement 4+ different adapters:
```typescript
// OpenRouter (varies by underlying model)
callOpenRouter({ tools: openAISchemas })

// Gemini (different format)
callGemini({ function_declarations: geminiSchemas })

// Bedrock (Claude format or Titan format)
callBedrock({ tools: claudeSchemas })

// Nvidia (OpenAI-compatible, but may vary)
callNvidia({ tools: openAISchemas })
```

#### 2. **Feature Parity Issues**
- Not all OpenRouter models support function calling
- Bedrock models have varying support (Claude vs Titan vs Llama)
- Nvidia endpoints may have limited function calling
- Would need fallback to XML for unsupported models anyway

#### 3. **Migration Cost**
Major rewrite required:
- Rewrite all 4 provider adapters
- Convert system prompt (remove XML format instructions)
- Update tool schemas to provider-specific formats
- Rewrite orchestrator to handle structured tool calls
- Update logging and debugging
- Test across all providers and models
- **Estimated effort: 2-3 weeks of development + testing**

#### 4. **Reduced Flexibility**
- Harder to mix text and function calls
- Less control over generation behavior
- Some providers don't support text before/after tools

#### 5. **API Dependency**
- Locked into provider-specific features
- Changes to provider APIs require updates
- Less control over the interface

#### 6. **Debugging Challenges**
- Function calls hidden in API metadata
- Not visible in raw text for debugging
- Harder to diagnose issues in Studio context

#### 7. **OpenRouter Complexity**
Vector uses OpenRouter as a primary provider:
- OpenRouter proxies 100+ models
- Each underlying model has different function calling support
- Some models don't support function calling at all
- Would need model-specific routing logic

---

## Specific Considerations for Vector

### 1. **Multi-Provider Strategy**
Vector explicitly supports multiple providers to avoid lock-in:
```typescript
type ProviderMode = 'openrouter' | 'gemini' | 'bedrock' | 'nvidia'
```
**Impact:** Native function calling would require maintaining 4+ different implementations, defeating the purpose of the unified orchestrator.

### 2. **Roblox Studio Context**
- Plugin runs in Roblox Studio IDE
- Users are game developers, not AI researchers
- Stability and reliability > cutting-edge features
- Breaking changes have high cost

**Impact:** The current XML system is working. Migration risk outweighs potential benefits.

### 3. **Development Workflow**
Key features enabled by XML approach:
- `[orch] provider.raw ...` logging shows exact model output
- Plugin users can see what tools are being called
- Debugging is straightforward (text-based)

**Impact:** Native function calling would make debugging harder in the Studio context.

### 4. **Already Invested in Robustness**
The codebase has sophisticated parsing:
```typescript
parseToolXML()      // Main parser
coercePrimitive()   // Handle multiple formats
parseXmlObject()    // Nested XML objects
stripCodeFences()   // Remove ```json blocks
toEditArray()       // Tolerant edit parsing
parseLooseEdits()   // Chunk-based parsing
```

**Impact:** Sunk cost in parser investment. It's working well.

### 5. **Token Costs**
Vector can use expensive models (Claude, GPT-4, etc.):
- XML overhead: ~10-20 extra tokens per tool call
- Average workflow: 5-10 tool calls
- Cost difference: ~100-200 tokens per workflow
- At $3/M tokens: ~$0.0006 per workflow

**Impact:** Token overhead is negligible for this use case.

---

## Benchmark Comparison

| Criteria | XML Tags | Native Function Calling |
|----------|----------|------------------------|
| **Multi-provider support** | ✅ Excellent | ⚠️ Requires multiple implementations |
| **Parsing reliability** | ⚠️ Good (with tolerance) | ✅ Excellent |
| **Implementation complexity** | ✅ Single parser | ❌ 4+ adapters |
| **Token efficiency** | ⚠️ Moderate overhead | ✅ Efficient |
| **Debugging** | ✅ Transparent | ⚠️ Harder |
| **Flexibility** | ✅ High | ⚠️ Limited |
| **Type safety** | ⚠️ Post-parse validation | ✅ Provider-level |
| **Migration cost** | ✅ None (current) | ❌ 2-3 weeks |
| **Vendor lock-in risk** | ✅ None | ⚠️ Moderate |
| **Industry standard** | ❌ Custom | ✅ Standard |

---

## Recommendation Details

### **Keep XML Tags** ✅

**Primary Reasons:**

1. **Multi-provider strategy is core to Vector's value proposition**
   - Supporting OpenRouter, Gemini, Bedrock, Nvidia is a feature, not a bug
   - Unified interface is more valuable than native function calling

2. **Current system is working and robust**
   - Parser handles edge cases well
   - Production-ready with good error handling
   - "Don't fix what isn't broken"

3. **Migration cost doesn't justify benefits**
   - 2-3 weeks of development for minimal gain
   - Risk of introducing bugs
   - Better to focus on user-facing features

4. **Debugging benefits are significant**
   - Roblox Studio developers need transparency
   - Text-based tool calls are easier to understand
   - `provider.raw` logging is valuable

5. **Similar to proven patterns**
   - Anthropic Claude uses XML tools successfully
   - Cline (AI coding assistant) uses similar approach
   - Proven pattern for multi-provider AI systems

### Suggested Improvements to Current System

Instead of migrating to function calling, consider these enhancements:

#### 1. **Improve Error Messages**
```typescript
// Current: generic validation errors
// Improved: specific guidance
function parseToolXML(text: string): ParsedTool | ParseError {
  // Return detailed error with fix suggestions
  // Example: "Expected closing tag </create_instance>, found </create-instance>"
}
```

#### 2. **Add Parser Metrics**
```typescript
// Track parsing success rates
const parserMetrics = {
  totalParsed: 0,
  successfulParses: 0,
  retryRequired: 0,
  commonErrors: new Map<string, number>()
}
```

#### 3. **Enhanced Validation Feedback**
```typescript
// Give model better feedback on errors
function buildValidationFeedback(error: ZodError): string {
  return `Tool call failed validation:
    - ${error.path.join('.')}: ${error.message}
    - Example: <${toolName}><${param}>value</${param}></${toolName}>
    - Retry with corrected format`
}
```

#### 4. **Optional Strict Mode**
```typescript
// For testing or specific providers
if (process.env.VECTOR_STRICT_XML_PARSING === '1') {
  // Disable tolerance logic for cleaner outputs
}
```

#### 5. **Document Format in System Prompt**
The system prompt already has good guidance, but could be even clearer:
```typescript
const TOOL_FORMAT_GUIDE = `
Tool Call Format (CRITICAL):

✅ Correct:
<create_instance>
  <className>Part</className>
  <parentPath>game.Workspace</parentPath>
  <props>{"Name":"Floor","Anchored":true}</props>
</create_instance>

❌ Wrong:
- Unclosed tags: <create_instance><className>Part
- Mismatched tags: <className>Part</classname>
- Quoted JSON: <props>"{"Name":"Floor"}"</props>
- Code fences: <props>\`\`\`json{"Name":"Floor"}\`\`\`</props>
`
```

---

## When Would Native Function Calling Be Better?

Native function calling would be preferable for:

1. **Single-provider systems** (e.g., OpenAI-only)
2. **New greenfield projects** (no migration cost)
3. **High-volume, cost-sensitive applications** (token efficiency matters)
4. **Systems where type safety is critical** (financial, medical)
5. **When provider guarantees are essential** (compliance requirements)

But Vector is **not** in any of these categories.

---

## Migration Path (If Ever Needed)

If you decide to migrate later, here's a gradual approach:

### Phase 1: Hybrid Support
```typescript
function parseResponse(text: string, provider: ProviderMode): ParsedTool[] {
  // Try native function call parsing first
  const nativeTools = parseNativeFunctionCalls(metadata)
  if (nativeTools.length > 0) return nativeTools
  
  // Fall back to XML parsing
  return parseToolXML(text)
}
```

### Phase 2: Provider-Specific Migration
```typescript
// Migrate one provider at a time
if (provider === 'openrouter' && supportsNativeFunctionCalling(model)) {
  return callWithFunctionCalling(...)
} else {
  return callWithXMLParsing(...)
}
```

### Phase 3: Deprecate XML (if all providers support native)
- Only after all providers support function calling
- Keep XML as fallback for 6-12 months
- Gradual sunset with deprecation warnings

**Timeline:** 12-18 months (if ever)

---

## Conclusion

For Vector's specific use case—a Roblox Studio AI copilot with multi-provider support, development tooling focus, and working production code—the **XML tag approach is the right choice**.

The benefits of native function calling (type safety, token efficiency, industry standard) do not outweigh the costs (multi-provider complexity, migration effort, reduced debugging capability) for this project.

**Final Recommendation:** Keep XML tags, invest in incremental improvements to the parser and error handling.

---

## Additional Resources

- Anthropic Claude tool use: https://docs.anthropic.com/claude/docs/tool-use
- OpenAI function calling: https://platform.openai.com/docs/guides/function-calling
- Cline (similar project): https://github.com/cline/cline
- Vector orchestrator: `vector/apps/web/lib/orchestrator/index.ts`
- Parser implementation: `parseToolXML()` at line 564

---

**Document Version:** 1.0  
**Date:** October 16, 2024  
**Author:** AI Code Analysis  
**Status:** Final Recommendation
