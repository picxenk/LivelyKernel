module('lively.ast.tests.AstTests').requires('lively.ast.AstHelper', 'lively.TestFramework').toRun(function() {

TestCase.subclass('lively.ast.tests.AstTests.Acorn',
'testing', {

    testFindNodeByAstIndex: function() {
        var src = 'var x = 3; function foo() { var y = 3; return y }; x + foo();',
            ast = acorn.parse(src),
            expected = ast.body[1].body.body[1].argument, // the y in "return y"
            found = acorn.walk.findNodeByAstIndex(ast, 9);
        this.assertIdentity(expected, found, 'node not found');
    },

    testFindNodeByAstIndexNoReIndex: function() {
        var src = 'var x = 3; function foo() { var y = 3; return y }; x + foo();',
            ast = acorn.parse(src),
            found = acorn.walk.findNodeByAstIndex(ast, 9, false);
        this.assertIdentity(null, found, 'node found (but should not add index)');
    },

    testFindStatementOfNode: function() {
        var tests = [{
            src: 'var x = 3; function foo() { var y = 3; return y + 2 }; x + foo();',
            target: function(ast) { return ast.body[1].body.body[1].argument.left; },
            expected: function(ast) { return ast.body[1].body.body[1]; },
        }, {
            src: 'var x = 1; x;',
            target: function(ast) { return ast.body[1]; },
            expected: function(ast) { return ast.body[1]; },
        }]

        tests.forEach(function(test, i) {
            var ast = acorn.parse(test.src),
                found = acorn.walk.findStatementOfNode(ast, test.target(ast));
            this.assertIdentity(test.expected(ast), found, 'node not found ' + (i + 1));
        }, this);
    },

    testUpdateSourceCodePositions: function() {
        var src = 'var x = { z: 3 }; function foo() { var y = 3; return y; } x.z + foo();',
            prettySrc = 'var x = { z: 3 };\nfunction foo() {\n    var y = 3;\n    return y;\n}\nx.z + foo();',
            ast = acorn.parse(src),
            genSrc = escodegen.generate(ast),
            genAst = acorn.parse(genSrc);

        this.assertEquals(prettySrc, genSrc, 'pretty printed source and generated source do not match');
        lively.ast.acorn.rematchAstWithSource(ast, genSrc);
        this.assertMatches(genAst, ast, 'source code positions were not corrected');
    },

    testUpdateSourceCodePositionsInSubTree: function() {
        var src1 = 'function foo() { var y = 3; return y; }',
            src2 = 'var x = { z: 3 };\nfunction foo() {\n    var y = 3;\n    return y;\n}\nx.z + foo();',
            ast1 = acorn.parse(src1).body[0],
            ast2 = acorn.parse(src2),
            genSrc = escodegen.generate(ast2),
            genAst = acorn.parse(genSrc);

        lively.ast.acorn.rematchAstWithSource(ast1, genSrc, null, 'body.1');
        this.assertMatches(genAst.body[1], ast1, 'source code positions were not corrected');
    },

    testUpdateSourceCodeLocations: function() {
        var src = 'var x = { z: 3 }; function foo() { var y = 3; return y; } x.z + foo();',
            prettySrc = 'var x = { z: 3 };\nfunction foo() {\n    var y = 3;\n    return y;\n}\nx.z + foo();',
            ast = acorn.parse(src),
            genSrc = escodegen.generate(ast),
            genAst = acorn.parse(genSrc);

        this.assertEquals(prettySrc, genSrc, 'pretty printed source and generated source do not match');
        lively.ast.acorn.rematchAstWithSource(ast, genSrc, true);
        this.assertMatches(genAst, ast, 'source code positions were not corrected');

        // sample some locations
        console.log(ast);
        var tests = [{  // var = x = { z: 3 };
            expected: { start: { line: 1, column: 0 }, end: { line: 1, column: 17 } },
            subject: ast.body[0].loc
        }, { // function foo() { ... }
            expected: { start: { line: 2, column: 0 }, end: { line: 5, column: 1 } },
            subject: ast.body[1].loc
        }, { // var y = 3;
            expected: { start: { line: 3, column: 4 }, end: { line: 3, column: 14 } },
            subject: ast.body[1].body.body[0].loc
        }, { // y  in  return y;
            expected: { start: { line: 4, column: 11 }, end: { line: 4, column: 12 } },
            subject: ast.body[1].body.body[1].argument.loc
        }, { // x.z + foo();
            expected: { start: { line: 6, column: 0 }, end: { line: 6, column: 12 } },
            subject: ast.body[2].loc
        }];

        tests.forEach(function(test, i) {
            this.assertMatches(test.expected, test.subject, 'incorrect location for test ' + (i+1));
        }, this);
    },

    testParseWithComments: function() {
        var src = 'var x = 3; // comment1\n// comment1\nfunction foo() { var y = 3; /*comment2*/ return y }; x + foo();',
            ast = lively.ast.acorn.parse(src, {withComments: true}),
            comments = ast.comments,
            expectedTopLevelComments = [{
              start: 11, end: 22,
              isBlock: false, text: " comment1"
            },{
              start: 23, end: 34,
              isBlock: false, text: " comment1"
            }],
            expectedScopedComments = [{
              start: 63, end: 75,
              isBlock: true, text: "comment2"
            }];
        this.assertMatches(expectedTopLevelComments, ast.comments, 'topLevel');
        this.assertMatches(expectedScopedComments, ast.body[1].body.comments, 'scoped');
    }

});

TestCase.subclass('lively.ast.tests.Transforming',
'testing', {

    testReplaceNode: function() {
        var code = 'var x = 3 + foo();',
            ast = lively.ast.acorn.parse(code),
            toReplace = ast.body[0].declarations[0].init.left,
            replacement = {
                start: 8, end: 9,
                loc: {
                  end: {column: 9, line: 1},
                  start: {column: 8, line: 1}
                },
                type: "Literal",
                value: "baz"
            },
            transformed = lively.ast.transform.replaceNode(ast, toReplace, replacement),
            transformedString = lively.ast.acorn.stringify(transformed),
            expected = 'var x = \'baz\' + foo();'

        this.assertEquals(expected, transformedString);
    },

    testTransformToReturnLastStatement: function() {
        var code = "var z = foo + bar; baz.foo(z, 3)",
            expected = "var z = foo + bar; return baz.foo(z, 3)",
            transformed = lively.ast.transform.returnLastStatement(code);
        this.assertEquals(expected, transformed);
    },

    testTransformTopLevelVarDeclsForCapturing: function() {
        return; // WIP
        var code = "var z = foo + bar; baz.foo(z, 3)",
            expected = "Global.z = foo + bar; baz.foo(z, 3)",
            transformed = lively.ast.transform.topLevelVarDecls(code, {declSubstitute: 'Global.'});
        this.assertEquals(expected, transformed);
    }

})

TestCase.subclass('lively.ast.tests.Querying',
'testing', {


    testFindVarDeclarationsInScopes: function() {

        var code = "var decl1 = {prop: 23};\n"
                 + "function foo(arg1, arg2) {\n"
                 + "    var decl2;\n"
                 + "    var decl3 = 23, decl4 = 42;\n"
                 + "    return decl3 + decl4;\n"
                 + "    function xxx() { return this.yyy }\n"
                 + "}\n";

        var ast = acorn.walk.addSource(code, null, null, true);

        var result = lively.ast.query.findDeclarationsAtPos(0, ast);
        var expected = ["decl1", "foo"];
        this.assertEquals(expected, result.pluck('id').pluck('name'), "1");

        var result = lively.ast.query.findDeclarationsAtPos(65, ast);
        var expected = ["decl1", "foo", "decl2", "xxx"];
        this.assertEquals(expected, result.pluck('id').pluck('name'), "2");
    },

    testFindTopLevelDeclarationsInSource: function() {
        var code = "var x = 3;\n function baz() { var zork; return xxx; }\nvar y = 4, z;\nbar = 'foo';"
        var decls = lively.ast.query.findTopLevelDeclarationsInSource(code);
        var expected = ["x", "baz", "y", "z"];
        this.assertEquals(expected, decls.pluck('id').pluck('name'), "1");
    }

});

TestCase.subclass('lively.ast.tests.AstTests.ClosureTest',
'testing', {

    test02RecreateClosure: function() {
        var f = function() { var x = 3; return x + y },
            closure = lively.Closure.fromFunction(f, {y: 2}),
            f2 = closure.recreateFunc();
        this.assertEquals(f.toString(), f2.toString());
        this.assertEquals(5, f2());
    },

    test03ClosureCanBindThis: function() {
        var obj = {},
            closure = lively.Closure.fromFunction(function() { this.testCalled = true }, {'this': obj});
        obj.foo = closure.recreateFunc();
        obj.foo();
        this.assert(obj.testCalled, 'this not bound');
    },

    test04LateBoundThis: function() {
        var obj = {name: 'obj1'},
            closure = lively.Closure.fromFunction(function() { return this.name }, {'this': obj});
        obj.foo = closure.recreateFunc();
        this.assertEquals('obj1', obj.foo());
        var obj2 = Object.inherit(obj);
        obj2.name = 'obj2';
        this.assertEquals('obj2', obj2.foo());
    },

    test05ThisBoundInSuper: function() {
        var obj1 = {bar: function bar() { this.foo = 1 }.asScript()},
            obj2 = Object.inherit(obj1);
        obj2.bar = function bar() { $super() }.asScriptOf(obj2);
        obj2.bar();
        this.assertEquals(1, obj2.foo);
        this.assert(!obj1.foo, 'foo was set in obj1');
        this.assert(obj2.hasOwnProperty('foo'), 'foo not set in obj2')
    },

    test06SuperBoundStatically: function() {
        var obj1 = {bar: function bar() { this.foo = 1 }.asScript()},
            obj2 = Object.inherit(obj1),
            obj3 = Object.inherit(obj2);
        obj2.bar = function bar() { $super() }.asScriptOf(obj2);
        obj3.bar();
        this.assertEquals(1, obj3.foo);
        this.assert(!obj1.foo, 'foo was set in obj1');
        this.assert(obj2.hasOwnProperty('foo'), 'foo was not set in obj2');
        this.assert(!obj3.hasOwnProperty('foo'), 'foo was set in obj3');
    },

    test07StoreFunctionProperties: function() {
        var func = function() { return 99 };
        func.someProperty = 'foo';
        var closure = lively.Closure.fromFunction(func),
            recreated = closure.recreateFunc();
        this.assertEquals('foo', recreated.someProperty);
    },

    test08SuperBoundAndAsArgument: function() {
        var obj = {
            m: function($super) {
                this.mWasCalled = true;
                $super();
            }.binds({$super: function() { this.superWasCalled = true }})
        }
        obj.m();
        this.assert(obj.mWasCalled, 'm not called');
        if (Global.superWasCalled) {
            delete Global.superWasCalled;
            this.assert(false, 'this not bound in super');
        }
        this.assert(obj.superWasCalled, 'super was not called');
    }

});

}) // end of module
