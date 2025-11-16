# Quick Decision Summary: XML Tags vs Direct Commands

## TL;DR

**Keep the XML tags.** Don't migrate to native function calling.

### Update (Oct 16, 2024)
- XML parser hardened to accept JSON/function-call fallbacks and attribute-based tags
- `search_assets` tags now parsed from strings, nested XML, or comma-separated formats
- See `FIXES_APPLIED.md` for implementation details and test cases

---

## The Question

Should Vector continue using XML-like tags for tool calls, or switch to native function calling APIs?

```xml
<!-- Current: XML Tags -->
<create_instance>
  <className>Part</className>
  <props>{"Name":"Floor"}</props>
</create_instance>
```

```json
// Alternative: Native Function Calling
{
  "name": "create_instance",
  "arguments": {
    "className": "Part",
    "props": {"Name": "Floor"}
  }
}
```

---

## The Answer

**Keep XML tags** because Vector's architecture is built around **multi-provider support**, and native function calling would require maintaining 4+ different implementations.

---

## Key Reasons

### 1. Multi-Provider is Core Value
Vector supports:
- OpenRouter (100+ models)
- Gemini
- AWS Bedrock  
- Nvidia

Each provider has different function calling APIs. XML keeps one unified interface.

### 2. It's Working
- Parser handles edge cases well
- Robust error tolerance built in
- Production-ready and stable

### 3. Migration Cost Too High
- 2-3 weeks development
- Risk of bugs
- Testing across all providers
- Better to focus on user features

### 4. Debugging Benefits
- Tool calls visible in raw text
- `[orch] provider.raw` logs show everything
- Critical for Roblox Studio development

### 5. Proven Pattern
- Anthropic Claude uses XML tools
- Cline (AI coding assistant) uses similar
- Not a weird custom approach

---

## What About the Downsides?

### "XML parsing is complex"
✅ Already invested in robust parser with tolerance logic. Working well.

### "Models make mistakes with XML"
✅ Have retry logic and validation feedback. Handles this well.

### "Token overhead"
✅ ~100-200 extra tokens per workflow = $0.0006. Negligible.

### "Not industry standard"
✅ Multi-provider support is more valuable than being "standard"

---

## When Would Function Calling Be Better?

Function calling makes sense for:
- ❌ Single-provider systems (Vector supports 4+)
- ❌ New greenfield projects (Vector is already built)
- ❌ High token costs (Vector's costs are negligible)
- ❌ Type safety requirements (development tool, not medical/financial)

Vector is **none of these**.

---

## Recommended Next Steps

Instead of migrating, improve the current system:

1. **Better error messages** - More specific validation feedback
2. **Parser metrics** - Track success rates and common errors
3. **Enhanced system prompt** - Clearer format examples
4. **Optional strict mode** - For testing

See `XML_VS_DIRECT_COMMANDS_ANALYSIS.md` for detailed recommendations.

---

## Bottom Line

Vector's XML-based tool calling is:
- ✅ Working in production
- ✅ Multi-provider compatible
- ✅ Easy to debug
- ✅ Proven pattern
- ✅ Cost-effective to maintain

Migrating to function calling would:
- ❌ Require 2-3 weeks development
- ❌ Need 4+ different implementations
- ❌ Make debugging harder
- ❌ Provide minimal benefit

**Decision: Keep XML tags. Focus on user features instead.**

---

## See Also

- Full analysis: `XML_VS_DIRECT_COMMANDS_ANALYSIS.md`
- Current parser: `vector/apps/web/lib/orchestrator/index.ts` line 564
- System prompt: `vector/apps/web/lib/orchestrator/index.ts` line 350
