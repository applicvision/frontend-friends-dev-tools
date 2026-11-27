import ts from 'typescript'
import { HtmlValidate } from 'html-validate'
import { interpolationDescriptors } from '@applicvision/frontend-friends/dynamic-fragment'
import { dirname, resolve } from 'path'
import { validateCss } from './css.ts'


export function getProgram(configPath?: string) {
	const projectConfig = getProjectConfig(configPath)
	if (projectConfig) {
		return ts.createProgram(projectConfig.fileNames, projectConfig.options)
	}
}

function getProjectConfig(configPath?: string) {

	if (configPath) {
		const resolvedPath = resolve(process.cwd(), configPath)
		const configFile = ts.readConfigFile(resolvedPath, ts.sys.readFile)
		if (configFile.error) {
			console.error(configFile.error)
		}
		return configFile.config ? ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(resolvedPath)) : null
	}
	const defaultConfigFilePath = ts.findConfigFile(process.cwd(), ts.sys.fileExists) ??
		ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'jsconfig.json')

	if (defaultConfigFilePath) {
		const configFile = ts.readConfigFile(defaultConfigFilePath, ts.sys.readFile)
		if (configFile.error) {
			console.error(configFile.error)
		}
		return configFile.config ? ts.parseJsonConfigFileContent(configFile.config, ts.sys, process.cwd()) : null
	}

	const fallbackConfig = {
		compilerOptions: {
			checkJs: true,
			allowJs: true,
			noEmit: true,
			target: 'EsNext',
			module: 'NodeNext',
			moduleResolution: 'nodenext'
		}
	}
	return ts.parseJsonConfigFileContent(fallbackConfig, ts.sys, process.cwd())
}

type TextPosition = { line: number, character: number }
type Range = { start: TextPosition, end: TextPosition }
const severity = {
	error: 1,
	warning: 2,
	information: 3,
	hint: 4
} as const

type Severity = typeof severity[keyof typeof severity]

export type Diagnostic = {
	range: Range
	message: string
	/** The full text of the line where the diagnostic starts */
	line: string
	severity: Severity
	/** What produced the diagnostic: 'frontend-friends', 'html-validate' or 'css-tree' */
	source: string
	/** Identifier of the rule which was broken */
	code: string
	/** Link to documentation for the rule, when available */
	codeDescription?: { href: string }
}

type GetLine = (line: number) => string

const taggedTemplateRegex = /\b(html|svg|css)\s*`/dg
const keyedTaggedTemplateRegex = /\b(html|svg)\.key\(/dg

const htmlValidate = new HtmlValidate({
	extends: ['html-validate:standard'],
	rules: {
		'no-trailing-whitespace': 'off',
		'no-implicit-button-type': 'off'
	}
})

function findTaggedTemplates(root: ts.SourceFile) {
	const taggedTemplateExpressions: ts.TaggedTemplateExpression[] = []

	const text = root.getFullText()

	for (const match of text.matchAll(taggedTemplateRegex)) {
		const offset = match.index
		const node = findNodeAt(root, offset)


		if (node?.parent && ts.isTaggedTemplateExpression(node.parent)) {
			const { tag } = node.parent
			if (ts.isIdentifier(tag) && (tag.text == 'html' || tag.text == 'svg' || tag.text == 'css')) {
				taggedTemplateExpressions.push(node.parent)
			}
		}
	}
	for (const match of text.matchAll(keyedTaggedTemplateRegex)) {
		const offset = match.index
		const node = findNodeAt(root, offset + 6)
		const maybeTaggedTemplate = node?.parent?.parent?.parent
		if (maybeTaggedTemplate && ts.isTaggedTemplateExpression(maybeTaggedTemplate)) {
			taggedTemplateExpressions.push(maybeTaggedTemplate)
		}
	}
	return taggedTemplateExpressions
}

function satisfiesType(type: ts.Type, typeFlag: ts.TypeFlags) {
	return (type.flags & typeFlag ||
		type.isUnion() && type.types.every(type => type.flags & typeFlag))
}

function satisfiesTypes(type: ts.Type, typeFlags: ts.TypeFlags[]) {
	if (typeFlags.some(flag => type.flags & flag)) {
		return true
	}
	return type.isUnion() && type.types.every(type => typeFlags.some(flag => type.flags & flag))
}

function isTypeObject(type: ts.Type) {
	if (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.NonPrimitive)) {
		return true;
	}
	if (type.isUnion()) {
		return type.types.every(isTypeObject)
	}
	if (type.isIntersection()) {
		return type.types.some(isTypeObject)
	}
	return false
}

function diagnoseTaggedTemplateSpans(
	typeChecker: ts.TypeChecker,
	diagnostics: Diagnostic[],
	descriptors: InterpolationDescriptor[],
	templateSpans: ts.NodeArray<ts.TemplateSpan>,
	tsSource: ts.SourceFile,
	getLine: GetLine) {

	const attributeDiagnostic = (expression: ts.Expression, descriptor: Exclude<InterpolationDescriptor, { type: 'content' }>, code: string, message: string) => {
		const startPos = expression.getStart() - 2 - descriptor.attributeStart
		const start = tsSource.getLineAndCharacterOfPosition(startPos)
		const end = tsSource.getLineAndCharacterOfPosition(startPos + descriptor.attribute.length)
		diagnostics.push(frontendFriendsDiagnostic({ start, end }, code, message, getLine))
	}

	// Highlights the ${ of an interpolation
	const interpolationDiagnostic = (expression: ts.Expression, code: string, message: string) => {
		const start = tsSource.getLineAndCharacterOfPosition(expression.getStart() - 2)
		const end = tsSource.getLineAndCharacterOfPosition(expression.getStart())
		diagnostics.push(frontendFriendsDiagnostic({ start, end }, code, message, getLine))
	}

	return templateSpans.map(({ expression }, index) => {

		const type = typeChecker.getTypeAtLocation(expression)
		const interpolationDescriptor = descriptors[index]

		const isBoolean = satisfiesType(type, ts.TypeFlags.BooleanLike)
		const isStringOrNumber = satisfiesTypes(type, [ts.TypeFlags.StringLike, ts.TypeFlags.NumberLike])
		const isObject = isTypeObject(type)


		switch (interpolationDescriptor.type) {
			case 'eventhandler':
				const [callSignature] = typeChecker.getSignaturesOfType(type, ts.SignatureKind.Call)
				if (!callSignature) {
					attributeDiagnostic(expression, interpolationDescriptor, 'event-handler-type',
						'A function is expected as event handler'
					)
				}
				break
			case 'attribute':
				if (isBoolean) {
					if (interpolationDescriptor.quotemark) {
						attributeDiagnostic(expression, interpolationDescriptor, 'boolean-attribute-quotes',
							'Boolean attributes can not use quotemark'
						)
					}

				} else if (!isStringOrNumber) {
					attributeDiagnostic(expression, interpolationDescriptor, 'attribute-type',
						'Attributes should use a string, number or boolean'
					)
				}
				break
			case 'attributeExtension':
				if (!isStringOrNumber) {
					interpolationDiagnostic(expression, 'attribute-extension-type',
						'Attribute extension can only be strings or numbers'
					)
				}
				break
			case 'specialAttribute':
				switch (interpolationDescriptor.attribute) {
					case 'ff-share':
						if (!isObject) {
							attributeDiagnostic(expression, interpolationDescriptor, 'ff-share-type',
								'ff-share must use an object for two way binding'
							)
						}
						const { elementName } = interpolationDescriptor
						if (!(elementName.includes('-') || elementName == 'input' || elementName == 'textarea' || elementName == 'select')) {
							attributeDiagnostic(expression, interpolationDescriptor, 'ff-share-element',
								'ff-share can only be used in native input elements, or custom elements which implement two way binding'
							)
						}
						break
					case 'ff-ref':
						if (type.getSymbol()?.escapedName != 'ElementReference') {
							attributeDiagnostic(expression, interpolationDescriptor, 'ff-ref-type',
								'ff-ref must use an ElementReference instance, created with ref().'
							)
						}
						break
				}
				break
			case 'content':
				const typeAsString = typeChecker.typeToString(type)

				if (typeChecker.isArrayType(type)) {
					if (typeAsString != 'DynamicFragment[]') {
						interpolationDiagnostic(expression, 'array-content-type',
							'Array content should be declared with html tag, ' + typeAsString
						)
					}
				} else if (isObject && typeAsString != 'DynamicFragment' && typeAsString != 'PropertySetter' && typeAsString != 'InnerHTML') {
					interpolationDiagnostic(expression, 'content-type', 'Invalid content: ' + typeAsString)
				}
		}
		return type
	})
}

export function diagnoseFile(program: ts.Program, fileName: string): Diagnostic[] {

	const tsSource = program.getSourceFile(fileName)

	if (!tsSource) {
		return []
	}

	const typeChecker = program.getTypeChecker()

	let _allLines: string[] | null = null
	const getLine = (lineNumber: number) => {
		if (!_allLines) {
			_allLines = tsSource.getFullText().split(/\r?\n/)
		}
		return _allLines[lineNumber]
	}

	const diagnostics: Diagnostic[] = []
	const taggedTemplates = findTaggedTemplates(tsSource)

	taggedTemplates.forEach(taggedTemplate => {

		if (taggedTemplate.tag.getText() == 'css') {
			diagnostics.push(...diagnoseCss(taggedTemplate, tsSource, getLine))
			return
		}

		const shouldDiagnoseHtml = taggedTemplate.tag.getText().includes('html')

		const start = tsSource.getLineAndCharacterOfPosition(taggedTemplate.template.getStart() + 1)

		if (ts.isNoSubstitutionTemplateLiteral(taggedTemplate.template)) {
			if (shouldDiagnoseHtml) {
				diagnostics.push(...diagnoseHtml(taggedTemplate.template.text, start, getLine))
			}
			return
		}

		const templateParts = [
			taggedTemplate.template.head.rawText ?? '',
			...taggedTemplate.template.templateSpans.map(({ literal }) => literal.rawText ?? '')
		]

		const descriptors = interpolationDescriptors(templateParts)

		const types = diagnoseTaggedTemplateSpans(typeChecker, diagnostics, descriptors, taggedTemplate.template.templateSpans, tsSource, getLine)

		const htmlString = buildHtmlStringWithWhitespace(taggedTemplate, descriptors, types, tsSource)
		if (shouldDiagnoseHtml) {
			diagnostics.push(...diagnoseHtml(htmlString.string, start, getLine, htmlString.interpolationRanges))
		}
	})

	return diagnostics
}

function diagnoseHtml(htmlString: string, start: ts.LineAndCharacter, getLine: GetLine, interpolationRanges: InterpolationRange[] = []): Diagnostic[] {
	const htmlDiag = htmlValidate.validateStringSync(htmlString)

	return htmlDiag.results.flatMap(result => {

		return result.messages

			.map(message => {
				const lineNumber = start.line + message.line - 1
				const startCharacter = (message.line == 1 ? start.character : 0) + message.column - 1
				const endCharancter = startCharacter + message.size

				const insideInterpolation = interpolationRanges.find(({ range }) =>
					// Start is inside interpolation
					(lineNumber > range.start.line || (lineNumber == range.start.line && startCharacter >= range.start.character)) &&
					(lineNumber < range.end.line || (lineNumber == range.end.line && startCharacter <= range.end.character)) ||

					// End is inside interpolation
					(lineNumber > range.start.line || (lineNumber == range.start.line && endCharancter >= range.start.character)) &&
					(lineNumber < range.end.line || (lineNumber == range.end.line && endCharancter <= range.end.character))
				)
				// Remove errors from placeholder attributes
				if (insideInterpolation?.replacement == 'placeholder') {
					return null
				}

				const line = getLine(lineNumber)
				const range: Range = insideInterpolation?.range ?? {
					start: {
						line: lineNumber,
						character: startCharacter
					},
					end: {
						line: lineNumber,
						character: startCharacter + message.size
					}
				}
				const diagnostic: Diagnostic = {
					message: message.message,
					line,
					severity: severity.warning,
					range,
					source: 'html-validate',
					code: message.ruleId
				}
				if (message.ruleUrl) {
					diagnostic.codeDescription = { href: message.ruleUrl }
				}
				return diagnostic
			})
			.filter(diagnostics => diagnostics != null)
	})
}

function diagnoseCss(taggedTemplate: ts.TaggedTemplateExpression, tsSource: ts.SourceFile, getLine: GetLine): Diagnostic[] {
	const { template } = taggedTemplate

	// Use the source text, rather than the cooked template text, so that offsets match the file
	const templateStart = template.getStart() + 1
	const sourceText = tsSource.text

	const interpolations = ts.isNoSubstitutionTemplateLiteral(template) ? [] :
		template.templateSpans.map(({ literal }, index) => ({
			// Start of ${
			start: (index == 0 ? template.head : template.templateSpans[index - 1].literal).getEnd() - 2 - templateStart,
			// End of }
			end: literal.getStart() + 1 - templateStart
		}))

	let cssString = sourceText.slice(templateStart, template.getEnd() - 1)
	for (const { start, end } of interpolations) {
		// Replace interpolations with whitespace, but keep line breaks to preserve positions
		cssString = cssString.slice(0, start) +
			cssString.slice(start, end).replace(/[^\r\n]/g, ' ') +
			cssString.slice(end)
	}

	return validateCss(cssString, interpolations).map(problem => {
		const start = tsSource.getLineAndCharacterOfPosition(templateStart + problem.start)
		const end = tsSource.getLineAndCharacterOfPosition(templateStart + problem.end)
		return {
			message: problem.message,
			line: getLine(start.line),
			severity: severity.warning,
			range: { start, end },
			source: 'css-tree',
			code: problem.code
		}
	})
}

function findNodeAt(root: ts.Node, pos: number): ts.Node | undefined {
	function find(n: ts.Node): ts.Node | undefined {
		if (pos >= n.getStart() && pos < n.getEnd()) {
			return ts.forEachChild(n, find) || n
		}
	}
	return find(root)
}

type InterpolationDescriptor = ReturnType<typeof interpolationDescriptors>[number]

function frontendFriendsDiagnostic(range: Range, code: string, message: string, getLine: GetLine): Diagnostic {
	return {
		message,
		line: getLine(range.start.line),
		severity: severity.warning,
		range,
		source: 'frontend-friends',
		code
	}
}

const forbiddenInAttrLiteral = /'|"|\n|\r\n/

type InterpolationRange = { range: Range, replacement: 'whitespace' | 'literal' | 'placeholder' }

function buildHtmlStringWithWhitespace(node: ts.TaggedTemplateExpression, descriptors: InterpolationDescriptor[], interpolationTypes: ts.Type[], file: ts.SourceFile) {

	const template = node.template

	if (ts.isNoSubstitutionTemplateLiteral(template)) {
		return { string: template.text, interpolationRanges: [] }
	}

	// -2 for ${
	let currentPosition = ts.getLineAndCharacterOfPosition(file, template.head.getEnd() - 2)

	const interpolationRanges: InterpolationRange[] = []

	const htmlString = template.templateSpans.reduce((result, span, index) => {

		const { literal } = span

		const descriptor = descriptors[index]
		const interpolationType = interpolationTypes[index]

		// +1 for }
		const nextStartPosition = ts.getLineAndCharacterOfPosition(file, literal.getStart() + 1)

		const interpolationRange: (typeof interpolationRanges)[number] = {
			range: { start: currentPosition, end: nextStartPosition },
			replacement: 'whitespace'
		}
		interpolationRanges.push(interpolationRange)

		const lineDiff = nextStartPosition.line - currentPosition.line

		const wsReplacement = ' '

		const interpolationLength = lineDiff ? 3 : nextStartPosition.character - currentPosition.character

		const newLineWhitespace = '\n'.repeat(lineDiff) + wsReplacement.repeat(nextStartPosition.character)

		let whiteSpace = lineDiff ? newLineWhitespace :
			wsReplacement.repeat(nextStartPosition.character - currentPosition.character)

		currentPosition = ts.getLineAndCharacterOfPosition(file, literal.getEnd() - 2)

		switch (descriptor.type) {
			case 'content':
				return result + whiteSpace + literal.text
			case 'attributeExtension':

				// Special treatment for id
				if (descriptor.attribute == 'id') {
					interpolationRange.replacement = 'placeholder'
					return result + whiteSpace.replaceAll(' ', 'x') + literal.text
				}
				return result + whiteSpace + literal.text
			case 'attribute':
				const endOfAttribute = descriptor.attribute.length - descriptor.attributeStart

				if (satisfiesType(interpolationType, ts.TypeFlags.BooleanLike)) {
					// remove =

					const withEqualsSignRemoved = result.slice(0, endOfAttribute) + result.slice(endOfAttribute).replace('=', wsReplacement)
					return withEqualsSignRemoved + whiteSpace + literal.text
				}

				const potentialReplacement = interpolationType.isStringLiteral() && interpolationType.value ||
					interpolationType.isUnion() && interpolationType.types.every(type => type.isStringLiteral()) && interpolationType.types[0].value

				// To prevent 'empty' attributes
				let attributeReplacement = ''
				if (potentialReplacement && (lineDiff || interpolationLength >= potentialReplacement.length + 1) && !forbiddenInAttrLiteral.test(potentialReplacement)) {
					interpolationRange.replacement = 'literal'
					attributeReplacement = potentialReplacement
				} else {
					interpolationRange.replacement = 'placeholder'
					attributeReplacement = lineDiff ? 'xxx' : 'x'.repeat(interpolationLength - 3)
				}

				let suffix = literal.text

				if (!descriptor.quotemark) {
					attributeReplacement = `"${attributeReplacement}"`

					return result +
						attributeReplacement +
						// compensate for replacement
						(lineDiff ? whiteSpace : whiteSpace.slice(0, -attributeReplacement.length)) +
						suffix

				} else if (descriptors[index + 1]?.type != "attributeExtension") {
					// 
					const indexOfEndQuote = suffix.indexOf(descriptor.quotemark)

					const equalSignIndex = result.lastIndexOf('=')
					const untilEqualSign = result.slice(0, equalSignIndex + 1)

					return untilEqualSign +
						// ${
						wsReplacement.repeat(2) +
						result.slice(equalSignIndex + 1) +
						attributeReplacement +
						suffix.slice(0, indexOfEndQuote) +
						descriptor.quotemark +
						// }
						(lineDiff ? whiteSpace : whiteSpace.slice(0, -2 - attributeReplacement.length)) +
						suffix.slice(indexOfEndQuote + 1)
				}

				const equalSignIndex = result.lastIndexOf('=')
				const untilEqualSign = result.slice(0, equalSignIndex + 1)
				if (lineDiff) {
					return result + attributeReplacement + whiteSpace + suffix
				}
				// Put all whitespace at the start
				return untilEqualSign + whiteSpace.slice(0, -attributeReplacement.length) +
					result.slice(equalSignIndex + 1) + attributeReplacement + suffix

			case 'specialAttribute':
			case 'eventhandler':
				// remove attribute
				const removedAttribute = result.slice(0, -descriptor.attributeStart) +
					wsReplacement.repeat(descriptor.attributeStart) +
					whiteSpace
				if (descriptor.quotemark) {
					const indexOfEndQuote = literal.text.indexOf(descriptor.quotemark)
					return removedAttribute + wsReplacement.repeat(indexOfEndQuote + 1) + literal.text.slice(indexOfEndQuote + 1)
				}
				return removedAttribute + literal.text
		}

	}, template.head.text)

	return {
		string: htmlString,
		interpolationRanges
	}

}
