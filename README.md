# FX Vision

Free installable PWA. Live candles, then **two lines on the results image**:

1. **Simple** — BUY / SELL / WAIT in plain English  
2. **Technical** — structure, MAs, RSI, volume (higher high, inverse H&S, neckline, etc.)

Pattern marks stay on the candles. The two messages sit in the glass bar at the bottom so a screenshot still makes sense.

**Repo:** [github.com/successpartner10/fxvision](https://github.com/successpartner10/fxvision)  
**License:** MIT — free to use, copy, and ship.

## Run locally

```bash
python3 server.py
```

Open [http://localhost:8080](http://localhost:8080).

No API key. No signup. Market data is proxied from public Binance endpoints (`data-api.binance.vision`, then fallbacks).

## What it does

- Candlesticks, EMA 20 / EMA 50, volume, RSI 14
- Detects structure (HH/HL, LH/LL), inverse H&S / H&S, double top/bottom, EMA crosses, RSI divergence
- Writes both result lines onto the chart
- Save / share the results image
- Copy both lines as text for a post
- Installable (manifest + service worker)

## Pair and timeframe

Tap the pair to search (BTC, ETH, SOL, or any USDT symbol). Timeframes: 15m, 1H, 4H, 1D, 1W.

## Not financial advice

FX Vision is a read of the tape, not a broker and not a promise. Patterns can fail. Size your own risk.
