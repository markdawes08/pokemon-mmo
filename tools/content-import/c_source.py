"""Small, strict parser for source data, not a C compiler or script interpreter.

Tokens and an expression/initializer AST preserve source symbols and ordering.
Only requested integer expressions are evaluated: unknown symbols, unsupported
syntax, duplicate designators and recursive macros fail instead of becoming 0.
Includes are recorded but never followed implicitly; callers pin/load inputs.
Arithmetic has C truncating integer division. Floating literals use exact decimal
fractions and require an explicit conversion at the destination integer field.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from fractions import Fraction
import re


class CSourceError(ValueError):
    pass


@dataclass(frozen=True)
class Expr:
    kind: str
    value: object
    args: tuple = ()
    source_tokens: tuple = ()


@dataclass(frozen=True)
class Initializer:
    entries: tuple


_LEXER = re.compile(
    r'(?P<space>\s+)|(?P<comment>//[^\n]*|/\*[\s\S]*?\*/)|'
    r'(?P<string>"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\')|'
    r'(?P<number>0[xX][0-9a-fA-F]+[uUlL]*|(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?[fFlL]?|\d+[uUlL]*)|'
    r'(?P<identifier>[A-Za-z_][A-Za-z_0-9]*)|'
    r'(?P<operator><<|>>|<=|>=|==|!=|&&|\|\||[{}\[\]().,;:=?+*/%~!&|^<>-])'
)
_IDENTIFIER = re.compile(r'[A-Za-z_][A-Za-z_0-9]*\Z')
_PRECEDENCE = {'||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6,
               '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8,
               '+': 9, '-': 9, '*': 10, '/': 10, '%': 10}


def tokens(text: str, outside_initializer=False) -> list[str]:
    result = []
    at = 0
    while at < len(text):
        match = _LEXER.match(text, at)
        if not match:
            if outside_initializer:
                # Declaration discovery may traverse a whole .c file. Keep
                # unrelated syntax opaque; the requested initializer still
                # goes through the strict grammar below.
                result.append(text[at])
                at += 1
                continue
            raise CSourceError(f'Unsupported C token near {text[at:at + 45]!r}')
        if match.lastgroup not in ('space', 'comment'):
            result.append(match[0])
        at = match.end()
    return result


def _without_comments(text: str) -> str:
    # Strings are consumed first so // and /* inside a quoted value survive.
    pattern = r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/'
    return re.sub(pattern, lambda m: ('\n' * m[0].count('\n') or ' ') if m[0].startswith(('/',)) else m[0], text)


class _Parser:
    def __init__(self, source: list[str]):
        self.tokens = source
        self.at = 0

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def pop(self, expected=None):
        token = self.peek()
        if token is None or (expected is not None and token != expected):
            raise CSourceError(f'Expected {expected or "token"}, got {token!r}')
        self.at += 1
        return token

    def expression(self, minimum=0):
        start = self.at
        token = self.pop()
        if token in ('+', '-', '~', '!'):
            node = Expr('unary', token, (self.expression(11),))
        elif token == '(':
            node = self.expression()
            self.pop(')')
        elif token.startswith('"'):
            parts = [token]
            while self.peek() and self.peek().startswith('"'):
                parts.append(self.pop())
            node = Expr('string', ''.join(_decode_string(p) for p in parts))
        elif token.startswith("'"):
            value = _decode_string(token)
            if len(value) != 1:
                raise CSourceError('Multi-character C character literal is unsupported')
            node = Expr('number', ord(value))
        elif _IDENTIFIER.fullmatch(token):
            node = Expr('symbol', token)
            if self.peek() == '(':
                self.pop()
                args = []
                if self.peek() != ')':
                    while True:
                        args.append(self.expression())
                        if self.peek() != ',':
                            break
                        self.pop()
                self.pop(')')
                node = Expr('call', token, tuple(args))
        elif token[0].isdigit() or token.startswith('.'):
            literal = re.sub(r'[uUlLfF]+$', '', token) if not token.lower().startswith('0x') else re.sub(r'[uUlL]+$', '', token)
            if '.' in literal or 'e' in literal.lower() and not literal.lower().startswith('0x'):
                value = Fraction(literal)
            else:
                base = 16 if literal.lower().startswith('0x') else (8 if len(literal) > 1 and literal.startswith('0') else 10)
                value = int(literal, base)
            node = Expr('number', value)
        else:
            raise CSourceError(f'Unsupported expression starting at {token!r}')
        while self.peek() in _PRECEDENCE and _PRECEDENCE[self.peek()] >= minimum:
            operator = self.pop()
            right = self.expression(_PRECEDENCE[operator] + 1)
            node = Expr('binary', operator, (node, right))
        if minimum == 0 and self.peek() == '?':
            self.pop()
            yes = self.expression()
            self.pop(':')
            node = Expr('conditional', None, (node, yes, self.expression()))
        return replace(node, source_tokens=tuple(self.tokens[start:self.at]))

    def initializer(self):
        if self.peek() != '{':
            return self.expression()
        self.pop('{')
        entries = []
        while self.peek() != '}':
            designator = None
            if self.peek() == '[':
                self.pop()
                designator = ('index', self.expression())
                self.pop(']')
                self.pop('=')
            elif self.peek() == '.':
                self.pop()
                field = self.pop()
                if not _IDENTIFIER.fullmatch(field):
                    raise CSourceError('Invalid field designator')
                designator = ('field', field)
                self.pop('=')
            entries.append((designator, self.initializer()))
            if self.peek() != ',':
                break
            self.pop(',')
        self.pop('}')
        return Initializer(tuple(entries))


def expression(text: str) -> Expr:
    parser = _Parser(tokens(text))
    result = parser.expression()
    if parser.peek() is not None:
        raise CSourceError(f'Unsupported trailing expression token {parser.peek()!r}')
    return result


def parse_table(text: str, name: str) -> Initializer | Expr:
    source = tokens(text, outside_initializer=True)
    found = []
    for at, token in enumerate(source):
        if token != name:
            continue
        next_at = at + 1
        while next_at < len(source) and source[next_at] == '[':
            depth = 1
            next_at += 1
            while next_at < len(source) and depth:
                depth += (source[next_at] == '[') - (source[next_at] == ']')
                next_at += 1
        if next_at < len(source) and source[next_at] == '=':
            parser = _Parser(source[next_at + 1:])
            result = parser.initializer()
            parser.pop(';')
            found.append(result)
    if len(found) != 1:
        raise CSourceError(f'Expected exactly one initialized table {name}, found {len(found)}')
    return found[0]


def _mapping(initializer: Initializer, kind: str) -> dict:
    if not isinstance(initializer, Initializer):
        raise CSourceError('Expected brace initializer')
    result = {}
    for designator, value in initializer.entries:
        if not designator or designator[0] != kind:
            raise CSourceError(f'Expected {kind} designator')
        key = symbol(designator[1]) if kind == 'index' else designator[1]
        if key in result:
            raise CSourceError(f'Duplicate initializer designator {key}')
        result[key] = value
    return result


def designated(initializer: Initializer) -> dict:
    return _mapping(initializer, 'index')


def fields(initializer: Initializer) -> dict:
    return _mapping(initializer, 'field')


def values(initializer: Initializer) -> list:
    if not isinstance(initializer, Initializer) or any(key is not None for key, _ in initializer.entries):
        raise CSourceError('Expected positional brace initializer')
    return [value for _, value in initializer.entries]


def symbol(value: Expr | str) -> str:
    value = expression(value) if isinstance(value, str) else value
    if not isinstance(value, Expr) or value.kind != 'symbol':
        raise CSourceError(f'Expected source identifier, got {value!r}')
    return str(value.value)


def _decode_string(token: str) -> str:
    escapes = {'n': '\n', 'r': '\r', 't': '\t', '\\': '\\', '"': '"', "'": "'", '0': '\0'}
    def decode(match):
        if match[1] not in escapes:
            raise CSourceError(f'Unsupported C string escape \\{match[1]}')
        return escapes[match[1]]
    return re.sub(r'\\(.)', decode, token[1:-1])


def string(value: Expr) -> str:
    if isinstance(value, Expr) and value.kind == 'call' and value.value in ('_', '__') and len(value.args) == 1:
        return string(value.args[0])
    if not isinstance(value, Expr) or value.kind != 'string':
        raise CSourceError('Expected literal source string')
    return str(value.value)


class CSource:
    def __init__(self, defines=None):
        self.defines = {key: str(value) for key, value in (defines or {}).items()}
        self.macros = {}
        self.enums = {}
        self.includes = []

    def _define(self, line: str):
        match = re.match(r'([A-Za-z_][A-Za-z_0-9]*)(.*)\Z', line.strip())
        if not match:
            raise CSourceError(f'Unsupported #define {line!r}')
        name, tail = match.groups()
        parameters = None
        if tail.startswith('('):
            close = tail.find(')')
            if close < 0:
                raise CSourceError(f'Unclosed macro parameter list {name}')
            parameters, body = tail[:close + 1], tail[close + 1:].strip()
        else:
            body = tail.strip()
        if parameters is not None:
            args = tuple(part.strip() for part in parameters[1:-1].split(',')) if parameters != '()' else ()
            # Unused macros may contain unsupported C constructs. They are
            # retained verbatim and fail only if required by an export.
            if name in self.macros and self.macros[name] != (args, body):
                raise CSourceError(f'Conflicting macro definition {name}')
            self.macros[name] = (args, body)
        else:
            if name in self.defines and self.defines[name] != body:
                raise CSourceError(f'Conflicting constant definition {name}')
            self.defines[name] = body

    def load_definitions(self, text: str, names: set[str]):
        """Load explicitly named, unconditional definitions from a broad header.

        This avoids inventing compiler defines merely to process global.h.
        Requested definitions nested in any conditional fail; caller must load
        the complete header with its real profile instead in that case.
        """
        text = re.sub(r'\\\r?\n', '', _without_comments(text))
        depth = 0
        found = set()
        for line in text.splitlines():
            directive = re.match(r'\s*#\s*(\w+)\s*(.*)', line)
            if not directive:
                continue
            kind, tail = directive.groups()
            if kind in ('if', 'ifdef', 'ifndef'):
                # The file's outer include guard does not select a variant.
                if kind == 'ifndef' and tail.startswith('GUARD_') and depth == 0:
                    continue
                depth += 1
            elif kind == 'endif':
                depth = max(0, depth - 1)
            elif kind == 'define':
                name = re.match(r'\w+', tail)[0]
                if name in names:
                    if depth or name in found:
                        raise CSourceError(f'Conditional or duplicate required definition {name}')
                    self._define(tail)
                    found.add(name)
        if found != names:
            raise CSourceError(f'Missing required definitions {sorted(names - found)}')

    def load(self, text: str) -> str:
        text = re.sub(r'\\\r?\n', '', _without_comments(text))
        active = True
        stack = []
        output = []
        for line in text.splitlines():
            directive = re.match(r'\s*#\s*(\w+)\s*(.*)', line)
            if not directive:
                if active:
                    output.append(line)
                continue
            kind, tail = directive.groups()
            if kind in ('if', 'ifdef', 'ifndef'):
                condition = False
                if active:
                    if kind == 'if':
                        condition = bool(self.integer(tail))
                    else:
                        if not _IDENTIFIER.fullmatch(tail.strip()):
                            raise CSourceError('Invalid conditional identifier')
                        condition = tail.strip() in self.defines or tail.strip() in self.macros
                        if kind == 'ifndef':
                            condition = not condition
                stack.append([active, condition, False])
                active = active and condition
            elif kind == 'elif':
                if not stack or stack[-1][2]:
                    raise CSourceError('Unexpected #elif')
                parent, taken, _ = stack[-1]
                active = parent and not taken and bool(self.integer(tail))
                stack[-1][1] = taken or active
            elif kind == 'else':
                if not stack or stack[-1][2] or tail.strip():
                    raise CSourceError('Unexpected #else')
                parent, taken, _ = stack[-1]
                active = parent and not taken
                stack[-1][1:] = [True, True]
            elif kind == 'endif':
                if not stack or tail.strip():
                    raise CSourceError('Unexpected #endif')
                active = stack.pop()[0]
            elif active and kind == 'define':
                self._define(tail)
            elif active and kind == 'undef':
                self.defines.pop(tail.strip(), None)
                self.macros.pop(tail.strip(), None)
            elif active and kind == 'include':
                self.includes.append(tail.strip())
            elif active:
                raise CSourceError(f'Unsupported active preprocessor directive #{kind}')
        if stack:
            raise CSourceError('Unclosed preprocessor conditional')
        result = '\n'.join(output)
        self._load_enums(result)
        return result

    def _load_enums(self, text: str):
        source = tokens(text)
        for at, token in enumerate(source):
            if token != 'enum':
                continue
            parser = _Parser(source[at + 1:])
            if parser.peek() and _IDENTIFIER.fullmatch(parser.peek()):
                parser.pop()
            if parser.peek() != '{':
                continue
            parser.pop('{')
            previous = -1
            while parser.peek() != '}':
                name = parser.pop()
                if not _IDENTIFIER.fullmatch(name) or name in self.enums or name in self.defines:
                    raise CSourceError(f'Invalid or duplicate enum identifier {name}')
                if parser.peek() == '=':
                    parser.pop()
                    previous = self.integer(parser.expression())
                else:
                    previous += 1
                self.enums[name] = previous
                if parser.peek() != ',':
                    break
                parser.pop(',')
            parser.pop('}')

    def _expand(self, source: tuple | list, resolving=()) -> list[str]:
        """Token substitution before parsing preserves C macro precedence."""
        result = []
        at = 0
        while at < len(source):
            name = source[at]
            at += 1
            if name == 'defined':
                if at < len(source) and source[at] == '(':
                    if at + 2 >= len(source) or not _IDENTIFIER.fullmatch(source[at + 1]) or source[at + 2] != ')':
                        raise CSourceError('defined requires one identifier')
                    result.extend(('defined', '(', source[at + 1], ')'))
                    at += 3
                elif at < len(source) and _IDENTIFIER.fullmatch(source[at]):
                    result.extend(('defined', '(', source[at], ')'))
                    at += 1
                else:
                    raise CSourceError('defined requires one identifier')
                continue
            if name in self.defines:
                if name in resolving:
                    raise CSourceError(f'Recursive source constant {name}')
                if not self.defines[name]:
                    raise CSourceError(f'Empty required source constant {name}')
                result.extend(self._expand(tokens(self.defines[name]), (*resolving, name)))
            elif name in self.macros and at < len(source) and source[at] == '(':
                if name in resolving:
                    raise CSourceError(f'Recursive source macro {name}')
                parameters, body = self.macros[name]
                if any(not _IDENTIFIER.fullmatch(p) for p in parameters):
                    raise CSourceError(f'Unsupported macro arguments {name}')
                at += 1
                arguments = [[]]
                depth = 1
                while at < len(source) and depth:
                    token = source[at]
                    at += 1
                    if token == '(':
                        depth += 1
                    elif token == ')':
                        depth -= 1
                    if token == ',' and depth == 1:
                        arguments.append([])
                    elif depth:
                        arguments[-1].append(token)
                if depth:
                    raise CSourceError(f'Unclosed macro call {name}')
                if arguments == [[]] and not parameters:
                    arguments = []
                if len(arguments) != len(parameters) or any(not argument for argument in arguments):
                    raise CSourceError(f'Unsupported macro arguments {name}')
                replacements = {key: self._expand(argument, resolving) for key, argument in zip(parameters, arguments)}
                replacement = []
                for token in tokens(body):
                    replacement.extend(replacements[token] if token in replacements else (token,))
                result.extend(self._expand(replacement, (*resolving, name)))
            else:
                result.append(name)
        return result

    def _number(self, node: Expr, local: dict, resolving: tuple):
        if not isinstance(node, Expr):
            raise CSourceError('Expected scalar numeric expression')
        if node.kind == 'number':
            return node.value
        if node.kind == 'symbol':
            name = str(node.value)
            if name in local:
                return local[name]
            if name in self.enums:
                return self.enums[name]
            raise CSourceError(f'Unresolved source constant {name}')
        if node.kind == 'call':
            name = str(node.value)
            if name == 'defined':
                if len(node.args) != 1:
                    raise CSourceError('defined requires one identifier')
                identifier = symbol(node.args[0])
                return int(identifier in self.defines or identifier in self.macros)
            # Function-like aliases created across an expansion boundary,
            # token pasting, stringification and arbitrary function calls are
            # outside this grammar. Never reinterpret them as functions.
            raise CSourceError(f'Unresolved or unsupported source macro {name}')
        if node.kind == 'conditional':
            condition = self._number(node.args[0], local, resolving)
            return self._number(node.args[1 if condition else 2], local, resolving)
        if node.kind not in ('unary', 'binary'):
            raise CSourceError(f'Unsupported numeric expression {node.kind}')
        left = self._number(node.args[0], local, resolving)
        if node.kind == 'unary':
            if node.value == '+':
                return left
            if node.value == '-':
                return -left
            if node.value == '!':
                return int(not left)
            if node.value == '~' and isinstance(left, int):
                return ~left
            raise CSourceError('Bitwise operation requires integers')
        if node.kind != 'binary':
            raise CSourceError(f'Unsupported numeric expression {node.kind}')
        if node.value == '&&' and not left:
            return 0
        if node.value == '||' and left:
            return 1
        right = self._number(node.args[1], local, resolving)
        operator = node.value
        if operator == '+':
            return left + right
        if operator == '-':
            return left - right
        if operator == '*':
            return left * right
        if operator in ('/', '%'):
            if right == 0:
                raise CSourceError('Division by zero in source expression')
            if operator == '/' and (isinstance(left, Fraction) or isinstance(right, Fraction)):
                return Fraction(left) / right
            if not isinstance(left, int) or not isinstance(right, int):
                raise CSourceError('Remainder operation requires integers')
            quotient = abs(left) // abs(right) * (-1 if (left < 0) != (right < 0) else 1)
            return quotient if operator == '/' else left - quotient * right
        if operator in ('<<', '>>', '&', '|', '^'):
            if not isinstance(left, int) or not isinstance(right, int):
                raise CSourceError('Bitwise operation requires integers')
            if operator in ('<<', '>>') and not 0 <= right <= 63:
                raise CSourceError('Unsupported source shift count')
            return {'<<': lambda: left << right, '>>': lambda: left >> right,
                    '&': lambda: left & right, '|': lambda: left | right, '^': lambda: left ^ right}[operator]()
        comparisons = {'<': left < right, '>': left > right, '<=': left <= right,
                       '>=': left >= right, '==': left == right, '!=': left != right,
                       '&&': bool(left) and bool(right), '||': bool(left) or bool(right)}
        if operator in comparisons:
            return int(comparisons[operator])
        raise CSourceError(f'Unsupported numeric operator {operator}')

    def integer(self, value: Expr | str, truncate=False) -> int:
        original = tokens(value) if isinstance(value, str) else value.source_tokens if isinstance(value, Expr) else ()
        if not original:
            raise CSourceError('Numeric expression lacks original source tokens')
        node = expression(' '.join(self._expand(original)))
        number = self._number(node, {}, ())
        if isinstance(number, Fraction) and number.denominator != 1 and not truncate:
            raise CSourceError('Fractional source value needs explicit integer conversion')
        return int(number)

    def resolve(self, name: str) -> int:
        return self.integer(expression(name))

    def reference(self, value: Expr | str) -> dict:
        name = symbol(value)
        return {'id': self.resolve(name), 'symbol': name}
