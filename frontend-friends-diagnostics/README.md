# Frontend Friends Diagnostics

Diagnose the HTML and interpolations of dynamic fragments built with [Frontend Friends](https://github.com/applicvision/frontend-friends).

## Install

Add to your project as a dev dependency.

```console
$ npm install --save-dev @applicvision/frontend-friends-diagnostics
```

## Example

Let's say we have the following JavaScript file.

```js
import { html } from '@applicvision/frontend-friends'

const template = html`<div>
    <button onclick=${'click'}>
</div>`
```

Then we run the diagnostics:

```console
> npx diagnose-fragments
3 Errors in sample.js
  
  A function is expected as event handler
  
  4 | <button onclick=${'click'}>
              ^^^^^^^            
  
  Unclosed element '<button>'
  
  4 | <button onclick=${'click'}>
       ^^^^^^                    
  
  End tag '</div>' seen but there were open elements
  
  5 | </div>`
       ^^^^  

```


## CLI

The diagnostics package exposes a command called diagnose-fragments. Run it in your project directory:

```console
$ npx diagnose-fragments
```

Or add it to your package.json script section

```json
"scripts": {
    "diagnose": "diagnose-fragments"
}
```

By default, it will look for a `tsconfig.json` or `jsconfig.json` in the current directory. But a custom config file can be provided with the option `--config`, or `-c`.

```console
npx diagnose-fragments --config tsconfig.special.json
```

Unless otherwise specified the command will look for fragments to diagnose in the files of the project, as specified by the tsconfig. But it is possible to pass custom files:

```console
npx diagnose-fragments src/views/**.js
```

The tool will look up tagged templates with a tag function named `html`. It uses the wonderful library [html-validate](https://www.npmjs.com/package/html-validate) to diagnose the HTML parts of the templates. It also checks that the interpolations have valid values.

If no issues are found, the command prints no output and exits with code 0.

## NodeJS

There is also a small API to use the validation programmatically.

```js
import {diagnoseFile, getProgram} from '@applicvision/frontend-friends-diagnostics'

const tsProgram = getProgram()
const diagnostics = diagnoseFile(tsProgram, '/developer/project/file.ts')

console.log(diagnostics)
```

The diagnose function has the following signature:
```ts
function diagnoseFile(program: ts.Program, fileName: string): {
    range: Range;
    message: string;
    line: string;
    severity: 1 | 2 | 3 | 4;
}[]

type TextPosition = { line: number, character: number }
type Range = { start: TextPosition, end: TextPosition }
```


<div align="center">

<br><br>

*Have fun writing awesome web apps!*

<br>
<img src="https://raw.githubusercontent.com/applicvision/frontend-friends/refs/heads/main/docs/img/logo.svg" alt="drawing" width="200"/>
</div>
