# Getting this running

> **Research prototype, not legal advice, no warranty.** Everything it produces must be checked
> against the primary source by a qualified person. See the [README](README.md) and [LICENSE](LICENSE).

There are two ways to use this. **Most people want the first one.**

---

## Option 1 — Ask it questions in plain English (Claude Desktop)

You end up typing things like *"We're a HIPAA covered entity, we had a breach, we have one New
York patient, we notified HHS yesterday — what are our deadlines?"* and getting back cited
answers with dates.

### Step 1 — Install Node.js

Node is the program that runs this. It is free and takes about two minutes.

Go to **[nodejs.org](https://nodejs.org)** and download the button marked **LTS**. Open the file
and click through the installer. Nothing to configure.

### Step 2 — Download this project

If you were sent a `.zip`, unzip it somewhere you will not delete by accident — your Documents
folder is fine. If you use git: `git clone <the repository URL>`.

### Step 3 — Open a terminal in that folder

- **Mac** — open the folder in Finder, right-click it, choose **New Terminal at Folder**.
  (If you do not see that option: System Settings → Keyboard → Keyboard Shortcuts → Services →
  tick *New Terminal at Folder*.)
- **Windows** — open the folder, click the address bar, type `cmd` and press Enter.

You will get a window with a blinking cursor. That is normal.

### Step 4 — Type these two lines

Press Enter after each. The first takes a minute.

```
npm install
npm run setup -- --write
```

The second one finds Claude Desktop's settings file and adds this to it for you.

> **Prefer not to let it edit a file?** Run `npm run setup` without `-- --write`. It prints the
> exact text and tells you which file to paste it into.

### Step 5 — Restart Claude Desktop

**Quit it completely** — on a Mac, ⌘Q, not just closing the window — then open it again.

### Step 6 — Check it worked

In Claude Desktop, look for the tools icon (a small slider or hammer symbol) near the message box.
`privacy-kb` should be listed. Then ask it something:

> *We are a telehealth company in Texas with one patient in New York. We had a data breach on
> 2 September and we notified HHS the same day. What are our deadlines?*

It should come back with **five business days to the New York Attorney General**, and say why.

---

## Option 2 — Use it from the terminal

If you are comfortable in a terminal, everything is available directly:

```
npm install
npm run doctor                                   # check the install works

node bin/privacy-kb.mjs ask --hipaa --ny-data --breach --told-hhs
node bin/privacy-kb.mjs deadlines --hipaa --ny-data --told-hhs --from 2026-09-02
node bin/privacy-kb.mjs coverage
node bin/privacy-kb.mjs cite ny.gbl.899_aa.9.hipaa_ag_notice
```

Run `node bin/privacy-kb.mjs` on its own for the full list of flags.

---

## When something goes wrong

**Run `npm run doctor` first.** It checks five things and tells you which one failed:

```
  ✓ Node.js v20.11.0
  ✓ corpus loads — 248 records
  ✓ engine answers — 244 records visible
  ✓ as-of dating works
  ✓ malformed dates are refused
```

| What you see | What to do |
|---|---|
| `npm: command not found` | Node.js is not installed, or the terminal was open before you installed it. Close the terminal, open a new one, try again. |
| `privacy-kb` is missing from Claude Desktop | You did not quit Claude Desktop *completely*. On a Mac, ⌘Q. Reopening the window is not enough. |
| `Node.js v18` and a ✗ | Too old. Install the current LTS from nodejs.org. |
| Something else | The output of `npm run doctor` is the useful thing to send when asking for help. |

---

## What it will and will not do

**It answers as of a date.** There is no "current law" here — only law as of a date you give it.
Ask without one and it refuses rather than guessing.

**It says when it does not know.** If an instrument is only partly in the corpus, the answer names
the duty categories it cannot reach. That is deliberate: a confident answer over a gap is worse
than a smaller answer that admits the gap.

**It will not treat pending law as law.** The SAFE for Kids Act is enacted and does not bind
anyone until January 2027; it is reported separately and can never appear as a current obligation.

**It covers US federal privacy law and New York.** No other state. No GDPR. No case law.

**It is not a lawyer and neither is the assistant reading it to you.** Every answer carries the
citation, the source URL, the fetch date and a content hash so that a person can check it. Check it.
