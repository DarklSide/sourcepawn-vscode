import {
  ExtensionContext,
  workspace as Workspace,
  languages,
  window,
  WorkspaceFolder,
  commands,
} from "vscode";
import {
  registerSMLinter,
  compilerDiagnostics,
  refreshDiagnostics,
} from "./spLinter";
const glob = require("glob");
import { existsSync } from "fs";
import { join } from "path";
import { SP_MODE } from "./spMode";
import { Providers } from "./Providers/spProviders";
import { registerSMCommands } from "./Commands/registerCommands";
import { SMDocumentFormattingEditProvider } from "./spFormat";
import { basename } from "path";
import { URI } from "vscode-uri";
import { SP_LEGENDS } from "./spLegends";

export function activate(context: ExtensionContext) {
  const providers = new Providers(context.globalState);
  let formatter = new SMDocumentFormattingEditProvider();
  let workspace: WorkspaceFolder;
  providers.parseSMApi();
  let workspaceFolders = Workspace.workspaceFolders;
  if (typeof workspaceFolders == "undefined") {
    window.showWarningMessage(
      "No workspace or folder found. \n Please open the folder containing your .sp file, not just the .sp file."
    );
  } else {
    workspace = workspaceFolders[0];
    let watcher = Workspace.createFileSystemWatcher(
      "**​/*.{inc,sp}",
      false,
      true,
      false
    );

    watcher.onDidCreate((uri) => {
      providers.itemsRepository.documents.set(
        basename(uri.fsPath),
        URI.file(uri.fsPath).toString()
      );
      let MainPath: string =
        Workspace.getConfiguration("sourcepawn").get("MainPath") || "";
      if (MainPath !== "") {
        if (!existsSync(MainPath)) {
          let workspace: WorkspaceFolder = Workspace.workspaceFolders[0];
          MainPath = join(workspace.uri.fsPath, MainPath);
          if (!existsSync(MainPath)) {
            return;
          }
        }
        MainPath = URI.file(MainPath).toString();
        for (let document of Workspace.textDocuments) {
          if (document.uri.toString() === MainPath) {
            refreshDiagnostics(document, compilerDiagnostics);
            break;
          }
        }
      }
    });
    watcher.onDidDelete((uri) => {
      providers.itemsRepository.documents.delete(basename(uri.fsPath));
    });
  }
  if (typeof workspace != "undefined") {
    getDirectories([workspace.uri.fsPath], providers);
  }
  // Get the names and directories of optional include directories.
  let optionalIncludeDirs: string[] = Workspace.getConfiguration(
    "sourcepawn"
  ).get("optionalIncludeDirsPaths");
  getDirectories(optionalIncludeDirs, providers);

  let MainPath: string =
    Workspace.getConfiguration("sourcepawn").get("MainPath") || "";
  if (MainPath != "") {
    try {
      if (!existsSync(MainPath)) {
        let workspace: WorkspaceFolder = Workspace.workspaceFolders[0];
        MainPath = join(workspace.uri.fsPath, MainPath);
        if (!existsSync(MainPath)) {
          throw "MainPath is incorrect.";
        }
      }
      providers.handle_document_opening(MainPath);
    } catch (error) {
      window
        .showErrorMessage(
          "A setting for the main.sp file was specified, but seems invalid. Please make sure it is valid.",
          "Open Settings"
        )
        .then((choice) => {
          if (choice === "Open Settings") {
            commands.executeCommand(
              "workbench.action.openSettings",
              "@ext:sarrus.sourcepawn-vscode"
            );
          }
        });
    }
  }

  // Load the currently opened file
  if (window.activeTextEditor !== undefined) {
    providers.handle_document_opening(
      window.activeTextEditor.document.uri.fsPath
    );
  }
  window.onDidChangeActiveTextEditor((e) =>
    providers.handle_document_opening(e.document.uri.fsPath)
  );

  context.subscriptions.push(
    languages.registerDocumentSymbolProvider(SP_MODE, providers)
  );
  context.subscriptions.push(
    languages.registerCompletionItemProvider(
      SP_MODE,
      providers,
      "<",
      '"',
      "'",
      "/",
      "\\",
      ".",
      ":",
      " "
    )
  );
  context.subscriptions.push(
    languages.registerCompletionItemProvider(
      SP_MODE,
      providers.documentationProvider,
      "*"
    )
  );
  context.subscriptions.push(
    languages.registerSignatureHelpProvider(SP_MODE, providers, "(", ",", "\n")
  );

  context.subscriptions.push(
    languages.registerDocumentSemanticTokensProvider(
      SP_MODE,
      providers,
      SP_LEGENDS
    )
  );

  context.subscriptions.push(
    languages.registerDefinitionProvider(SP_MODE, providers)
  );

  context.subscriptions.push(
    languages.registerDocumentFormattingEditProvider(SP_MODE, formatter)
  );
  context.subscriptions.push(
    languages.registerHoverProvider(SP_MODE, providers)
  );

  Workspace.onDidChangeTextDocument(
    providers.handleDocumentChange,
    providers,
    context.subscriptions
  );
  Workspace.onDidOpenTextDocument(
    providers.handleNewDocument,
    providers,
    context.subscriptions
  );
  Workspace.onDidCreateFiles(
    providers.handleAddedDocument,
    providers,
    context.subscriptions
  );

  // Register SM Commands
  registerSMCommands(context);

  // Register SM linter
  registerSMLinter(context);
}

function getDirectories(paths: string[], providers: Providers) {
  for (let path of paths) {
    let files = glob.sync(path.replace(/\/\s*$/, "") + "/**/*.{inc,sp}");
    for (let file of files) {
      providers.itemsRepository.documents.set(
        basename(file),
        URI.file(file).toString()
      );
    }
  }
}
