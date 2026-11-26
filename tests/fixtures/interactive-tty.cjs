// Exercise Ink's interactive path with piped synthetic input and captured output.
// Ink's CI detection overrides TTY detection; simulate a local terminal throughout.
delete process.env.CI
delete process.env.CONTINUOUS_INTEGRATION
Object.defineProperty(process.stdin, 'isTTY', { value: true })
process.stdin.setRawMode = () => process.stdin
Object.defineProperty(process.stdout, 'isTTY', { value: true })
process.stdout.columns = 120
process.stdout.rows = 80
