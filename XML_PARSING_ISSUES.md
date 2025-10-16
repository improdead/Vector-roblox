# XML Parsing Issues Analysis

## Summary

After investigating the codebase, here are the **actual issues** with the XML tag approach that are causing problems, especially with asset search:

---

## Critical Issue #1: Tags Parameter Parsing Fails

### The Problem

The `search_assets` tool expects a `tags` parameter as an array:

```typescript
// schema.ts
search_assets: z.object({ 
  query: z.string(), 
  tags: z.array(z.string()).optional(),  // <-- EXPECTS ARRAY
  limit: z.number().min(1).max(50).optional() 
})
```

But when models generate XML like this:

```xml
<search_assets>
  <query>oak tree</query>
  <tags>["tree","nature"]</tags>
  <limit>6</limit>
</search_assets>
```

The `coercePrimitive()` function tries to parse `["tree","nature"]` but may fail if there are:
- Single quotes: `['tree','nature']`
- Spacing issues: `[ "tree", "nature" ]`
- Unquoted values: `[tree, nature]`
- Code fences: ` ```json ["tree","nature"] ``` `

### The Fix Needed

The parser has some tolerance but not enough. It should handle:
1. Single quotes → double quotes
2. Unquoted array elements
3. Mixed formats

---

## Critical Issue #2: Non-Greedy XML Tag Matching

### The Problem

The regex in `parseToolXML()` is **non-greedy** which fails with nested tags:

```typescript
const tagRe = /<([a-zA-Z_][\w]*)>([\s\S]*?)<\/\1>/g  // <-- *? is non-greedy
```

Example failure:

```xml
<search_assets>
  <query>barracks</query>
  <tags>["model", "building"]</tags>  <!-- This has "model" inside! -->
  <limit>6</limit>
</search_assets>
```

The regex might stop at the first `</` it sees, potentially cutting off early.

---

## Critical Issue #3: Empty or Malformed Inner Content

### The Problem

When models generate:

```xml
<search_assets>
  <query></query>  <!-- Empty! -->
  <tags>[]</tags>
  <limit>6</limit>
</search_assets>
```

The parser doesn't handle empty strings well, leading to validation errors.

---

## Critical Issue #4: Model Confusion on Format

### The Real Problem

The system prompt shows examples like:

```xml
<search_assets>
  <query>oak tree</query>
  <tags>["tree","nature"]</tags>
  <limit>6</limit>
</search_assets>
```

But models sometimes generate:

**Wrong Format 1: Nested XML Tags**
```xml
<search_assets>
  <query>oak tree</query>
  <tags>
    <tag>tree</tag>
    <tag>nature</tag>
  </tags>
  <limit>6</limit>
</search_assets>
```

**Wrong Format 2: Comma-separated**
```xml
<search_assets>
  <query>oak tree</query>
  <tags>tree, nature</tags>
  <limit>6</limit>
</search_assets>
```

**Wrong Format 3: Single quotes**
```xml
<search_assets>
  <query>oak tree</query>
  <tags>['tree', 'nature']</tags>
  <limit>6</limit>
</search_assets>
```

### Current Parser Behavior

The `coercePrimitive()` function tries to handle these but:
1. Doesn't unwrap nested XML arrays
2. Single quote regex can fail on escaped quotes
3. Doesn't handle comma-separated strings

---

## Critical Issue #5: Array vs String Confusion

### The Problem

Look at line 921-926 in orchestrator/index.ts:

```typescript
if (name === 'search_assets') {
  const query = typeof (a as any).query === 'string' ? (a as any).query : (msg || 'button')
  const tags = Array.isArray((a as any).tags) ? (a as any).tags.map(String) : undefined  // <-- ONLY WORKS IF ARRAY
  const limit = typeof (a as any).limit === 'number' ? (a as any).limit : 6
  proposals.push({ id: id('asset'), type: 'asset_op', search: { query, tags, limit } })
  return { proposals }
}
```

If `tags` comes as a string (which it often does from XML), it becomes `undefined`.

Example:
- Input: `<tags>["tree","nature"]</tags>`
- After `coercePrimitive()`: Could be string `'["tree","nature"]'` or array `['tree', 'nature']`
- If it's a string, `Array.isArray()` returns false
- Result: `tags = undefined`

---

## Critical Issue #6: Validation Happens AFTER Parsing

The flow is:
1. Parse XML → get args object
2. Map to proposals (line 921) → tags become undefined if not array
3. Validate with Zod (line 1656)
4. Zod validation passes because `tags` is optional!

So invalid tags silently become `undefined` and the search returns bad results.

---

## Critical Issue #7: No Retry Logic for Search Failures

When asset search fails:
1. The orchestrator doesn't detect it as a failure
2. No validation error is raised
3. The model continues thinking it worked
4. Results are empty or wrong

---

## Specific Test Cases That Fail

### Test Case 1: Single Quotes
```xml
<search_assets>
  <query>tower</query>
  <tags>['model', 'structure']</tags>
</search_assets>
```
**Expected:** `tags = ['model', 'structure']`
**Actual:** `tags = undefined` (fails to parse single quotes consistently)

### Test Case 2: Nested XML
```xml
<search_assets>
  <query>tree</query>
  <tags>
    <tag>nature</tag>
    <tag>plant</tag>
  </tags>
</search_assets>
```
**Expected:** `tags = ['nature', 'plant']`
**Actual:** `tags = undefined` (nested tags not handled)

### Test Case 3: Comma-Separated
```xml
<search_assets>
  <query>fence</query>
  <tags>barrier, wall, boundary</tags>
</search_assets>
```
**Expected:** `tags = ['barrier', 'wall', 'boundary']`
**Actual:** `tags = undefined` (comma-separated not parsed)

### Test Case 4: Extra Whitespace
```xml
<search_assets>
  <query>chair</query>
  <tags>  [ "furniture" , "seat" ]  </tags>
</search_assets>
```
**Expected:** `tags = ['furniture', 'seat']`
**Actual:** Possibly works, but fragile

---

## Comparison: Native Function Calling Would Fix This

With native function calling:

```typescript
// OpenAI/Anthropic function calling format
{
  "name": "search_assets",
  "arguments": {
    "query": "tower",
    "tags": ["model", "structure"],  // <-- Provider validates this as array
    "limit": 6
  }
}
```

**Benefits:**
1. Provider ensures `tags` is actually an array
2. No parsing ambiguity
3. Type-safe at API level
4. Consistent format across all calls

---

## Root Cause Analysis

The XML approach has **fundamental ambiguity**:

```xml
<tags>["a","b"]</tags>  <!-- Is this a string or an array? -->
```

Versus native function calling which is unambiguous:
```json
{"tags": ["a","b"]}  <!-- This is definitely an array -->
```

---

## Recommended Fixes

### Option 1: Fix XML Parser (Band-aid)

Improve `coercePrimitive()` to:

```typescript
function coercePrimitive(v: string): any {
  const t = v.trim()
  
  // Handle comma-separated lists for array fields
  if (/^[a-zA-Z_][\w]*(?:\s*,\s*[a-zA-Z_][\w]*)+$/.test(t)) {
    return t.split(/\s*,\s*/).map(s => s.trim())
  }
  
  // Handle nested XML tags like <tag>val</tag><tag>val2</tag>
  if (/<([a-zA-Z_][\w]*)>/.test(t)) {
    const xmlArr = parseNestedXmlArray(t)
    if (xmlArr) return xmlArr
  }
  
  // ... existing logic
}

function parseNestedXmlArray(xml: string): string[] | null {
  const matches: string[] = []
  const re = /<tag>(.*?)<\/tag>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    matches.push(m[1])
  }
  return matches.length > 0 ? matches : null
}
```

### Option 2: Improve System Prompt (Better)

Make the format crystal clear:

```
CRITICAL FORMAT FOR ARRAYS:
<tags>["value1","value2"]</tags>  ✅ CORRECT (strict JSON array with double quotes)
<tags>['value1','value2']</tags>  ❌ WRONG (single quotes not allowed)
<tags>value1, value2</tags>       ❌ WRONG (comma-separated not allowed)
<tags>
  <tag>value1</tag>
  <tag>value2</tag>
</tags>                           ❌ WRONG (nested tags not allowed)
```

### Option 3: Add Pre-Validation (Quick Win)

Before mapping to proposals, validate and transform:

```typescript
if (name === 'search_assets') {
  let query = typeof (a as any).query === 'string' ? (a as any).query : (msg || 'button')
  let tags = (a as any).tags
  
  // Transform tags to array if it's a string
  if (typeof tags === 'string') {
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(tags)
      if (Array.isArray(parsed)) {
        tags = parsed.map(String)
      }
    } catch {
      // Try comma-separated
      if (tags.includes(',')) {
        tags = tags.split(',').map(s => s.trim()).filter(s => s.length > 0)
      }
    }
  }
  
  // Ensure it's an array
  const tagsArray = Array.isArray(tags) ? tags.map(String) : undefined
  
  // Validate before creating proposal
  if (!query || query.trim().length === 0) {
    return { proposals, missingContext: 'search_assets requires non-empty query' }
  }
  
  const limit = typeof (a as any).limit === 'number' ? (a as any).limit : 6
  proposals.push({ id: id('asset'), type: 'asset_op', search: { query, tags: tagsArray, limit } })
  return { proposals }
}
```

### Option 4: Migrate to Native Function Calling (Proper Fix)

**For OpenRouter/Claude/GPT models that support it:**
- Use native `tools` parameter
- Get structured JSON responses
- No parsing ambiguity

**For models that don't support it:**
- Keep XML as fallback
- Detect capability per model

---

## Specific Fix for Asset Search

### Immediate Fix (5 minutes):

Add better tags handling in `mapToolToProposals`:

```typescript
if (name === 'search_assets') {
  const query = typeof (a as any).query === 'string' ? (a as any).query : (msg || 'button')
  
  // Better tags parsing
  let tags: string[] | undefined = undefined
  const tagsRaw = (a as any).tags
  
  if (Array.isArray(tagsRaw)) {
    tags = tagsRaw.map(String).filter(s => s.trim().length > 0)
  } else if (typeof tagsRaw === 'string' && tagsRaw.trim().length > 0) {
    const trimmed = tagsRaw.trim()
    // Try JSON parse
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        tags = parsed.map(String).filter(s => s.trim().length > 0)
      }
    } catch {
      // Try comma/space split
      tags = trimmed
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0 && s !== 'tags')
    }
  }
  
  const limit = typeof (a as any).limit === 'number' ? (a as any).limit : 6
  proposals.push({ id: id('asset'), type: 'asset_op', search: { query, tags, limit } })
  return { proposals }
}
```

---

## Conclusion

**The XML approach has inherent parsing ambiguities** that make it error-prone for complex types like arrays. Asset search fails because:

1. Models generate tags in multiple formats
2. The parser doesn't handle all formats
3. Silent failures cause tags to become `undefined`
4. No validation error is raised

**Short-term fix:** Improve tags parsing in `search_assets` handler
**Long-term fix:** Migrate to native function calling for supported providers

---

**Next Steps:**
1. ✅ Identify the issue (this document)
2. ⚠️ Implement immediate fix for `search_assets`
3. ⚠️ Add validation that catches empty tags before creating proposals
4. ⚠️ Update system prompt with explicit array format requirements
5. ⚠️ Consider native function calling for primary providers
