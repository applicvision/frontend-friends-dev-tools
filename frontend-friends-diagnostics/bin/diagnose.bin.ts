#! /usr/bin/env node

import { parseArguments } from '@applicvision/js-toolbox/args'
import style from '@applicvision/js-toolbox/style'
import { relative } from 'node:path'
import { diagnoseFile, getProgram } from '../index.ts'

const parsed = parseArguments()
	.option('--config', { description: 'Path to tsconfig.' })
	.help('Welcome to Frontend Friends diagnostics.\nUsage: [<options>] [--] [<pathspec>]')
	.parse()

if (parsed.help) {
	console.log(parsed.help)
	process.exit(0)
}

const options = parsed.options as { config?: string }

const program = getProgram(options.config)
if (!program) {
	process.exit(1)
}

for (const entry of parsed.args.length > 0 ? parsed.args : program.getRootFileNames()) {

	const diagnostics = diagnoseFile(program, entry)

	if (diagnostics.length > 0) {
		process.exitCode = 1
		console.log(diagnostics.length, diagnostics.length == 1 ? 'Error in' : 'Errors in', relative(process.cwd(), entry))
	}

	diagnostics.forEach(({ message, line, range }) => {
		console.group()
		console.log()
		console.log(message)

		const onelineError = range.start.line == range.end.line

		console.log()
		const trimmedLine = line.trimStart()
		const lineNumber = `${range.start.line + 1} |`
		console.log(style.dim(lineNumber) + ' ' + trimmedLine)
		const leadingWhitespace = line.length - trimmedLine.length
		const indicatorLine = ' '.repeat(range.start.character - leadingWhitespace) +
			(onelineError ?
				'^'.repeat(range.end.character - range.start.character) + ' '.repeat(line.length - range.end.character) :
				'^'.repeat(line.length - range.start.character)
			)

		console.log(' '.repeat(lineNumber.length) + ' ' + indicatorLine)

		console.groupEnd()
	})
}
