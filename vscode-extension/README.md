# Frontend Friends

*Welcome to the Developer Tool for Frontend Friends!*

This extension brings rich language support for the [Frontend Friends](https://github.com/applicvision/frontend-friends) framework to Visual Studio Code. It provides a first-class developer experience when working with `html`, `svg`, and `css` tagged template literals in your JavaScript and TypeScript files.


## Features

The extension is designed to make you more productive and help you avoid common errors when using Frontend Friends.

### Syntax Highlighting
Enjoy full syntax highlighting for HTML, SVG, and CSS within your tagged template literals. The extension correctly highlights your markup and styles, making your code easier to read and navigate in your JavaScript and TypeScript files.

```javascript
import { html, css } from '@applicvision/frontend-friends'

const styles = css`
  .greeting {
    font-size: 1.5rem;
    color: dodgerblue;
  }
`

const template = html`
  <div class="greeting">
    Hello, Frontend Friends!
  </div>
`
```

### Rich IntelliSense
Get smart completions and helpful hover information inside your `html` and `css` templates, just like you would in a regular `.html` or `.css` file.

*   **Autocompletion:** Get suggestions for HTML tags, attributes, and CSS properties as you type.
*   **Hover Information:** Hover over tags and attributes to see documentation from MDN. This includes helpful information on special Frontend Friends attributes like `ff-share` and `ff-ref`.

### Advanced Diagnostics
The extension analyzes your `html` templates in real-time to catch errors before they make it to the browser.

*   **HTML Validation:** It validates your HTML structure, warning you about issues like unclosed tags or invalid attributes. This is powered by the excellent html-validate library.
*   **Frontend Friends-specific Rules:** It goes beyond standard HTML and checks for correct usage of Frontend Friends features:
    *   Ensures event handlers (e.g., `onclick`) are passed functions, not strings or other types.
    *   Validates the types used for attribute interpolations (e.g., strings, numbers, or booleans).
    *   Checks for correct usage of special attributes like `ff-share` and `ff-ref`.

## How It Works
This extension uses a combination of TextMate grammars for syntax highlighting and a powerful Language Server to provide advanced features. The server creates virtual documents from your tagged templates, allowing the built-in VS Code HTML and CSS language services to provide features like completion and hover. For diagnostics, it uses the `@applicvision/frontend-friends-diagnostics` package to perform  analysis of your code against the framework's rules.

## Contributing
This extension is open source and part of the Frontend Friends Dev Tools repository, which, in adition to the extension source code, also includes the source code for the diagnostics tool. We welcome contributions! If you find a bug or have a feature request, please open an issue on GitHub.
