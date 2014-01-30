module('lively.ast.tests.RewriterTests').requires('lively.ast.Rewriting', 'lively.ast.StackReification', 'lively.ast.AstHelper', 'lively.TestFramework').toRun(function() {

TestCase.subclass('lively.ast.tests.RewriterTests.AcornRewrite',
'running', {

    setUp: function($super) {
        $super();
        this.parser = lively.ast.acorn;
        this.rewrite = function(node) { return lively.ast.Rewriting.rewrite(node, astRegistry); };
        this.oldAstRegistry = lively.ast.Rewriting.getCurrentASTRegistry();
        var astRegistry = this.astRegistry = [];
        lively.ast.Rewriting.setCurrentASTRegistry(astRegistry);
    },

    tearDown: function($super) {
        $super();
        lively.ast.Rewriting.setCurrentASTRegistry(this.oldAstRegistry);
    }

},
'matching code', {

    tryCatch: function(level, varMapping, inner) {
        level = level || 0;
        return Strings.format("try {\n"
            + "var _ = {}, lastNode = undefined, _%s = %s, __%s = [\n"
            + "        _,\n"
            + "        _%s,\n"
            + "        %s\n"
            + "    ];\n"
            + "%s"
            + "} catch (e) {\n"
            + "    var ex = e.isUnwindException ? e : new lively.ast.Rewriting.UnwindException(e);\n"
            + "    ex.shiftFrame(this, __%s, lastNode, %s);\n"
            + "    throw ex;\n"
            + "}\n",
            level, generateVarMappingString(), level, level,
            level-1 < 0 ? 'Global' : '__' + (level-1),
            inner, level, "__/[0-9]+/__");
        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        function generateVarMappingString() {
            if (!varMapping) return '{}';
            var ast = {
                type: "ObjectExpression",
                properties: Object.keys(varMapping).map(function(k) {
                    return {
                        kind: "init",
                        key: {type: "Literal",value: k},
                        value: {name: varMapping[k],type: "Identifier"}
                    }
                })
            };
            return escodegen.generate(ast);
        }
    },
    
    closureWrapper: function(level, name, args, innerVarDecl, inner) {
        // something like:
        // __createClosure(333, __0, function () {
        //     try {
        //         var _ = {}, _1 = {}, __1 = [_,_1,__0];
        //     ___ DO INNER HERE ___
        //     } catch (e) {...}
        // })
        var argDecl = innerVarDecl || {};
        args.forEach(function(argName) { argDecl[argName] = argName; });
        return Strings.format(
            "__createClosure(__/[0-9]+/__, __%s, function %s(%s) {\n"
          + this.tryCatch(level+1, argDecl, inner)
          + "})", level, name, args.join(', '));
    },
    
    intermediateResult: function(expression, optionalAstIndex) {
        // like _['7'] = 42; <-- the value stored in the _ object is the AST index
        var astIndexMatcher = optionalAstIndex || "__/[0-9]+/__";
        return "_[lastNode = " + astIndexMatcher + "] = " + expression;
    },

    setVar: function(level, varName, inner) {
        return Strings.format("_%s['%s'] = %s", level, varName, inner);
    },

    getVar: function(level, varName) {
        return Strings.format("_%s['%s']", level, varName);
    }

},
'helping', {

    assertASTMatchesCode: function(ast, code, msg) {
        var genCode = escodegen.generate(ast);
        var match = Strings.stringMatch(genCode.trim(), code.trim(), {ignoreIndent: true});
        if (match.matched) return;
        this.assert(false,
            'ast does not match code:\n  '
           + (msg ? msg + '\n' : '')
           + '\npattern:\n  ' + Strings.print(match.pattern) + '\nerror:\n  ' + Strings.print(match.error));
    },

    assertAstNodesEqual: function(node1, node2, msg) {
        var notEqual = lively.ast.acorn.compareAst(node1, node2);
        if (!notEqual) return;
        this.assert(false, 'nodes not equal: ' + (msg ? '\n  ' + msg : '') + '\n  ' + notEqual.join('\n  '));
    }

},
'testing', {

    test01WrapperTest: function() {
        var ast = this.parser.parse('12345;'),
            result = this.rewrite(ast);
        this.assertASTMatchesCode(result, this.tryCatch(0, null, '12345;\n'))
    },

    test02LocalVarTest: function() {
        var src = 'var i = 0; i;',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {'i': 'undefined'},
                        this.intermediateResult(
                            this.setVar(0, 'i', '0;\n')
                          + this.getVar(0, 'i')
                          + ';\n', 3/*astIndex of "var i = 0"*/));
        this.assertASTMatchesCode(result, expected);
    },

    test03GlobalVarTest: function() {
        var src = 'i;',
            ast = this.parser.parse(src),
            result = this.rewrite(ast);
        this.assertASTMatchesCode(result, this.tryCatch(0, null, 'i;\n'));
    },

    test04MultiVarDeclarationTest: function() {
        var src = 'var i = 0, j;',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {'i': 'undefined', 'j': 'undefined'},
                this.intermediateResult(
                    this.setVar(0, 'i', '0, ')
                  + this.intermediateResult(this.setVar(0, 'j', 'undefined;\n'))));
        this.assertASTMatchesCode(result, expected);
    },

    test05FunctionDeclarationTest: function() {
        var src = 'function fn(k, l) {}',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {'fn': 'undefined'},
                this.intermediateResult(
                    this.setVar(0, 'fn',
                        this.closureWrapper(0, 'fn', ['k', 'l'], {}, "") + ';\n')));
        this.assertASTMatchesCode(result, expected);
    },

    test06ScopedVariableTest: function() {
        var src = 'var i = 0; function fn() {var i = 1;}',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {'i': 'undefined', 'fn': 'undefined'},
                this.intermediateResult(
                    this.setVar(0, 'i', '0;\n'))
              + this.intermediateResult(
                    this.setVar(0, 'fn',
                        this.closureWrapper(0, 'fn', [], {i: 'undefined'}, 
                            this.intermediateResult(
                                this.setVar(1, 'i', '1;\n'))))) + ';\n');
        this.assertASTMatchesCode(result, expected);
    },

    test07UpperScopedVariableTest: function() {
        var src = 'var i = 0; function fn() {i;}',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {'i': 'undefined', 'fn': 'undefined'},
                this.intermediateResult(
                    this.setVar(0, 'i', '0;\n'))
              + this.intermediateResult(
                    this.setVar(0, 'fn',
                        this.closureWrapper(0, 'fn', [], {},
                            this.getVar(0, 'i') + ';\n'))) + ';\n');
        this.assertASTMatchesCode(result, expected);
    },

    test08ForWithVarDeclarationTest: function() {
        var src = 'for (var i = 0; i < 10; i++) {}',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {'i': 'undefined'},
                "for ("
              + this.intermediateResult(this.setVar(0, 'i', "0; "))
              + this.getVar(0, 'i') + ' < 10; '
              + this.intermediateResult(this.getVar(0, 'i') + '++')
              + ") {\n}\n");
        this.assertASTMatchesCode(result, expected);
    },

    test09ForInWithVarDeclarationTest: function() {
        var src = 'for (var key in obj) {}',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {'key': 'undefined'},
                "for ("
              + this.getVar(0, 'key') + ' in obj'
              + ") {\n}\n");
        this.assertASTMatchesCode(result, expected);
    },

    test10EmptyForTest: function() {
        var src = 'for (;;) {}',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {}, "for (;;) {\n}\n");
        this.assertASTMatchesCode(result, expected);
    },

    test11FunctionAssignmentTest: function() {
        var src = 'var foo = function bar() {}',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {'foo': 'undefined'},
                this.intermediateResult(
                    this.setVar(0, 'foo', 
                        this.intermediateResult(
                            this.closureWrapper(0, 'bar', [], {}, "")))) + ';\n');
// FIXME: inner function should be declared local');
// expected = this.tryCatch(0, {'foo': 'undefined', 'bar': 'undefined'},
//     this.intermediateResult(
//         this.setVar(0, 'foo',
//             this.intermediateResult(
//             this.setVar(0, 'bar',
//                 this.closureWrapper(0, 'bar', [], {},""))))) + ';\n');
        this.assertASTMatchesCode(result, expected);
    },

    test12FunctionAsParameterTest: function() {
        var src = 'fn(function () {});',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {},
                this.intermediateResult(
                    "fn.call(Global, "
                  + this.intermediateResult(
                      this.closureWrapper(0, '', [], {}, "") + ');\n')));
        this.assertASTMatchesCode(result, expected);
    },

    test13FunctionAsPropertyTest: function() {
        var src = '({fn: function () {}});',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {},
                "({\nfn: "
                + this.intermediateResult(
                      this.closureWrapper(0, '', [], {}, "") + '\n')
                + "});\n");
        this.assertASTMatchesCode(result, expected);
    },

    test14FunctionAsSetterGetterTest: function() {
        var src = '({get foo() {}, set bar(val) {val++;}});',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {},
                "({\n"
                + "get foo() {\n" + this.tryCatch(1, {}, "") + "},\n"
                + "set bar(val) {\n" + this.tryCatch(1, {val: 'val'},
                        this.intermediateResult(
                            this.getVar(1, 'val') + '++;\n')) + '}\n'
                + "});\n");
        this.assertASTMatchesCode(result, expected);
    },

    test15FunctionAsReturnArgumentTest: function() {
        var src = '(function () {return function() {};});',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {},
                this.intermediateResult(
                      this.closureWrapper(0, '', [], {},
                      "return " + this.intermediateResult(
                          this.closureWrapper(1, '', [], {}, "") + ';\n')) + ';\n'));
        this.assertASTMatchesCode(result, expected);
    },

    test16FunctionInConditionalTest: function() {
        var src = 'true ? function() {} : 23;',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {},
                "true ? "
              + this.intermediateResult(
                  this.closureWrapper(0, '', [], {},"") + ' : 23;\n'));
        this.assertASTMatchesCode(result, expected);
    },

    test17ClosureCallTest: function() {
        var src = '(function() {})();',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {},
                this.intermediateResult(
                    '('
                    + this.intermediateResult(
                        this.closureWrapper(0, '', [], {},""))
                    + ").call(Global);\n"));
        this.assertASTMatchesCode(result, expected);
    },

    test18MemberChainSolvingTest: function() {
        var src = 'var lively, ast, morphic; lively.ast.morphic;',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {lively: 'undefined', ast: 'undefined', morphic: 'undefined'},
            // FIXME vars are initialized twice?!
                this.intermediateResult(
                    this.setVar(0, 'lively', 'undefined, '))
              + this.intermediateResult(
                    this.setVar(0, 'ast', 'undefined, '))
              + this.intermediateResult(
                    this.setVar(0, 'morphic', 'undefined;\n'))
              + this.getVar(0, 'lively') + '.ast.morphic;\n');
        this.assertASTMatchesCode(result, expected);
    },

    test19FunctionInMemberChainTest: function() {
        var src = '(function() {}).toString();',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {},
              this.intermediateResult(
                    "("
                  + this.intermediateResult(
                        this.closureWrapper(0, '', [], {}, "")))
                  + ").toString();\n");
        this.assertASTMatchesCode(result, expected);
    },

    test20ObjectPropertyNamingTest: function() {
        var src = 'var foo; ({foo: foo});',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {foo: 'undefined'},
                this.intermediateResult(this.setVar(0, 'foo', 'undefined;\n'))
              + "({ foo: " + this.getVar(0, 'foo') + ' });\n');
        this.assertASTMatchesCode(result, expected);
    },

    test21FunctionAsArrayElementTest: function() {
        var src = '[function() {}];',
            ast = this.parser.parse(src),
            result = this.rewrite(ast),
            expected = this.tryCatch(0, {},
                "[" + this.intermediateResult(this.closureWrapper(0, '', [], {}, "")) + '];\n');
        this.assertASTMatchesCode(result, expected);
    },

    test22FunctionCall: function() {
        // test if the "return g();" is translated to "return _1["g"].call();"
        var func = function() { function g() {}; return g(); }, returnStmt;
        func.stackCaptureMode();
        acorn.walk.simple(func.asRewrittenClosure().ast, {ReturnStatement: function(n) { returnStmt = n; }})
        var expected = "return " + this.intermediateResult(this.getVar(1, 'g')) + '.call(Global);'
        this.assertASTMatchesCode(returnStmt, expected);
    }
});

TestCase.subclass('lively.ast.tests.RewriterTests.AcornRewriteExecution',
// checks that rewritten code doesn't introduce semantic changes
'testing', {

    test01LoopResult: function() {
        function code() {
            var result = 0;
            for (var i = 0; i < 10; i++) result += i;
            return result;
        }
        var src = Strings.format('(%s)();', code),
            src2 = escodegen.generate(lively.ast.Rewriting.rewrite(lively.ast.acorn.parse(src)));
        this.assertEquals(eval(src), eval(src2), code + ' not identically rewritten');
    }

});

TestCase.subclass('lively.ast.tests.RewriterTests.ContinuationTest',
'running', {

    setUp: function($super) {
        $super();
        this.oldAstRegistry = lively.ast.Rewriting.getCurrentASTRegistry();
        lively.ast.Rewriting.setCurrentASTRegistry(this.astRegistry = []);
    },

    tearDown: function($super) {
        $super();
        lively.ast.Rewriting.setCurrentASTRegistry(this.oldAstRegistry);
    }

},
'assertion', {

    assertAstNodesEqual: lively.ast.tests.RewriterTests.AcornRewrite.prototype.assertAstNodesEqual

},
'testing', {

    test01RunWithNoBreak: function() {
        function code() {
            var x = 2;
            return x + 4;
        }
        var expected = {
            isContinuation: false,
            returnValue: 6
        }
        var runResult = lively.ast.StackReification.run(code);
        this.assertEqualState(expected, runResult)
    },

    test02SimpleBreak: function() {
        // Program(12,"function code() { var x = 2; debu...")
        // \---.body[0]:FunctionDeclaration(11,"function code() { var x = 2; debu...")
        //     |---.id:Identifier(0,"code")
        //     \---.body:BlockStatement(10,"{ var x = 2; debugger; ...")
        //         |---.body[0]:VariableDeclaration(4,"var x = 2;")
        //         |   \---.declarations[0]:VariableDeclarator(3,"x = 2")
        //         |       |---.id:Identifier(1,"x")
        //         |       \---.init:Literal(2,"2")
        //         |---.body[1]:DebuggerStatement(5,"debugger;")
        //         \---.body[2]:ReturnStatement(9,"return x + 4;")
        //             \---.argument:BinaryExpression(8,"x + 4")
        //                 |---.left:Identifier(6,"x")
        //                 \---.right:Literal(7,"4")
        function code() {
            var x = 2;
            debugger;
            return x + 4;
        }

        var expected = { isContinuation: true },
            runResult = lively.ast.StackReification.run(code, this.astRegistry),
            frame = runResult.frames().first();
        this.assert(runResult.isContinuation, 'no continuation');

        // can we access the original ast, needed for resuming?
        var capturedAst = frame.getOriginalAst();
        this.assertAstNodesEqual(lively.ast.acorn.parseFunction(String(code)), capturedAst);

        // where did the execution stop?
        // this.assertIdentity(5, frame.getPC(), 'pc');
        this.assertIdentity(capturedAst.body.body[1], frame.getPC(), 'pc');
    },

    test03SimpleBreakInNestedFunction: function() {
        function code() {
            var x = 1;
            var f = function() {
                debugger;
                return x * 2;
            };
            var y = x + f();
            return y;
        }

        var continuation = lively.ast.StackReification.run(code, this.astRegistry),
            frame1 = continuation.frames()[0],
            frame2 = continuation.frames()[1];
        // frame state
        this.assertEquals(2, continuation.frames().length, 'number of captured frames');
        this.assertEquals(1, continuation.currentFrame.lookup('x'), 'val of x');
        this.assertEquals(undefined, continuation.currentFrame.lookup('y'), 'val of y');
        this.assertEquals(Global, continuation.currentFrame.getThis(), 'val of this');

        // captured asts
        var expectedAst = lively.ast.acorn.parseFunction('function() { debugger; return x * 2; }'),
            actualAst = frame1.getOriginalAst();
        this.assertAstNodesEqual(expectedAst, actualAst);
        this.assertAstNodesEqual(lively.ast.acorn.parseFunction(String(code)), frame2.getOriginalAst());

        // access the node where execution stopped
        var resumeNode = frame1.getPC(),
            debuggerNode = actualAst.body.body[0];
        this.assertAstNodesEqual(debuggerNode, resumeNode, 'resumeNode');
    },

    test04BreakAndContinue: function() {
        function code() {
            var x = 1;
            debugger;
            return x + 3;
        }
        var continuation = lively.ast.StackReification.run(code, this.astRegistry),
            result = continuation.resume();
        this.assertEquals(4, result, 'resume not working');
    },

    test05BreakAndContinueWithForLoop: function() {
        function code() {
            var x = 1;
            for (var i = 0; i < 5; i++) {
                if (i == 3) debugger;
                x += i;
            }
            return x + 3;
        }
        var continuation = lively.ast.StackReification.run(code, this.astRegistry),
            result = continuation.resume();
        this.assertEquals(14, result, 'resume not working');
    },

    test06BreakAndContinueWithWhileLoop: function() {
        function code() {
            var x = 1, i = 0;
            while (i < 5) {
                if (i == 3) debugger;
                x += i;
                i++;
            }
            return x + 3;
        }
        var continuation = lively.ast.StackReification.run(code, this.astRegistry),
            result = continuation.resume();
        this.assertEquals(14, result, 'resume not working');
    },

    test07BreakAndContinueWithForInLoop: function() {
        function code() {
            var x = 1,
                obj = { a: 1, b: 2, c: 3 };
            for (var i in obj) {
                if (i == 'b') debugger;
                x += obj[i];
            }
            return x + 3;
        }
        var continuation = lively.ast.StackReification.run(code, this.astRegistry),
            result = continuation.resume();
        this.assertEquals(10, result, 'resume not working');
    },

    test08BreakAndContinueWithInnerFunction: function() {
        function code() {
            var x = 1;
            var f = function() {
                debugger;
                return x * 2;
            };
            var y = x + f();
            return y;
        }

        var continuation = lively.ast.StackReification.run(code, this.astRegistry),
            result = continuation.resume();
        this.assertEquals(3, result, 'resume not working');
    },

    test09ReturnFunctionThatBreaksAndContinues: function() {
        function code() {
            var x = 3;
            return function() {
                debugger;
                return x * 2;
            };
        }

        var continuation = lively.ast.StackReification.run(code, this.astRegistry),
            func = continuation.returnValue;
        var continuation2 = lively.ast.StackReification.run(func, this.astRegistry),
            result = continuation2.resume();
        this.assertEquals(6, result, 'resume not working');
    },

    test10BreakAndContinueOfInnerFunction: function() {
        function code() {
            var x = 1;
            function f() { debugger; return x; }
            return (function() { var x = 2; return f(); })();
        }

// FIXME there is currently a bug: in lively.ast.Continuation>>resume we
// correctly resume the "f" which contains the debugger statement. In the next
// step however we don't jump to the correct node ("return f();") of the next
// frame but instead start the resume at "var x = 2;" which leads to running "f
// ()" again.
// FIXME second bug: there is a difference between the lexical scope of a
// function (the x in f refers to "x = 1") but our current logic only considers
// the runtime stack that is created on unwind which will incorrectly use "x = 2
// " in the parent runtime scope for lookup
        var continuation = lively.ast.StackReification.run(code, this.astRegistry),
            result = continuation.resume();
        this.assertEquals(1, result, 'resume not working');
    }

});

}) // end of module