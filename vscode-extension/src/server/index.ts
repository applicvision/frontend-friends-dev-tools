import { getLanguageService, newHTMLDataProvider } from 'vscode-html-languageservice';
import { getCSSLanguageService } from 'vscode-css-languageservice';
import { CompletionParams, createConnection, FileChangeType, HoverParams, ProposedFeatures, TextDocuments, TextDocumentSyncKind } from 'vscode-languageserver/node';
import { TextDocument, Position } from 'vscode-languageserver-textdocument';
import ts from 'typescript'
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path'
import { readFileSync } from 'node:fs';

async function runDiagnostics(program: ts.Program, file: string) {
	const { diagnoseFile } = await import('@applicvision/frontend-friends-diagnostics')
	return diagnoseFile(program, file)
}

const connection = createConnection(ProposedFeatures.all);

const documents = new TextDocuments(TextDocument);

const htmlLanguageService = getLanguageService();

htmlLanguageService.setDataProviders(true, [newHTMLDataProvider('frontend-friends', {
	version: 1.1,
	globalAttributes: [{
		name: 'ff-share',
		description: 'Pass a two way binding to supported elements',
		references: [{
			name: 'ff-share documentation',
			url: 'https://github.com/applicvision/frontend-friends/tree/main/docs/api#twowayt-extends-objectstate-t-property-keyof-t-twowaybinding'
		}]
	}, {
		name: 'ff-ref',
		description: 'Get a reference to a DOM element. Pass an ElementReference, created with the ref() function.'
	}]
})])
const cssLanguageService = getCSSLanguageService()

let tsService: ts.LanguageService | undefined

connection.onInitialize((params) => {

	const workspaceUri = params.workspaceFolders?.[0].uri
	if (workspaceUri) {
		const path = fileURLToPath(workspaceUri)
		tsService = createTSService(path)
	}

	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,

			completionProvider: {
				resolveProvider: false,
				triggerCharacters: ['<', '>']
			},
			hoverProvider: true
		}
	};
});

function createTSService(path: string) {
	const configFilePath = ts.findConfigFile(path, ts.sys.fileExists) ??
		ts.findConfigFile(path, ts.sys.fileExists, 'jsconfig.json')

	let parsedConfig: ts.ParsedCommandLine
	if (configFilePath) {
		const configFile = ts.readConfigFile(configFilePath, ts.sys.readFile)
		if (configFile.error) {
			console.warn(configFile.error)
			return
		}
		parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(configFilePath))
	} else {
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
		parsedConfig = ts.parseJsonConfigFileContent(fallbackConfig, ts.sys, path)
	}



	if (parsedConfig.errors.length) {
		console.warn('Detected errors in config', parsedConfig.errors)
		return
	}

	parsedConfig.fileNames.forEach(fileName => {
		const content = readFileSync(fileName).toString()
		sourceFileCache.set(fileName, { version: 0, text: content, sourceFile: ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true) })
	})

	const host: ts.LanguageServiceHost = {
		getCompilationSettings: () => parsedConfig.options,
		getScriptFileNames: () => parsedConfig.fileNames,
		getScriptSnapshot: fileName => {
			const cached = sourceFileCache.get(fileName)
			if (cached) {
				return ts.ScriptSnapshot.fromString(cached.text)
			}
			const cachedLibFile = libFileCache.get(fileName)
			if (cachedLibFile) return cachedLibFile

			const text = ts.sys.readFile(fileName)
			if (typeof text == 'string') {
				const snapshot = ts.ScriptSnapshot.fromString(text)
				libFileCache.set(fileName, snapshot)
				return snapshot
			}
		},
		getScriptVersion: fileName => String(sourceFileCache.get(fileName)?.version),
		getCurrentDirectory: () => process.cwd(),
		getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),

		fileExists: ts.sys.fileExists,
		readFile: ts.sys.readFile,
		readDirectory: ts.sys.readDirectory,

	}

	return ts.createLanguageService(host)
}

const sourceFileCache = new Map<string, { version: number, sourceFile: ts.SourceFile, text: string }>();

const libFileCache = new Map<string, ts.IScriptSnapshot>()

function getTsSourceFile(document: TextDocument) {
	const path = fileURLToPath(document.uri)

	const cached = sourceFileCache.get(path)
	if (cached?.version == document.version) {
		return cached.sourceFile
	}
	console.log('reading file', 'this should probab not happen')
	const text = document.getText()
	const sourceFile = ts.createSourceFile(document.uri, text, ts.ScriptTarget.Latest, true)
	sourceFileCache.set(document.uri, { version: document.version, sourceFile, text })
	return sourceFile
}

function activeTaggedTemplateDocument(params: HoverParams | CompletionParams): { type: 'html' | 'css' | 'xml', document: TextDocument } | undefined {

	const document = documents.get(params.textDocument.uri)

	if (!document) {
		return
	}

	if (!document.getText().includes('@applicvision/frontend-friends')) {
		return
	}

	let tsSource = getTsSourceFile(document)

	const offset = document.offsetAt(params.position)

	const node = findNodeAt(tsSource, offset)

	if (!node) return

	let taggedTemplate: ts.TaggedTemplateExpression | null = null
	if (ts.isNoSubstitutionTemplateLiteral(node) && ts.isTaggedTemplateExpression(node.parent)) {
		taggedTemplate = node.parent
	}
	else if (ts.isTemplateHead(node) && ts.isTaggedTemplateExpression(node.parent.parent)) {
		taggedTemplate = node.parent.parent

	} else if ((ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && ts.isTaggedTemplateExpression(node.parent.parent.parent)) {
		taggedTemplate = node.parent.parent.parent
	}

	if (!taggedTemplate) return

	taggedTemplate.tag

	const tagName = taggedTemplate.tag.getText()

	const type = (tagName == 'html' || tagName.startsWith('html.key(')) ? 'html' :
		(tagName == 'svg' || tagName.startsWith('svg.key(')) ? 'xml' :
			tagName == 'css' ? 'css' : null

	if (type) {
		const virtualDoc = buildTaggedStringWithWhitespace(taggedTemplate, document)

		const htmlDoc = TextDocument.create(params.textDocument.uri, type, 1,
			virtualDoc
		)
		return {
			type,
			document: htmlDoc
		}
	}
}

connection.onHover((params, token) => {

	const taggedTemplateDocument = activeTaggedTemplateDocument(params)

	if (!taggedTemplateDocument) return

	const { type, document } = taggedTemplateDocument

	switch (type) {
		case 'html': return htmlLanguageService.doHover(document, params.position, htmlLanguageService.parseHTMLDocument(document))
		case 'css': return cssLanguageService.doHover(document, params.position, cssLanguageService.parseStylesheet(document))
	}
})

connection.onCompletion((params, _token) => {

	const taggedTemplateDocument = activeTaggedTemplateDocument(params)

	if (!taggedTemplateDocument) return

	const { type, document } = taggedTemplateDocument

	switch (type) {
		case 'html': return htmlLanguageService.doComplete(document, params.position, htmlLanguageService.parseHTMLDocument(document))
		case 'css': return cssLanguageService.doComplete(document, params.position, cssLanguageService.parseStylesheet(document))
		case 'xml': return htmlLanguageService.doComplete(document, params.position, htmlLanguageService.parseHTMLDocument(document))
	}
})

// TODO: Handle new files

documents.onDidChangeContent(async (change) => {

	const text = change.document.getText()

	const path = fileURLToPath(change.document.uri)

	sourceFileCache.set(path, {
		text,
		version: change.document.version,
		sourceFile: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
	})

	const program = tsService?.getProgram()

	if (!program) return

	const diagnostics = await runDiagnostics(program, path)

	connection.sendDiagnostics({
		uri: change.document.uri,
		diagnostics: diagnostics
	})
})

function logVirtualDoc(doc: string, position: Position) {
	doc.split('\n').forEach((row, index) => {
		let rowWithSelection = row
		if (index == position.line) {
			rowWithSelection = row.slice(0, position.character) + '|' +
				row.slice(position.character)
		}
		console.log(`${String(index).padStart(2)}. ${rowWithSelection}`)
	})
}

function buildTaggedStringWithWhitespace(node: ts.TaggedTemplateExpression, document: TextDocument): string {

	const template = node.template

	const position = document.positionAt(node.getStart())

	const initialWhitespace = '\n'.repeat(position.line) + ' '.repeat(position.character + node.tag.getWidth() + 1)

	if (ts.isNoSubstitutionTemplateLiteral(template)) {
		return initialWhitespace + template.text
	}

	let result = initialWhitespace + template.head.text

	let currentPosition = document.positionAt(template.head.getEnd())

	for (const { literal } of template.templateSpans) {

		const nextStartPosition = document.positionAt(literal.getStart())
		const lineDiff = nextStartPosition.line - currentPosition.line
		result += '\n'.repeat(lineDiff)

		// To prevent empty attributes
		// TODO: Maybe use interpolationDescriptors
		result += 'x'
		result += ' '.repeat((lineDiff ?
			// +1 because of }
			nextStartPosition.character + 1 :
			// +3 because of ${}
			nextStartPosition.character - currentPosition.character + 3)
			// -1 because of 'a'
			- 1
		)

		result += literal.text
		currentPosition = document.positionAt(literal.getEnd())
	}
	return result

}

function findNodeAt(root: ts.Node, pos: number): ts.Node | undefined {
	function find(n: ts.Node): ts.Node | undefined {
		if (pos >= n.getStart() && pos < n.getEnd()) {
			return ts.forEachChild(n, find) || n
		}
	}
	return find(root)
}

documents.listen(connection)

connection.listen()
