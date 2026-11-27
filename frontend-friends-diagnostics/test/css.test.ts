import { diagnoseFile, getProgram } from '@applicvision/frontend-friends-diagnostics'
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'

describe('Diagnose css', () => {
	let program: ts.Program
	before(() => {
		program = getProgram()!
	})
	it('Should find errors in css tagged templates', () => {
		const diagnostics = diagnoseFile(program, './test/css-sample.ts')

		assert.deepEqual(diagnostics.map(({ message, range, source, code }) => ({ message, range, source, code })), [
			{
				message: "Unknown property 'colr'",
				source: 'css-tree',
				code: 'unknown-property',
				range: { start: { line: 9, character: 2 }, end: { line: 9, character: 6 } }
			},
			{
				message: "Invalid value for 'margin': '1px 2px 3px 4px 5px'",
				source: 'css-tree',
				code: 'invalid-value',
				range: { start: { line: 12, character: 26 }, end: { line: 12, character: 29 } }
			},
			{
				message: "Invalid value for 'opacity': '2px'",
				source: 'css-tree',
				code: 'invalid-value',
				range: { start: { line: 15, character: 20 }, end: { line: 15, character: 23 } }
			},
			{
				message: "Unknown descriptor 'foo' in '@font-face'",
				source: 'css-tree',
				code: 'unknown-descriptor',
				range: { start: { line: 19, character: 35 }, end: { line: 19, character: 38 } }
			}
		])
	})
})
