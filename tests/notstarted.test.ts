/**
 * The page's own note for when the planner never starts (index.html). Right after a release a
 * browser may still hold the page from before it and ask for a script file that is gone: the page
 * then says to reload instead of staying blank. The note is plain HTML and CSS, since it is for
 * the very case where the script is missing, and the stylesheet with it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf-8');

describe("the page's note for a planner that hasn't started", () => {
  it('sits right after an empty #root, which is what shows it', () => {
    // #root:empty + #not-started: any content in #root, or anything between the two, would hide it for good
    expect(html).toMatch(/<div id="root"><\/div>\s*<div id="not-started">/);
    expect(html).toContain('#root:empty + #not-started');
  });

  it('is hidden unless that rule shows it, and waits before it does', () => {
    expect(html).toMatch(/#not-started \{\s*display: none;/);
    // invisible at first, shown by an animation that starts after a delay
    const rule = /#root:empty \+ #not-started \{([^}]*)\}/.exec(html)?.[1] ?? '';
    expect(rule).toMatch(/opacity: 0;/);
    // 10 seconds: a slow phone may need most of that for the script itself
    expect(rule).toMatch(/animation: not-started [\d.]+s linear 10s forwards;/);
    expect(html).toMatch(/@keyframes not-started \{\s*to \{\s*opacity: 1;/);
  });

  it('needs nothing the page may be missing: no script, no link, no file of the site', () => {
    const note = /<div id="not-started">([\s\S]*?)<\/div>\s*<script/.exec(html)?.[1] ?? '';
    expect(note).toContain("The planner hasn't started yet");
    expect(note).toContain('reload the page');
    expect(note).not.toMatch(/<a\b|<img\b|<script\b|href=|src=|url\(/);
    // its styles are in the page itself (the stylesheet is a file that may be gone with the script)
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    expect(style).toContain('#not-started');
    expect(style).not.toMatch(/url\(|@import/);
  });
});
