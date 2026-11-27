import { diagnoseFile, getProgram } from '@applicvision/frontend-friends-diagnostics'
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'

describe('Diagnose fragment', () => {
	let program: ts.Program
	before(() => {
		program = getProgram()!
	})
	it('Should find errors', () => {
		const diagnostics = diagnoseFile(program, './test/sample.ts')
		assert.equal(diagnostics.length, 3)

		assert.equal(diagnostics[0].message, 'A function is expected as event handler')
		assert.deepEqual(diagnostics[0].range, {
			start: { line: 3, character: 9 }, end: { line: 3, character: 16 }
		})

		assert.equal(diagnostics[1].message, "Unclosed element '<button>'")
		assert.deepEqual(diagnostics[1].range, {
			start: { line: 3, character: 2 }, end: { line: 3, character: 8 }
		})

		assert.equal(diagnostics[2].message, "End tag '</div>' seen but there were open elements")
		assert.deepEqual(diagnostics[2].range, {
			start: { line: 4, character: 1 }, end: { line: 4, character: 5 }
		})
	})
})
