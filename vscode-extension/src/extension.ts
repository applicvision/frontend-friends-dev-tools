// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { ExtensionContext, Uri, workspace } from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	if (!workspace.workspaceFolders) return
	const rootPath = workspace.workspaceFolders[0].uri
	const packageJsonPath = Uri.joinPath(rootPath, 'package.json')

	try {

		const packageFile = await workspace.fs.readFile(packageJsonPath)

		const packageJsonStr = new TextDecoder().decode(packageFile)
		const packageJson = JSON.parse(packageJsonStr)

		const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }

		if (!deps['@applicvision/frontend-friends']) {
			console.log('Project does not use Frontend Friends')
			return
		}
	} catch (error) {
		console.log('Could not detect Frotend Friends', (error as Error).message)
		return
	}

	const server = context.asAbsolutePath('out/server/index.js')

	const serverOptions: ServerOptions = {
		run: { module: server, transport: TransportKind.ipc },
		debug: { module: server, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6009'] } }
	}

	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: 'file', language: 'javascript' },
			{ scheme: 'file', language: 'typescript' }
		]
	}

	client = new LanguageClient(
		'FrontendFriedsLangServer',
		'Frontend Friends Language server',
		serverOptions,
		clientOptions
	)

	client.start()
}

// This method is called when your extension is deactivated
export function deactivate() {
	return client?.stop()
}
