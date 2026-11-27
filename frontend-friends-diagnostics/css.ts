import * as csstree from 'css-tree'

const { tokenTypes } = csstree

export type CssProblem = {
	/** Offset in the validated source where the problem starts */
	start: number
	/** Offset in the validated source where the problem ends */
	end: number
	message: string
	/** Identifier of the kind of problem, e.g. 'unknown-property' */
	code: string
}

type OffsetRange = { start: number, end: number }

const AMPERSAND = 0x0026

/**
 * css-tree only recognises nested style rules when they start with `&`.
 * This replacement of the `Block` parser looks ahead to decide whether a statement
 * inside a style block is a nested rule (it reaches `{` before `;` or `}`) or a declaration,
 * so that `> span { }`, `.child & { }` and `div:hover { }` are parsed as rules.
 */
function parseBlock(this: any, isStyleBlock: boolean) {
	const start = this.tokenStart
	const children = this.createList()

	const consumeRaw = () => this.Raw(null, true)
	const consumeRule = () => this.parseWithFallback(this.Rule, consumeRaw)
	const consumeRawDeclaration = () => this.Raw(this.consumeUntilSemicolonIncluded, true)
	const consumeDeclaration = () => {
		if (this.tokenType === tokenTypes.Semicolon) {
			return consumeRawDeclaration()
		}
		const node = this.parseWithFallback(this.Declaration, consumeRawDeclaration)
		if (this.tokenType === tokenTypes.Semicolon) {
			this.next()
		}
		return node
	}

	const isNestedRule = () => {
		if (this.isDelim(AMPERSAND)) return true
		// Custom properties may contain curly brackets in their values
		if (this.tokenType === tokenTypes.Ident && this.cmpStr(this.tokenStart, this.tokenStart + 2, '--')) {
			return false
		}
		let index = this.tokenIndex
		while (index < this.tokenCount) {
			const type = this.getTokenType(index)
			switch (type) {
				case tokenTypes.LeftCurlyBracket:
					return true
				case tokenTypes.Semicolon:
				case tokenTypes.RightCurlyBracket:
				case tokenTypes.EOF:
					return false
				case tokenTypes.Function:
				case tokenTypes.LeftParenthesis:
				case tokenTypes.LeftSquareBracket: {
					const pair = this.getBlockTokenPairIndex(index)
					if (pair === -1) return false
					index = pair
				}
			}
			index++
		}
		return false
	}

	this.eat(tokenTypes.LeftCurlyBracket)

	scan:
	while (!this.eof) {
		switch (this.tokenType) {
			case tokenTypes.RightCurlyBracket:
				break scan
			case tokenTypes.WhiteSpace:
			case tokenTypes.Comment:
				this.next()
				break
			case tokenTypes.AtKeyword:
				children.push(this.parseWithFallback(this.Atrule.bind(this, isStyleBlock), consumeRaw))
				break
			default:
				if (!isStyleBlock) {
					children.push(consumeRule())
				} else if (isNestedRule()) {
					children.push(consumeRule())
				} else {
					children.push(consumeDeclaration())
				}
		}
	}

	if (!this.eof) {
		this.eat(tokenTypes.RightCurlyBracket)
	}

	return {
		type: 'Block',
		loc: this.getLocation(start, this.tokenStart),
		children
	}
}

const syntax = csstree.fork({
	node: {
		Block: { parse: parseBlock }
	}
})

/** Values using these functions are resolved at computed-value time, and can not be matched against the grammar. */
const substitutionFunction = /\b(var|env|attr|if|sibling-index|sibling-count)\(/i

const vendorPrefix = /^-(webkit|moz|ms|o)-/i

const firstLine = (message: string) => message.split('\n')[0]

function overlaps(a: OffsetRange, b: OffsetRange) {
	return a.start <= b.end && b.start <= a.end
}

/**
 * Validates a stylesheet.
 * @param source The CSS source
 * @param ignoredRanges Ranges (e.g. interpolations) where problems should not be reported
 */
export function validateCss(source: string, ignoredRanges: OffsetRange[] = []): CssProblem[] {
	const problems: CssProblem[] = []

	const isIgnored = (range: OffsetRange) => ignoredRanges.some(ignored => overlaps(ignored, range))

	const report = (problem: CssProblem) => {
		const isDuplicate = problems.some(({ start, end, message }) =>
			start == problem.start && end == problem.end && message == problem.message)
		if (!isIgnored(problem) && !isDuplicate) {
			problems.push(problem)
		}
	}

	// Statements which contain an interpolation can not be validated, since the interpolated value is unknown
	const containsInterpolation = (loc?: csstree.CssLocation | null) =>
		loc != null && isIgnored({ start: loc.start.offset, end: loc.end.offset })

	const ast = syntax.parse(source, {
		positions: true,
		// Selectors are validated separately, to support relative selectors in nested rules
		parseRulePrelude: false,
		onParseError(error) {
			report({
				start: error.offset,
				end: Math.min(error.offset + 1, source.length),
				message: error.message,
				code: 'syntax'
			})
		}
	})

	syntax.walk(ast, {
		enter(this: csstree.WalkContext, node: csstree.CssNode) {
			switch (node.type) {
				case 'Rule':
					if (node.prelude.type == 'Raw' && !containsInterpolation(node.prelude.loc)) {
						validateSelector(node.prelude, this.rule != null, report)
					}
					break
				case 'Atrule':
					if (!containsInterpolation(node.prelude?.loc)) {
						validateAtrule(node, report)
					}
					break
				case 'Declaration':
					if (!containsInterpolation(node.loc)) {
						validateDeclaration(node, this.atrule, report)
					}
					break
			}
		}
	})

	return problems.sort((a, b) => a.start - b.start)
}

function validateSelector(prelude: csstree.Raw, nested: boolean, report: (problem: CssProblem) => void) {
	const loc = prelude.loc
	if (!loc) return

	const text = prelude.value
	if (!text.trim()) {
		report({ start: loc.start.offset, end: Math.max(loc.end.offset, loc.start.offset + 1), message: 'Selector is expected', code: 'selector' })
		return
	}

	// Nested rules may start with a combinator (relative selector), e.g. `> span`.
	const relative = nested && /^\s*[>+~]/.test(text)
	const prefix = relative ? '&' : ''

	let parseError: csstree.SyntaxParseError | undefined
	syntax.parse(prefix + text, {
		context: 'selectorList',
		onParseError: error => { parseError ??= error }
	})
	if (parseError) {
		const start = loc.start.offset + Math.max(0, parseError.offset - prefix.length)
		report({ start, end: Math.min(start + 1, loc.end.offset), message: parseError.message, code: 'selector' })
	}
}

function validateAtrule(node: csstree.Atrule, report: (problem: CssProblem) => void) {
	const loc = node.loc
	if (!loc) return
	const name = node.name

	if (vendorPrefix.test(name)) return

	if (!syntax.lexer.getAtrule(name)) {
		report({
			start: loc.start.offset,
			end: loc.start.offset + name.length + 1,
			message: `Unknown at-rule '@${name}'`,
			code: 'unknown-at-rule'
		})
		return
	}

	if (node.prelude && node.prelude.type != 'Raw') {
		const { error } = syntax.lexer.matchAtrulePrelude(name, node.prelude)
		if (error) {
			const range = errorRange(error) ?? node.prelude.loc
			if (range) {
				report({
					start: range.start.offset,
					end: range.end.offset,
					message: `Invalid prelude for '@${name}': ${firstLine(error.message)}`,
					code: 'invalid-prelude'
				})
			}
		}
	}
}

function validateDeclaration(node: csstree.Declaration, atrule: csstree.Atrule | null, report: (problem: CssProblem) => void) {
	const loc = node.loc
	if (!loc) return

	const { property } = node

	// Custom properties can have any value
	if (property.startsWith('--')) return

	const nameRange = { start: loc.start.offset, end: loc.start.offset + property.length }

	// Declarations in at-rules like @font-face and @property are descriptors, not properties
	const atruleDefinition = atrule && syntax.lexer.getAtrule(atrule.name)
	const descriptors = atruleDefinition?.descriptors
	// Note: lexer.getAtruleDescriptor() throws in css-tree 3.2.1, so look up the descriptor directly
	const isDescriptor = !!descriptors && Object.hasOwn(descriptors, property.toLowerCase())

	if (descriptors && !isDescriptor && !syntax.lexer.getProperty(property)) {
		// Some at-rules, like @page, accept regular properties as well, so only report names which are neither
		report({ ...nameRange, message: `Unknown descriptor '${property}' in '@${atrule!.name}'`, code: 'unknown-descriptor' })
		return
	} else if (!isDescriptor && !syntax.lexer.getProperty(property)) {
		if (!vendorPrefix.test(property)) {
			report({ ...nameRange, message: `Unknown property '${property}'`, code: 'unknown-property' })
		}
		return
	}

	if (node.value.type == 'Raw') {
		if (!node.value.value.trim()) {
			report({ ...nameRange, message: `Missing value for '${property}'`, code: 'missing-value' })
		}
		// Values which could not be parsed can not be matched
		return
	}

	const valueText = syntax.generate(node.value)
	if (!valueText.trim()) {
		report({ ...nameRange, message: `Missing value for '${property}'`, code: 'missing-value' })
		return
	}
	if (substitutionFunction.test(valueText)) return

	const { error } = isDescriptor ?
		syntax.lexer.matchAtruleDescriptor(atrule!.name, property, node.value) :
		syntax.lexer.matchDeclaration(node)

	if (error) {
		const range = errorRange(error) ?? node.value.loc
		if (!range) return
		report({
			start: range.start.offset,
			end: Math.max(range.end.offset, range.start.offset + 1),
			message: `Invalid value for '${property}': '${valueText}'`,
			code: 'invalid-value'
		})
	}
}

function errorRange(error: Error): csstree.CssLocation | undefined {
	const loc = (error as { loc?: csstree.CssLocation }).loc
	if (loc?.start && loc.end && loc.end.offset > loc.start.offset) {
		return loc
	}
}
