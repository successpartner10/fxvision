import { formatPrice } from "./analyze.js";

function rsiBit(a) {
  if (a.lastRsi == null) return "";
  return `RSI ${a.lastRsi.toFixed(0)}`;
}

function maBit(a) {
  if (a.aboveEma20 && a.aboveEma50) return "Price holding above EMA 20 and EMA 50";
  if (a.aboveEma20 && !a.aboveEma50) return "Price above EMA 20 but still under EMA 50";
  if (!a.aboveEma20 && a.aboveEma50) return "Price lost EMA 20, still above EMA 50";
  return "Price trading under EMA 20 and EMA 50";
}

function volBit(a) {
  return a.volSpike ? " on a volume spike" : "";
}

function structureBit(a) {
  if (a.structure === "uptrend") return "Higher highs and higher lows";
  if (a.structure === "downtrend") return "Lower highs and lower lows";
  if (a.freshHH) return "Just printed a higher high";
  if (a.freshLL) return "Just printed a lower low";
  if (a.hh) return "Last swing is a higher high";
  if (a.ll) return "Last swing is a lower low";
  if (a.hl) return "Last swing is a higher low";
  if (a.lh) return "Last swing is a lower high";
  return "No clean trend yet — still a range";
}

export function buildMessages(a) {
  const inv = a.inverseHs;
  if (inv && inv.complete) {
    return {
      verdict: "BUY",
      simple: "Buyers already took control. The reversal happened — don’t wait for a perfect dip.",
      technical: `Inverse head and shoulders completed. Neckline ${formatPrice(inv.neckline)} broken${inv.higherHigh ? ", first higher high above the right shoulder" : ""}. ${maBit(a)}. ${rsiBit(a)}${volBit(a)} — momentum confirms the break, not just the shape.`,
    };
  }

  const hs = a.hs;
  if (hs && hs.complete) {
    return {
      verdict: "SELL",
      simple: "Sellers took the level. The top is done — don’t buy the bounce just because it looks cheap.",
      technical: `Head and shoulders completed. Neckline ${formatPrice(hs.neckline)} broken${hs.lowerLow ? ", first lower low under the right shoulder" : ""}. ${maBit(a)}. ${rsiBit(a)}${volBit(a)}.`,
    };
  }

  if (a.doubleBottom && a.doubleBottom.complete) {
    return {
      verdict: "BUY",
      simple: "The floor held twice and buyers pushed through. That’s a real turn, not a maybe.",
      technical: `Double bottom completed. Neckline ${formatPrice(a.doubleBottom.neckline)} broken. ${structureBit(a)}. ${maBit(a)}. ${rsiBit(a)}${volBit(a)}.`,
    };
  }

  if (a.doubleTop && a.doubleTop.complete) {
    return {
      verdict: "SELL",
      simple: "The ceiling held twice and price fell through. Don’t argue with a failed breakout.",
      technical: `Double top completed. Neckline ${formatPrice(a.doubleTop.neckline)} broken. ${structureBit(a)}. ${maBit(a)}. ${rsiBit(a)}${volBit(a)}.`,
    };
  }

  if (inv && !inv.complete) {
    return {
      verdict: "WAIT",
      simple: "A reversal is trying to form, but it hasn’t broken yet. Watch — don’t buy the idea.",
      technical: `Inverse head and shoulders still forming. Neckline ${formatPrice(inv.neckline)} has not broken. ${maBit(a)}. ${rsiBit(a)}. Wait for a close through the neckline.`,
    };
  }

  if (hs && !hs.complete) {
    return {
      verdict: "WAIT",
      simple: "A topping pattern is on the table, but sellers haven’t confirmed it. Don’t short the sketch.",
      technical: `Head and shoulders still forming. Neckline ${formatPrice(hs.neckline)} intact. ${maBit(a)}. ${rsiBit(a)}. Wait for a close under the neckline.`,
    };
  }

  if (a.emaCross?.type === "golden" && a.aboveEma20) {
    return {
      verdict: "BUY",
      simple: "The short average just crossed back above the long one. Buyers are taking the tape.",
      technical: `EMA 20 crossed above EMA 50. ${structureBit(a)}. ${maBit(a)}. ${rsiBit(a)}${volBit(a)}.`,
    };
  }

  if (a.emaCross?.type === "death" && !a.aboveEma20) {
    return {
      verdict: "SELL",
      simple: "The short average rolled under the long one. Sellers own the tape until that flips.",
      technical: `EMA 20 crossed below EMA 50. ${structureBit(a)}. ${maBit(a)}. ${rsiBit(a)}${volBit(a)}.`,
    };
  }

  if (a.structure === "uptrend" && a.extendedUp && a.rsiOverbought) {
    return {
      verdict: "WAIT",
      simple: "Trend is still up, but it’s already run. Don’t chase — wait until it cools off.",
      technical: `${structureBit(a)}. Extended ${a.extension.toFixed(1)} ATR above EMA 20. ${rsiBit(a)} is stretched. ${maBit(a)}. No sell of the trend — just no buy up here.`,
    };
  }

  if (a.structure === "uptrend" && a.aboveEma20 && !a.rsiOverbought) {
    return {
      verdict: "BUY",
      simple: "Uptrend is intact and it isn’t blown out. Dips are for buying, not for panicking.",
      technical: `${structureBit(a)}. ${maBit(a)}. ${rsiBit(a)}${a.rsiRising ? ", rising" : ""}${volBit(a)}. ${a.freshHH ? "Fresh higher high on the last swing." : "Waiting for the next higher high, structure still bullish."}`,
    };
  }

  if (a.structure === "downtrend" && a.extendedDown && a.rsiOversold) {
    return {
      verdict: "WAIT",
      simple: "It’s washed out, but that is not a buy by itself. Wait for a higher low first.",
      technical: `${structureBit(a)}. Extended ${Math.abs(a.extension).toFixed(1)} ATR under EMA 20. ${rsiBit(a)} is oversold. ${maBit(a)}. Bounce risk is high — no long until structure turns.`,
    };
  }

  if (a.structure === "downtrend" && !a.aboveEma20) {
    return {
      verdict: "SELL",
      simple: "Sellers still have it. Rallies are for exiting, not for hoping.",
      technical: `${structureBit(a)}. ${maBit(a)}. ${rsiBit(a)}${volBit(a)}. ${a.freshLL ? "Fresh lower low on the last swing." : "Trend remains lower highs and lower lows."}`,
    };
  }

  if (a.divergence?.type === "bullish" && !a.aboveEma50) {
    return {
      verdict: "WAIT",
      simple: "Selling is getting tired, but buyers haven’t taken the tape yet. Wait for the turn to print.",
      technical: `Bullish RSI divergence vs the last two swing lows. ${structureBit(a)}. ${maBit(a)}. ${rsiBit(a)}. Need a higher low or a close back over EMA 20 to act.`,
    };
  }

  if (a.divergence?.type === "bearish" && a.aboveEma20) {
    return {
      verdict: "WAIT",
      simple: "The high is getting heavy. Don’t pile in just because it was going up.",
      technical: `Bearish RSI divergence vs the last two swing highs. ${structureBit(a)}. ${maBit(a)}. ${rsiBit(a)}. Momentum is not confirming the last push.`,
    };
  }

  if (a.freshHH && a.aboveEma20) {
    return {
      verdict: "BUY",
      simple: "It just made a new high and buyers kept it. That’s strength, not a reason to fade it.",
      technical: `${structureBit(a)}. ${maBit(a)}. ${rsiBit(a)}${volBit(a)}.`,
    };
  }

  if (a.freshLL && !a.aboveEma20) {
    return {
      verdict: "SELL",
      simple: "New low, no reclaim. Don’t buy it just because it’s down.",
      technical: `${structureBit(a)}. ${maBit(a)}. ${rsiBit(a)}${volBit(a)}.`,
    };
  }

  if (a.rsiOversold && a.aboveEma50) {
    return {
      verdict: "WAIT",
      simple: "It’s cheap against the last few bars, but wait for it to stop going down first.",
      technical: `${structureBit(a)}. ${rsiBit(a)} oversold. ${maBit(a)}. Look for a higher low against EMA 50 before buying.`,
    };
  }

  if (a.rsiOverbought && a.extendedUp) {
    return {
      verdict: "WAIT",
      simple: "It’s stretched. Let it come back before you do anything.",
      technical: `${structureBit(a)}. ${rsiBit(a)} overbought, ${a.extension.toFixed(1)} ATR above EMA 20. ${maBit(a)}.`,
    };
  }

  if (a.aboveEma20 && a.aboveEma50 && a.emaBull && a.hl) {
    return {
      verdict: "BUY",
      simple: "Buyers still have the higher-low structure. Stay with them until that breaks.",
      technical: `${structureBit(a)}. ${maBit(a)}. ${rsiBit(a)}${volBit(a)}.`,
    };
  }

  if (!a.aboveEma20 && !a.aboveEma50 && a.lh) {
    return {
      verdict: "SELL",
      simple: "Lower high under the averages. That’s a sell rally until it stops making them.",
      technical: `${structureBit(a)}. ${maBit(a)}. ${rsiBit(a)}${volBit(a)}.`,
    };
  }

  return {
    verdict: "WAIT",
    simple: "Nothing is finished. No clean buy, no clean sell — sit on your hands.",
    technical: `${structureBit(a)}. ${maBit(a)}. ${rsiBit(a)}. Need a higher high / lower low or a pattern trigger before this is more than a range.`,
  };
}

export function copyText(symbol, tf, messages, price) {
  return [
    `${symbol}  ${tf}  ${price}`,
    `${messages.verdict} — ${messages.simple}`,
    "",
    `Technical: ${messages.technical}`,
  ].join("\n");
}
