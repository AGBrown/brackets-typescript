//   Copyright 2013 François de Campredon
//
//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.

'use strict';


import LexicalStructureService = require('../commons/lexicalStructureService');
import WorkingSet = require('./workingSet')

var EditorManager = brackets.getModule('editor/EditorManager'),
    QuickOpen    = brackets.getModule('search/QuickOpen');


class Session {
    constructor(
        public items: LexicalStructureService.LexicalStructureItem[]
    ){}
} 


class TypeScriptQuickFindDefitionProvider implements brackets.QuickOpenPluginDef<TypeScriptQuickFindDefitionProvider.LexicalStructureItem> {
    
    private lexicalStructureService: JQueryDeferred<LexicalStructureService> = $.Deferred();
    
    private session: Session;
    
    setLexicalStructureService(service: LexicalStructureService) {
        this.lexicalStructureService.resolve(service);
    }
    
    
    name = 'TypeScriptQuickFindDefitionProvider';
    languageIds = ["typescript"];    
    label = 'TypeScript';
    
    match(query: string) {
        return query.indexOf("@") === 0;
    }
    
    search = (request: string) =>  {
        request = request.substr(1);
        return this.getSession().then(session => {
            return session.items.filter(item => item.name.indexOf(request) !== -1);
        });
    }
    
    done = () => {
        this.session = null;
    }
    
    itemSelect(item: TypeScriptQuickFindDefitionProvider.LexicalStructureItem) {
         EditorManager.getActiveEditor().setCursorPos(item.position.line, item.position.ch, true, true)
    }
    
    resultsFormatter(item: TypeScriptQuickFindDefitionProvider.LexicalStructureItem) {
        var displayName = QuickOpen.highlightMatch(item.name);
        displayName = item.containerName ? item.containerName + '.' + displayName : displayName;
        return "<li>" + displayName + "</li>";
    }
    
    
    private getSession(): JQueryPromise<Session> {
        return $.Deferred(deferred => {
            if (this.session) {
                deferred.resolve(this.session)
            } else {
                this.lexicalStructureService.then(lexicalStructureService => {
                    var currentFile = EditorManager.getActiveEditor().document.file.fullPath;
                    lexicalStructureService.getLexicalStructureForFile(currentFile).then(items => {
                        this.session = new Session(items);
                        deferred.resolve(this.session);    
                    });
                });
            }
        }).promise();
    }
}

module TypeScriptQuickFindDefitionProvider {
    export interface LexicalStructureItem {
        name: string; 
        containerName:string;
        position: CodeMirror.Position;
    }
}


export = TypeScriptQuickFindDefitionProvider;
   /* itemFocus =  (result: LexicalStructureItem) => {
       
    }*/
    
    
    
//        /**
//         * performs an action when a result has been highlighted (via arrow keys, mouseover, etc.).
//         */
//        itemFocus?: (result: S) => void;
//        /**
//         * options to pass along to the StringMatcher (see StringMatch.StringMatcher for available options). 
//         */
//        matcherOptions? : StringMatcherOptions;