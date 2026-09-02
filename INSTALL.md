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

Go to **[nodejs.org](https://nodejs.org)** and download the version marked **LTS**. Open the file
and click through the installer. Nothing to configure.

This project needs **Node 20 or newer**. Any current LTS is fine. If you are not sure what you
already have, step 4 will tell you.

### Step 2 — Download this project

If you were sent a `.zip`, unzip it somewhere you will not delete by accident — your Documents
folder is fine. If you use git: `git clone <the repository URL>`.

### Step 3 — Open a terminal in that folder

- **Mac** — the reliable way, on every version of macOS: open **Terminal** (⌘Space, type
  `Terminal`, Enter), type `cd ` with a space after it, then **drag the project folder from Finder
  into the Terminal window** and press Enter. That fills in the path for you.
  *(Some Macs also offer right-click → New Terminal at Folder in Finder. If you see it, use it.)*
- **Windows** — open the folder in File Explorer, click in the address bar so the path highlights,
  type `cmd` over it and press Enter.

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

The simplest check is just to ask. Claude Desktop shows connected tools near the message box —
the exact icon changes between versions, so rather than hunting for it, type this:

> *We are a telehealth company in Texas with one patient in New York. We had a data breach on
> 8 September and we notified HHS the same day. What are our deadlines?*

It should come back with **five business days to the New York Attorney General** and explain that
notifying HHS is what started that clock. If instead it answers from general knowledge without
citing § 899-aa(9), the server is not connected — see the table below.

---

## Option 2 — Use it from the terminal

If you are comfortable in a terminal, everything is available directly:

```
npm install
npm run doctor                                   # check the install works

node bin/privacy-kb.mjs ask --hipaa --ny-data --breach --told-hhs
node bin/privacy-kb.mjs deadlines --hipaa --ny-data --told-hhs --from 2026-09-08
node bin/privacy-kb.mjs coverage
node bin/privacy-kb.mjs cite ny.gbl.899_aa.9.hipaa_ag_notice
```

Run `node bin/privacy-kb.mjs` on its own for the full list of flags.

---

## When something goes wrong

**Run `npm run doctor` first.** It checks five things and tells you which one failed:

```
  ✓ Node.js v22.14.0        ← your version appears here; anything 20+ passes
  ✓ corpus loads — 248 records
  ✓ engine answers — 244 records visible
  ✓ as-of dating works
  ✓ malformed dates are refused
```

| What you see | What to do |
|---|---|
| `npm: command not found` | Node.js is not installed, or the terminal was open before you installed it. Close the terminal, open a new one, try again. |
| Claude answers but cites nothing | The server is not connected. Quit Claude Desktop **completely** — on a Mac ⌘Q, not just closing the window — and reopen. |
| Still not connected after restarting | Run `npm run setup` (no `--write`). It prints the config file path. Open that file and check the block is really there and the JSON is valid. |
| You use `nvm` or similar | `npm run setup -- --write` records the *absolute path* of the Node you ran it with. If you later switch Node versions, run it again. |
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
