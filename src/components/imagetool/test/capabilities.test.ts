import './setup'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const capabilities = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8')) as {
  permissions: string[]
}
const tool = readFileSync('src/components/imagetool/ImageTool.tsx', 'utf8')

describe('Tauri capabilities of the Image view', () => {
  it('allows the confirmation dialog shown before closing a modified image', () => {
    expect(tool).toContain('ask(')
    expect(capabilities.permissions).toContain('dialog:allow-ask')
  })

  it('lets the window close guard destroy the window', () => {
    expect(capabilities.permissions).toContain('core:window:allow-destroy')
  })
})
