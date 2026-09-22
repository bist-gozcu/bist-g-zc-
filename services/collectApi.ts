// Dosya: services/collectApi.ts

import { logger } from "@/utils/logger";

import { UNIQUE_BIST_STOCKS } from "@/constants/bistStocks";
import {
  classifyDataFreshness,
  DataFreshness,
  getFreshnessWarning,
  parseMarketTimestamp,
  fetchBatchQuotes,
} from "@/utils/yahooFinance";
import {
  fetchTwelveDataQuotes,
  isTwelveDataEnabled,
} from "@/utils/twelveData";

export type Hisse = {
  sembol: string;
  fiyat: number;
  degisimYuzde: number;
  hacim: number;
  /** Yahoo Finance üç aylık ortalama hacmi; bazı veri kaynaklarında bulunmayabilir. */
  ortalamaHacim?: number;
  /** Kaynağın fiyatı son güncellediği Unix zamanı; yoksa null. */
  piyasaZamani: number | null;
  /** Quote’un uygulama tarafından alındığı Unix zamanı. */
  veriCekilmeZamani: number;
  /** Veri tazeliği sınıfı. */
  veriKalitesi: DataFreshness;
  /** Veri kaynağının kullanıcıya gösterilecek adı. */
  veriKaynagi: string;
  /** Risk bandında gösterilecek uyarı. */
  veriUyarisi: string | null;
};

export type TemelVeri = {
  fk: number | null;
  pddd: number | null;
};

type QuoteRecord = {
  symbol?: unknown;
  regularMarketPrice?: unknown;
  regularMarketChangePercent?: unknown;
  regularMarketVolume?: unknown;
  averageDailyVolume3Month?: unknown;
  regularMarketTime?: unknown;
  exchangeDataDelayedBy?: unknown;
  marketState?: unknown;
  fetchedAt?: unknown;
  marketTimestamp?: unknown;
  delayedBySeconds?: unknown;
  freshness?: unknown;
  dataSource?: unknown;
};

type QuoteResponse = {
  quoteResponse?: {
    result?: QuoteRecord[];
  };
};

/**
 * API proxy adresini EXPO_PUBLIC_DOMAIN ortam değişkeninden alır.
 * Varsayılan: bist-gozcu--careki73.replit.app
 * .env dosyası ile değiştirilebilir.
 */
const DEFAULT_API_DOMAIN = "bist-gozcu--careki73.replit.app";

const getApiBase = (): string => {
  const configuredDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  const domain = configuredDomain || DEFAULT_API_DOMAIN;
  return `https://${domain}/api`;
};

export const parseTRNumber = (
  value: string | number | undefined | null,
): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;

  const normalized = value
    .trim()
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");

  if (!normalized) return 0;

  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  let canonical = normalized;

  if (lastComma > lastDot) {
    canonical = normalized.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    canonical = normalized.replace(/,/g, "");
  }

  const parsed = Number(canonical);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeQuote = (quote: QuoteRecord): Hisse => {
  const veriCekilmeZamani =
    parseTRNumber(quote.fetchedAt as string | number | null | undefined) ||
    Date.now();
  const piyasaZamani = parseMarketTimestamp(
    quote.marketTimestamp ?? quote.regularMarketTime,
  );
  const rawFreshness =
    typeof quote.freshness === "string" ? quote.freshness : null;
  const veriKalitesi: DataFreshness =
    rawFreshness === "fresh" ||
    rawFreshness === "slightly_delayed" ||
    rawFreshness === "stale" ||
    rawFreshness === "unknown" ||
    rawFreshness === "closed_reference"
      ? rawFreshness
      : classifyDataFreshness(piyasaZamani, veriCekilmeZamani);
  const veriKaynagi =
    typeof quote.dataSource === "string" && quote.dataSource.length > 0
      ? quote.dataSource
      : "BIST Gözcü quote kaynağı";
  return {
    sembol: String(quote.symbol ?? "")
      .replace(".IS", "")
      .toUpperCase(),
    fiyat: parseTRNumber(
      quote.regularMarketPrice as string | number | null | undefined,
    ),
    degisimYuzde: parseTRNumber(
      quote.regularMarketChangePercent as string | number | null | undefined,
    ),
    hacim: parseTRNumber(
      quote.regularMarketVolume as string | number | null | undefined,
    ),
    ortalamaHacim: parseTRNumber(
      quote.averageDailyVolume3Month as string | number | null | undefined,
    ),
    piyasaZamani,
    veriCekilmeZamani,
    veriKalitesi,
    veriKaynagi,
    veriUyarisi: getFreshnessWarning(veriKalitesi),
  };
};

const validQuotes = (quotes: Hisse[]): Hisse[] =>
  quotes.filter((quote) => quote.sembol.length > 0 && quote.fiyat > 0);

// BIST günlük fiyat marjı ±%10'dur. Küçük toleransla %11'i aşan bir "günlük
// değişim", genellikle bir önceki seans kapanışının boş gelmesinden kaynaklanan
// hatalı veridir; bu satırları alternatif kaynaktan onarmaya çalışıyoruz.
const BIST_DAILY_LIMIT_PCT = 11;

const isSuspectQuote = (quote: Hisse): boolean =>
  !Number.isFinite(quote.degisimYuzde) ||
  Math.abs(quote.degisimYuzde) > BIST_DAILY_LIMIT_PCT;

/**
 * Yahoo verisinde mantıksız (±%11 üstü) günlük değişim gösteren satırları,
 * varsa alternatif ücretsiz kaynaktan (Twelve Data) temiz veriyle onarır.
 * Anahtar tanımlı değilse quote'lar aynen döner.
 */
async function repairSuspectQuotes(quotes: Hisse[]): Promise<Hisse[]> {
  if (!isTwelveDataEnabled()) return quotes;
  const suspects = quotes.filter(isSuspectQuote).map((q) => q.sembol);
  if (suspects.length === 0) return quotes;

  try {
    const altMap = await fetchTwelveDataQuotes(suspects);
    if (altMap.size === 0) return quotes;
    return quotes.map((quote) => {
      if (!isSuspectQuote(quote)) return quote;
      const alt = altMap.get(quote.sembol);
      if (!alt) return quote;
      return {
        ...quote,
        fiyat: alt.fiyat > 0 ? alt.fiyat : quote.fiyat,
        degisimYuzde: alt.degisimYuzde,
        veriKaynagi: "Twelve Data (BIST)",
      };
    });
  } catch (e) {
    logger.warn("collectApi", "Alternatif kaynak onarımı başarısız", e);
    return quotes;
  }
}

export const getBist100 = async (): Promise<Hisse[]> => {
  const stockSymbols = UNIQUE_BIST_STOCKS.map((stock) => stock.symbol);
  const symbols = stockSymbols.join(",");

  try {
    // Proxy ölü/erişilemez olduğunda her yenilemede tam ağ zaman aşımını
    // beklemeyip hızlıca Yahoo fallback'e geçmek için kısa süre koyuyoruz.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const response = await fetch(
      `${getApiBase()}/bist/quotes?symbols=${encodeURIComponent(symbols)}`,
      { signal: controller.signal },
    ).finally(() => clearTimeout(timeout));
    const contentType = response.headers.get("content-type") ?? "";

    // Expo web dev sunucusu /api için HTML fallback döndürebilir. HTML’i
    // quote yanıtı gibi parse etmeyip doğrudan güvenli fallback’e geçiyoruz.
    if (response.ok && contentType.includes("application/json")) {
      const payload = (await response.json()) as QuoteResponse;
      const quotes = validQuotes(
        (payload.quoteResponse?.result ?? []).map(normalizeQuote),
      );
      if (quotes.length > 0) return repairSuspectQuotes(quotes);
    }
  } catch (e) {
    logger.warn("collectApi", "Proxy quote istek hatası, Yahoo fallback deneniyor", e);
  }

  const fallbackQuotes = await fetchBatchQuotes(stockSymbols);
  return repairSuspectQuotes(
    validQuotes(
      fallbackQuotes.map((quote) => normalizeQuote(quote as QuoteRecord)),
    ),
  );
};

export const fetchHisseTemelDetay = async (
  _sembol: string,
): Promise<TemelVeri> => {
  return { fk: null, pddd: null };
};
