import {
  CompletionItem,
  workspace as Workspace,
  Memento,
  Disposable,
  TextDocument,
  Position,
  CompletionList,
  CompletionItemKind,
  WorkspaceFolder,
  Range,
} from "vscode";
import { basename, join } from "path";
import { existsSync } from "fs";
import { URI } from "vscode-uri";
import { SPItem, Include, ConstantItem, KeywordItem } from "./spItems";
import { defaultConstantItems, defaultKeywordsItems } from "./spDefaultItems";
import { events } from "../Misc/sourceEvents";
import {
  GetLastFuncName,
  isFunction,
  getLastEnumStructName,
} from "./spDefinitions";
import { globalIdentifier } from "./spGlobalIdentifier";

export class FileItems {
  completions: Map<string, SPItem>;
  includes: Include[];
  uri: string;

  constructor(uri: string) {
    this.completions = new Map();
    // Add constants only in one map.
    if (uri.includes("sourcemod.inc")) {
      makeNewItemsMap(this.completions);
    }
    this.includes = [];
    this.uri = uri;
  }

  add(id: string, completion: SPItem) {
    this.completions.set(id, completion);
  }

  get(id: string): SPItem {
    return this.completions.get(id);
  }

  getCompletions(repo: ItemsRepository): SPItem[] {
    let completions = [];
    for (let completion of this.completions.values()) {
      completions.push(completion);
    }
    return completions;
  }

  toCompletionResolve(item: CompletionItem): CompletionItem {
    item.label = item.label;
    item.documentation = item.documentation;
    return item;
  }

  addInclude(include: string, IsBuiltIn: boolean) {
    this.includes.push(new Include(include, IsBuiltIn));
  }

  resolve_import(
    file: string,
    documents: Map<string, string>,
    IsBuiltIn: boolean = false
  ) {
    let inc_file: string;
    // If no extension is provided, it's a .inc file
    if (!/.sp\s*$/g.test(file) && !/.inc\s*$/g.test(file)) {
      file += ".inc";
    }

    let match = file.match(/include\/(.*)/);
    if (match) file = match[1];
    let uri: string;
    if (!(uri = documents.get(basename(file)))) {
      let includes_dirs: string[] = Workspace.getConfiguration(
        "sourcepawn"
      ).get("optionalIncludeDirsPaths");
      for (let includes_dir of includes_dirs) {
        inc_file = join(includes_dir, file);
        if (existsSync(inc_file)) {
          this.addInclude(URI.file(inc_file).toString(), IsBuiltIn);
          return;
        }
      }
      this.addInclude("file://__sourcemod_builtin/" + file, IsBuiltIn);
    } else {
      this.addInclude(uri, IsBuiltIn);
    }
  }
}

export class ItemsRepository implements Disposable {
  public completions: Map<string, FileItems>;
  public documents: Map<string, string>;
  private globalState: Memento;

  constructor(globalState?: Memento) {
    this.completions = new Map();
    this.documents = new Map();
    this.globalState = globalState;
  }

  public dispose() {}

  getEventCompletions(): CompletionList {
    return new CompletionList(events);
  }

  getIncludeCompletions(
    document: TextDocument,
    tempName: string
  ): CompletionList {
    let isQuoteInclude: boolean = tempName.includes('"');
    tempName = tempName.replace("<", "").replace('"', "");
    let match = tempName.match(/([^\/]+\/)+/);
    tempName = match ? match[0] : "";
    let scriptingDirname: string = document.uri.toString();
    let itemsNames: string[] = [];
    scriptingDirname =
      scriptingDirname.replace(basename(document.uri.fsPath), "") + "include/";
    let scriptingDirnames: string[] = [scriptingDirname];
    let includes_dirs: string[] = Workspace.getConfiguration("sourcepawn").get(
      "optionalIncludeDirsPaths"
    );
    // Convert to URIs
    includes_dirs = includes_dirs.map((e) => URI.parse(e).toString());

    scriptingDirnames = scriptingDirnames.concat(includes_dirs);
    let items: CompletionItem[] = [];
    let cleanedUri: string;
    for (let uri of this.documents.values()) {
      if (uri.includes("file://__sourcemod_builtin/" + tempName)) {
        cleanedUri = uri.replace("file://__sourcemod_builtin/" + tempName, "");
        let match = cleanedUri.match(/([^\/]+\/)?/);
        if (match[0] != "") {
          let item = {
            label: match[0].replace("/", ""),
            kind: CompletionItemKind.Folder,
            detail: "Sourcemod BuiltIn",
          };
          if (itemsNames.indexOf(match[0]) == -1) {
            items.push(item);
            itemsNames.push(match[0]);
          }
        } else {
          let insertText = cleanedUri.replace(".inc", "");
          insertText += isQuoteInclude ? "" : ">";
          let item = {
            label: cleanedUri,
            kind: CompletionItemKind.File,
            detail: "Sourcemod BuiltIn",
            insertText: insertText,
          };
          if (itemsNames.indexOf(cleanedUri) == -1) {
            items.push(item);
            itemsNames.push(cleanedUri);
          }
        }
      } else {
        for (scriptingDirname of scriptingDirnames) {
          if (uri.includes(scriptingDirname + tempName)) {
            cleanedUri = uri.replace(scriptingDirname + tempName, "");
            let match = cleanedUri.match(/([^\/]+\/)?/);
            if (match[0] != "") {
              let item = {
                label: match[0].replace("/", ""),
                kind: CompletionItemKind.Folder,
                detail: URI.parse(uri).fsPath,
              };
              if (itemsNames.indexOf(match[0]) == -1) {
                items.push(item);
                itemsNames.push(match[0]);
              }
            } else {
              let insertText = cleanedUri.replace(".inc", "");
              insertText += isQuoteInclude ? "" : ">";
              let item = {
                label: cleanedUri,
                kind: CompletionItemKind.File,
                detail: URI.parse(uri).fsPath,
                insertText: insertText,
              };
              if (itemsNames.indexOf(cleanedUri) == -1) {
                items.push(item);
                itemsNames.push(cleanedUri);
              }
            }
          }
        }
      }
    }

    return new CompletionList(items);
  }

  getCompletions(document: TextDocument, position: Position): CompletionList {
    let line = document.lineAt(position.line).text;
    let isMethod = checkIfMethod(line, position);
    let allItems: SPItem[] = this.getAllItems(document.uri.toString());
    let completionsList: CompletionList = new CompletionList();
    if (allItems !== []) {
      let lastFunc: string = GetLastFuncName(position, document, allItems);
      let lastEnumStruct = getLastEnumStructName(position, document, allItems);
      if (isMethod) {
        let variableType = this.getTypeOfVariable(
          line,
          position,
          allItems,
          lastFunc,
          lastEnumStruct
        );
        let variableTypes: string[] = this.getAllInheritances(
          variableType,
          allItems
        );
        let existingNames: string[] = [];
        for (let item of allItems) {
          if (
            (item.kind === CompletionItemKind.Method ||
              item.kind === CompletionItemKind.Property) &&
            variableTypes.includes(item.parent) &&
            // Don't include the constructor of the methodmap
            !variableTypes.includes(item.name)
          ) {
            if (!existingNames.includes(item.name)) {
              completionsList.items.push(
                item.toCompletionItem(document.uri.fsPath, lastFunc)
              );
              existingNames.push(item.name);
            }
          }
        }
        return completionsList;
      }
      let existingNames: string[] = [];
      for (let item of allItems) {
        if (
          !(
            item.kind === CompletionItemKind.Method ||
            item.kind === CompletionItemKind.Property
          )
        ) {
          if (!existingNames.includes(item.name)) {
            completionsList.items.push(
              item.toCompletionItem(document.uri.fsPath, lastFunc)
            );
            existingNames.push(item.name);
          }
        }
      }
      return completionsList;
    }
  }

  getAllInheritances(variableType: string, allCompletions: SPItem[]): string[] {
    let methodMapItem = allCompletions.find(
      (e) => e.kind === CompletionItemKind.Class && e.name === variableType
    );
    if (
      typeof methodMapItem === "undefined" ||
      typeof methodMapItem.parent === "undefined"
    ) {
      return [variableType];
    }
    return [variableType].concat(
      this.getAllInheritances(methodMapItem.parent, allCompletions)
    );
  }

  getTypeOfVariable(
    line: string,
    position: Position,
    allItems: SPItem[],
    lastFuncName: string,
    lastEnumStruct: string
  ): string {
    let i = position.character - 1;
    let bCounter = 0;
    let pCounter = 0;
    let isNameSpace = false;
    while (i >= 0) {
      if (/\w/.test(line[i])) {
        i--;
      } else if (line[i] === ".") {
        i--;
        break;
      } else if (line[i] === ":") {
        i--;
        if (line[i] === ":") {
          i--;
          isNameSpace = true;
          break;
        }
      }
    }
    let wordCounter = 0;
    let words: string[] = [""];
    while (i >= 0) {
      if (line[i] === "]") {
        bCounter++;
        i--;
        continue;
      }
      if (line[i] === "[") {
        bCounter--;
        i--;
        continue;
      }
      if (line[i] === ")") {
        pCounter++;
        i--;
        continue;
      }
      if (line[i] === "(") {
        pCounter--;
        i--;
        continue;
      }
      if (bCounter === 0 && pCounter === 0) {
        if (/\w/.test(line[i])) {
          words[wordCounter] = line[i] + words[wordCounter];
        } else if (line[i] === ".") {
          wordCounter++;
          words[wordCounter] = "";
        } else if (line[i] === ":") {
          i--;
          if (line[i] === ":") {
            wordCounter++;
            words[wordCounter] = "";
            isNameSpace = true;
          }
        } else {
          break;
        }
      }
      i--;
    }
    let variableType: string;
    if (isNameSpace) {
      variableType = words[words.length - 1];
    } else {
      if (
        lastEnumStruct !== globalIdentifier &&
        words[words.length - 1] === "this"
      ) {
        variableType = lastEnumStruct;
      } else {
        variableType = allItems.find(
          (e) =>
            (e.kind === CompletionItemKind.Variable &&
              [globalIdentifier, lastFuncName].includes(e.scope) &&
              e.name === words[words.length - 1]) ||
            (e.kind === CompletionItemKind.Function &&
              e.name === words[words.length - 1])
        ).type;
      }
    }

    if (words.length > 1) {
      words = words.slice(0, words.length - 1).reverse();
      for (let word of words) {
        variableType = allItems.find(
          (e) =>
            (e.kind === CompletionItemKind.Method ||
              e.kind === CompletionItemKind.Property) &&
            e.parent === variableType &&
            e.name === word
        ).type;
      }
    }

    return variableType;
  }

  getAllItems(file: string): SPItem[] {
    let includes = new Set<string>();
    let MainPath: string =
      Workspace.getConfiguration("sourcepawn").get("MainPath") || "";
    let allItems;
    if (MainPath !== "") {
      if (!existsSync(MainPath)) {
        let workspace: WorkspaceFolder = Workspace.workspaceFolders[0];
        MainPath = join(workspace.uri.fsPath, MainPath);
        if (!existsSync(MainPath)) {
          throw "MainPath is incorrect.";
        }
      }
      let uri = URI.file(MainPath).toString();
      allItems = this.completions.get(uri);
      if (!includes.has(uri)) {
        includes.add(uri);
      }
    } else {
      allItems = this.completions.get(file);
      includes.add(file);
    }
    if (typeof allItems !== "undefined") {
      this.getIncludedFiles(allItems, includes);
    } else {
      return [];
    }
    return [...includes]
      .map((file) => {
        return this.getFileItems(file);
      })
      .reduce(
        (completion, file_completions) => completion.concat(file_completions),
        []
      );
  }

  getFileItems(file: string): SPItem[] {
    let file_completions: FileItems = this.completions.get(file);
    let completion_list: SPItem[] = [];
    if (file_completions) {
      return file_completions.getCompletions(this);
    }
    return completion_list;
  }

  getIncludedFiles(completions: FileItems, files: Set<string>) {
    for (let include of completions.includes) {
      if (!files.has(include.uri)) {
        files.add(include.uri);
        let include_completions = this.completions.get(include.uri);
        if (include_completions) {
          this.getIncludedFiles(include_completions, files);
        }
      }
    }
  }

  getItemFromPosition(document: TextDocument, position: Position): SPItem[] {
    let range = document.getWordRangeAtPosition(position);
    // First check if we are dealing with a method or property.
    let isMethod: boolean = false;
    let isConstructor: boolean = false;
    let match: RegExpMatchArray;
    if (range.start.character > 1) {
      let newPosStart = new Position(
        range.start.line,
        range.start.character - 2
      );
      let newPosEnd = new Position(range.start.line, range.start.character);
      let newRange = new Range(newPosStart, newPosEnd);
      let char = document.getText(newRange);
      isMethod = /(?:\w+\.|\:\:)/.test(char);
      if (!isMethod) {
        let newPosStart = new Position(range.start.line, 0);
        let newPosEnd = new Position(range.start.line, range.end.character);
        let newRange = new Range(newPosStart, newPosEnd);
        let line = document.getText(newRange);
        match = line.match(/new\s+(\w+)$/);
        if (match) {
          isConstructor = true;
        }
      }
    }
    let word: string = document.getText(range);
    let allItems = this.getAllItems(document.uri.toString());
    let lastFunc: string = GetLastFuncName(position, document, allItems);
    let lastEnumStruct: string = getLastEnumStructName(
      position,
      document,
      allItems
    );
    // If we match a property or a method of an enum struct
    // but not a local scopped variable inside an enum struct's method.
    if (lastEnumStruct !== globalIdentifier && lastFunc === globalIdentifier) {
      let items = allItems.filter(
        (item) =>
          (item.kind === CompletionItemKind.Method ||
            item.kind === CompletionItemKind.Property) &&
          item.parent === lastEnumStruct &&
          item.name === word
      );
      return items;
    }

    if (isMethod) {
      let line = document.lineAt(position.line).text;
      // If we are dealing with a method or property, look for the type of the variable
      let variableType = this.getTypeOfVariable(
        line,
        position,
        allItems,
        lastFunc,
        lastEnumStruct
      );
      // Get inheritances from methodmaps
      let variableTypes: string[] = this.getAllInheritances(
        variableType,
        allItems
      );
      // Find and return the matching item
      let items = allItems.filter(
        (item) =>
          (item.kind === CompletionItemKind.Method ||
            item.kind === CompletionItemKind.Property) &&
          variableTypes.includes(item.parent) &&
          item.name === word
      );
      return items;
    }

    if (isConstructor) {
      let items = this.getAllItems(document.uri.toString()).filter(
        (item) =>
          item.kind === CompletionItemKind.Method &&
          item.name === match[1] &&
          item.parent === match[1]
      );
      return items;
    }
    // Check if we are dealing with a function
    let bIsFunction = isFunction(
      range,
      document,
      document.lineAt(position.line).text.length
    );
    let items = [];
    if (bIsFunction) {
      items = allItems.filter(
        (item) =>
          [CompletionItemKind.Function, CompletionItemKind.Interface].includes(
            item.kind
          ) && item.name === word
      );
      return items;
    }
    items = allItems.filter(
      (item) =>
        !(
          item.kind === CompletionItemKind.Method ||
          item.kind === CompletionItemKind.Property ||
          item.kind === CompletionItemKind.Function
        ) &&
        item.name === word &&
        item.scope === lastFunc
    );
    if (items.length > 0) {
      return items;
    }
    items = allItems.filter((item) => {
      if (
        item.kind === CompletionItemKind.Method ||
        item.kind === CompletionItemKind.Property
      ) {
        return false;
      }
      if (typeof item.scope !== "undefined") {
        if (typeof item.enumStructName !== "undefined") {
          return (
            item.scope === globalIdentifier &&
            item.name === word &&
            item.enumStructName === lastEnumStruct
          );
        }
        return item.scope === globalIdentifier && item.name === word;
      }
      return item.name === word;
    });
    return items;
  }
}

function checkIfMethod(line: string, position: Position): boolean {
  return /(?:\.|\:\:)\w*$/.test(line.slice(0, position.character));
}

function makeNewItemsMap(itemsMap): Map<string, SPItem> {
  for (let name of defaultConstantItems) {
    itemsMap.set(name, new ConstantItem(name));
  }
  for (let name of defaultKeywordsItems) {
    itemsMap.set(name, new KeywordItem(name));
  }
  return itemsMap;
}
