import { css, innerCSS } from '@applicvision/frontend-friends/declarative-element'

const shared = css`
	.shared { padding: 1rem }
`

export const styles = css`
	:host {
		display: block;
		colr: red;
	}
	.card {
		margin: 1px 2px 3px 4px 5px;
		color: ${innerCSS('red')};
		padding: var(--gap);
		> span { opacity: 2px }
		&:hover { color: green }
	}
	${shared}
	@font-face { font-family: Custom; foo: bar }
`
