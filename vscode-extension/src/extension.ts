// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import {
	ExtensionContext,
	Uri, workspace, window, StatusBarAlignment,
	MarkdownString, StatusBarItem, TextEditor,
	RelativePattern, FileSystemWatcher,
	Disposable, WorkspaceFolder
} from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
let statusBarItem: StatusBarItem | undefined
let frontendFriendsDetected = false
let serverPath: string

export async function activate(context: ExtensionContext) {


	const item = window.createStatusBarItem(StatusBarAlignment.Right)
	item.text = '$(code) FF'
	item.tooltip = new MarkdownString('### Frontend Friends\n' +
		'Dev tools are active.'
	)

	statusBarItem = item

	serverPath = context.asAbsolutePath('out/server/index.js')

	const activeWatchers = new Map<string, FileSystemWatcher>();

	const watchPackageJSON = (folder: WorkspaceFolder) => {
		const pattern = new RelativePattern(folder, 'package.json')
		const workspaceWatcher = workspace.createFileSystemWatcher(pattern)
		workspaceWatcher.onDidCreate(refreshLanguageServer)
		workspaceWatcher.onDidChange(refreshLanguageServer)
		workspaceWatcher.onDidDelete(refreshLanguageServer)
		activeWatchers.set(folder.uri.fsPath, workspaceWatcher)
	}

	workspace.workspaceFolders?.forEach(watchPackageJSON)

	context.subscriptions.push(
		item,
		window.onDidChangeActiveTextEditor(updateStatusBarVisibility),
		workspace.onDidChangeWorkspaceFolders((event) => {
			event.removed.forEach(removedWorkspace => {
				activeWatchers.get(removedWorkspace.uri.fsPath)?.dispose()
				activeWatchers.delete(removedWorkspace.uri.fsPath)
			})
			event.added.forEach(watchPackageJSON)
			refreshLanguageServer()
		}),
		new Disposable(() => {
			activeWatchers.forEach(watcher => watcher.dispose())
			activeWatchers.clear()
		})
	);

	await startLanguageServerIfSuitable()
}

let checkNeeded = false
let checkingServer = false
async function refreshLanguageServer() {
	checkNeeded = true
	if (checkingServer) return

	checkingServer = true
	while (checkNeeded) {
		checkNeeded = false
		await startLanguageServerIfSuitable()
	}
	checkingServer = false
}

async function startLanguageServerIfSuitable() {
	const frontendFriendsDirectories = await workspaceFoldersWithFrontendFriends()
	if (frontendFriendsDirectories.length > 0) {
		if (!client) {
			client = createLanguageServerClient(serverPath, frontendFriendsDirectories)
			await client.start()
			console.log('Started language server')
		} else {
			await client.sendNotification('ff-directories', { folders: frontendFriendsDirectories })
		}
	} else if (client) {
		console.log('Stopped language server')
		await client.stop()
		frontendFriendsDetected = false
		statusBarItem?.hide()
		client = undefined
	}
}

function createLanguageServerClient(serverPath: string, frontendFriendsFolders: string[]) {

	const serverOptions: ServerOptions = {
		run: { module: serverPath, transport: TransportKind.ipc },
		debug: { module: serverPath, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6009'] } }
	}

	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: 'file', language: 'javascript' },
			{ scheme: 'file', language: 'typescript' }
		],
		initializationOptions: {
			folders: frontendFriendsFolders
		}
	}

	const client = new LanguageClient(
		'FrontendFriendsLangServer',
		'Frontend Friends Language server',
		serverOptions,
		clientOptions
	)

	client.onNotification('ff-used', showStatusBarItem)

	return client
}

async function workspaceFoldersWithFrontendFriends() {
	if (!workspace.workspaceFolders) return []

	const results = await Promise.allSettled(workspace.workspaceFolders.map(async folder => {

		const packageJsonPath = Uri.joinPath(folder.uri, 'package.json')

		const packageFile = await workspace.fs.readFile(packageJsonPath)

		const packageJsonStr = new TextDecoder().decode(packageFile)
		const packageJson = JSON.parse(packageJsonStr)

		const { name, dependencies = {}, devDependencies = {} } = packageJson

		const ffName = '@applicvision/frontend-friends'

		return name == ffName || dependencies[ffName] || devDependencies[ffName] ? folder.uri.fsPath : null
	}))
	return results.map(result => result.status == 'fulfilled' ? result.value : null)
		.filter(result => result != null)
}

function updateStatusBarVisibility(editor: TextEditor | undefined) {
	if (!statusBarItem) return

	const langId = editor?.document.languageId
	if (frontendFriendsDetected && (langId == 'javascript' || langId == 'typescript')) {
		statusBarItem.show()
	} else {
		statusBarItem.hide()
	}
}

function showStatusBarItem() {
	frontendFriendsDetected = true
	statusBarItem?.show()
}

// This method is called when your extension is deactivated
export function deactivate() {
	return client?.stop()
}
