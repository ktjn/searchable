# RAG over WebLLM

Also deployed live as part of the [feature gallery](../../showcase/build-gallery-rag-webllm.ts)
(the "RAG over WebLLM" card on the gallery hub) -- this directory is both that demo's
source and a standalone example you can build and run on its own.

A fully client-side retrieval-augmented generation example built on this repo's own
pieces:

- **Retrieval** — [`@ktjn/searchable`](../../packages/searchable), running entirely
  offline against a static index built with the [Python indexer](../../python/searchable)
  over 1,422 chunked passages from
  [tiny-shakespeare](https://github.com/karpathy/char-rnn/blob/master/data/tinyshakespeare/input.txt)
  (public domain, 1.1MB, concatenated Shakespeare dialogue; no per-play/scene
  attribution in the source file).
- **Generation** — [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm), which runs a
  small LLM entirely inside the browser tab via WebGPU. No server, no API key, nothing
  leaves the machine at query time -- the same "static, no query-time backend"
  premise as the rest of this project, extended one step further to the generation
  side.

## Building and running it

```sh
./build.sh          # builds @ktjn/searchable and the search index (both gitignored)
cd . && npx serve .  # or: python3 -m http.server 8000
```

Open the printed URL in **a recent desktop Chrome or Edge** (WebGPU support --
Firefox and Safari don't reliably support it yet). Pick a model, click **Load model**
(this downloads the model weights from Hugging Face the first time -- a few hundred MB
to a few GB depending on which one you pick -- and caches them in the browser for next
time), then chat. Each turn retrieves fresh passages for that question, then asks the
model to answer using only those passages, citing them as `[1]`, `[2]`, etc. Prior
turns stay in the conversation (and feed retrieval for follow-ups -- see below), so you
can ask something like:

1. "What does Romeo say about dreams?"
2. "What about love?"
3. "Who else talks about that?"

and have the thread hold together, instead of each question starting from a blank
page. Click **New chat** to drop the conversation and start over.

### How multi-turn retrieval and context work

- **Retrieval is per-turn, not cached.** Every question (not just the first) runs a
  fresh `client.search()`; nothing from an earlier turn's passages is reused. To keep
  a short follow-up like "what about him?" from retrieving on three near-empty words,
  the query sent to `search()` combines the current question with the user's last two
  prior questions (not the assistant's answers) -- see `buildRetrievalQuery()`.
- **The model sees two kinds of history.** Prior conversation turns are carried
  forward as plain `{role, content}` messages (no passages attached). The *current*
  turn's user message is built fresh each time as its retrieved passages followed by
  the question -- see the system prompt in `index.html`, which tells the model
  passages aren't repeated across turns so it should answer from the current turn's
  passages, not go hunting in earlier ones.
- **History is bounded, not just the model's own context limit.** The smallest
  offered model (SmolLM2-135M) has a tiny context window, so prior turns are kept to
  the last `MAX_HISTORY_TURNS` (6) exchanges, and trimmed further (two turns at a
  time, to keep user/assistant pairing intact) if their combined length exceeds
  `HISTORY_CHAR_BUDGET` (4000 characters). This is a conservative heuristic, not a
  real tokenizer-based budget -- there's no tokenizer available client-side for every
  offered model, and the point is only to avoid a visibly broken response on the
  smallest model, not to maximize how much history larger ones could technically fit.
- **No passages found doesn't stop the turn.** Unlike a single-shot "no passages,
  give up" response, the model still generates a reply when retrieval comes up empty
  (told plainly that nothing matched), so conversational turns like "thanks!" don't
  dead-end the chat.

The source corpus is [tiny-shakespeare](https://github.com/karpathy/char-rnn/blob/master/data/tinyshakespeare/input.txt),
a specific selection of plays (Romeo and Juliet, Coriolanus, the Henry VI/Richard
III history plays, The Tempest, The Winter's Tale, and others) -- it does **not**
include Hamlet, Macbeth, Lear, or Othello, so a question naming one of those will
legitimately return nothing. Ask about a character or play that's actually in the
corpus, or check `content/tinyshakespeare.txt` for a `^NAME:` speaker tag first.

## What's in here

- `index.html` -- the whole app (retrieval + generation + UI), one file. Chat state
  (the conversation array, retrieval, and history trimming) all lives in its one
  `<script type="module">`.
- `content/tinyshakespeare.txt` -- the source corpus, committed as source content
  (small, public domain, and keeps the example buildable offline).
- `build_corpus.py` -- chunks the corpus and builds the index with
  `build_index_documents()` (pre-extracted documents, not the HTML-parsing path --
  these are synthetic chunks, not real pages). Each chunk is indexed on
  `title`/`body` and carries its full text back on `chunkText` via a stored (not
  just indexed) field, so retrieval can hand the model complete passages, not just
  titles.
- `build.sh` -- builds `@ktjn/searchable` and runs `build_corpus.py`.
  `searchable.js`, `search-index/`, and `chunks.json` are generated by this script
  and gitignored, not committed.

## Verification notes

Retrieval was verified end-to-end through a real browser loading the real built
`@ktjn/searchable` bundle against the real built index: queries like "dreams", "crown
king", "murder", and "love" each return dozens of genuinely relevant passages with
correct titles, speakers, and full text. Full natural-language questions (the kind the
UI is actually asked) are searched with `operator: "or"` -- the client's default
`operator: "and"` requires every query term to appear in the same chunk, which a
realistic question almost never satisfies, so a question like "What does Romeo say
about dreams?" returned zero hits until this was set explicitly. The page loads
without console errors, and
the WebGPU-adapter check actually calls `requestAdapter()` rather than just checking
whether the API object exists -- Chromium can expose `navigator.gpu` as a JS API
surface with no usable adapter behind it (headless/virtualized environments, or
blocklisted drivers), so a presence check alone gives a false positive and the
load button would otherwise sit enabled over a load that silently never completes.

Actually downloading a model and generating an answer needs a real GPU and normal
outbound network access to Hugging Face and WebLLM's CDN -- neither of which a
sandboxed CI-style environment necessarily has, so that part needs a real browser on
a real machine to exercise.

## Pointing it at different content

Rebuild the index over different content: replace `content/tinyshakespeare.txt` (or
edit `build_corpus.py` to read something else) and rerun `build.sh`. The
`index.html` retrieval code only assumes `title`, `chunkText`, and `speakers`
stored fields -- adjust the three places it reads `hit.fields.*` if you index
different ones. See [docs/guides/facets.md](../../docs/guides/facets.md) for the
indexer's field-definition API.
