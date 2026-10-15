"""Checks the code limits of Python files: python3 -I tools/check_py.py FILE [FILE ...]

Per function: at most 100 lines, 5 parameters, cyclomatic complexity 8 (1 plus each if, loop,
except, boolean operator, conditional expression, comprehension and match case) and block depth 3.
Nested functions count on their own. It prints each function over a limit and exits 1.
"""

import ast
import sys

LIMITS = {"lines": 100, "params": 5, "complexity": 8, "depth": 3}
BLOCKS = (ast.If, ast.For, ast.While, ast.Try, ast.With, ast.AsyncFor, ast.AsyncWith)
FUNCS = (ast.FunctionDef, ast.AsyncFunctionDef)


def points(node):
    """Complexity points of one node, not counting nested functions."""
    if isinstance(node, (ast.If, ast.For, ast.While, ast.AsyncFor, ast.IfExp, ast.ExceptHandler)):
        return 1
    if isinstance(node, (ast.comprehension, ast.match_case)):
        return 1
    return len(node.values) - 1 if isinstance(node, ast.BoolOp) else 0


def measure(func):
    """(complexity, depth) of a function body."""
    score, depth = 1, 0
    stack = [(child, 0) for child in ast.iter_child_nodes(func)]
    while stack:
        node, level = stack.pop()
        if isinstance(node, FUNCS + (ast.Lambda, ast.ClassDef)):
            continue
        score += points(node)
        level += isinstance(node, BLOCKS)
        depth = max(depth, level)
        stack.extend((child, level) for child in ast.iter_child_nodes(node))
    return score, depth


def params(func):
    a = func.args
    return len(a.posonlyargs + a.args + a.kwonlyargs) + bool(a.vararg) + bool(a.kwarg)


def check(path):
    tree = ast.parse(open(path, encoding="utf-8").read(), path)
    bad = []
    for func in (n for n in ast.walk(tree) if isinstance(n, FUNCS)):
        score, depth = measure(func)
        found = {"lines": func.end_lineno - func.lineno + 1, "params": params(func),
                 "complexity": score, "depth": depth}
        over = [f"{k}={v}" for k, v in found.items() if v > LIMITS[k]]
        if over:
            bad.append(f"{path}:{func.lineno} {func.name} {' '.join(over)}")
    return bad


def self_test():
    body = "".join(f"    if a == {i}:\n        pass\n" for i in range(8))
    src = "def f(a, b, c, d, e, g):\n" + body
    tree = ast.parse(src)
    func = tree.body[0]
    assert measure(func) == (9, 1) and params(func) == 6, (measure(func), params(func))


def main():
    self_test()
    bad = [line for path in sys.argv[1:] for line in check(path)]
    print("\n".join(bad) or f"python limits ok: {len(sys.argv) - 1} files")
    sys.exit(1 if bad else 0)


main()
