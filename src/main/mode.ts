//   Copyright 2013-2014 François de Campredon
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


import ts = require('typescript');

type Token  = {
	string: string;
	classification: ts.TokenClass;
	length: number;
	position: number;
}

type BracketsStackItem = { 
    indent: number ; brackets: string[] 
}

interface LineDescriptor {
    tokenMap: { [position: number]: Token };
    eolState: ts.EndOfLineState;
    indent: number;
    nextLineIndent: number;
    bracketsStack: BracketsStackItem[]
}


function last<T>(arr: T[]) {
    return arr[arr.length -1];
}

var classifier: ts.Classifier = ts.createClassifier({ log: () => void 0 });

function getClassificationsForLine(text: string, eolState: ts.EndOfLineState ) {
	var classificationResult = classifier.getClassificationsForLine(text, eolState),
		currentPosition = 0,
		tokens: Token[]  = [];

	for (var i = 0, l = classificationResult.entries.length; i < l ; i++) {
		var entry = classificationResult.entries[i];
		var token = {
			string: text.substr(currentPosition, entry.length),
			length: entry.length,
			classification: entry.classification,
			position: currentPosition
		};
		tokens.push(token);
		currentPosition += entry.length;
	}

	return {
		tokens: tokens,
		eolState: classificationResult.finalLexState
	};
}

function getStyleForToken(token: Token, textBefore: string): string {
	var TokenClass = ts.TokenClass;
	switch (token.classification) {
		case TokenClass.NumberLiteral:
			return 'number';
		case TokenClass.StringLiteral:
			return 'string';
		case TokenClass.RegExpLiteral:
			return 'string-2';
		case TokenClass.Operator: 
			return 'operator';
		case TokenClass.Comment:
			return 'comment';
		case TokenClass.Keyword: 
			switch (token.string) {
				case 'string':
				case 'number':
				case 'void':
				case 'bool':
				case 'boolean':
					return 'variable-2';
				case 'static':
				case 'public':
				case 'private':
				case 'export':
				case 'get':
				case 'set':
					return 'qualifier';
				case 'class':
				case 'function':
				case 'module':
				case 'var':
					return 'def';
				default:
					return 'keyword';
			}

		case TokenClass.Identifier:
			// Show types (indentifiers in PascalCase) as variable-2, other types (camelCase) as variable
			if (token.string.charAt(0).toLowerCase() !== token.string.charAt(0)) {
				return 'variable-2';
			} else {
				return 'variable';
			}
		case TokenClass.Punctuation: 
			return 'bracket';
		case TokenClass.Whitespace:
		default:
			return null;
	}
}


var openingBrackets = ['{', '(', '[', '<'];
var closingBrackets = ['}', ')', ']', '>'];

function isOpening(bracket: string) {
    return openingBrackets.indexOf(bracket) !== -1;
}

function isClosing(bracket: string) {
    return closingBrackets.indexOf(bracket) !== -1;
}


function isPair(opening: string, closing: string) {
    return openingBrackets.indexOf(opening) === closingBrackets.indexOf(closing);
}


function getLineDescriptorInfo(text: string, eolState: ts.EndOfLineState, indent: number, bracketsStack: BracketsStackItem[]) {
    bracketsStack = bracketsStack.map(item => ({
        indent: item.indent,
        brackets: item.brackets.slice()
    }));
    
    var classificationResult = getClassificationsForLine(text, eolState);
    var tokens = classificationResult.tokens;
    var tokenMap: { [position: number]: Token } = {};
    
    var openedBrackets: string[] = [];
    var closedBrackets: string[] = []

    function openBracket(openedBracket: string) {
        openedBrackets.push(openedBracket);
    }

    function closeBracket(closedBracket: string) {
        var openedBracket = last(openedBrackets)
        if (openedBracket) {
            if (isPair(openedBracket, closedBracket)) {
                openedBrackets.pop();
            }
        } else {
            closedBrackets.push(closedBracket)
        }
    }


    for (var i = 0, l = tokens.length; i < l; i++) {
        var token = tokens[i];
        tokenMap[token.position] = token;
        if (token.classification === ts.TokenClass.Punctuation) {
            if (isClosing(token.string)) {
                closeBracket(token.string);
            } else if (isOpening(token.string)) {
                openBracket(token.string);
            }
        }
    }


    
    if(closedBrackets.length) {
        var newStack: string[][] = [];
        for (var i = bracketsStack.length -1; i >=0; i--) {
            var item = bracketsStack[i];
            var brackets = item.brackets;

            var hasPair = false;
            while (
                isPair(last(brackets), closedBrackets[0]) && 
                brackets.length && item.brackets.length
            ) {
                brackets.pop();
                closedBrackets.shift();
                hasPair = true;
            }
            
            if (hasPair) {
                indent = item.indent;
            }

            if (!brackets.length) {
                bracketsStack.pop();
            } else {
                // in this case we had closing token that are not pair with our openingStack 
                // error
                break;
            }
        } 
    }
                    
    if (openedBrackets.length) {
        bracketsStack.push({ 
            indent: indent,
            brackets: openedBrackets 
        });
    } 
    
    return {
        eolState: classificationResult.eolState,
        tokenMap: tokenMap,
        indent: indent,
        bracketsStack: bracketsStack,
        hasOpening: !!openedBrackets.length
    }
}

function createTypeScriptMode(options: CodeMirror.EditorConfiguration, spec: any): CodeMirror.CodeMirrorMode<any> {
    return {
        lineComment: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        electricChars: ':{}[]()',
        
        startState(): LineDescriptor {
            return {
                tokenMap: {},
                eolState: ts.EndOfLineState.Start,
                indent: 0,
                nextLineIndent: 0,
                bracketsStack: []
            };
        },
        
        copyState(lineDescriptor: LineDescriptor) {
            return {
                tokenMap: lineDescriptor.tokenMap,
                eolState: lineDescriptor.eolState,
                indent: lineDescriptor.indent,
                nextLineIndent: lineDescriptor.nextLineIndent,
                bracketsStack: lineDescriptor.bracketsStack
            }
        },

        token(stream: CodeMirror.CodeMirrorStream, lineDescriptor: LineDescriptor) {
            if (stream.sol()) {
                var info = getLineDescriptorInfo(stream.string, lineDescriptor.eolState, lineDescriptor.nextLineIndent, lineDescriptor.bracketsStack);
                
                lineDescriptor.eolState = info.eolState;
                lineDescriptor.tokenMap = info.tokenMap;
                lineDescriptor.bracketsStack = info.bracketsStack;
                lineDescriptor.indent = info.indent;
                lineDescriptor.nextLineIndent = info.hasOpening ? info.indent + 1 : info.indent;
            }

            var token = lineDescriptor.tokenMap[stream.pos];
            if (token) {
                var textBefore: string  = stream.string.substr(0, stream.pos);
                for (var i = 0; i < token.length; i++) {
                    stream.next();
                }
                return getStyleForToken(token, textBefore);
            } else {
                stream.skipToEnd();

            }

            return null;
        },


        indent(lineDescriptor: LineDescriptor , textAfter: string): number {
            if (lineDescriptor.eolState !== ts.EndOfLineState.Start) {
                return CodeMirror.Pass;
            }
            
            var indent = lineDescriptor.nextLineIndent;
            if (textAfter) {
                indent = getLineDescriptorInfo(textAfter, lineDescriptor.eolState, lineDescriptor.nextLineIndent, lineDescriptor.bracketsStack).indent;
            } 
         
            return indent * options.indentUnit
        }
    }
}

export = createTypeScriptMode;
