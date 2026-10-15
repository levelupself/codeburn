// Exercise Ink's interactive path with piped synthetic input and captured output.
Object.defineProperty(process.stdin, 'isTTY', { value: true })
process.stdin.setRawMode = () => process.stdin
Object.defineProperty(process.stdout, 'isTTY', { value: true })
process.stdout.columns = 120
process.stdout.rows = 80
