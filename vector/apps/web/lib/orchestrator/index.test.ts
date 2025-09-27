import assert from 'node:assert/strict'

import { parseToolXML } from './index'

type Case = { name: string; fn: () => void }

const cases: Case[] = [
  {
    name: 'parseToolXML extracts prefix text before the tool',
    fn: () => {
      const xml = `Heads up before tool\n<message>\n  <text>Hello world</text>\n</message>`
      const parsed = parseToolXML(xml)
      assert.ok(parsed, 'expected tool to parse')
      assert.equal(parsed!.name, 'message')
      assert.equal(parsed!.prefixText.trim(), 'Heads up before tool')
      assert.equal(parsed!.suffixText.trim(), '')
      assert.deepEqual(parsed!.args, { text: 'Hello world' })
    },
  },
  {
    name: 'parseToolXML captures trailing text after the tool',
    fn: () => {
      const xml = `<message>\n  <text>All done</text>\n</message>\nThanks!`
      const parsed = parseToolXML(xml)
      assert.ok(parsed, 'expected tool to parse')
      assert.equal(parsed!.suffixText.trim(), 'Thanks!')
    },
  },
  {
    name: 'parseToolXML handles JSON-like payloads inside code fences',
    fn: () => {
      const xml = [
        '<apply_edit>',
        '  <path>ServerScriptService.Script</path>',
        '  <edits>```json',
        '  [{',
        '    "start": { "line": 0, "character": 0 },',
        '    "end": { "line": 0, "character": 0 },',
        '    "text": "print(\\"hi\\")"',
        '  }]',
        '  ```</edits>',
        '</apply_edit>',
      ].join('\n')
      const parsed = parseToolXML(xml)
      assert.ok(parsed, 'expected tool to parse')
      const edits = parsed!.args.edits
      assert.ok(Array.isArray(edits), 'expected edits to be parsed as an array')
      assert.equal(edits.length, 1)
      assert.deepEqual(edits[0].start, { line: 0, character: 0 })
      assert.deepEqual(edits[0].end, { line: 0, character: 0 })
      assert.equal(edits[0].text, 'print("hi")')
    },
  },
  {
    name: 'parseToolXML returns null when no tool tag is present',
    fn: () => {
      const parsed = parseToolXML('Just some plain text with no tool tag.')
      assert.equal(parsed, null)
    },
  },
]

let failed = false
for (const c of cases) {
  try {
    c.fn()
    console.log(`ok ${c.name}`)
  } catch (err) {
    failed = true
    console.error(`fail ${c.name}`)
    console.error(err)
  }
}

process.exit(failed ? 1 : 0)
