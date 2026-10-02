# Changelog

## 0.2.0

- Token check: select a contract address and pick **Check this token**, or paste one into the panel.
- A fact card from the chain and DEX Screener: price, liquidity, 24h volume and trades, pool and age, owner, upgradeable, burned supply. Thin liquidity and young pools are marked.
- Orbz Opus reads the facts, streamed, with its cost. Facts only, no buy or sell calls. Follow-up questions still know the token.
- Uses the new `/v1/token/facts` (free) and `/v1/token/read` (paid like a reply) endpoints.

## 0.1.0

First release.

- Right-click on a selection: Ask Orbz about this, Explain, Summarize, Translate to English, Draft a reply.
- Right-click on a page: Summarize this page.
- Side panel chat with Orbz Opus, streamed, with tokens, cost and balance under every reply.
- Toolbar badge with the balance; the panel header shows which credit burns next.
- The key stays in extension storage; Disconnect removes it. A page is read only when asked.
