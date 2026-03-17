import { getLanguageService, newHTMLDataProvider } from 'vscode-html-languageservice'
import { getCSSLanguageService } from 'vscode-css-languageservice'
import { CompletionParams, createConnection, HoverParams, ProposedFeatures, TextDocuments, TextDocumentSyncKind } from 'vscode-languageserver/node'
import { TextDocument, Position } from 'vscode-languageserver-textdocument'
import ts from 'typescript'
import { dirname } from 'node:path'
import { URI } from 'vscode-uri'

async function runDiagnostics(program: ts.Program, file: string) {
	const { diagnoseFile } = await import('@applicvision/frontend-friends-diagnostics')
	return diagnoseFile(program, file)
}

const connection = createConnection(ProposedFeatures.all)

const documents = new TextDocuments(TextDocument)

const htmlLanguageService = getLanguageService()

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

const tsServices = new Map<string, ts.LanguageService>()

connection.onInitialize((params) => {
	const frontendFriendsFolders: string[] = params.initializationOptions.folders
	// const workspaceUri = params.workspaceFolders?.[0].uri
	frontendFriendsFolders.forEach(folder => {
		const tsService = createTSService(folder)
		if (tsService) {
			tsServices.set(folder, tsService)
		}
	})

	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,

			completionProvider: {
				resolveProvider: false,
				triggerCharacters: ['<', '>']
			},
			hoverProvider: true
		}
	}
})

connection.onNotification('ff-directories', (params: { folders: string[] }) => {
	Array.from(tsServices.keys())
		.filter(workspace => !params.folders.includes(workspace))
		.forEach(removedWorkspace => {
			tsServices.delete(removedWorkspace)
		})

	params.folders
		.filter(folder => !tsServices.has(folder))
		.forEach(newWorkspace => {
			const tsService = createTSService(newWorkspace)
			if (tsService) {
				tsServices.set(newWorkspace, tsService)
			}
		})
})

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

	const host: ts.LanguageServiceHost = {
		getCompilationSettings: () => parsedConfig.options,
		getScriptFileNames: () => parsedConfig.fileNames,
		getScriptSnapshot: fileName => {

			const cachedActiveFile = activeFilesCache.get(fileName)
			if (cachedActiveFile) return ts.ScriptSnapshot.fromString(cachedActiveFile.text)

			const cachedFile = fileSystemCache.get(fileName)
			if (cachedFile) return cachedFile

			const text = ts.sys.readFile(fileName)
			if (typeof text == 'string') {
				const snapshot = ts.ScriptSnapshot.fromString(text)
				fileSystemCache.set(fileName, snapshot)
				return snapshot
			}
		},
		getScriptVersion: fileName => String(activeFilesCache.get(fileName)?.version ?? 0),
		getCurrentDirectory: () => process.cwd(),
		getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),

		fileExists: ts.sys.fileExists,
		readFile: ts.sys.readFile,
		readDirectory: ts.sys.readDirectory,

	}

	return ts.createLanguageService(host)
}

const activeFilesCache = new Map<string, { version: number, text: string }>()

const fileSystemCache = new Map<string, ts.IScriptSnapshot>()

function getTsSourceFile(document: TextDocument) {
	const path = URI.parse(document.uri).fsPath

	const sourceFile = getProgramForPath(path)?.getSourceFile(path)
	if (!sourceFile) throw new Error('Missing sourcefile')

	return sourceFile

}

function activeTaggedTemplateDocument(params: HoverParams | CompletionParams): { type: 'html' | 'css' | 'xml', document: TextDocument } | undefined {

	const document = documents.get(params.textDocument.uri)

	if (!document) return

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

function getProgramForPath(path: string) {
	const workspaceFolders = Array.from(tsServices.keys())

	workspaceFolders.sort((a, b) => b.length - a.length)

	for (const workspacePath of workspaceFolders) {

		if (path.startsWith(workspacePath)) {
			return tsServices.get(workspacePath)?.getProgram()
		}
	}
}

let notificationSent = false
documents.onDidChangeContent(async (change) => {

	const text = change.document.getText()

	const usesFF = text.includes('@applicvision/frontend-friends')

	const path = URI.parse(change.document.uri).fsPath

	activeFilesCache.set(path, {
		text,
		version: change.document.version,
	})

	const program = getProgramForPath(path)

	if (!program) return

	const diagnostics = usesFF ? await runDiagnostics(program, path) : []

	connection.sendDiagnostics({
		uri: change.document.uri,
		diagnostics: diagnostics
	})

	if (!notificationSent && usesFF) {
		connection.sendNotification('ff-used')
	}
})

documents.onDidClose((event) => {
	const path = URI.parse(event.document.uri).fsPath
	// Clear file system cache if user touched the file
	if (activeFilesCache.delete(path)) {
		fileSystemCache.delete(path)
	}
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
