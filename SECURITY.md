# Security policy

## Supported versions

Only the latest release of Custom Views receives security fixes. Update through **Settings → Community plugins** before reporting, and say which version you tested.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/anupchavan/obsidian-custom-views/security/advisories/new). Do not open a public issue, discussion or pull request for an unfixed vulnerability.

A useful report includes:

- the Custom Views and Obsidian versions, and your platform (desktop or mobile, and OS)
- the smallest view template, CSS, JavaScript or note that reproduces the problem
- whether **Allow JavaScript** was on or off
- what an attacker controls, and what they gain

You will get an acknowledgement within 7 days. Fixes ship in a new release, and the advisory is published once that release is available. Reporters are credited in the advisory unless they ask not to be.

## Trust model

Custom Views renders HTML, CSS and optional JavaScript that you write in a view's template. Whether something is a vulnerability depends on where the input comes from.

**Templates are trusted.** The person who writes a view's HTML, CSS and JavaScript is treated like the author of any other Obsidian plugin code. Template JavaScript runs inside Obsidian with full access to the `app` object, the vault and the network, and **Allow JavaScript** is on by default. A template that reads files, changes notes or makes network requests is working as designed, not a vulnerability. Only use templates and views from people you trust, as you would plugins.

**Note contents are not trusted.** Notes often come from somewhere else: shared vaults, synced folders, web clippings or imported files. Nothing inside a note should be able to run code or escape the template that displays it. That covers frontmatter values, the note body, linked notes and Bases results. Values inserted through `{{ }}` placeholders are HTML-escaped for this reason.

### In scope

- Note contents that run JavaScript, inject HTML or attributes into a view, or break out of escaping, whatever the **Allow JavaScript** setting
- Template JavaScript running while **Allow JavaScript** is off
- A view's scoped CSS or script leaking into other views, notes or Obsidian's interface in a way that lets note contents take control of it
- A filter, expression or rule that a crafted note can use to read files or settings the template did not ask for
- Problems in the released `main.js`, `manifest.json` or `styles.css`

### Out of scope

- Template JavaScript doing what it was written to do
- Someone who can already edit your vault's `.obsidian` folder, where views are stored, changing your views. They can already install plugins.
- Vulnerabilities in Obsidian itself. Report those to [Obsidian](https://obsidian.md/security).
- Advisories for development dependencies (test, lint and build tools) that do not reach the released files. Dependabot tracks these and they are fixed as routine maintenance.

## Verifying a release

Every release is built by GitHub Actions from its tag and published with [build provenance attestations](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations). To check that a downloaded file came from this repository's workflow:

```bash
gh attestation verify main.js --repo anupchavan/obsidian-custom-views
```

## For contributors

Changes are reviewed against the trust model above. In particular:

- **Escape note data by default.** Values from notes reach the page through the existing escaping in `src/renderer.ts`. Do not add a path that inserts note data with `innerHTML`, `insertAdjacentHTML` or unescaped attributes.
- **Keep code execution behind Allow JavaScript.** `src/script-engine.ts` is the only place template JavaScript runs, and only after the renderer checks the setting. Do not add other uses of `eval`, `new Function` or script element injection.
- **No network access in plugin code.** Custom Views makes no network requests of its own. Templates may, because they are trusted.
- **Keep runtime dependencies few.** Every package in `dependencies` ships inside `main.js`. Prefer existing code or Obsidian's API over a new package, and explain any new runtime dependency in the pull request.
- **Run `npm audit` before opening a pull request** that changes `package.json` or `package-lock.json`.
- **Never commit secrets or personal vault data.** `data.json` holds your local views and settings and must stay out of commits.

If you are unsure whether a change affects security, say so in the pull request and it will get a closer look.
