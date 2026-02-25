import ts from 'typescript'
import { HtmlValidate } from 'html-validate'
import { interpolationDescriptors } from '@applicvision/frontend-friends/dynamic-fragment'
import { dirname, resolve } from 'path'


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

const taggedTemplateRegex = /(html|svg)`/dg
const keyedTaggedTemplateRegex = /(html|svg)\.key\(/dg

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
			if (ts.isIdentifier(tag) && (tag.text == 'html' || tag.text == 'svg')) {
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
	diagnostics: { range: Range, message: string, line: string, severity: Severity }[],
	descriptors: InterpolationDescriptor[],
	templateSpans: ts.NodeArray<ts.TemplateSpan>,
	tsSource: ts.SourceFile) {

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
					const diagnostic = attributeDiagnostic(expression, tsSource, interpolationDescriptor,
						'A function is expected as event handler'
					)
					diagnostics.push(diagnostic)
				}
				break
			case 'attribute':
				if (isBoolean) {
					if (interpolationDescriptor.quotemark) {
						const diagnostic = attributeDiagnostic(expression, tsSource, interpolationDescriptor,
							'Boolean attributes can not use quotemark'
						)
						diagnostics.push(diagnostic)
					}

				} else if (!isStringOrNumber) {
					const diagnostic = attributeDiagnostic(expression, tsSource, interpolationDescriptor,
						'Attributes should use a string, number or boolean'
					)
					diagnostics.push(diagnostic)
				}
				break
			case 'attributeExtension':
				if (!isStringOrNumber) {
					const start = tsSource.getLineAndCharacterOfPosition(expression.getStart() - 2)
					const end = tsSource.getLineAndCharacterOfPosition(expression.getStart())
					const allLines = tsSource.getFullText().split(/\r?\n/)
					const line = allLines[start.line]
					diagnostics.push({
						message: 'Attribute extension can only be strings or numbers',
						line,
						severity: severity.warning,
						range: { start, end }
					})
				}
				break
			case 'specialAttribute':
				switch (interpolationDescriptor.attribute) {
					case 'ff-share':
						if (!isObject) {
							const diagnostic = attributeDiagnostic(expression, tsSource, interpolationDescriptor, 'ff-share must use an object for two way binding')
							diagnostics.push(diagnostic)
						}
						const { elementName } = interpolationDescriptor
						if (!(elementName.includes('-') || elementName == 'input' || elementName == 'textarea' || elementName == 'select')) {
							const diagnostic = attributeDiagnostic(expression, tsSource, interpolationDescriptor,
								'ff-share can only be used in native input elements, or custom elements which implement two way binding'
							)
							diagnostics.push(diagnostic)
						}
						break
					case 'ff-ref':
						if (type.getSymbol()?.escapedName != 'ElementReference') {
							const diagnostic = attributeDiagnostic(expression, tsSource, interpolationDescriptor,
								'ff-ref must use an ElementReference instance, created with ref().'
							)
							diagnostics.push(diagnostic)
						}
						break
				}
				break
			case 'content':
				const typeAsString = typeChecker.typeToString(type)

				if (typeChecker.isArrayType(type)) {
					if (typeAsString != 'DynamicFragment[]') {
						const start = tsSource.getLineAndCharacterOfPosition(expression.getStart() - 2)
						const end = tsSource.getLineAndCharacterOfPosition(expression.getStart())
						const allLines = tsSource.getFullText().split(/\r?\n/)
						const line = allLines[start.line]
						diagnostics.push({
							message: 'Array content should be declared with html tag, ' + typeAsString,
							line,
							severity: severity.warning,
							range: { start, end },
						})
					}
				} else if (isObject && typeAsString != 'DynamicFragment' && typeAsString != 'PropertySetter' && typeAsString != 'InnerHTML') {
					const start = tsSource.getLineAndCharacterOfPosition(expression.getStart() - 2)
					const end = tsSource.getLineAndCharacterOfPosition(expression.getStart())
					const allLines = tsSource.getFullText().split(/\r?\n/)
					const line = allLines[start.line]
					diagnostics.push({
						message: 'Invalid content: ' + typeAsString,
						line,
						severity: severity.warning,
						range: { start, end }
					})
				}
		}
		return type
	})
}

export function diagnoseFile(program: ts.Program, fileName: string) {

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

	const diagnostics: { range: Range, message: string, line: string, severity: 1 | 2 | 3 | 4 }[] = []
	const taggedTemplates = findTaggedTemplates(tsSource)

	taggedTemplates.forEach(taggedTemplate => {

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

		const types = diagnoseTaggedTemplateSpans(typeChecker, diagnostics, descriptors, taggedTemplate.template.templateSpans, tsSource)

		const htmlString = buildHtmlStringWithWhitespace(taggedTemplate, descriptors, types, tsSource)
		if (shouldDiagnoseHtml) {
			diagnostics.push(...diagnoseHtml(htmlString.string, start, getLine, htmlString.interpolationRanges))
		}
	})

	return diagnostics
}

function diagnoseHtml(htmlString: string, start: ts.LineAndCharacter, getLine: (line: number) => string, interpolationRanges: InterpolationRange[] = []) {
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
				return {
					message: message.message,
					line,
					severity: severity.warning,
					range,
				}
			})
			.filter(diagnostics => diagnostics != null)
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

function attributeDiagnostic(expression: ts.Expression, tsSource: ts.SourceFile, descriptor: Exclude<InterpolationDescriptor, { type: 'content' }>, message: string) {
	const startPos = expression.getStart() - 2 - descriptor.attributeStart
	const start = tsSource.getLineAndCharacterOfPosition(startPos)
	const end = tsSource.getLineAndCharacterOfPosition(startPos + descriptor.attribute.length)
	const allLines = tsSource.getFullText().split(/\r?\n/)
	const line = allLines[start.line]
	return {
		message,
		line,
		severity: severity.warning,
		range: { start, end }
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
