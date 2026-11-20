import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdown, parseInline, toggleTaskLine } from './markdown.js'

describe('markdown', () => {
  it('parses headings, code blocks, checklists, and inline styles safely', () => {
    const src = [
      '# GPU Passthrough',
      'Set **vfio** in `/etc/modules` and check [docs](https://pve.proxmox.com).',
      '- [ ] Backup VM',
      '- [x] Reboot host',
      '```bash',
      'update-initramfs -u',
      '```',
    ].join('\n')

    const blocks = parseMarkdown(src)
    assert.equal(blocks[0].type, 'heading')
    assert.equal(blocks[0].level, 1)
    assert.equal(blocks[1].type, 'p')
    assert.equal(blocks[2].type, 'ul')
    assert.equal(blocks[2].items[0].task, true)
    assert.equal(blocks[2].items[0].checked, false)
    assert.equal(blocks[2].items[1].checked, true)
    assert.equal(blocks[3].type, 'codeblock')
    assert.equal(blocks[3].code, 'update-initramfs -u')
  })

  it('rejects javascript: links as plain text', () => {
    const tokens = parseInline('[click](javascript:alert(1))')
    assert.ok(tokens.every((t) => t.type !== 'link'))
  })

  it('toggles task list lines in place', () => {
    const src = '- [ ] First\n- [x] Second'
    assert.equal(toggleTaskLine(src, 0), '- [x] First\n- [x] Second')
    assert.equal(toggleTaskLine(src, 1), '- [ ] First\n- [ ] Second')
  })
})
